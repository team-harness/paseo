import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { StoredTeam } from "@getpaseo/protocol/team/types";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamStore } from "./team-store.js";
import { TeamService, type TeamAgentGateway, type TeamRoomGateway } from "./team-service.js";

const logger = createTestLogger();

class RecordingRoomGateway implements TeamRoomGateway {
  readonly discarded: string[] = [];

  async createRoom(): Promise<void> {}

  async discardRoom(input: { roomId: string }): Promise<void> {
    this.discarded.push(input.roomId);
  }
}

class RecordingAgentGateway implements TeamAgentGateway {
  readonly archived: string[] = [];
  readonly labelsCleared: string[] = [];
  readonly labelsRestored: string[] = [];
  /** Agent ids the daemon no longer has a record for. */
  missing = new Set<string>();
  /** Agent ids whose archive fails for a reason that is not "gone". */
  failing = new Set<string>();
  /** Runs as each agent is created, to interleave something else. */
  onCreate: ((agentId: string) => Promise<void>) | null = null;

  async createAgent(input: { agentId: string }): Promise<void> {
    await this.onCreate?.(input.agentId);
  }
  async sendPrompt(): Promise<void> {}

  async archiveAgent(agentId: string): Promise<{ kind: "archived" } | { kind: "not_found" }> {
    if (this.missing.has(agentId)) {
      return { kind: "not_found" };
    }
    if (this.failing.has(agentId)) {
      throw new Error(`Storage is unavailable for ${agentId}`);
    }
    this.archived.push(agentId);
    return { kind: "archived" };
  }

  async clearTeamLabels(agentId: string): Promise<void> {
    this.labelsCleared.push(agentId);
  }

  async restoreTeamLabels(input: { agentId: string }): Promise<void> {
    this.labelsRestored.push(input.agentId);
  }
}

