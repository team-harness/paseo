import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { StoredTeam } from "@getpaseo/protocol/team/types";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamStore } from "./team-store.js";
import { TeamService, type TeamAgentGateway, type TeamRoomGateway } from "./team-service.js";

const logger = createTestLogger();

/**
 * DEC-13. Recruiting is a two-phase transaction, not a create followed by
 * bookkeeping: the seat and the whole replayable intent are written first, so
 * a crash at any point afterwards leaves something that says what was meant to
 * happen. There is never an agent wearing team labels that the roster does not
 * know about.
 */
describe("TeamService recruitment", () => {
  let home: string;
  let store: TeamStore;
  let agents: RecruitingAgentGateway;
  let service: TeamService;

  class RecruitingAgentGateway implements TeamAgentGateway {
    readonly created: Array<{ agentId: string; labels: Record<string, string> }> = [];
    readonly prompts: Array<{ agentId: string; clientMessageId: string }> = [];
    readonly archived: string[] = [];
    readonly labelsCleared: string[] = [];
    missing = new Set<string>();
    /** Runs just before an agent is created, to interleave something else. */
    beforeCreate: (() => Promise<void>) | null = null;
    /** The same, for the briefing — the widest window in a recruit. */
    beforePrompt: (() => Promise<void>) | null = null;
    /** Runs once the briefing has landed, before the intent is committed. */
    afterPrompt: (() => Promise<void>) | null = null;

    async createAgent(input: { agentId: string; labels: Record<string, string> }): Promise<void> {
      await this.beforeCreate?.();
      this.created.push({ agentId: input.agentId, labels: input.labels });
    }

    async sendPrompt(input: { agentId: string; clientMessageId: string }): Promise<void> {
      await this.beforePrompt?.();
      this.prompts.push(input);
      await this.afterPrompt?.();
    }

    async archiveAgent(agentId: string): Promise<{ kind: "archived" } | { kind: "not_found" }> {
      if (this.missing.has(agentId)) return { kind: "not_found" };
      this.archived.push(agentId);
      return { kind: "archived" };
    }

    async clearTeamLabels(agentId: string): Promise<void> {
      this.labelsCleared.push(agentId);
    }

    async restoreTeamLabels(): Promise<void> {}

    async getAgentState(agentId: string) {
      return this.missing.has(agentId)
        ? { kind: "missing" as const }
        : { kind: "active" as const, teamLabel: null };
    }
  }

  const rooms: TeamRoomGateway = {
    createRoom: async () => {},
    discardRoom: async () => {},
  };

  async function seedTeam(memberRoles: string[] = []): Promise<StoredTeam> {
    const team = await service.create({
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "Find what is eating the disk",
      lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
      members: memberRoles.map((role) => ({
        role,
        provider: "codex",
        title: null,
        briefing: null,
        settings: null,
      })),
      templateId: null,
    });
    agents.created.length = 0;
    agents.prompts.length = 0;
    return team;
  }

  function recruitRequest(team: StoredTeam, overrides: Record<string, unknown> = {}) {
    return {
      recruiterAgentId: team.leadAgentId,
      teamRole: "database",
      provider: "codex",
      title: null,
      settings: null,
      initialPrompt: "Look at the query plans",
      ...overrides,
    };
  }

  function entryFor(team: StoredTeam | null | undefined, agentId: string) {
    return team?.members.find((member) => member.agentId === agentId);
  }

  function entryWithRole(team: StoredTeam | null | undefined, role: string) {
    return team?.members.find((member) => member.role === role);
  }

  function agentIdOf(entry: { agentId: string }): string {
    return entry.agentId;
  }

  function clientMessageIdOf(prompt: { clientMessageId: string }): string {
    return prompt.clientMessageId;
  }

  function isFulfilled(result: { status: string }): boolean {
    return result.status === "fulfilled";
  }

  /** Moves a reserved intent on to `created`, as the second phase would. */
  async function markIntentCreated(teamId: string, agentId: string): Promise<void> {
    await store.update(teamId, (current) => {
      const intent = current.pendingRecruitments?.[agentId];
      if (!intent) throw new Error("expected a pending recruitment");
      return {
        ...current,
        pendingRecruitments: { [agentId]: { ...intent, stage: "created" as const } },
      };
    });
  }

  function activeSeats(team: StoredTeam | null): number {
    return (
      team?.members.filter(
        (member) => member.state === "active" && member.agentId !== team.leadAgentId,
      ).length ?? 0
    );
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-recruit-"));
    store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    agents = new RecruitingAgentGateway();
    service = new TeamService({ store, rooms, agents, logger });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  describe("recruiting a member", () => {
    test("seats the recruit, builds it, and briefs it", async () => {
      const team = await seedTeam();

      const recruited = await service.recruit({ teamId: team.id, ...recruitRequest(team) });

      expect(agents.created).toHaveLength(1);
      expect(agents.created[0]?.agentId).toBe(recruited.agentId);
      expect(agents.prompts).toHaveLength(1);
      const updated = await store.get(team.id);
      expect(entryFor(updated, recruited.agentId)?.role).toBe("database");
      // The intent is gone once there is nothing left to replay.
      expect(updated?.pendingRecruitments).toBeNull();
    });

    // A lead with no members builds its own team. This is the path a template
    // with an empty roster takes.
    test("lets a lead build a whole team from nothing", async () => {
      const team = await seedTeam();

      await service.recruit({ teamId: team.id, ...recruitRequest(team, { teamRole: "server" }) });
      await service.recruit({ teamId: team.id, ...recruitRequest(team, { teamRole: "app" }) });

      expect(activeSeats(await store.get(team.id))).toBe(2);
    });

    test("refuses the reserved role", async () => {
      const team = await seedTeam();

      await expect(
        service.recruit({ teamId: team.id, ...recruitRequest(team, { teamRole: "lead" }) }),
      ).rejects.toThrow(/reserved/i);
    });

    test("refuses a role someone already holds", async () => {
      const team = await seedTeam(["server"]);

      await expect(
        service.recruit({ teamId: team.id, ...recruitRequest(team, { teamRole: "server" }) }),
      ).rejects.toThrow(/unique/i);
    });

    test("refuses a recruiter that is not on the team", async () => {
      const team = await seedTeam();

      await expect(
        service.recruit({
          teamId: team.id,
          ...recruitRequest(team, { recruiterAgentId: "outsider" }),
        }),
      ).rejects.toThrow(/not a member/i);
    });

    test("refuses to recruit into a team that is no longer active", async () => {
      const team = await seedTeam();
      await service.archive(team.id);

      await expect(service.recruit({ teamId: team.id, ...recruitRequest(team) })).rejects.toThrow(
        /not active/i,
      );
    });

    // Capacity is taken in the same write as the seat, before anything external
    // exists, so the loser of a race is turned away before it builds anything.
    test("refuses to go past the last seat", async () => {
      const team = await seedTeam(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);

      await expect(service.recruit({ teamId: team.id, ...recruitRequest(team) })).rejects.toThrow(
        /at most 8/i,
      );
      expect(agents.created).toEqual([]);
    });

    test("lets only one of two racing recruits take the last seat", async () => {
      const team = await seedTeam(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);

      const results = await Promise.allSettled([
        service.recruit({ teamId: team.id, ...recruitRequest(team, { teamRole: "a" }) }),
        service.recruit({ teamId: team.id, ...recruitRequest(team, { teamRole: "b" }) }),
      ]);

      expect(results.filter(isFulfilled)).toHaveLength(1);
      expect(activeSeats(await store.get(team.id))).toBe(8);
      expect(agents.created).toHaveLength(1);
    });
  });

  // Every step checks the team is still active first. A team that was archived
  // mid-recruit does not gain a member afterwards.
  describe("a team that goes away mid-recruit", () => {
    test("cancels the seat and archives what it built", async () => {
      const team = await seedTeam();
      agents.beforeCreate = async () => {
        await service.archive(team.id);
      };

      await expect(service.recruit({ teamId: team.id, ...recruitRequest(team) })).rejects.toThrow(
        /cancelled/i,
      );

      const updated = await store.get(team.id);
      const recruit = entryWithRole(updated, "database");
      expect(recruit?.state).toBe("removed");
      expect(recruit?.removalReason).toBe("recruitment_canceled");
      expect(updated?.pendingRecruitments).toBeNull();
      // Nothing is left running that the team no longer accounts for.
      expect(agents.archived).toContain(recruit?.agentId);
    });
  });

  // The fence asks about this recruit's own entry, not only the team. A recruit
  // removed while its briefing was in flight is no longer a member, and the
  // send finishing must not paper over that.
  describe("a recruit removed mid-recruit", () => {
    test("cancels rather than reporting a member that already left", async () => {
      const team = await seedTeam();
      let reservedId = "";
      agents.beforeCreate = async () => {
        const current = await store.get(team.id);
        reservedId = entryWithRole(current, "database")!.agentId;
        await service.removeMember({ teamId: team.id, agentId: reservedId });
      };

      await expect(service.recruit({ teamId: team.id, ...recruitRequest(team) })).rejects.toThrow(
        /cancelled/i,
      );

      const entry = entryFor(await store.get(team.id), reservedId);
      expect(entry?.state).toBe("removed");
      expect(agents.archived).toContain(reservedId);
      expect((await store.get(team.id))?.pendingRecruitments).toBeNull();
    });

    // The briefing is the slowest step, so it is the widest window.
    test("cancels when the removal lands while the briefing is being sent", async () => {
      const team = await seedTeam();
      let reservedId = "";
      agents.beforePrompt = async () => {
        const current = await store.get(team.id);
        reservedId = entryWithRole(current, "database")!.agentId;
        await service.removeMember({ teamId: team.id, agentId: reservedId });
      };

      await expect(service.recruit({ teamId: team.id, ...recruitRequest(team) })).rejects.toThrow(
        /cancelled/i,
      );

      expect(entryFor(await store.get(team.id), reservedId)?.state).toBe("removed");
      expect(agents.archived).toContain(reservedId);
      expect((await store.get(team.id))?.pendingRecruitments).toBeNull();
    });
  });

  // Checking that the recruit is still a member and then clearing its intent
  // would be two operations, and a removal arriving between them would be
  // cleared away as if it had not happened. They are one locked step.
  test("cancels a recruit removed after its briefing was delivered", async () => {
    const team = await seedTeam();
    let reservedId = "";
    agents.afterPrompt = async () => {
      const current = await store.get(team.id);
      reservedId = entryWithRole(current, "database")!.agentId;
      await service.removeMember({ teamId: team.id, agentId: reservedId });
    };

    await expect(service.recruit({ teamId: team.id, ...recruitRequest(team) })).rejects.toThrow(
      /cancelled/i,
    );

    expect(agents.archived).toContain(reservedId);
    expect((await store.get(team.id))?.pendingRecruitments).toBeNull();
  });

  // The intent is what makes a crash recoverable: it holds everything needed to
  // finish, so the reconciler replays rather than re-decides.
  describe("recovering an interrupted recruit", () => {
    async function leaveReserved(team: StoredTeam, agentId: string): Promise<void> {
      await store.update(team.id, (current) => ({
        ...current,
        members: [
          ...current.members,
          {
            agentId,
            role: "database",
            joinedAt: new Date().toISOString(),
            leftAt: null,
            state: "active" as const,
            removalReason: null,
          },
        ],
        pendingRecruitments: {
          [agentId]: {
            provider: "codex",
            settings: null,
            title: null,
            teamRole: "database",
            initialPrompt: "Look at the query plans",
            clientMessageId: `team-${team.id}-recruit-${agentId}`,
            recruiterAgentId: team.leadAgentId,
            workspaceId: team.workspaceId,
            stage: "reserved" as const,
          },
        },
      }));
    }

    test("builds the agent the seat was taken for", async () => {
      const team = await seedTeam();
      await leaveReserved(team, "recruit-1");
      agents.missing.add("recruit-1");

      await service.reconcile();

      expect(agents.created.map(agentIdOf)).toEqual(["recruit-1"]);
      expect((await store.get(team.id))?.pendingRecruitments).toBeNull();
    });

    test("sends the briefing the intent recorded, once", async () => {
      const team = await seedTeam();
      await leaveReserved(team, "recruit-1");
      await markIntentCreated(team.id, "recruit-1");

      await service.reconcile();

      // Already built: only the briefing was outstanding.
      expect(agents.created).toEqual([]);
      expect(agents.prompts.map(clientMessageIdOf)).toEqual([`team-${team.id}-recruit-recruit-1`]);
    });

    // Two passes over the same pending recruit: the first finishes it, the
    // second finds no intent left. That is a replay arriving second, not a
    // cancellation — archiving the agent it just recruited would be worse than
    // doing nothing.
    test("does not undo a recruit another pass already finished", async () => {
      const team = await seedTeam();
      await leaveReserved(team, "recruit-1");

      await Promise.all([service.reconcile(), service.reconcile()]);

      const entry = entryFor(await store.get(team.id), "recruit-1");
      expect(entry?.state).toBe("active");
      expect(agents.archived).toEqual([]);
    });

    test("cancels an intent left behind by a team that is no longer active", async () => {
      const team = await seedTeam();
      await leaveReserved(team, "recruit-1");
      await service.archive(team.id);
      agents.created.length = 0;

      await service.reconcile();

      const updated = await store.get(team.id);
      expect(agents.created).toEqual([]);
      expect(entryFor(updated, "recruit-1")?.removalReason).toBe("recruitment_canceled");
      expect(updated?.pendingRecruitments).toBeNull();
    });
  });
});
