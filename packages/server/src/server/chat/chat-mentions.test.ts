import { describe, expect, test, vi } from "vitest";
import type pino from "pino";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { ManagedAgent } from "../agent/agent-manager.js";
import {
  buildChatMentionNotification,
  notifyChatMentions,
  prepareChatMentionFanout,
} from "./chat-mentions.js";

function storedAgent(overrides: Partial<StoredAgentRecord> & { id: string }): StoredAgentRecord {
  return {
    internal: false,
    archivedAt: null,
    lastStatus: "idle",
    ...overrides,
  } as StoredAgentRecord;
}

function liveAgent(overrides: Partial<ManagedAgent> & { id: string }): ManagedAgent {
  return { internal: false, lifecycle: "idle", ...overrides } as ManagedAgent;
}

async function prepare(input: {
  authorAgentId: string;
  mentionAgentIds: string[];
  storedAgents?: StoredAgentRecord[];
  liveAgents?: ManagedAgent[];
  roomPosterAgentIds?: string[];
  limit?: number;
}) {
  const result = await prepareChatMentionFanout({
    authorAgentId: input.authorAgentId,
    mentionAgentIds: input.mentionAgentIds,
    storedAgents: input.storedAgents ?? [],
    liveAgents: input.liveAgents ?? [],
    listRoomPosterAgentIds: async () => input.roomPosterAgentIds ?? [],
    limit: input.limit,
  });
  if (!result.ok) {
    throw new Error(`expected ok prepare, got error: ${result.error}`);
  }
  return result.prepared;
}

