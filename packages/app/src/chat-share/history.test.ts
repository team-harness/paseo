import { describe, expect, it } from "vitest";
import type {
  DaemonClient,
  FetchAgentTimelinePayload,
  ProviderSubagentTimelinePayload,
} from "@getpaseo/client/internal/daemon-client";
import {
  exportChatHistory,
  loadCompleteChatHistory,
  loadCompleteProviderSubagentChatHistory,
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

function makeProviderSubagentTimelinePage(input: {
  direction: "tail" | "before";
  hasOlder: boolean;
  rows: ProviderSubagentTimelinePayload["rows"];
}): ProviderSubagentTimelinePayload {
  return {
    requestId: `request-${input.direction}`,
    parentAgentId: "parent-1",
    subagentId: "subagent-1",
    provider: "codex",
    direction: input.direction,
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 3, nextSeq: 4 },
    hasOlder: input.hasOlder,
    hasNewer: false,
    rows: input.rows,
    error: null,
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
      format: "threadshare-history@v1",
      schemaVersion: 1,
      exportedAt: "2026-07-28T00:01:00.000Z",
      conversation: {
        id: "agent-1",
        title: "Release review",
        source: "paseo",
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

  it("redacts credentials from every exported visible text field", () => {
    const timestamp = new Date("2026-07-28T00:00:00.000Z");
    const history = exportChatHistory({
      agentId: "agent-1",
      title: "password=title-secret",
      exportedAt: timestamp,
      items: [
        { kind: "user_message", id: "user-1", text: "apiKey=user-secret", timestamp },
        {
          kind: "assistant_message",
          id: "assistant-1",
          text: "ghp_1234567890",
          timestamp,
        },
        {
          kind: "thought",
          id: "thought-1",
          text: "password=thought-secret",
          status: "ready",
          timestamp,
        },
        {
          kind: "todo_list",
          id: "todo-1",
          provider: "codex",
          items: [{ text: "password=todo-secret", completed: false }],
          timestamp,
        },
        {
          kind: "activity_log",
          id: "activity-1",
          activityType: "info",
          message: "postgres://alice:database-password@db.invalid/app",
          timestamp,
        },
      ],
    });

    expect(history.conversation.title).toBe("password=[REDACTED]");
    expect(history.entries).toEqual([
      {
        id: "user-1",
        createdAt: "2026-07-28T00:00:00.000Z",
        kind: "message",
        role: "user",
        markdown: "apiKey=[REDACTED]",
      },
      {
        id: "assistant-1",
        createdAt: "2026-07-28T00:00:00.000Z",
        kind: "message",
        role: "assistant",
        markdown: "[REDACTED]",
      },
      {
        id: "thought-1",
        createdAt: "2026-07-28T00:00:00.000Z",
        kind: "thought",
        text: "password=[REDACTED]",
        status: "ready",
      },
      {
        id: "todo-1",
        createdAt: "2026-07-28T00:00:00.000Z",
        kind: "todo",
        items: [{ text: "password=[REDACTED]", completed: false }],
      },
      {
        id: "activity-1",
        createdAt: "2026-07-28T00:00:00.000Z",
        kind: "activity",
        message: "postgres://alice:[REDACTED]@db.invalid/app",
        level: "info",
      },
    ]);
  });

  it("redacts credentials from exported tool data without hiding token metrics", () => {
    const items: StreamItem[] = [
      {
        kind: "tool_call",
        id: "tool-with-secrets",
        timestamp: new Date("2026-07-28T00:00:02.000Z"),
        payload: {
          source: "orchestrator",
          data: {
            toolCallId: "call-with-secrets",
            toolName: "request",
            arguments: {
              apiKey: "sk-private-api-key",
              nested: {
                authorization: "Bearer abc12345",
                tokenCount: 42,
                input_tokens: 100,
                authorizationStatus: "enabled",
              },
              databaseUrl: "postgres://alice:database-password@db.invalid/app",
            },
            result: {
              response:
                "password=hunter2 ghp_1234567890 Basic dTpw Bearer abc12345 Basic authentication is standardized. Bearer authentication is standardized. Explain bearer authorization headers. Authorization: Bearer authentication",
            },
            status: "completed",
          },
        },
      },
    ];

    expect(
      exportChatHistory({
        agentId: "agent-1",
        title: "Credential test",
        items,
        exportedAt: new Date("2026-07-28T00:01:00.000Z"),
      }).entries,
    ).toEqual([
      {
        id: "tool-with-secrets",
        createdAt: "2026-07-28T00:00:02.000Z",
        kind: "tool",
        name: "request",
        status: "completed",
        input: {
          apiKey: "[REDACTED]",
          nested: {
            authorization: "[REDACTED]",
            tokenCount: 42,
            input_tokens: 100,
            authorizationStatus: "enabled",
          },
          databaseUrl: "postgres://alice:[REDACTED]@db.invalid/app",
        },
        output: {
          response:
            "password=[REDACTED] [REDACTED] Basic [REDACTED] Bearer [REDACTED] Basic authentication is standardized. Bearer authentication is standardized. Explain bearer authorization headers. Authorization: [REDACTED]",
        },
      },
    ]);
  });

  it("redacts nested credentials in stringified JSON without changing its structure", () => {
    const json =
      '{"outer":{"config":{"password":"hunter2","safe":1},"list":[{"apiKey":"secret","nested":{"token":"short"}}]},"snowflake":9007199254740993,"precise":0.12345678901234567890}';
    const items: StreamItem[] = [
      {
        kind: "tool_call",
        id: "tool-with-json",
        timestamp: new Date("2026-07-28T00:00:02.000Z"),
        payload: {
          source: "orchestrator",
          data: {
            toolCallId: "call-with-json",
            toolName: "read_config",
            arguments: {},
            result: json,
            status: "completed",
          },
        },
      },
    ];

    const entry = exportChatHistory({ agentId: "agent-1", title: "JSON", items }).entries[0];
    expect(entry).toEqual({
      id: "tool-with-json",
      createdAt: "2026-07-28T00:00:02.000Z",
      kind: "tool",
      name: "read_config",
      status: "completed",
      input: {},
      output:
        '{"outer":{"config":{"password":"[REDACTED]","safe":1},"list":[{"apiKey":"[REDACTED]","nested":{"token":"[REDACTED]"}}]},"snowflake":9007199254740993,"precise":0.12345678901234567890}',
    });
  });

  it("preserves prose about bearer authentication in exported tool output", () => {
    const items: StreamItem[] = [
      {
        kind: "tool_call",
        id: "tool-with-docs",
        timestamp: new Date("2026-07-28T00:00:02.000Z"),
        payload: {
          source: "orchestrator",
          data: {
            toolCallId: "call-with-docs",
            toolName: "read_docs",
            arguments: {},
            result: "Bearer authentication is standardized. Explain bearer authorization headers.",
            status: "completed",
          },
        },
      },
    ];

    expect(
      exportChatHistory({ agentId: "agent-1", title: "Docs", items }).entries[0],
    ).toMatchObject({
      output: "Bearer authentication is standardized. Explain bearer authorization headers.",
    });
  });

  it("redacts authorization credentials and short bearer tokens without hiding prose", () => {
    const text = [
      "Authorization: Token abc12345",
      "Authorization: Bearer abc",
      "Bearer abc",
      "Bearer middleware validates requests",
      "Bearer authentication is standardized.",
    ].join("\n");
    const items: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "assistant-with-auth",
        text,
        timestamp: new Date("2026-07-28T00:00:02.000Z"),
      },
    ];

    expect(exportChatHistory({ agentId: "agent-1", title: "Auth", items }).entries[0]).toEqual({
      id: "assistant-with-auth",
      createdAt: "2026-07-28T00:00:02.000Z",
      kind: "message",
      role: "assistant",
      markdown: [
        "Authorization: [REDACTED]",
        "Authorization: [REDACTED]",
        "Bearer [REDACTED]",
        "Bearer middleware validates requests",
        "Bearer authentication is standardized.",
      ].join("\n"),
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

  it("loads every page of a Codex provider subagent before exporting", async () => {
    const pages = [
      makeProviderSubagentTimelinePage({
        direction: "tail",
        hasOlder: true,
        rows: [
          {
            seq: 3,
            timestamp: "2026-07-28T00:00:03.000Z",
            item: makeAssistantEntry(3, "Newest").item,
          },
        ],
      }),
      makeProviderSubagentTimelinePage({
        direction: "before",
        hasOlder: false,
        rows: [
          {
            seq: 1,
            timestamp: "2026-07-28T00:00:01.000Z",
            item: makeAssistantEntry(1, "Oldest").item,
          },
          {
            seq: 2,
            timestamp: "2026-07-28T00:00:02.000Z",
            item: makeAssistantEntry(2, "Middle").item,
          },
        ],
      }),
    ];
    const requests: Parameters<DaemonClient["fetchProviderSubagentTimeline"]>[2][] = [];
    const client = {
      async fetchProviderSubagentTimeline(
        _parentAgentId: string,
        _subagentId: string,
        request: Parameters<DaemonClient["fetchProviderSubagentTimeline"]>[2],
      ) {
        requests.push(request);
        const page = pages.shift();
        if (!page) throw new Error("Unexpected timeline request");
        return page;
      },
    };

    const items = await loadCompleteProviderSubagentChatHistory({
      client,
      parentAgentId: "parent-1",
      subagentId: "subagent-1",
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
      { direction: "tail", limit: 40 },
      { direction: "before", cursor: { epoch: "epoch-1", seq: 3 }, limit: 40 },
    ]);
  });
});
