import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TEAM_ERROR_CODES } from "@getpaseo/protocol/team/rpc-schemas";
import type { StoredTeam } from "@getpaseo/protocol/team/types";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamStore } from "./team-store.js";
import { TeamService, type TeamAgentGateway, type TeamRoomGateway } from "./team-service.js";
import { TeamSessionHandlers, type TeamOutboundMessage } from "./team-session.js";

const logger = createTestLogger();

const rooms: TeamRoomGateway = {
  createRoom: async () => {},
  discardRoom: async () => {},
};

const agents: TeamAgentGateway = {
  createAgent: async () => {},
  sendPrompt: async () => {},
  archiveAgent: async () => {},
  clearTeamLabels: async () => {},
  restoreTeamLabels: async () => {},
  getAgentState: async () => ({ kind: "active" as const }),
};

/**
 * The wire surface. Its one job beyond forwarding is to keep server-only state
 * off the wire — the record carries a creation plan and recruitment intents
 * that no client has any business seeing.
 */
describe("team session handlers", () => {
  let home: string;
  let store: TeamStore;
  let service: TeamService;
  let sent: TeamOutboundMessage[];
  let handlers: TeamSessionHandlers;

  function createRequest(overrides: Record<string, unknown> = {}) {
    return {
      type: "team.create.request" as const,
      requestId: "req-1",
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "Find what is eating the disk",
      lead: { role: "lead", provider: "claude" },
      members: [{ role: "server", provider: "codex" }],
      ...overrides,
    };
  }

  function payloadOf<T extends TeamOutboundMessage["type"]>(type: T) {
    const message = sent.find((candidate) => candidate.type === type);
    if (!message) throw new Error(`no ${type} was sent`);
    return message.payload as Extract<TeamOutboundMessage, { type: T }>["payload"];
  }

  function memberIdWithRole(team: StoredTeam, role: string): string {
    const entry = team.members.find((member) => member.role === role);
    if (!entry) throw new Error(`no member with role ${role}`);
    return entry.agentId;
  }

  function entryFor(
    team: { members: Array<{ agentId: string; state: string }> } | null | undefined,
    agentId: string,
  ) {
    return team?.members.find((member) => member.agentId === agentId);
  }

  async function seedTeam(): Promise<StoredTeam> {
    return await service.create({
      idempotencyKey: "seed",
      name: "Seeded",
      workspaceId: "ws-1",
      task: "task",
      lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
      members: [{ role: "server", provider: "codex", title: null, briefing: null, settings: null }],
      templateId: null,
    });
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-session-"));
    store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    service = new TeamService({ store, rooms, agents, logger });
    sent = [];
    handlers = new TeamSessionHandlers({
      service,
      store,
      send: (message) => sent.push(message),
      logger,
    });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  describe("creating", () => {
    test("answers with the team it built", async () => {
      await handlers.handle(createRequest());

      const payload = payloadOf("team.create.response");
      expect(payload.requestId).toBe("req-1");
      expect(payload.error).toBeNull();
      expect(payload.team?.lifecycle).toBe("active");
      expect(payload.team?.members).toHaveLength(2);
    });

    // The stored record carries a creation plan and recruitment intents. Those
    // are the daemon's working notes, and spreading the record onto the wire
    // would publish them.
    test("does not put the daemon's own bookkeeping on the wire", async () => {
      await handlers.handle(createRequest());

      const wire = JSON.stringify(payloadOf("team.create.response").team);
      expect(wire).not.toContain("creationPlan");
      expect(wire).not.toContain("requestFingerprint");
      expect(wire).not.toContain("pendingRecruitments");
      expect(wire).not.toContain("idempotencyKey");
    });

    test("reports a rejected request as an error rather than throwing", async () => {
      await handlers.handle(createRequest({ members: [{ role: "lead", provider: "codex" }] }));

      const payload = payloadOf("team.create.response");
      expect(payload.team).toBeNull();
      expect(payload.error).toMatch(/reserved/i);
    });

    // A client retrying with the same key needs to tell "your retry worked"
    // from "that key means something else now".
    test("names the conflict when a key is reused for a different request", async () => {
      await handlers.handle(createRequest());
      sent.length = 0;

      await handlers.handle(createRequest({ task: "something else" }));

      const payload = payloadOf("team.create.response");
      expect(payload.errorCode).toBe(TEAM_ERROR_CODES.idempotencyConflict);
    });

    test("broadcasts the new team", async () => {
      await handlers.handle(createRequest());

      expect(payloadOf("team.update").team.lifecycle).toBe("active");
    });
  });

  describe("listing", () => {
    test("leaves archived teams out unless they are asked for", async () => {
      const team = await seedTeam();
      await service.archive(team.id);

      await handlers.handle({ type: "team.list.request", requestId: "req-1" });
      expect(payloadOf("team.list.response").teams).toEqual([]);

      sent.length = 0;
      await handlers.handle({
        type: "team.list.request",
        requestId: "req-2",
        includeArchived: true,
      });
      expect(payloadOf("team.list.response").teams).toHaveLength(1);
    });
  });

  describe("inspecting", () => {
    test("answers with the team", async () => {
      const team = await seedTeam();

      await handlers.handle({ type: "team.inspect.request", requestId: "req-1", teamId: team.id });

      expect(payloadOf("team.inspect.response").team?.id).toBe(team.id);
    });

    test("says so when there is no such team", async () => {
      await handlers.handle({
        type: "team.inspect.request",
        requestId: "req-1",
        teamId: "nope",
      });

      const payload = payloadOf("team.inspect.response");
      expect(payload.team).toBeNull();
      expect(payload.error).toMatch(/not found/i);
    });
  });

  describe("archiving", () => {
    test("archives and broadcasts", async () => {
      const team = await seedTeam();

      await handlers.handle({ type: "team.archive.request", requestId: "req-1", teamId: team.id });

      expect(payloadOf("team.archive.response").team?.lifecycle).toBe("archived");
      expect(payloadOf("team.update").team.lifecycle).toBe("archived");
    });
  });

  describe("removing a member", () => {
    test("removes and broadcasts", async () => {
      const team = await seedTeam();
      const memberId = memberIdWithRole(team, "server");

      await handlers.handle({
        type: "team.member.remove.request",
        requestId: "req-1",
        teamId: team.id,
        agentId: memberId,
      });

      const payload = payloadOf("team.member.remove.response");
      expect(entryFor(payload.team, memberId)?.state).toBe("removed");
    });

    test("reports the refusal when asked to remove the lead", async () => {
      const team = await seedTeam();

      await handlers.handle({
        type: "team.member.remove.request",
        requestId: "req-1",
        teamId: team.id,
        agentId: team.leadAgentId,
      });

      const payload = payloadOf("team.member.remove.response");
      expect(payload.team).toBeNull();
      expect(payload.error).toMatch(/lead/i);
    });
  });
});