describe("chat mentions", () => {
  test("@everyone in an empty room resolves to no targets", async () => {
    const prepared = await prepare({
      authorAgentId: "author-agent",
      mentionAgentIds: ["everyone"],
      storedAgents: [storedAgent({ id: "unrelated-agent" })],
      liveAgents: [liveAgent({ id: "live-unrelated-agent" })],
      roomPosterAgentIds: [],
    });

    expect(prepared.targetMentionAgentIds).toEqual([]);
  });

  test("@everyone in a single-poster room excludes the author", async () => {
    const prepared = await prepare({
      authorAgentId: "author-agent",
      mentionAgentIds: ["everyone"],
      storedAgents: [storedAgent({ id: "author-agent" })],
      roomPosterAgentIds: ["author-agent"],
    });

    expect(prepared.targetMentionAgentIds).toEqual([]);
  });

  test("@everyone only expands to active posters in the room", async () => {
    const prepared = await prepare({
      authorAgentId: "author-agent",
      mentionAgentIds: ["everyone"],
      storedAgents: [
        storedAgent({ id: "agent-a" }),
        storedAgent({ id: "agent-b" }),
        storedAgent({ id: "unrelated-agent" }),
      ],
      liveAgents: [liveAgent({ id: "agent-c" }), liveAgent({ id: "live-unrelated-agent" })],
      roomPosterAgentIds: ["agent-a", "agent-b", "agent-c"],
    });

    expect([...prepared.targetMentionAgentIds].sort()).toEqual(["agent-a", "agent-b", "agent-c"]);
  });

  // DEC-10 lists `error` as wakeable: it means the last turn failed, not that
  // the agent is unusable — the wake goes through `ensureAgentLoaded`, which is
  // how it recovers. Archived is the one that is genuinely out.
  test("@everyone excludes archived agents but still reaches error-state ones", async () => {
    const prepared = await prepare({
      authorAgentId: "author-agent",
      mentionAgentIds: ["everyone"],
      storedAgents: [
        storedAgent({ id: "active-agent" }),
        storedAgent({ id: "archived-agent", archivedAt: "2026-03-28T00:00:00.000Z" }),
        storedAgent({ id: "stored-error-agent", lastStatus: "error" }),
      ],
      liveAgents: [liveAgent({ id: "live-error-agent", lifecycle: "error" })],
      roomPosterAgentIds: [
        "active-agent",
        "archived-agent",
        "stored-error-agent",
        "live-error-agent",
      ],
    });

    expect(prepared.targetMentionAgentIds.sort()).toEqual([
      "active-agent",
      "live-error-agent",
      "stored-error-agent",
    ]);
  });

  test("wakes an error-state agent that was mentioned by name", async () => {
    const woken: string[] = [];
    await notifyChatMentions({
      room: "coord-room",
      authorAgentId: "author-agent",
      body: "@agent-error can you retry?",
      mentionAgentIds: ["agent-error"],
      logger: { warn: vi.fn() } as unknown as pino.Logger,
      storedAgents: [storedAgent({ id: "agent-error", lastStatus: "error" })],
      liveAgents: [liveAgent({ id: "agent-error", lifecycle: "error" })],
      prepared: { targetMentionAgentIds: ["agent-error"], roomPosterAgentIds: [] },
      resolveAgentIdentifier: async (identifier: string) => ({
        ok: true as const,
        agentId: identifier,
      }),
      sendAgentMessage: async (agentId: string) => {
        woken.push(agentId);
      },
    });

    expect(woken).toEqual(["agent-error"]);
  });

  // `archivedAt` is a durable fact and the stored record owns it. Nothing else
  // in that record decides eligibility, so an agent that is merely between
  // states cannot fall out of the room's reach.
  test("keeps an agent reachable whatever transient state the records disagree on", async () => {
    const prepared = await prepare({
      authorAgentId: "author-agent",
      mentionAgentIds: ["recovered-agent"],
      storedAgents: [storedAgent({ id: "recovered-agent", lastStatus: "error" })],
      liveAgents: [liveAgent({ id: "recovered-agent", lifecycle: "idle" })],
    });

    expect(prepared.targetMentionAgentIds).toEqual(["recovered-agent"]);
  });

  test("@everyone deduplicates with explicit mentions and keeps explicit non-everyone mentions", async () => {
    const prepared = await prepare({
      authorAgentId: "author-agent",
      mentionAgentIds: ["everyone", "agent-a", "custom-title"],
      storedAgents: [storedAgent({ id: "agent-a" })],
      liveAgents: [liveAgent({ id: "agent-b" })],
      roomPosterAgentIds: ["agent-a", "agent-b"],
    });

    expect([...prepared.targetMentionAgentIds].sort()).toEqual([
      "agent-a",
      "agent-b",
      "custom-title",
    ]);
  });

  test("does not list room posters when @everyone is not mentioned", async () => {
    const listRoomPosterAgentIds = vi.fn(async () => []);
    const result = await prepareChatMentionFanout({
      authorAgentId: "author-agent",
      mentionAgentIds: ["agent-a"],
      storedAgents: [storedAgent({ id: "agent-a" })],
      liveAgents: [],
      listRoomPosterAgentIds,
    });

    expect(result.ok).toBe(true);
    expect(listRoomPosterAgentIds).not.toHaveBeenCalled();
  });

  test("rejects @everyone fan-out above the hard cap", async () => {
    const posters = Array.from({ length: 26 }, (_, index) => `agent-${index}`);
    const result = await prepareChatMentionFanout({
      authorAgentId: "author-agent",
      mentionAgentIds: ["everyone"],
      storedAgents: posters.map((id) => storedAgent({ id })),
      liveAgents: [],
      listRoomPosterAgentIds: async () => posters,
    });

    expect(result).toEqual({
      ok: false,
      error:
        "@everyone would notify 26 agents, which exceeds the limit of 25. Narrow the room or mention specific agents.",
    });
  });

  test("notification body strips inline mentions but keeps the room context", () => {
    expect(
      buildChatMentionNotification({
        room: "coord-room",
        authorAgentId: "author-agent",
        body: "@agent-a @everyone Check the latest status.",
        mentionAgentIds: ["agent-a", "everyone"],
      }),
    ).toContain("Check the latest status.");
  });

  test("notifyChatMentions delegates sends for resolved targets", async () => {
    const resolveAgentIdentifier = vi.fn(async (identifier: string) => ({
      ok: true as const,
      agentId: identifier,
    }));
    const sendAgentMessage = vi.fn(async () => {});
    const logger = {
      warn: vi.fn(),
    } as unknown as pino.Logger;

    const storedAgents = [storedAgent({ id: "agent-a" })];
    const liveAgents = [liveAgent({ id: "agent-b" })];

    await notifyChatMentions({
      room: "coord-room",
      authorAgentId: "author-agent",
      body: "@everyone Check status",
      mentionAgentIds: ["everyone"],
      logger,
      storedAgents,
      liveAgents,
      prepared: {
        targetMentionAgentIds: ["agent-a", "agent-b"],
        roomPosterAgentIds: ["agent-a", "agent-b"],
      },
      resolveAgentIdentifier,
      sendAgentMessage,
    });

    expect(resolveAgentIdentifier).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-a",
      expect.stringContaining('room "coord-room"'),
    );
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-b",
      expect.stringContaining("Check status"),
    );
  });

  // DEC-10. A mention is a nudge, not an interrupt. An agent mid-turn has the
  // message in the room already and will read it when it looks; waking it would
  // cancel the work someone else is waiting on.
  describe("waking a mentioned agent", () => {
    async function notifyOne(input: {
      agentId: string;
      storedAgents?: StoredAgentRecord[];
      liveAgents?: ManagedAgent[];
    }): Promise<string[]> {
      const woken: string[] = [];
      await notifyChatMentions({
        room: "coord-room",
        authorAgentId: "author-agent",
        body: `@${input.agentId} status?`,
        mentionAgentIds: [input.agentId],
        logger: { warn: vi.fn() } as unknown as pino.Logger,
        storedAgents: input.storedAgents ?? [],
        liveAgents: input.liveAgents ?? [],
        prepared: {
          targetMentionAgentIds: [input.agentId],
          roomPosterAgentIds: [],
        },
        resolveAgentIdentifier: async (identifier: string) => ({
          ok: true as const,
          agentId: identifier,
        }),
        sendAgentMessage: async (agentId: string) => {
          woken.push(agentId);
        },
      });
      return woken;
    }

    // The agent went from idle to running between the check and the send, so
    // the manager refuses the run. That is the non-interrupting outcome working
    // as intended, and it must not cost the other mentioned agents their nudge.
    test("gives up quietly when the agent starts a turn mid-send", async () => {
      const woken: string[] = [];
      await notifyChatMentions({
        room: "coord-room",
        authorAgentId: "author-agent",
        body: "@agent-a @agent-b status?",
        mentionAgentIds: ["agent-a", "agent-b"],
        logger: { warn: vi.fn() } as unknown as pino.Logger,
        storedAgents: [storedAgent({ id: "agent-a" }), storedAgent({ id: "agent-b" })],
        liveAgents: [
          liveAgent({ id: "agent-a", lifecycle: "idle" }),
          liveAgent({ id: "agent-b", lifecycle: "idle" }),
        ],
        prepared: {
          targetMentionAgentIds: ["agent-a", "agent-b"],
          roomPosterAgentIds: [],
        },
        resolveAgentIdentifier: async (identifier: string) => ({
          ok: true as const,
          agentId: identifier,
        }),
        sendAgentMessage: async (agentId: string) => {
          if (agentId === "agent-a") {
            throw new Error("Agent agent-a already has an active run");
          }
          woken.push(agentId);
        },
      });

      expect(woken).toEqual(["agent-b"]);
    });

    test("wakes an agent that is live and idle", async () => {
      const woken = await notifyOne({
        agentId: "agent-a",
        storedAgents: [storedAgent({ id: "agent-a" })],
        liveAgents: [liveAgent({ id: "agent-a", lifecycle: "idle" })],
      });

      expect(woken).toEqual(["agent-a"]);
    });

    // No live entry means no session in memory, which is exactly the agent that
    // needs waking rather than the one that must be left alone.
    test("wakes an agent that only exists in storage", async () => {
      const woken = await notifyOne({
        agentId: "agent-a",
        storedAgents: [storedAgent({ id: "agent-a", lastStatus: "closed" })],
        liveAgents: [],
      });

      expect(woken).toEqual(["agent-a"]);
    });

    // Not-running is not the same as wakeable. An initializing agent is busy
    // starting up, and waking it either races its own first turn or is refused.
    test("leaves an initializing agent alone", async () => {
      const woken = await notifyOne({
        agentId: "agent-a",
        storedAgents: [storedAgent({ id: "agent-a", lastStatus: "initializing" })],
        liveAgents: [liveAgent({ id: "agent-a", lifecycle: "initializing" })],
      });

      expect(woken).toEqual([]);
    });

    test("leaves a running agent alone", async () => {
      const woken = await notifyOne({
        agentId: "agent-a",
        storedAgents: [storedAgent({ id: "agent-a", lastStatus: "running" })],
        liveAgents: [liveAgent({ id: "agent-a", lifecycle: "running" })],
      });

      expect(woken).toEqual([]);
    });

    // Live state is the truth. A stale stored record saying "running" must not
    // veto a wake, and a stale one saying "idle" must not cause an interrupt.
    test("believes the live agent over a stale stored record", async () => {
      const wokenDespiteStaleRunning = await notifyOne({
        agentId: "agent-a",
        storedAgents: [storedAgent({ id: "agent-a", lastStatus: "running" })],
        liveAgents: [liveAgent({ id: "agent-a", lifecycle: "idle" })],
      });
      expect(wokenDespiteStaleRunning).toEqual(["agent-a"]);

      const skippedDespiteStaleIdle = await notifyOne({
        agentId: "agent-a",
        storedAgents: [storedAgent({ id: "agent-a", lastStatus: "idle" })],
        liveAgents: [liveAgent({ id: "agent-a", lifecycle: "running" })],
      });
      expect(skippedDespiteStaleIdle).toEqual([]);
    });
  });
});
