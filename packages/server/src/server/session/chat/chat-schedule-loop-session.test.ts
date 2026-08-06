import { describe, expect, it } from "vitest";
import pino from "pino";
import {
  ChatScheduleLoopSession,
  type ChatScheduleLoopSessionHost,
} from "./chat-schedule-loop-session.js";
import { createStub } from "../../test-utils/class-mocks.js";
import { findByType } from "../../test-utils/session-stubs.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { ChatServiceError, type FileBackedChatService } from "../../chat/chat-service.js";
import type { ScheduleService } from "../../schedule/service.js";
import type { LoopService } from "../../loop-service.js";

type ChatMessageFixture = Awaited<ReturnType<FileBackedChatService["post"]>>;

interface MakeOptions {
  chat?: { [K in keyof FileBackedChatService]?: unknown };
  schedule?: { [K in keyof ScheduleService]?: unknown };
  loop?: { [K in keyof LoopService]?: unknown };
  host?: Partial<ChatScheduleLoopSessionHost>;
}

function makeSubsystem(options: MakeOptions = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const sentAgentMessages: Array<{ agentId: string; text: string }> = [];
  let onSend: (() => void) | null = null;
  const host: ChatScheduleLoopSessionHost = {
    emit: (msg) => emitted.push(msg),
    listStoredAgents: async () => [],
    listLiveAgents: () => [],
    resolveAgentIdentifier: async (identifier) => ({ ok: true, agentId: identifier }),
    sendAgentMessage: async (agentId, text) => {
      sentAgentMessages.push({ agentId, text });
      onSend?.();
    },
    ...options.host,
  };
  const subsystem = new ChatScheduleLoopSession({
    host,
    chatService: createStub<FileBackedChatService>(options.chat ?? {}),
    scheduleService: createStub<ScheduleService>(options.schedule ?? {}),
    loopService: createStub<LoopService>(options.loop ?? {}),
    clientId: "client-1",
    logger: pino({ level: "silent" }),
  });
  // notifyChatMentions is fire-and-forget; arm the signal before dispatching so the
  // mentioned-agent send is observed deterministically without polling.
  function waitForSend(): Promise<void> {
    return new Promise((resolve) => {
      onSend = resolve;
    });
  }
  return { subsystem, emitted, sentAgentMessages, waitForSend };
}

describe("ChatScheduleLoopSession", () => {
  // Mention fanout moved behind the chat store so an agent tool posting a
  // message wakes the same people as a human posting one. What is left here is
  // the handler's own job: name the author and relay the result.
  it("chat/post attributes a bare post to the human on this socket", async () => {
    const message: ChatMessageFixture = {
      id: "m1",
      roomId: "r1",
      authorAgentId: "client-1",
      body: "hello",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      author: { kind: "human", id: "client-1" },
    };
    const posted: Array<{ actor: { kind: string; id: string } }> = [];
    const { subsystem, emitted } = makeSubsystem({
      chat: {
        post: async (input: { actor: { kind: string; id: string } }) => {
          posted.push(input);
          return message;
        },
      },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p1",
      room: "r1",
      body: "hello",
    });

    expect(posted[0]?.actor).toEqual({ kind: "human", id: "client-1" });
    const res = findByType(emitted, "chat/post/response");
    expect(res?.payload.message).toEqual(message);
    expect(res?.payload.error).toBeNull();
  });

  it("chat/post attributes a post carrying an author id to that agent", async () => {
    const message: ChatMessageFixture = {
      id: "m2",
      roomId: "r1",
      authorAgentId: "agent-7",
      body: "on it",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      author: { kind: "agent", id: "agent-7" },
    };
    const posted: Array<{ actor: { kind: string; id: string } }> = [];
    const { subsystem } = makeSubsystem({
      chat: {
        post: async (input: { actor: { kind: string; id: string } }) => {
          posted.push(input);
          return message;
        },
      },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p2",
      room: "r1",
      body: "on it",
      authorAgentId: "agent-7",
    });

    expect(posted[0]?.actor).toEqual({ kind: "agent", id: "agent-7" });
  });

  it("chat/post surfaces a refused mention storm as a chat error", async () => {
    const { subsystem, emitted } = makeSubsystem({
      chat: {
        post: async () => {
          throw new ChatServiceError(
            "chat_mention_fanout_limit_exceeded",
            "Too many mentioned agents",
          );
        },
      },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p3",
      room: "r1",
      body: "@everyone go",
    });

    const err = findByType(emitted, "rpc_error");
    expect(err?.payload.code).toBe("chat_mention_fanout_limit_exceeded");
    expect(err?.payload.requestId).toBe("p3");
  });

  it("schedule/create returns a summary with the runs stripped", async () => {
    const stored = {
      id: "s1",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "a" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
          status: "running" as const,
          agentId: null,
          output: null,
          error: null,
        },
      ],
    };
    const { subsystem, emitted } = makeSubsystem({ schedule: { create: async () => stored } });

    await subsystem.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc1",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "agent", agentId: "a" },
    });

    const res = findByType(emitted, "schedule/create/response");
    expect(res?.payload.schedule).toBeDefined();
    expect(res?.payload.schedule).not.toHaveProperty("runs");
    expect(res?.payload.schedule.id).toBe("s1");
  });

  it("schedule/create remaps a self target to an agent target before creating", async () => {
    let received: Parameters<ScheduleService["create"]>[0] | undefined;
    const stored = {
      id: "s2",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const { subsystem, emitted } = makeSubsystem({
      schedule: {
        create: async (input: Parameters<ScheduleService["create"]>[0]) => {
          received = input;
          return stored;
        },
      },
    });

    await subsystem.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc2",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "self", agentId: "agent-9" },
    });

    expect(received?.target).toEqual({ type: "agent", agentId: "agent-9" });
    expect(findByType(emitted, "schedule/create/response")?.payload.error).toBeNull();
  });

  it("loop/run emits the loop summary from the loop service", async () => {
    const loop = { id: "loop-1", status: "running" };
    const { subsystem, emitted } = makeSubsystem({ loop: { runLoop: async () => loop } });

    await subsystem.handleLoopRunRequest({
      type: "loop/run",
      requestId: "l1",
      prompt: "p",
      cwd: "/tmp/loop",
    });

    const res = findByType(emitted, "loop/run/response");
    expect(res?.payload.loop).toEqual(loop);
  });
});