describe("TeamService lifecycle", () => {
  let home: string;
  let store: TeamStore;
  let rooms: RecordingRoomGateway;
  let agents: RecordingAgentGateway;
  let service: TeamService;

  async function seedActiveTeam(): Promise<StoredTeam> {
    const created = await service.create({
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "Find what is eating the disk",
      lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
      members: [
        { role: "server", provider: "codex", title: null, briefing: null, settings: null },
        { role: "app", provider: "claude", title: null, briefing: null, settings: null },
      ],
      templateId: null,
    });
    agents.archived.length = 0;
    return created;
  }

  function entryFor(team: StoredTeam | null | undefined, agentId: string) {
    return team?.members.find((member) => member.agentId === agentId);
  }

  function agentIdOf(member: { agentId: string }): string {
    return member.agentId;
  }

  function filler(_unused: unknown, index: number) {
    return {
      agentId: `filler-${index}`,
      role: `filler-${index}`,
      joinedAt: "2026-08-06T10:00:00.000Z",
      leftAt: null,
      state: "active" as const,
      removalReason: null,
    };
  }

  /** Adds `count` active members straight to the roster, bypassing creation. */
  async function fillSeats(teamId: string, count: number): Promise<void> {
    await store.update(teamId, (current) => ({
      ...current,
      members: [...current.members, ...Array.from({ length: count }, filler)],
    }));
  }

  async function markEntryArchived(teamId: string, agentId: string): Promise<void> {
    await store.update(teamId, (current) => ({
      ...current,
      members: current.members.map((member) =>
        member.agentId === agentId ? { ...member, state: "archived" as const } : member,
      ),
    }));
  }

  function memberIdFor(team: StoredTeam, role: string): string {
    const entry = team.members.find((member) => member.role === role);
    if (!entry) throw new Error(`No member with role ${role}`);
    return entry.agentId;
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-lifecycle-"));
    store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    rooms = new RecordingRoomGateway();
    agents = new RecordingAgentGateway();
    service = new TeamService({ store, rooms, agents, logger });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  describe("archive", () => {
    test("archives every active member and keeps the room", async () => {
      const team = await seedActiveTeam();

      const archived = await service.archive(team.id);

      expect(archived?.lifecycle).toBe("archived");
      expect(archived?.archivedAt).not.toBeNull();
      expect(agents.archived.sort()).toEqual(team.members.map(agentIdOf).sort());
      // The room outlives the team: its history is why anyone would look.
      expect(rooms.discarded).toEqual([]);
    });

    // An agent that was hard-deleted leaves an entry pointing at nothing. The
    // team is still archivable; the entry is simply already done.
    test("treats a member the daemon no longer has as already archived", async () => {
      const team = await seedActiveTeam();
      const gone = memberIdFor(team, "server");
      agents.missing.add(gone);

      const archived = await service.archive(team.id);

      expect(archived?.lifecycle).toBe("archived");
      expect(agents.archived).not.toContain(gone);
    });

    // "Gone" and "could not be reached" are different answers. Recording the
    // team as archived on the second would leave a member running with the
    // marker that stops anything trying again.
    test("does not record the team as archived when a member could not be", async () => {
      const team = await seedActiveTeam();
      agents.failing.add(memberIdFor(team, "server"));

      await expect(service.archive(team.id)).rejects.toThrow(/unavailable/i);

      const after = await store.get(team.id);
      expect(after?.lifecycle).not.toBe("archived");
      expect(after?.archivedAt).toBeNull();
    });

    test("does not archive a member that already left", async () => {
      const team = await seedActiveTeam();
      const left = memberIdFor(team, "server");
      await service.removeMember({ teamId: team.id, agentId: left });
      agents.archived.length = 0;

      await service.archive(team.id);

      expect(agents.archived).not.toContain(left);
    });

    // Creation and the lifecycle operations have to take the same lock. An
    // archive that lands while a team is still being built would otherwise be
    // undone by the creation finishing and declaring the team active.
    test("does not come back to life when archived mid-creation", async () => {
      // One service, so both operations contend for the same lock — with two
      // instances this would pass whatever the locking does.
      let teamId = "";
      let archiveDuringCreation: Promise<unknown> = Promise.resolve();
      rooms.createRoom = async () => {
        archiveDuringCreation = raced.archive(teamId);
      };
      const raced: TeamService = new TeamService({
        store,
        rooms,
        agents,
        logger,
        onTeamAllocated: (id) => {
          teamId = id;
        },
      });

      await raced.create({
        idempotencyKey: "raced",
        name: "Raced",
        workspaceId: "ws-1",
        task: "task",
        lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
        members: [],
        templateId: null,
      });
      await archiveDuringCreation;

      const finished = await store.get(teamId);
      expect(finished?.lifecycle).toBe("archived");
      // And the archive really ran: it did not merely lose a write race.
      expect(finished?.archivedAt).not.toBeNull();
    });

    // An external event carries the same weight as the RPC. A lead archived by
    // whatever means during creation must not leave an active team behind it.
    test("does not activate a team whose lead was archived mid-creation", async () => {
      let teamId = "";
      let eventDuringCreation: Promise<unknown> = Promise.resolve();
      const raced: TeamService = new TeamService({
        store,
        rooms: {
          createRoom: async () => {},
          discardRoom: async () => {},
        },
        agents,
        logger,
        onTeamAllocated: (id) => {
          teamId = id;
        },
      });
      agents.onCreate = async (agentId) => {
        const team = await store.get(teamId);
        if (team && agentId === team.leadAgentId) {
          eventDuringCreation = raced.onAgentArchived(agentId);
        }
      };

      await raced.create({
        idempotencyKey: "raced-event",
        name: "Raced",
        workspaceId: "ws-1",
        task: "task",
        lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
        members: [],
        templateId: null,
      });
      await eventDuringCreation;

      expect((await store.get(teamId))?.lifecycle).not.toBe("active");
    });

    test("archiving a team that is already archived changes nothing", async () => {
      const team = await seedActiveTeam();
      await service.archive(team.id);
      const archivedAt = (await store.get(team.id))?.archivedAt;
      agents.archived.length = 0;

      const again = await service.archive(team.id);

      expect(again?.archivedAt).toBe(archivedAt);
      expect(agents.archived).toEqual([]);
    });
  });

  describe("removing a member", () => {
    test("marks the entry removed and takes its team labels off", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");

      const updated = await service.removeMember({ teamId: team.id, agentId });

      const entry = entryFor(updated, agentId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("removed_by_user");
      expect(entry?.leftAt).not.toBeNull();
      expect(agents.labelsCleared).toEqual([agentId]);
      // Removing someone from a team does not end their agent.
      expect(agents.archived).toEqual([]);
    });

    // The lead is what the team's convergence rules hang off. Removing it would
    // leave a team nobody can archive through its own lead.
    test("refuses to remove the lead", async () => {
      const team = await seedActiveTeam();

      await expect(
        service.removeMember({ teamId: team.id, agentId: team.leadAgentId }),
      ).rejects.toThrow(/lead/i);
    });

    test("removing someone twice is not an error", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");
      await service.removeMember({ teamId: team.id, agentId });

      const again = await service.removeMember({ teamId: team.id, agentId });

      expect(entryFor(again, agentId)?.state).toBe("removed");
      expect(agents.labelsCleared).toEqual([agentId]);
    });
  });

  // DEC-12. A hard delete leaves no tombstone, so the team has to converge on
  // what is left rather than wait to be told what happened.
  describe("an agent being hard-deleted", () => {
    test("records a member as removed and leaves the team running", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");

      const updated = await service.onAgentDeleted(agentId);

      expect(updated?.lifecycle).toBe("active");
      const entry = entryFor(updated, agentId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("hard_deleted");
    });

    test("converges the whole team when it was the lead", async () => {
      const team = await seedActiveTeam();

      const updated = await service.onAgentDeleted(team.leadAgentId);

      expect(updated?.lifecycle).toBe("archived");
      const lead = entryFor(updated, team.leadAgentId);
      expect(lead?.state).toBe("removed");
      expect(lead?.removalReason).toBe("hard_deleted");
      // Kept as a historical reference: an archived team does not need its lead
      // to still exist.
      expect(updated?.leadAgentId).toBe(team.leadAgentId);
    });

    test("ignores an agent that was never on a team", async () => {
      await seedActiveTeam();

      await expect(service.onAgentDeleted("unrelated-agent")).resolves.toBeNull();
    });
  });

  // DEC-11. Whatever brought the agent back, the team asks the same question:
  // is there still a place for it here? There is no state where an archived
  // team holds an active member, or an archived entry points at a live agent.
  describe("a member being unarchived from outside", () => {
    test("takes it back when the team is active and has room", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");
      await service.onAgentArchived(agentId);

      const updated = await service.onAgentUnarchived(agentId);

      const entry = entryFor(updated, agentId);
      expect(entry?.state).toBe("active");
      expect(entry?.removalReason).toBeNull();
      expect(agents.labelsRestored).toEqual([agentId]);
    });

    test("evicts it when the team is no longer active", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");
      await service.archive(team.id);

      const updated = await service.onAgentUnarchived(agentId);

      const entry = entryFor(updated, agentId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("unarchive_evicted");
      expect(entry?.leftAt).not.toBeNull();
      expect(agents.labelsCleared).toContain(agentId);
    });

    // The lead does not take a seat, so an active team always has room for it —
    // even one whose seats are otherwise full. Reaching this state needs the
    // entry archived without the team following, which is the window between a
    // lead being archived and the team converging on it.
    test("takes the lead back into an active team whose seats are full", async () => {
      const team = await seedActiveTeam();
      await markEntryArchived(team.id, team.leadAgentId);
      await fillSeats(team.id, 8);

      const updated = await service.onAgentUnarchived(team.leadAgentId);

      expect(entryFor(updated, team.leadAgentId)?.state).toBe("active");
    });

    test("evicts it when the team has since filled the last seat", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");
      await service.onAgentArchived(agentId);
      // Fill the roster to capacity while this one is away.
      await fillSeats(team.id, 7);

      const updated = await service.onAgentUnarchived(agentId);

      const entry = entryFor(updated, agentId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("unarchive_evicted");
    });

    // Leaving a team is final. The agent carries on as an ordinary one, and
    // whatever happens to it afterwards is nobody's business but its own —
    // certainly not grounds for the team to take it back.
    test("does not take back someone who was removed", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");
      await service.removeMember({ teamId: team.id, agentId });
      agents.labelsRestored.length = 0;

      // Not "this team decided to keep it out" but "this is not its team".
      await expect(service.onAgentUnarchived(agentId)).resolves.toBeNull();

      const entry = entryFor(await store.get(team.id), agentId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("removed_by_user");
      expect(agents.labelsRestored).toEqual([]);
    });

    test("ignores an agent that was never on a team", async () => {
      await seedActiveTeam();

      await expect(service.onAgentUnarchived("unrelated-agent")).resolves.toBeNull();
    });
  });

  describe("a member being archived from outside", () => {
    test("records the entry as archived and leaves the team running", async () => {
      const team = await seedActiveTeam();
      const agentId = memberIdFor(team, "server");

      const updated = await service.onAgentArchived(agentId);

      expect(updated?.lifecycle).toBe("active");
      expect(entryFor(updated, agentId)?.state).toBe("archived");
    });

    test("archives the team when the lead is archived", async () => {
      const team = await seedActiveTeam();

      const updated = await service.onAgentArchived(team.leadAgentId);

      expect(updated?.lifecycle).toBe("archived");
    });
  });
});
