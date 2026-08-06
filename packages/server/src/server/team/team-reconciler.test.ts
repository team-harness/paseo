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
 * §5.7. Nothing the reconciler does is new behaviour — it applies the same
 * rules the event path applies, to state that was left mid-change. That is why
 * a crash cannot produce an outcome the normal path would not have produced.
 */
describe("TeamService reconciliation", () => {
  let home: string;
  let store: TeamStore;
  let rooms: ReplayingRoomGateway;
  let agents: ReplayingAgentGateway;
  let service: TeamService;

  class ReplayingRoomGateway implements TeamRoomGateway {
    readonly created: string[] = [];
    readonly discarded: string[] = [];

    async createRoom(input: { roomId: string }): Promise<void> {
      this.created.push(input.roomId);
    }

    async discardRoom(input: { roomId: string }): Promise<void> {
      this.discarded.push(input.roomId);
    }
  }

  class ReplayingAgentGateway implements TeamAgentGateway {
    readonly created: string[] = [];
    readonly prompts: string[] = [];
    readonly archived: string[] = [];
    readonly labelsCleared: string[] = [];
    readonly labelsRestored: string[] = [];
    /** Agent ids the daemon has no record for. */
    missing = new Set<string>();
    /** Agent ids whose records exist but are archived. */
    archivedOutside = new Set<string>();

    async createAgent(input: { agentId: string }): Promise<void> {
      this.created.push(input.agentId);
    }

    async sendPrompt(input: { clientMessageId: string }): Promise<void> {
      this.prompts.push(input.clientMessageId);
    }

    async archiveAgent(agentId: string): Promise<{ kind: "archived" } | { kind: "not_found" }> {
      if (this.missing.has(agentId)) return { kind: "not_found" };
      this.archived.push(agentId);
      return { kind: "archived" };
    }

    async clearTeamLabels(agentId: string): Promise<void> {
      this.labelsCleared.push(agentId);
    }

    async restoreTeamLabels(input: { agentId: string }): Promise<void> {
      this.labelsRestored.push(input.agentId);
    }

    /** Agents whose team labels have gone, however that happened. */
    unlabelled = new Set<string>();
    /**
     * What the daemon would report as this agent's team labels. Set by the
     * fixture to whatever the roster says, so only an agent named in
     * `unlabelled` looks wrong.
     */
    labelFor: (agentId: string) => { teamId: string; role: string } | null = () => null;

    async getAgentState(agentId: string) {
      if (this.missing.has(agentId)) return { kind: "missing" as const };
      if (this.archivedOutside.has(agentId)) return { kind: "archived" as const };
      return {
        kind: "active" as const,
        teamLabel: this.unlabelled.has(agentId) ? null : this.labelFor(agentId),
      };
    }
  }

  function entryFor(team: StoredTeam | null | undefined, agentId: string) {
    return team?.members.find((member) => member.agentId === agentId);
  }

  function agentIdOf(member: { agentId: string }): string {
    return member.agentId;
  }

  function nonLeadIdOf(team: StoredTeam): string {
    const entry = team.members.find((member) => member.agentId !== team.leadAgentId);
    if (!entry) throw new Error("expected a non-lead member");
    return entry.agentId;
  }

  function briefingIdsFor(team: StoredTeam): string[] {
    return team.members.map((member) => `team-${team.id}-briefing-${member.agentId}`);
  }

  function planMemberOf(team: StoredTeam) {
    return (member: { agentId: string; role: string }) => ({
      agentId: member.agentId,
      isLead: member.agentId === team.leadAgentId,
      role: member.role,
      title: null,
      provider: "codex",
      settings: null,
      briefing: null,
    });
  }

  /** Puts a team into a lifecycle it would normally only reach mid-change. */
  async function forceLifecycle(
    teamId: string,
    lifecycle: "creating" | "archiving" | "failed",
  ): Promise<void> {
    await store.update(teamId, (current) => ({ ...current, lifecycle }));
  }

  async function markEntryArchived(teamId: string, agentId: string): Promise<void> {
    await store.update(teamId, (current) => ({
      ...current,
      members: current.members.map((member) =>
        member.agentId === agentId ? { ...member, state: "archived" as const } : member,
      ),
    }));
  }

  async function seedTeam(): Promise<StoredTeam> {
    const team = await service.create({
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "Find what is eating the disk",
      lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
      members: [{ role: "server", provider: "codex", title: null, briefing: null, settings: null }],
      templateId: null,
    });
    rooms.created.length = 0;
    agents.created.length = 0;
    agents.prompts.length = 0;
    agents.archived.length = 0;
    // Every member wears the labels the roster says it should, so a test only
    // has to say which agent lost them.
    agents.labelFor = (agentId) => {
      const entry = team.members.find((member) => member.agentId === agentId);
      return entry ? { teamId: team.id, role: entry.role } : null;
    };
    return team;
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-reconcile-"));
    store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    rooms = new ReplayingRoomGateway();
    agents = new ReplayingAgentGateway();
    service = new TeamService({ store, rooms, agents, logger });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // A creation that stopped part-way is finished from its plan, not restarted.
  describe("a creation that was interrupted", () => {
    async function leaveCreating(stage: "allocated" | "room_created" | "agents_created") {
      const team = await seedTeam();
      return await store.update(team.id, (current) => ({
        ...current,
        lifecycle: "creating" as const,
        creationStage: stage,
        creationPlan: {
          task: "Find what is eating the disk",
          room: { roomId: current.chatRoomId, internalName: `team-${current.id}` },
          members: current.members.map(planMemberOf(current)),
        },
      }));
    }

    test("finishes one that stopped before the room existed", async () => {
      const team = await leaveCreating("allocated");

      await service.reconcile();

      expect(rooms.created).toEqual([team!.chatRoomId]);
      expect((await store.get(team!.id))?.lifecycle).toBe("active");
    });

    test("does not rebuild the room when it already exists", async () => {
      await leaveCreating("room_created");

      await service.reconcile();

      expect(rooms.created).toEqual([]);
    });

    test("briefs everyone with the ids the plan already fixed", async () => {
      const team = await leaveCreating("agents_created");

      await service.reconcile();

      expect(agents.created).toEqual([]);
      expect(agents.prompts).toEqual(briefingIdsFor(team!));
    });

    // DEC-12's fallback: something the plan says exists is gone, and the daemon
    // cannot tell "deleted" from "never created". Rebuilding could duplicate
    // real work, so the team fails instead.
    test("fails rather than rebuilding when the lead is gone", async () => {
      const team = await leaveCreating("agents_created");
      agents.missing.add(team!.leadAgentId);

      await service.reconcile();

      expect((await store.get(team!.id))?.lifecycle).toBe("failed");
      expect(agents.created).toEqual([]);
    });
  });

  describe("an archive that was interrupted", () => {
    test("finishes archiving the members that are left", async () => {
      const team = await seedTeam();
      await forceLifecycle(team.id, "archiving");

      await service.reconcile();

      expect((await store.get(team.id))?.lifecycle).toBe("archived");
      expect(agents.archived.sort()).toEqual(team.members.map(agentIdOf).sort());
    });

    // §5.7's ordering: eviction is applied before the archive resumes, so the
    // agent that came back is not archived again on its way out.
    test("evicts a member that was unarchived before resuming", async () => {
      const team = await seedTeam();
      const memberId = nonLeadIdOf(team);
      await forceLifecycle(team.id, "archiving");
      await markEntryArchived(team.id, memberId);

      await service.reconcile();

      const entry = entryFor(await store.get(team.id), memberId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("unarchive_evicted");
      expect(agents.labelsCleared).toContain(memberId);
    });
  });

  describe("a failed creation", () => {
    test("cleans up what it built and records that it did", async () => {
      const team = await seedTeam();
      await forceLifecycle(team.id, "failed");

      await service.reconcile();

      const cleaned = await store.get(team.id);
      expect(cleaned?.failedCleanupAt).not.toBeNull();
      expect(agents.archived.sort()).toEqual(team.members.map(agentIdOf).sort());
      // The room was never anyone's to read: it belonged to a team that failed.
      expect(rooms.discarded).toEqual([team.chatRoomId]);
    });

    // §5.7 puts `archived` and `failed` on the same line for this: the state
    // DEC-11 says does not exist — an entry marked archived over an agent that
    // is running — is reachable either way.
    test("evicts a member that was unarchived while the daemon was down", async () => {
      const team = await seedTeam();
      const memberId = nonLeadIdOf(team);
      await forceLifecycle(team.id, "failed");
      await markEntryArchived(team.id, memberId);

      await service.reconcile();

      const entry = entryFor(await store.get(team.id), memberId);
      expect(entry?.state).toBe("removed");
      expect(entry?.removalReason).toBe("unarchive_evicted");
      // Its labels go too, or `create_agent` keeps finding a team that failed
      // and refusing to recruit for it — this agent could never recruit again.
      expect(agents.labelsCleared).toContain(memberId);
    });

    test("still evicts after the cleanup already ran once", async () => {
      // `failedCleanupAt` short-circuits the cleanup, and eviction used to sit
      // behind it. An unarchive after the first pass would then never be seen.
      const team = await seedTeam();
      const memberId = nonLeadIdOf(team);
      await forceLifecycle(team.id, "failed");
      await service.reconcile();
      await markEntryArchived(team.id, memberId);

      await service.reconcile();

      expect(entryFor(await store.get(team.id), memberId)?.state).toBe("removed");
    });

    test("does not clean up twice", async () => {
      const team = await seedTeam();
      await forceLifecycle(team.id, "failed");
      await service.reconcile();
      agents.archived.length = 0;
      rooms.discarded.length = 0;

      await service.reconcile();

      expect(agents.archived).toEqual([]);
      expect(rooms.discarded).toEqual([]);
    });
  });

  // An active team is checked against what the daemon actually has, because the
  // events that would have told it may never have arrived.
  describe("an active team", () => {
    test("records a member that was archived while nobody was listening", async () => {
      const team = await seedTeam();
      const memberId = nonLeadIdOf(team);
      agents.archivedOutside.add(memberId);

      await service.reconcile();

      expect(entryFor(await store.get(team.id), memberId)?.state).toBe("archived");
    });

    // The event that archives a lead is supposed to take the team with it. If
    // the daemon dies between the two, nothing else notices: the team is still
    // active and its lead is not. Reconciliation has to finish the job, or the
    // team stays that way forever.
    test("finishes archiving a team whose lead was archived", async () => {
      const team = await seedTeam();
      agents.archivedOutside.add(team.leadAgentId);

      await service.reconcile();

      expect((await store.get(team.id))?.lifecycle).toBe("archived");
    });

    // The lead's entry was marked archived, the daemon died before the team
    // followed, and the lead came back while it was down. The event path would
    // have restored it, so recovery has to reach the same place.
    test("restores a lead whose entry was archived but which came back", async () => {
      const team = await seedTeam();
      await markEntryArchived(team.id, team.leadAgentId);

      await service.reconcile();

      const after = await store.get(team.id);
      expect(after?.lifecycle).toBe("active");
      expect(entryFor(after, team.leadAgentId)?.state).toBe("active");
    });

    test("converges the team when its lead turns out to be gone", async () => {
      const team = await seedTeam();
      agents.missing.add(team.leadAgentId);

      await service.reconcile();

      expect((await store.get(team.id))?.lifecycle).toBe("archived");
    });

    // Removing a member clears its labels and then records the removal. A crash
    // between the two leaves an agent the roster calls a member with nothing
    // marking it as one, and no event will ever mention it again.
    test("puts back the labels of a member that lost them", async () => {
      const team = await seedTeam();
      const memberId = nonLeadIdOf(team);
      agents.unlabelled.add(memberId);

      await service.reconcile();

      expect(agents.labelsRestored).toEqual([memberId]);
    });

    test("leaves a healthy team alone", async () => {
      const team = await seedTeam();

      await service.reconcile();

      const after = await store.get(team.id);
      expect(after?.lifecycle).toBe("active");
      expect(agents.archived).toEqual([]);
      expect(agents.labelsCleared).toEqual([]);
    });
  });

  // Equivalence is the property worth testing: the reconciler is not a second
  // implementation of the rules, it is the same one applied later.
  test("reaches the same place as the event path for an unarchived member", async () => {
    const viaEvent = await seedTeam();
    const memberId = nonLeadIdOf(viaEvent);
    await service.archive(viaEvent.id);
    await service.onAgentUnarchived(memberId);
    const eventResult = entryFor(await store.get(viaEvent.id), memberId);

    // The same situation, but the event never arrived: the entry still says
    // archived while the agent is active again.
    const viaReconcile = await service.create({
      idempotencyKey: "key-2",
      name: "Second",
      workspaceId: "ws-1",
      task: "task",
      lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
      members: [{ role: "server", provider: "codex", title: null, briefing: null, settings: null }],
      templateId: null,
    });
    const otherMemberId = viaReconcile.members.find(
      (m) => m.agentId !== viaReconcile.leadAgentId,
    )!.agentId;
    await service.archive(viaReconcile.id);

    await service.reconcile();
    const reconciledResult = entryFor(await store.get(viaReconcile.id), otherMemberId);

    expect(reconciledResult?.state).toBe(eventResult?.state);
    expect(reconciledResult?.removalReason).toBe(eventResult?.removalReason);
  });
});
