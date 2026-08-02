import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoChatHistory } from "./history";
import { CHAT_SHARE_MAX_BYTES, ChatShareTooLargeError, shareChatHistory } from "./upload";

const history: PaseoChatHistory = {
  format: "threadshare-history@v1",
  schemaVersion: 1,
  exportedAt: "2026-07-28T00:00:00.000Z",
  conversation: { id: "agent-1", title: "Shared conversation", source: "paseo" },
  entries: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareChatHistory", () => {
  it("uploads the history to the configured service and returns its viewer URL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "7b853015-bf1a-4c4c-b969-14e1247aef85" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareChatHistory({ baseUrl: "https://share.example.com", history })).resolves.toBe(
      "https://share.example.com/?id=7b853015-bf1a-4c4c-b969-14e1247aef85",
    );
    expect(fetchMock).toHaveBeenCalledWith("https://share.example.com/api/v1/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(history),
    });
  });

  it("reports an upload failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Storage is unavailable" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      shareChatHistory({ baseUrl: "https://share.example.com", history }),
    ).rejects.toThrow("Storage is unavailable");
  });

  it("compacts tool results only when the full history exceeds the upload limit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "7b853015-bf1a-4c4c-b969-14e1247aef85" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const largeHistory: PaseoChatHistory = {
      ...history,
      entries: [
        {
          id: "user-1",
          createdAt: "2026-07-28T00:00:00.000Z",
          kind: "message",
          role: "user",
          markdown: "Keep this user message exactly.",
        },
        {
          id: "tool-1",
          createdAt: "2026-07-28T00:00:01.000Z",
          kind: "tool",
          name: "cs-agent.cs_agent_events",
          status: "running",
          input: {
            type: "unknown",
            input: { runId: "run-1", cursor: 12 },
            output: "x".repeat(CHAT_SHARE_MAX_BYTES),
          },
        },
        {
          id: "assistant-1",
          createdAt: "2026-07-28T00:00:02.000Z",
          kind: "message",
          role: "assistant",
          markdown: "Keep this assistant message exactly.",
        },
        {
          id: "tool-1",
          createdAt: "2026-07-28T00:00:03.000Z",
          kind: "tool",
          name: "cs-agent.cs_agent_events",
          status: "completed",
          input: {
            type: "unknown",
            input: { runId: "run-1", cursor: 12 },
            output: "y".repeat(CHAT_SHARE_MAX_BYTES),
          },
          output: { events: "z".repeat(CHAT_SHARE_MAX_BYTES) },
        },
      ],
    };

    await expect(
      shareChatHistory({ baseUrl: "https://share.example.com", history: largeHistory }),
    ).resolves.toBe("https://share.example.com/?id=7b853015-bf1a-4c4c-b969-14e1247aef85");

    const request = fetchMock.mock.calls[0]?.[1];
    expect(typeof request?.body).toBe("string");
    const uploaded = JSON.parse(request?.body as string) as PaseoChatHistory;
    expect(uploaded.entries).toEqual([
      largeHistory.entries[0],
      {
        id: "tool-1",
        createdAt: "2026-07-28T00:00:01.000Z",
        kind: "tool",
        name: "cs-agent.cs_agent_events",
        status: "completed",
        input: { runId: "run-1", cursor: 12 },
      },
      largeHistory.entries[2],
    ]);
    expect(new TextEncoder().encode(request?.body as string).byteLength).toBeLessThanOrEqual(
      CHAT_SHARE_MAX_BYTES,
    );
  });

  it("keeps structured tool requests while dropping structured results", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "7b853015-bf1a-4c4c-b969-14e1247aef85" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const structuredHistory: PaseoChatHistory = {
      ...history,
      entries: [
        {
          id: "shell-1",
          createdAt: "2026-07-28T00:00:00.000Z",
          kind: "tool",
          name: "shell",
          status: "completed",
          input: {
            type: "shell",
            command: "npm test",
            cwd: "/workspace",
            output: "x".repeat(CHAT_SHARE_MAX_BYTES),
            exitCode: 0,
          },
        },
        {
          id: "search-1",
          createdAt: "2026-07-28T00:00:01.000Z",
          kind: "tool",
          name: "search",
          status: "completed",
          input: {
            type: "search",
            query: "shareChatHistory",
            toolName: "grep",
            mode: "content",
            content: "matched source",
            filePaths: ["upload.ts"],
            numMatches: 1,
          },
        },
        {
          id: "sub-agent-1",
          createdAt: "2026-07-28T00:00:02.000Z",
          kind: "tool",
          name: "Sub-agent",
          status: "failed",
          input: {
            type: "sub_agent",
            subAgentType: "explorer",
            description: "Inspect sharing",
            childSessionId: "child-1",
            log: "large result",
            actions: [{ index: 0, toolName: "read", summary: "Read upload.ts" }],
          },
          error: "child failed with a detailed stack trace",
        },
        {
          id: "worktree-1",
          createdAt: "2026-07-28T00:00:03.000Z",
          kind: "tool",
          name: "worktree_setup",
          status: "completed",
          input: {
            type: "worktree_setup",
            worktreePath: "/workspace/feature",
            branchName: "feature/share",
            log: "setup output",
            commands: [
              {
                index: 0,
                command: "npm install",
                cwd: "/workspace/feature",
                log: "install output",
                status: "completed",
                exitCode: 0,
                durationMs: 100,
              },
            ],
          },
        },
        {
          id: "question-1",
          createdAt: "2026-07-28T00:00:04.000Z",
          kind: "tool",
          name: "request_user_input",
          status: "running",
          input: {
            type: "plain_text",
            text: "Which environment should be deployed?",
            icon: "brain",
          },
        },
        {
          id: "question-1",
          createdAt: "2026-07-28T00:00:05.000Z",
          kind: "tool",
          name: "request_user_input",
          status: "completed",
          input: {
            type: "plain_text",
            text: "Which environment should be deployed?\n\nAnswers:\nproduction",
            icon: "brain",
          },
        },
        {
          id: "terminal-1",
          createdAt: "2026-07-28T00:00:06.000Z",
          kind: "tool",
          name: "terminal",
          status: "completed",
          input: {
            type: "plain_text",
            label: "npm publish",
            text: "yes\n",
            icon: "square_terminal",
          },
        },
        {
          id: "plan-1",
          createdAt: "2026-07-28T00:00:07.000Z",
          kind: "tool",
          name: "plan",
          status: "completed",
          input: { type: "plan", text: "Generated implementation plan" },
        },
        {
          id: "future-1",
          createdAt: "2026-07-28T00:00:08.000Z",
          kind: "tool",
          name: "future_tool",
          status: "completed",
          input: {
            type: "future_detail",
            query: "keep this request",
            customFlag: true,
            output: "drop this result",
            durationMs: 42,
          },
        },
        {
          id: "switch-mode-1",
          createdAt: "2026-07-28T00:00:09.000Z",
          kind: "tool",
          name: "switch_mode",
          status: "completed",
          input: {
            type: "plain_text",
            label: "Switch mode",
            text: "plan",
            icon: "sparkles",
          },
        },
      ],
    };

    await shareChatHistory({ baseUrl: "https://share.example.com", history: structuredHistory });

    const request = fetchMock.mock.calls[0]?.[1];
    const uploaded = JSON.parse(request?.body as string) as PaseoChatHistory;
    expect(uploaded.entries).toEqual([
      {
        id: "shell-1",
        createdAt: "2026-07-28T00:00:00.000Z",
        kind: "tool",
        name: "shell",
        status: "completed",
        input: { type: "shell", command: "npm test", cwd: "/workspace" },
      },
      {
        id: "search-1",
        createdAt: "2026-07-28T00:00:01.000Z",
        kind: "tool",
        name: "search",
        status: "completed",
        input: {
          type: "search",
          query: "shareChatHistory",
          toolName: "grep",
          mode: "content",
        },
      },
      {
        id: "sub-agent-1",
        createdAt: "2026-07-28T00:00:02.000Z",
        kind: "tool",
        name: "Sub-agent",
        status: "failed",
        input: {
          type: "sub_agent",
          subAgentType: "explorer",
          description: "Inspect sharing",
          childSessionId: "child-1",
        },
      },
      {
        id: "worktree-1",
        createdAt: "2026-07-28T00:00:03.000Z",
        kind: "tool",
        name: "worktree_setup",
        status: "completed",
        input: {
          type: "worktree_setup",
          worktreePath: "/workspace/feature",
          branchName: "feature/share",
          commands: [{ index: 0, command: "npm install", cwd: "/workspace/feature" }],
        },
      },
      {
        id: "question-1",
        createdAt: "2026-07-28T00:00:04.000Z",
        kind: "tool",
        name: "request_user_input",
        status: "completed",
        input: {
          type: "plain_text",
          text: "Which environment should be deployed?",
          icon: "brain",
        },
      },
      {
        id: "terminal-1",
        createdAt: "2026-07-28T00:00:06.000Z",
        kind: "tool",
        name: "terminal",
        status: "completed",
        input: {
          type: "plain_text",
          label: "npm publish",
          text: "yes\n",
          icon: "square_terminal",
        },
      },
      {
        id: "plan-1",
        createdAt: "2026-07-28T00:00:07.000Z",
        kind: "tool",
        name: "plan",
        status: "completed",
      },
      {
        id: "future-1",
        createdAt: "2026-07-28T00:00:08.000Z",
        kind: "tool",
        name: "future_tool",
        status: "completed",
        input: {
          type: "future_detail",
          query: "keep this request",
          customFlag: true,
          output: "drop this result",
          durationMs: 42,
        },
      },
      {
        id: "switch-mode-1",
        createdAt: "2026-07-28T00:00:09.000Z",
        kind: "tool",
        name: "switch_mode",
        status: "completed",
        input: {
          type: "plain_text",
          label: "Switch mode",
          text: "plan",
          icon: "sparkles",
        },
      },
    ]);
  });

  it("rejects histories whose messages still exceed the limit after tool compaction", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const largeMessageHistory: PaseoChatHistory = {
      ...history,
      entries: [
        {
          id: "assistant-1",
          createdAt: "2026-07-28T00:00:00.000Z",
          kind: "message",
          role: "assistant",
          markdown: "x".repeat(CHAT_SHARE_MAX_BYTES),
        },
      ],
    };

    const upload = shareChatHistory({
      baseUrl: "https://share.example.com",
      history: largeMessageHistory,
    });
    await expect(upload).rejects.toBeInstanceOf(ChatShareTooLargeError);
    await expect(upload).rejects.toMatchObject({ maxBytes: CHAT_SHARE_MAX_BYTES });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not guess how to compact future tool detail types", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const futureDetailHistory: PaseoChatHistory = {
      ...history,
      entries: [
        {
          id: "future-1",
          createdAt: "2026-07-28T00:00:00.000Z",
          kind: "tool",
          name: "future_tool",
          status: "completed",
          input: {
            type: "future_detail",
            status: "request-status",
            actions: ["request-action"],
            response: "x".repeat(CHAT_SHARE_MAX_BYTES),
          },
        },
      ],
    };

    await expect(
      shareChatHistory({ baseUrl: "https://share.example.com", history: futureDetailHistory }),
    ).rejects.toBeInstanceOf(ChatShareTooLargeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("measures the upload limit in UTF-8 bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "7b853015-bf1a-4c4c-b969-14e1247aef85" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const createHistory = (markdown: string): PaseoChatHistory => ({
      ...history,
      entries: [
        {
          id: "assistant-1",
          createdAt: "2026-07-28T00:00:00.000Z",
          kind: "message",
          role: "assistant",
          markdown,
        },
      ],
    });
    const emptyBodyBytes = new TextEncoder().encode(JSON.stringify(createHistory(""))).byteLength;
    const availableBytes = CHAT_SHARE_MAX_BYTES - emptyBodyBytes;
    const markdown = "界".repeat(Math.floor(availableBytes / 3)) + "a".repeat(availableBytes % 3);
    const atLimit = createHistory(markdown);

    expect(new TextEncoder().encode(JSON.stringify(atLimit)).byteLength).toBe(CHAT_SHARE_MAX_BYTES);
    await expect(
      shareChatHistory({ baseUrl: "https://share.example.com", history: atLimit }),
    ).resolves.toContain("?id=");

    await expect(
      shareChatHistory({
        baseUrl: "https://share.example.com",
        history: createHistory(`${markdown}a`),
      }),
    ).rejects.toBeInstanceOf(ChatShareTooLargeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed configured base URL", async () => {
    await expect(shareChatHistory({ baseUrl: "file:///tmp/share", history })).rejects.toThrow(
      "Chat sharing requires an HTTP or HTTPS service URL",
    );
  });
});
