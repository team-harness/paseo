import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { TEAM_ID_LABEL, TEAM_ROLE_LABEL } from "@getpaseo/protocol/agent-labels";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamStore } from "./team-store.js";
import { TeamService, type TeamAgentGateway, type TeamRoomGateway } from "./team-service.js";

const logger = createTestLogger();

/**
 * DEC-2. Creation touches four things that can each outlive a crash: the team
 * record, a chat room, one agent per member, and the prompts that brief them.
 * The record is written first and carries the whole plan, so every later step
 * is a replay of something already decided rather than a fresh decision.
 */
describe("TeamService creation", () => {
  let home: string;
  let store: TeamStore;
  let rooms: FakeRoomGateway;
  let agents: FakeAgentGateway;
  let service: TeamService;

  class FakeRoomGateway implements TeamRoomGateway {
    readonly created: Array<{ roomId: string; name: string; ownerId: string }> = [];
    readonly discarded: string[] = [];

    async createRoom(input: {
      roomId: string;
      name: string;
      displayName: string;
      ownerId: string;
    }): Promise<void> {
      this.created.push({ roomId: input.roomId, name: input.name, ownerId: input.ownerId });
    }

    async discardRoom(input: { roomId: string; ownerId: string }): Promise<void> {
      this.discarded.push(input.roomId);
    }
  }

  class FakeAgentGateway implements TeamAgentGateway {
    readonly created: Array<{ agentId: string; provider: string; labels: Record<string, string> }> =
      [];
    readonly prompts: Array<{ agentId: string; prompt: string; clientMessageId: string }> = [];
    readonly archived: string[] = [];

    async createAgent(input: {
      agentId: string;
      provider: string;
      workspaceId: string;
      title: string | null;
      settings: Record<string, unknown> | null;
      labels: Record<string, string>;
    }): Promise<void> {
      this.created.push({
        agentId: input.agentId,
        provider: input.provider,
        labels: input.labels,
      });
    }

    async sendPrompt(input: {
      agentId: string;
      prompt: string;
      clientMessageId: string;
    }): Promise<void> {
      this.prompts.push(input);
    }

    async archiveAgent(agentId: string): Promise<void> {
      this.archived.push(agentId);
    }
  }

  function createRequest(overrides: Partial<Parameters<TeamService["create"]>[0]> = {}) {
    return {
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "Find what is eating the disk",
      lead: { role: "lead", provider: "claude", title: "Lead", briefing: null, settings: null },
      members: [
        { role: "server", provider: "codex", title: null, briefing: null, settings: null },
        { role: "app", provider: "claude", title: null, briefing: null, settings: null },
      ],
      templateId: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-service-"));
    store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    rooms = new FakeRoomGateway();
    agents = new FakeAgentGateway();
    service = new TeamService({ store, rooms, agents, logger });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("lands an active team with a room, an agent per member, and a briefing each", async () => {
    const team = await service.create(createRequest());

    expect(team.lifecycle).toBe("active");
    expect(team.members).toHaveLength(3);
    expect(rooms.created).toHaveLength(1);
    expect(agents.created.map((agent) => agent.provider)).toEqual(["claude", "codex", "claude"]);
    expect(agents.prompts).toHaveLength(3);
  });

  test("labels every agent with its team and role", async () => {
    const team = await service.create(createRequest());

    for (const created of agents.created) {
      expect(created.labels[TEAM_ID_LABEL]).toBe(team.id);
    }
    expect(agents.created.map((agent) => agent.labels[TEAM_ROLE_LABEL])).toEqual([
      "lead",
      "server",
      "app",
    ]);
  });

  // The room belongs to the team, so only the team can remove it. Its internal
  // name has to be unique across all rooms; the display name is the team's.
  test("gives the team a room it owns", async () => {
    const team = await service.create(createRequest());

    expect(rooms.created[0]?.ownerId).toBe(team.id);
    expect(rooms.created[0]?.roomId).toBe(team.chatRoomId);
    expect(rooms.created[0]?.name).toContain(team.id);
  });

  // The lead is told the task; a member is told its role and where the room is.
  // Both prompts carry a deterministic id so a replay is recognisable as one.
  test("briefs the lead with the task and each member with its role", async () => {
    const team = await service.create(createRequest());

    const leadPrompt = agents.prompts.find((prompt) => prompt.agentId === team.leadAgentId);
    expect(leadPrompt?.prompt).toContain("Find what is eating the disk");
    expect(leadPrompt?.clientMessageId).toBe(`team-${team.id}-briefing-${team.leadAgentId}`);

    const memberId = team.members.find((member) => member.role === "server")?.agentId;
    const memberPrompt = agents.prompts.find((prompt) => prompt.agentId === memberId);
    expect(memberPrompt?.prompt).toContain("server");
    expect(memberPrompt?.prompt).toContain(team.chatRoomId);
  });

  // Ordering is what makes a crash recoverable: the record carrying the plan is
  // on disk before anything it describes exists.
  test("writes the plan before creating anything it describes", async () => {
    const stages: Array<string | null> = [];
    rooms.createRoom = async () => {
      stages.push((await store.get(teamId))?.creationStage ?? null);
    };
    let teamId = "";
    const observing = new TeamService({
      store,
      rooms,
      agents,
      logger,
      onTeamAllocated: (id) => {
        teamId = id;
      },
    });

    await observing.create(createRequest());

    expect(stages).toEqual(["allocated"]);
  });

  test("clears the plan once the team is active and keeps the fingerprint", async () => {
    const team = await service.create(createRequest());
    const stored = await store.get(team.id);

    expect(stored?.creationPlan).toBeNull();
    expect(stored?.creationStage).toBeNull();
    expect(stored?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("refuses a role that would collide with the lead", async () => {
    await expect(
      service.create(
        createRequest({
          members: [
            { role: "lead", provider: "codex", title: null, briefing: null, settings: null },
          ],
        }),
      ),
    ).rejects.toThrow(/reserved/i);
  });

  test("refuses more non-lead members than a team can hold", async () => {
    const members = Array.from({ length: 9 }, (_unused, index) => ({
      role: `role-${index}`,
      provider: "codex",
      title: null,
      briefing: null,
      settings: null,
    }));

    await expect(service.create(createRequest({ members }))).rejects.toThrow(/at most 8/i);
  });

  test("refuses two members that would share a role", async () => {
    await expect(
      service.create(
        createRequest({
          members: [
            { role: "server", provider: "codex", title: null, briefing: null, settings: null },
            { role: "server", provider: "claude", title: null, briefing: null, settings: null },
          ],
        }),
      ),
    ).rejects.toThrow(/unique/i);
  });

  // A failure leaves the record behind saying what it was doing, because the
  // reconciler has to be able to tell an abandoned creation from a live one.
  test("marks the team failed and keeps the plan when a step throws", async () => {
    agents.createAgent = async () => {
      throw new Error("provider is not installed");
    };

    await expect(service.create(createRequest())).rejects.toThrow("provider is not installed");

    const [stored] = await store.list();
    expect(stored?.lifecycle).toBe("failed");
    expect(stored?.creationStage).toBe("room_created");
    expect(stored?.creationPlan).not.toBeNull();
  });
});

/**
 * §4.1. The key is the caller's promise that two requests are the same
 * request. The fingerprint is the daemon's check of that promise, and it is
 * persisted so a restart can still tell a retry from a contradiction.
 */
describe("TeamService creation idempotency", () => {
  let home: string;
  let store: TeamStore;
  let service: TeamService;
  let agents: { created: string[] };

  function build(): TeamService {
    return new TeamService({
      store,
      rooms: {
        createRoom: vi.fn(async () => {}),
        discardRoom: vi.fn(async () => {}),
      },
      agents: {
        createAgent: vi.fn(async (input: { agentId: string }) => {
          agents.created.push(input.agentId);
        }),
        sendPrompt: vi.fn(async () => {}),
        archiveAgent: vi.fn(async () => {}),
      },
      logger,
    });
  }

  function createRequest(overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "Find what is eating the disk",
      lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
      members: [],
      templateId: null,
      ...overrides,
    } as Parameters<TeamService["create"]>[0];
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-idempotency-"));
    store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    agents = { created: [] };
    service = build();
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("returns the same team for a repeat of the same request", async () => {
    const first = await service.create(createRequest());
    const second = await service.create(createRequest());

    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
    expect(agents.created).toHaveLength(1);
  });

  test("recognises a retry across a restart", async () => {
    const first = await service.create(createRequest());

    // A fresh store and service, as if the daemon had been restarted.
    const restarted = new TeamStore(join(home, "teams"), logger);
    await restarted.initialize();
    store = restarted;
    const second = await build().create(createRequest());

    expect(second.id).toBe(first.id);
    expect(await restarted.list()).toHaveLength(1);
  });

  test("refuses the same key with a different request", async () => {
    await service.create(createRequest());

    await expect(
      service.create(createRequest({ task: "something else entirely" })),
    ).rejects.toThrow(/already used/i);
  });

  test("lets a new key build a second team", async () => {
    const first = await service.create(createRequest());
    const second = await service.create(createRequest({ idempotencyKey: "key-2" }));

    expect(second.id).not.toBe(first.id);
    expect(await store.list()).toHaveLength(2);
  });

  // Two clients, or one client retrying before the first answer arrives.
  test("makes one team when the same request arrives twice at once", async () => {
    const [first, second] = await Promise.all([
      service.create(createRequest()),
      service.create(createRequest()),
    ]);

    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
    expect(agents.created).toHaveLength(1);
  });
});
