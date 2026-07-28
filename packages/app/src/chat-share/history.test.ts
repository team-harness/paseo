import { describe, expect, it } from "vitest";
import { exportChatHistory } from "./history";
import type { StreamItem } from "@/types/stream";

describe("exportChatHistory", () => {
  it("exports a portable, versioned transcript without runtime-only fields", () => {
    const items: StreamItem[] = [
      {
        kind: "user_message",
        id: "user-1",
        messageId: "provider-user-id",
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
});
