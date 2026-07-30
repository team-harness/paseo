import { describe, expect, it } from "vitest";
import type {
  DaemonClient,
  FetchAgentTimelinePayload,
} from "@getpaseo/client/internal/daemon-client";
import {
  exportChatHistory,
  loadCompleteChatHistory,
  selectChatHistoryFromUserMessage,
} from "./history";
import type { StreamItem } from "@/types/stream";

function makeTimelinePage(input: {
  direction: "tail" | "before";
  hasOlder: boolean;
  startSeq: number;
  endSeq: number;
  entries: FetchAgentTimelinePayload["entries"];
}): FetchAgentTimelinePayload {
  return {
    requestId: `request-${input.direction}-${input.startSeq}`,
    agentId: "agent-1",
    agent: null,
    direction: input.direction,
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 3, nextSeq: 4 },
    startCursor: { epoch: "epoch-1", seq: input.startSeq },
    endCursor: { epoch: "epoch-1", seq: input.endSeq },
    hasOlder: input.hasOlder,
    hasNewer: false,
    entries: input.entries,
    error: null,
  };
}

function makeAssistantEntry(
  seq: number,
  text: string,
): FetchAgentTimelinePayload["entries"][number] {
  return {
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
    provider: "codex",
    item: { type: "assistant_message", text, messageId: `assistant-${seq}` },
    timestamp: `2026-07-28T00:00:0${seq}.000Z`,
  };
}

describe("exportChatHistory", () => {
  it("exports a portable, versioned transcript without runtime-only fields", () => {
    const items: StreamItem[] = [
      {
        kind: "user_message",
        id: "user-1",
        text: "Summarize this",
        timestamp: new Date("2026-07-28T00:00:00.000Z"),
      },
      {
        kind: "assistant_message",
        id: "assistant-1",
        messageId: "provider-assistant-id",
        timelineCursor: { epoch: "live", seq: 4 },
        text: "## Summary\n\nDone",
        timestamp: new Date("2026-07-28T00:00:01.000Z"),
      },
      {
        kind: "tool_call",
        id: "tool-1",
        timestamp: new Date("2026-07-28T00:00:02.000Z"),
        payload: {
          source: "orchestrator",
          data: {
            toolCallId: "call-1",
            toolName: "read_file",
            arguments: { path: "README.md", size: BigInt(4) },
            result: { ok: true },
            status: "completed",
          },
        },
      },
    ];

    expect(
      exportChatHistory({
        agentId: "agent-1",
        title: "Release review",
        provider: "codex",
        model: "gpt-5",
        items,
        exportedAt: new Date("2026-07-28T00:01:00.000Z"),
      }),
    ).toEqual({
      schemaVersion: 1,
      exportedAt: "2026-07-28T00:01:00.000Z",
      conversation: {
        id: "agent-1",
        title: "Release review",
        provider: "codex",
        model: "gpt-5",
      },
      entries: [
        {
          id: "user-1",
          createdAt: "2026-07-28T00:00:00.000Z",
          kind: "message",
          role: "user",
          markdown: "Summarize this",
        },
        {
          id: "assistant-1",
          createdAt: "2026-07-28T00:00:01.000Z",
          kind: "message",
          role: "assistant",
          markdown: "## Summary\n\nDone",
        },
        {
          id: "tool-1",
          createdAt: "2026-07-28T00:00:02.000Z",
          kind: "tool",
          name: "read_file",
          status: "completed",
          input: { path: "README.md", size: "4" },
          output: { ok: true },
        },
      ],
    });
  });

  it("starts a shared history at the selected user message", () => {
    const items: StreamItem[] = [
      {
        kind: "user_message",
        id: "user-1",
        text: "First request",
        timestamp: new Date("2026-07-28T00:00:00.000Z"),
      },
      {
        kind: "assistant_message",
        id: "assistant-1",
        text: "First response",
        timestamp: new Date("2026-07-28T00:00:01.000Z"),
      },
      {
        kind: "tool_call",
        id: "tool-1",
        timestamp: new Date("2026-07-28T00:00:02.000Z"),
        payload: {
          source: "orchestrator",
          data: {
            toolCallId: "call-1",
            toolName: "read_file",
            arguments: {},
            result: { ok: true },
            status: "completed",
          },
        },
      },
      {
        kind: "user_message",
        id: "user-2",
        text: "Second request",
        timestamp: new Date("2026-07-28T00:00:03.000Z"),
      },
      {
        kind: "assistant_message",
        id: "assistant-2",
        text: "Second response",
        timestamp: new Date("2026-07-28T00:00:04.000Z"),
      },
    ];

    expect(selectChatHistoryFromUserMessage(items, "user-2")?.map((item) => item.id)).toEqual([
      "user-2",
      "assistant-2",
    ]);
    expect(selectChatHistoryFromUserMessage(items, "missing")).toBeNull();
  });

  it("loads every older projected page before exporting", async () => {
    const pages = [
      makeTimelinePage({
        direction: "tail",
        hasOlder: true,
        startSeq: 3,
        endSeq: 3,
        entries: [makeAssistantEntry(3, "Newest")],
      }),
      makeTimelinePage({
        direction: "before",
        hasOlder: false,
        startSeq: 1,
        endSeq: 2,
        entries: [makeAssistantEntry(1, "Oldest"), makeAssistantEntry(2, "Middle")],
      }),
    ];
    const requests: Parameters<DaemonClient["fetchAgentTimeline"]>[1][] = [];
    const client = {
      async fetchAgentTimeline(
        _agentId: string,
        request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
      ) {
        requests.push(request);
        const page = pages.shift();
        if (!page) {
          throw new Error("Unexpected timeline request");
        }
        return page;
      },
    };

    const items = await loadCompleteChatHistory({
      client,
      agentId: "agent-1",
      localTail: [],
      liveHead: [],
    });

    expect(
      items
        .filter(
          (item): item is Extract<StreamItem, { kind: "assistant_message" }> =>
            item.kind === "assistant_message",
        )
        .map((item) => item.text)
        .join(""),
    ).toBe("OldestMiddleNewest");
    expect(requests).toEqual([
      { direction: "tail", limit: 40, projection: "projected" },
      {
        direction: "before",
        cursor: { epoch: "epoch-1", seq: 3 },
        limit: 40,
        projection: "projected",
      },
    ]);
  });
});
