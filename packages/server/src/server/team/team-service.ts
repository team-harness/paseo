import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import { TEAM_ID_LABEL, TEAM_ROLE_LABEL } from "@getpaseo/protocol/agent-labels";
import { TEAM_MAX_NON_LEAD_MEMBERS } from "@getpaseo/protocol/team/rpc-schemas";
import type {
  RecruitmentIntent,
  StoredTeam,
  TeamCreationPlan,
  TeamCreationStage,
  TeamMemberEntry,
} from "@getpaseo/protocol/team/types";

import { buildLeadBriefing, buildMemberBriefing } from "./team-prompts.js";
import type { NewTeam, TeamStore } from "./team-store.js";

/** The role the lead holds. No member may claim it. */
export const TEAM_LEAD_ROLE = "lead";

export interface TeamMemberRequest {
  role: string;
  provider: string;
  title: string | null;
  briefing: string | null;
  settings: Record<string, unknown> | null;
}

export interface CreateTeamRequest {
  idempotencyKey: string;
  name: string;
  workspaceId: string;
  task: string;
  lead: TeamMemberRequest;
  members: TeamMemberRequest[];
  templateId: string | null;
}

/**
 * Creating and removing the team's chat room. Injected rather than imported so
 * the service does not depend on the chat store, and so a test can watch what
 * it asks for without one.
 */
export interface TeamRoomGateway {
  createRoom(input: {
    roomId: string;
    name: string;
    displayName: string;
    ownerId: string;
  }): Promise<void>;
  discardRoom(input: { roomId: string; ownerId: string }): Promise<void>;
}

/** The same, for the agents a team is made of. */
export interface TeamAgentGateway {
  createAgent(input: {
    agentId: string;
    provider: string;
    workspaceId: string;
    title: string | null;
    settings: Record<string, unknown> | null;
    labels: Record<string, string>;
  }): Promise<void>;
  sendPrompt(input: { agentId: string; prompt: string; clientMessageId: string }): Promise<void>;
  /**
   * Archives an agent, saying which of the two outcomes it was. "Not found" has
   * to be distinguishable: an entry pointing at a hard-deleted agent is already
   * done, while a storage or provider failure is not — treating them alike lets
   * a team record itself archived with a member still running.
   */
  archiveAgent(agentId: string): Promise<{ kind: "archived" } | { kind: "not_found" }>;
  /** Detaches an agent from its team without ending it. */
  clearTeamLabels(agentId: string): Promise<void>;
  restoreTeamLabels(input: { agentId: string; teamId: string; role: string }): Promise<void>;
  /**
   * What the daemon currently has for this agent. The reconciler needs it
   * because the events that would have told the team may never have arrived.
   *
   * The team labels come with it because §5.7 has to check them too: a crash
   * between clearing an agent's labels and recording its removal leaves an
   * agent the roster still calls a member with nothing marking it as one, and
   * an answer of only active/archived/missing cannot show that.
   */
  getAgentState(agentId: string): Promise<
    | {
        kind: "active";
        teamLabel: { teamId: string; role: string } | null;
      }
    | { kind: "archived" }
    | { kind: "missing" }
  >;
}

export interface TeamServiceOptions {
  store: TeamStore;
  rooms: TeamRoomGateway;
  agents: TeamAgentGateway;
  logger: Logger;
  /** Called once the record carrying the plan is on disk. For tests. */
  onTeamAllocated?: (teamId: string) => void;
}

export class TeamCreateConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used for a different team request`);
    this.name = "TeamCreateConflictError";
  }
}

/**
 * A recruit that was cancelled rather than failed. The distinction matters to
 * the reconciler: a cancellation has already recorded its reason and cleaned
 * up, so treating it as a failure would overwrite that with a vaguer one.
 */
export class TeamRecruitmentCancelledError extends Error {
  constructor(teamId: string) {
    super(`The recruit for team ${teamId} was cancelled before it could join`);
    this.name = "TeamRecruitmentCancelledError";
  }
}

export class TeamCreateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamCreateValidationError";
  }
}

/**
 * Owns a team's lifecycle. Creation is the part with teeth: it produces a chat
 * room and one agent per member, none of which the store can roll back, so the
 * record is written first and carries the whole plan. Every later step is then
 * a replay of a decision already on disk rather than a fresh one, which is what
 * lets the reconciler pick up from any crash point.
 */
export class TeamService {
  private readonly store: TeamStore;
  private readonly rooms: TeamRoomGateway;
  private readonly agents: TeamAgentGateway;
  private readonly logger: Logger;
  private readonly onTeamAllocated: ((teamId: string) => void) | undefined;
  private readonly creationRuns = new Map<string, Promise<StoredTeam>>();
  private readonly teamOperations = new Map<string, Promise<void>>();

  constructor(options: TeamServiceOptions) {
    this.store = options.store;
    this.rooms = options.rooms;
    this.agents = options.agents;
    this.logger = options.logger.child({ module: "team", component: "team-service" });
    this.onTeamAllocated = options.onTeamAllocated;
  }

  async create(request: CreateTeamRequest): Promise<StoredTeam> {
    assertMemberSpecsValid(request);
    const fingerprint = fingerprintCreateRequest(request);

    // The store holds the key's lock across this, so a concurrent repeat of the
    // same request waits here and finds the team rather than building a second.
    const allocated = await this.store.createIfAbsent(request.idempotencyKey, () =>
      buildAllocatedTeam(request, fingerprint),
    );

    if (allocated.requestFingerprint !== fingerprint) {
      throw new TeamCreateConflictError(request.idempotencyKey);
    }
    if (allocated.lifecycle === "active") {
      return allocated;
    }
    this.onTeamAllocated?.(allocated.id);

    // Two guards, doing different jobs. This one joins a plan already running
    // for the same team, so two callers do not both walk it and rely on each
    // step's idempotence to sort out the duplicate.
    const running = this.creationRuns.get(allocated.id);
    if (running) {
      return await running;
    }
    // And the plan itself takes the team's lock, the same one archive and the
    // rest take. Without that, an archive landing mid-creation would be undone
    // by the creation finishing and declaring the team active.
    const run = this.serializePerTeam(allocated.id, () => this.runCreationPlan(allocated)).finally(
      () => {
        this.creationRuns.delete(allocated.id);
      },
    );
    this.creationRuns.set(allocated.id, run);
    return await run;
  }

  /**
   * Drives an allocated team to `active`, one stage at a time. Safe to call
   * again from any stage: each step is idempotent on the resource it creates,
   * and the stage says which ones are already known to be done.
   */
  private async runCreationPlan(team: StoredTeam): Promise<StoredTeam> {
    // Re-read under the lock. The snapshot the caller holds was taken before
    // the lock, and an archive that got there first would otherwise have this
    // plan go on building a room, agents and briefings for a team that is
    // already over — the lifecycle guard at the end catches the record, not the
    // resources.
    const locked = await this.store.get(team.id);
    if (!locked || locked.lifecycle !== "creating") {
      return locked ?? team;
    }

    const plan = locked.creationPlan;
    if (!plan) {
      throw new Error(`Team ${team.id} has no creation plan to run`);
    }

    let current = locked;
    try {
      if (!isStageComplete(current.creationStage, "room_created")) {
        await this.rooms.createRoom({
          roomId: plan.room.roomId,
          name: plan.room.internalName,
          displayName: current.name,
          ownerId: current.id,
        });
        current = await this.advance(current, "room_created");
      }

      if (!isStageComplete(current.creationStage, "agents_created")) {
        for (const member of plan.members) {
          await this.agents.createAgent({
            agentId: member.agentId,
            provider: member.provider,
            workspaceId: current.workspaceId,
            title: member.title,
            settings: member.settings,
            labels: { [TEAM_ID_LABEL]: current.id, [TEAM_ROLE_LABEL]: member.role },
          });
        }
        current = await this.advance(current, "agents_created");
      }

      if (!isStageComplete(current.creationStage, "briefed")) {
        for (const member of plan.members) {
          await this.agents.sendPrompt({
            agentId: member.agentId,
            prompt: member.isLead
              ? buildLeadBriefing({ team: current, plan, member })
              : buildMemberBriefing({ team: current, plan, member }),
            // Deterministic, so a replay of this briefing is recognisable as one
            // rather than arriving as a second instruction.
            clientMessageId: `team-${current.id}-briefing-${member.agentId}`,
          });
        }
        current = await this.advance(current, "briefed");
      }

      return await this.finishCreation(current);
    } catch (error) {
      await this.markFailed(current.id);
      throw error;
    }
  }

  private async advance(team: StoredTeam, stage: TeamCreationStage): Promise<StoredTeam> {
    const updated = await this.store.update(team.id, (current) => ({
      ...current,
      creationStage: stage,
    }));
    if (!updated) {
      throw new Error(`Team ${team.id} disappeared while it was being created`);
    }
    return updated;
  }

  private async finishCreation(team: StoredTeam): Promise<StoredTeam> {
    const updated = await this.store.update(team.id, (current) => ({
      ...current,
      // Only a team that is still being created becomes active. One that was
      // archived while the lock was held elsewhere stays archived; declaring it
      // active here would resurrect a team someone has already ended.
      lifecycle: current.lifecycle === "creating" ? ("active" as const) : current.lifecycle,
      // The plan has done its job; the fingerprint stays, because it is what
      // tells a later retry of this key apart from a different request.
      creationPlan: null,
      creationStage: null,
    }));
    if (!updated) {
      throw new Error(`Team ${team.id} disappeared while it was being created`);
    }
    return updated;
  }

  /**
   * A failed creation keeps its plan and stage. The reconciler needs both to
   * tell what was built before deciding what to clean up.
   */
  /**
   * DEC-13. Recruiting is a transaction, not a create followed by bookkeeping.
   *
   * The seat and the whole replayable intent are written first, in one write,
   * before anything external exists. Two things follow from that order: a race
   * for the last seat is decided before either side builds anything, and a
   * crash at any later point leaves a record saying what was meant to happen.
   * There is never an agent wearing team labels that the roster does not know.
   *
   * Every later step re-checks that the team is still active. A team archived
   * mid-recruit does not gain a member afterwards; the seat is released and
   * whatever was built is archived.
   */
  async recruit(input: {
    teamId: string;
    recruiterAgentId: string;
    teamRole: string;
    provider: string;
    title: string | null;
    settings: Record<string, unknown> | null;
    initialPrompt: string;
  }): Promise<{ agentId: string }> {
    const agentId = await this.serializePerTeam(input.teamId, async () => {
      const team = await this.store.get(input.teamId);
      assertRecruitable(team, input);

      const reservedId = randomUUID();
      const now = new Date().toISOString();
      await this.store.update(input.teamId, (current) => ({
        ...current,
        members: [
          ...current.members,
          {
            agentId: reservedId,
            role: input.teamRole.trim(),
            joinedAt: now,
            leftAt: null,
            state: "active" as const,
            removalReason: null,
          },
        ],
        pendingRecruitments: {
          ...current.pendingRecruitments,
          [reservedId]: {
            provider: input.provider,
            settings: input.settings,
            title: input.title,
            teamRole: input.teamRole.trim(),
            initialPrompt: input.initialPrompt,
            clientMessageId: `team-${current.id}-recruit-${reservedId}`,
            recruiterAgentId: input.recruiterAgentId,
            workspaceId: current.workspaceId,
            stage: "reserved" as const,
          },
        },
      }));
      return reservedId;
    });

    await this.landRecruit(input.teamId, agentId);
    return { agentId };
  }

  /**
   * Carries a reserved recruit through to a briefed member, checking before
   * each step that the team is still active. Used both by `recruit` and by the
   * reconciler, so an interrupted recruit finishes the way it would have.
   */
  private async landRecruit(teamId: string, agentId: string): Promise<void> {
    /**
     * The fence, checked before every step and again after the last one.
     *
     * It asks about this recruit's own roster entry, not only the team: a
     * member removed while its briefing was in flight is no longer a member,
     * and letting the send finish would leave an agent running with team labels
     * behind an entry that says it left.
     */
    const intentOf = async (): Promise<RecruitmentIntent | null> => {
      const team = await this.store.get(teamId);
      if (!team || team.lifecycle !== "active") return null;
      const entry = team.members.find((member) => member.agentId === agentId);
      if (!entry || entry.state !== "active") return null;
      return team.pendingRecruitments?.[agentId] ?? null;
    };

    const cancel = async (): Promise<never> => {
      await this.cancelRecruitment(teamId, agentId);
      throw new TeamRecruitmentCancelledError(teamId);
    };

    let intent = await intentOf();
    if (!intent) await cancel();

    if (intent!.stage === "reserved") {
      await this.agents.createAgent({
        agentId,
        provider: intent!.provider,
        workspaceId: intent!.workspaceId,
        title: intent!.title,
        settings: intent!.settings,
        labels: { [TEAM_ID_LABEL]: teamId, [TEAM_ROLE_LABEL]: intent!.teamRole },
      });
      await this.store.update(teamId, (current) => ({
        ...current,
        pendingRecruitments: {
          ...current.pendingRecruitments,
          [agentId]: { ...intent!, stage: "created" as const },
        },
      }));
    }

    intent = await intentOf();
    if (!intent) await cancel();

    await this.agents.sendPrompt({
      agentId,
      prompt: intent!.initialPrompt,
      clientMessageId: intent!.clientMessageId,
    });

    // Checking and then clearing would be two operations, and a removal
    // arriving between them would be cleared away as if it had not happened.
    // The store's update runs inside the record's own lock, so deciding there
    // makes the last check and the commit one step.
    if ((await this.commitRecruitment(teamId, agentId)) === "invalidated") await cancel();
  }

  /**
   * Clears the intent only if this recruit is still one, and says whether it
   * did. The decision and the write are the same locked read-modify-write.
   */
  private async commitRecruitment(
    teamId: string,
    agentId: string,
  ): Promise<"committed" | "already_committed" | "invalidated"> {
    let outcome: "committed" | "already_committed" | "invalidated" = "invalidated";
    await this.store.update(teamId, (current) => {
      const entry = current.members.find((member) => member.agentId === agentId);
      const stillJoining = current.lifecycle === "active" && entry?.state === "active";
      if (!stillJoining) {
        return current;
      }
      // A recruit that is still a member and has no intent left was finished by
      // another pass. That is a replay arriving second, not a cancellation —
      // cancelling here would archive an agent that has already joined.
      if (!current.pendingRecruitments?.[agentId]) {
        outcome = "already_committed";
        return current;
      }
      outcome = "committed";
      return {
        ...current,
        pendingRecruitments: withoutIntent(current.pendingRecruitments, agentId),
      };
    });
    return outcome;
  }

  /**
   * Releases the seat and takes down whatever was built for it. The agent may
   * not exist yet, which is why archiving it is allowed to find nothing.
   */
  private async cancelRecruitment(teamId: string, agentId: string): Promise<void> {
    // Claimed the same way a failure is: the intent still being there is what
    // says this recruit is still ours to cancel.
    let claimed = false;
    await this.store.update(teamId, (current) => {
      if (!current.pendingRecruitments?.[agentId]) {
        return current;
      }
      claimed = true;
      return {
        ...current,
        members: current.members.map((member) =>
          member.agentId === agentId
            ? {
                ...member,
                state: "removed" as const,
                leftAt: new Date().toISOString(),
                removalReason: "recruitment_canceled" as const,
              }
            : member,
        ),
        pendingRecruitments: withoutIntent(current.pendingRecruitments, agentId),
      };
    });

    if (claimed) {
      await this.archiveAgentIdempotently(agentId);
    }
  }

  /**
   * Brings every team back in line with what the daemon actually has.
   *
   * This is not a second implementation of the rules — it applies the same ones
   * the event path applies, to state that was left mid-change. A crash
   * therefore cannot produce an outcome the normal path would not have
   * produced, which is the property the two paths are tested for together.
   */
  async reconcile(): Promise<void> {
    for (const team of await this.store.list()) {
      try {
        await this.reconcileTeam(team.id);
      } catch (error) {
        // One team's mess is not a reason to leave the rest unreconciled.
        this.logger.error({ err: error, teamId: team.id }, "Failed to reconcile a team");
      }
    }
  }

  private async reconcileTeam(teamId: string): Promise<void> {
    const team = await this.store.get(teamId);
    if (!team) return;

    switch (team.lifecycle) {
      case "creating":
        await this.resumeCreation(team);
        return;
      case "archiving":
        // Eviction first: an agent that came back while the archive was
        // stopped leaves the team rather than being archived on its way out.
        await this.cancelOutstandingRecruits(team);
        await this.evictAgentsThatCameBack(team);
        await this.archive(team.id);
        return;
      case "failed":
        await this.cancelOutstandingRecruits(team);
        await this.cleanUpFailed(team);
        return;
      case "active":
        await this.reconcileActive(team);
        return;
      case "archived":
        await this.cancelOutstandingRecruits(team);
        await this.evictAgentsThatCameBack(team);
        return;
    }
  }

  private async resumeCreation(team: StoredTeam): Promise<void> {
    // The plan says the lead exists. If it does not, the daemon cannot tell
    // "deleted" from "never created", and rebuilding could duplicate work that
    // already happened — so the team fails rather than guesses. Asked before
    // the lock because it is a question for the agent runtime, not the record.
    const leadIsGone =
      isStageComplete(team.creationStage, "agents_created") &&
      (await this.agents.getAgentState(team.leadAgentId)).kind === "missing";

    // Everything that writes happens under the lock, re-reading first. An
    // archive can complete while the question above is in flight, and marking
    // that team `failed` would overwrite an ending someone chose.
    await this.serializePerTeam(team.id, async () => {
      const current = await this.store.get(team.id);
      if (current?.lifecycle !== "creating") {
        return;
      }
      if (!current.creationPlan || leadIsGone) {
        if (leadIsGone) {
          this.logger.error(
            { teamId: team.id, leadAgentId: team.leadAgentId },
            "Failing a half-created team: its lead is gone and cannot be safely rebuilt",
          );
        }
        await this.markFailed(team.id);
        return;
      }
      await this.runCreationPlan(current);
    });
  }

  /**
   * Cleans up after a creation that gave up: the agents it managed to build are
   * archived, and the room goes, since it belonged to a team that never ran.
   */
  private async cleanUpFailed(team: StoredTeam): Promise<void> {
    if (team.failedCleanupAt) return;

    for (const member of team.members) {
      if (member.state === "removed") continue;
      await this.archiveAgentIdempotently(member.agentId);
    }
    await this.rooms.discardRoom({ roomId: team.chatRoomId, ownerId: team.id });
    await this.store.update(team.id, (current) => ({
      ...current,
      failedCleanupAt: new Date().toISOString(),
    }));
  }

  private async reconcileActive(team: StoredTeam): Promise<void> {
    const lead = await this.agents.getAgentState(team.leadAgentId);
    if (lead.kind === "missing") {
      await this.markRemoved(team.id, team.leadAgentId, "hard_deleted");
      await this.archive(team.id);
      return;
    }
    // An archived lead means the team is over, whether the event that should
    // have said so ever ran. The daemon can die between marking the entry and
    // archiving the team, and nothing else would ever notice.
    if (lead.kind === "archived") {
      await this.archive(team.id);
      return;
    }

    await this.finishInterruptedRecruits(team);

    // Re-read: finishing the recruits above changes the roster, and deciding
    // the rest of this pass from the snapshot it started with would overwrite
    // what those steps just recorded.
    const current = (await this.store.get(team.id)) ?? team;

    // The lead goes through the same checks as everyone else. Skipping it left
    // one state unreachable: an entry that says `archived` while the agent has
    // since come back — which the event path would have restored.
    for (const member of current.members) {
      const state =
        member.agentId === team.leadAgentId
          ? lead
          : await this.agents.getAgentState(member.agentId);
      if (state.kind === "missing" && member.state !== "removed") {
        await this.markRemoved(team.id, member.agentId, "hard_deleted");
        continue;
      }
      if (state.kind === "archived" && member.state === "active") {
        await this.onAgentArchived(member.agentId);
        continue;
      }
      if (state.kind === "active" && member.state === "archived") {
        await this.onAgentUnarchived(member.agentId);
        continue;
      }
      // The roster says this agent is a member and the agent does not know it.
      // A crash between clearing labels and recording a removal leaves exactly
      // this, and nothing else would ever put it right.
      if (
        state.kind === "active" &&
        member.state === "active" &&
        !labelsMatch(state.teamLabel, team.id, member.role)
      ) {
        this.logger.info(
          { teamId: team.id, agentId: member.agentId },
          "Restoring team labels on a member that had lost them",
        );
        await this.agents.restoreTeamLabels({
          agentId: member.agentId,
          teamId: team.id,
          role: member.role,
        });
      }
    }
  }

  /**
   * Replays recruits that were interrupted. The intent holds everything needed
   * to finish, so this replays rather than re-decides. A replay that cannot go
   * through releases the seat instead of holding it forever.
   */
  private async finishInterruptedRecruits(team: StoredTeam): Promise<void> {
    for (const agentId of Object.keys(team.pendingRecruitments ?? {})) {
      try {
        await this.landRecruit(team.id, agentId);
      } catch (error) {
        // A cancellation has already recorded why the recruit is gone and
        // cleaned up after it. Running the failure path on top would overwrite
        // that reason with a vaguer one.
        if (error instanceof TeamRecruitmentCancelledError) {
          continue;
        }
        this.logger.error(
          { err: error, teamId: team.id, agentId },
          "Releasing a recruit that could not be finished",
        );
        await this.failRecruitment(team.id, agentId);
      }
    }
  }

  /** Cancels every outstanding recruit, for a team that may no longer take them. */
  private async cancelOutstandingRecruits(team: StoredTeam): Promise<void> {
    for (const agentId of Object.keys(team.pendingRecruitments ?? {})) {
      await this.cancelRecruitment(team.id, agentId);
    }
  }

  /**
   * Gives up on a recruit, but only if it is still one.
   *
   * The intent is the claim. A pass that failed while another was succeeding
   * finds it already gone, and stops there — archiving the agent that other
   * pass just recruited would be a far worse outcome than a logged failure.
   * The claim is taken in the same write that records the failure.
   */
  private async failRecruitment(teamId: string, agentId: string): Promise<void> {
    let claimed = false;
    await this.store.update(teamId, (current) => {
      if (!current.pendingRecruitments?.[agentId]) {
        return current;
      }
      claimed = true;
      return {
        ...current,
        members: current.members.map((member) =>
          member.agentId === agentId
            ? {
                ...member,
                state: "removed" as const,
                leftAt: new Date().toISOString(),
                removalReason: "recruitment_failed" as const,
              }
            : member,
        ),
        pendingRecruitments: withoutIntent(current.pendingRecruitments, agentId),
      };
    });

    if (!claimed) {
      this.logger.info(
        { teamId, agentId },
        "Leaving a recruit alone: another pass had already finished it",
      );
      return;
    }
    await this.archiveAgentIdempotently(agentId);
  }

  /**
   * DEC-11 applied to entries the event never reached: an agent that is active
   * again while its entry says otherwise gets the same question, and the same
   * answer, as it would have on the event path.
   */
  private async evictAgentsThatCameBack(team: StoredTeam): Promise<void> {
    // Re-read: earlier steps in this pass may already have closed entries, and
    // deciding from the snapshot this pass started with would undo them.
    const current = await this.store.get(team.id);
    if (!current) return;

    for (const member of current.members) {
      if (member.state === "removed") continue;
      const state = await this.agents.getAgentState(member.agentId);
      if (state.kind !== "active") continue;
      if (member.state === "archived") {
        await this.onAgentUnarchived(member.agentId);
      }
    }
  }

  /**
   * Ends the team: every member that is still active gets archived, then the
   * record does.
   *
   * The room stays. Its history is the reason anyone would look at an archived
   * team at all.
   */
  async archive(teamId: string): Promise<StoredTeam | null> {
    return await this.serializePerTeam(teamId, async () => {
      const team = await this.store.get(teamId);
      if (!team) return null;
      if (team.lifecycle === "archived") {
        return team;
      }

      const marked = await this.store.update(teamId, (current) => ({
        ...current,
        lifecycle: "archiving" as const,
      }));
      if (!marked) return null;

      for (const member of marked.members) {
        if (member.state !== "active") continue;
        await this.archiveAgentIdempotently(member.agentId);
      }

      return await this.store.update(teamId, (current) => ({
        ...current,
        lifecycle: "archived" as const,
        archivedAt: new Date().toISOString(),
        members: current.members.map((member) =>
          member.state === "active" ? { ...member, state: "archived" as const } : member,
        ),
      }));
    });
  }

  /**
   * Takes a member off the team. The agent carries on as an ordinary agent —
   * leaving a team is not the same as being shut down.
   */
  async removeMember(input: { teamId: string; agentId: string }): Promise<StoredTeam | null> {
    return await this.serializePerTeam(input.teamId, async () => {
      const team = await this.store.get(input.teamId);
      if (!team) return null;
      if (team.leadAgentId === input.agentId) {
        throw new TeamCreateValidationError(
          "The lead cannot be removed from its own team; archive the team instead",
        );
      }
      const entry = team.members.find((member) => member.agentId === input.agentId);
      if (!entry || entry.state === "removed") {
        return team;
      }

      await this.agents.clearTeamLabels(input.agentId);
      return await this.markRemoved(input.teamId, input.agentId, "removed_by_user");
    });
  }

  /**
   * DEC-12. A hard delete leaves nothing behind to consult, so the team
   * converges on what is left: a member simply goes, and a lead takes the team
   * with it. `leadAgentId` stays as a historical reference — an archived team
   * does not need its lead to still exist.
   */
  async onAgentDeleted(agentId: string): Promise<StoredTeam | null> {
    const team = await this.findTeamOf(agentId);
    if (!team) return null;

    // Under the team's lock, for the same reason as an archive event.
    const updated = await this.serializePerTeam(team.id, () =>
      this.markRemoved(team.id, agentId, "hard_deleted"),
    );
    if (team.leadAgentId !== agentId || updated?.lifecycle !== "active") {
      return updated;
    }
    return await this.archive(team.id);
  }

  /** An agent archived outside the team. The lead taking that step ends the team. */
  async onAgentArchived(agentId: string): Promise<StoredTeam | null> {
    const team = await this.findTeamOf(agentId);
    if (!team) return null;

    // Under the team's lock like everything else. An event landing mid-creation
    // used to change the roster while creation carried on and declared the team
    // active — an active team whose lead had already been archived.
    const marked = await this.serializePerTeam(team.id, async () => {
      const current = await this.store.get(team.id);
      if (!current) return null;
      return await this.store.update(team.id, (latest) => ({
        ...latest,
        members: latest.members.map((member) =>
          member.agentId === agentId && member.state === "active"
            ? { ...member, state: "archived" as const }
            : member,
        ),
      }));
    });

    if (marked && marked.leadAgentId === agentId && marked.lifecycle === "active") {
      return await this.archive(team.id);
    }
    return marked;
  }

  /**
   * DEC-11. However the agent came back, the team asks one question: is there
   * still a place for it here? Yes means the entry is restored and the labels
   * with it; no means the entry is closed and the agent goes on without the
   * team. The rule is the same whether this arrives as an event or as the
   * reconciler catching up, which is what keeps the two paths equivalent.
   */
  async onAgentUnarchived(agentId: string): Promise<StoredTeam | null> {
    const team = await this.findTeamOf(agentId);
    if (!team) return null;

    return await this.serializePerTeam(team.id, async () => {
      const current = await this.store.get(team.id);
      if (!current) return null;
      const entry = current.members.find((member) => member.agentId === agentId);
      // `removed` is where an entry stops. Someone who left, was evicted, or
      // was deleted is no longer a member; what happens to that agent
      // afterwards is not the team's business, and reading its history as a
      // claim to a seat would undo an explicit removal.
      if (!entry || entry.state === "active" || entry.state === "removed") {
        return current;
      }

      if (hasRoomFor(current, agentId)) {
        await this.agents.restoreTeamLabels({
          agentId,
          teamId: current.id,
          role: entry.role,
        });
        return await this.store.update(current.id, (latest) => ({
          ...latest,
          members: latest.members.map((member) =>
            member.agentId === agentId
              ? { ...member, state: "active" as const, leftAt: null, removalReason: null }
              : member,
          ),
        }));
      }

      await this.agents.clearTeamLabels(agentId);
      return await this.markRemoved(current.id, agentId, "unarchive_evicted");
    });
  }

  /**
   * Archiving a member of a team is allowed to find nothing: an entry can point
   * at an agent that was hard-deleted, and that entry is simply already done.
   * The user-facing command still reports a missing agent as an error — this
   * leniency belongs to the team's own bookkeeping, not to that contract.
   *
   * Any other failure propagates. Swallowing it would let the team mark itself
   * archived, or its cleanup finished, while the agent is still running — and
   * those markers are exactly what stops anything trying again.
   */
  private async archiveAgentIdempotently(agentId: string): Promise<void> {
    const result = await this.agents.archiveAgent(agentId);
    if (result.kind === "not_found") {
      this.logger.info(
        { agentId },
        "Treating a missing agent as already archived while archiving its team",
      );
    }
  }

  private async markRemoved(
    teamId: string,
    agentId: string,
    reason: "removed_by_user" | "hard_deleted" | "unarchive_evicted",
  ): Promise<StoredTeam | null> {
    const now = new Date().toISOString();
    return await this.store.update(teamId, (current) => ({
      ...current,
      members: current.members.map((member) =>
        member.agentId === agentId
          ? { ...member, state: "removed" as const, leftAt: now, removalReason: reason }
          : member,
      ),
    }));
  }

  /**
   * The team this agent still belongs to, if any. A `removed` entry is history
   * rather than membership — an agent that left one team and joined another
   * must not be found by the first.
   */
  private async findTeamOf(agentId: string): Promise<StoredTeam | null> {
    const teams = await this.store.list();
    return (
      teams.find((team) =>
        team.members.some((member) => member.agentId === agentId && member.state !== "removed"),
      ) ?? null
    );
  }

  /**
   * One operation per team at a time. Archive reads the roster, acts on each
   * entry, then writes the outcome; a concurrent removal landing in the middle
   * would otherwise be overwritten by a decision taken before it.
   */
  private async serializePerTeam<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.teamOperations.get(teamId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.teamOperations.set(
      teamId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return await next;
  }

  private async markFailed(teamId: string): Promise<void> {
    try {
      await this.store.update(teamId, (current) => ({
        ...current,
        lifecycle: "failed" as const,
      }));
    } catch (error) {
      this.logger.error({ err: error, teamId }, "Failed to record a failed team creation");
    }
  }
}

const CREATION_STAGE_ORDER: TeamCreationStage[] = [
  "allocated",
  "room_created",
  "agents_created",
  "briefed",
];

function isStageComplete(current: TeamCreationStage | null, stage: TeamCreationStage): boolean {
  if (current === null) return false;
  return CREATION_STAGE_ORDER.indexOf(current) >= CREATION_STAGE_ORDER.indexOf(stage);
}

/**
 * Whether the team can take this agent back. Only an active team can, and only
 * if the seats are not full — except for the lead, which does not occupy one,
 * so an active team always has room for its own lead.
 */
function hasRoomFor(team: StoredTeam, agentId: string): boolean {
  if (team.lifecycle !== "active") {
    return false;
  }
  if (team.leadAgentId === agentId) {
    return true;
  }
  const occupied = team.members.filter(
    (member) => member.state === "active" && member.agentId !== team.leadAgentId,
  ).length;
  return occupied < TEAM_MAX_NON_LEAD_MEMBERS;
}

function labelsMatch(
  label: { teamId: string; role: string } | null,
  teamId: string,
  role: string,
): boolean {
  return label?.teamId === teamId && label.role === role;
}

/** Removes one intent, collapsing an empty table back to null. */
function withoutIntent(
  intents: Record<string, RecruitmentIntent> | null,
  agentId: string,
): Record<string, RecruitmentIntent> | null {
  if (!intents) return null;
  const remaining = Object.fromEntries(
    Object.entries(intents).filter(([candidate]) => candidate !== agentId),
  );
  return Object.keys(remaining).length > 0 ? remaining : null;
}

function assertRecruitable(
  team: StoredTeam | null,
  input: {
    recruiterAgentId: string;
    teamRole: string;
    settings: Record<string, unknown> | null;
  },
): asserts team is StoredTeam {
  if (!team || team.lifecycle !== "active") {
    throw new TeamCreateValidationError(`Team ${team?.id ?? ""} is not active`);
  }
  const recruiter = team.members.find((member) => member.agentId === input.recruiterAgentId);
  if (!recruiter || recruiter.state !== "active") {
    throw new TeamCreateValidationError(
      `${input.recruiterAgentId} is not a member of this team and cannot recruit into it`,
    );
  }

  assertJsonValue(input.settings, "settings");

  const role = input.teamRole.trim();
  if (role.length === 0) {
    throw new TeamCreateValidationError("A recruit needs a role");
  }
  if (role === TEAM_LEAD_ROLE) {
    throw new TeamCreateValidationError(`"${TEAM_LEAD_ROLE}" is a reserved role`);
  }
  if (team.members.some((member) => member.state === "active" && member.role === role)) {
    throw new TeamCreateValidationError(`Team member roles must be unique: ${role}`);
  }

  const occupied = team.members.filter(
    (member) => member.state === "active" && member.agentId !== team.leadAgentId,
  ).length;
  if (occupied >= TEAM_MAX_NON_LEAD_MEMBERS) {
    throw new TeamCreateValidationError(
      `A team holds at most ${TEAM_MAX_NON_LEAD_MEMBERS} members besides its lead`,
    );
  }
}

function assertMemberSpecsValid(request: CreateTeamRequest): void {
  assertJsonValue(request.lead.settings, "lead.settings");
  request.members.forEach((member, index) =>
    assertJsonValue(member.settings, `members[${index}].settings`),
  );

  if (request.members.length > TEAM_MAX_NON_LEAD_MEMBERS) {
    throw new TeamCreateValidationError(
      `A team holds at most ${TEAM_MAX_NON_LEAD_MEMBERS} members besides its lead`,
    );
  }

  const seen = new Set<string>();
  for (const member of request.members) {
    const role = member.role.trim();
    if (role.length === 0) {
      throw new TeamCreateValidationError("Every team member needs a role");
    }
    if (role === TEAM_LEAD_ROLE) {
      throw new TeamCreateValidationError(`"${TEAM_LEAD_ROLE}" is a reserved role`);
    }
    if (seen.has(role)) {
      throw new TeamCreateValidationError(`Team member roles must be unique: ${role}`);
    }
    seen.add(role);
  }
}

/**
 * Identifies the request itself, with the transport fields left out: two
 * genuine retries differ in `requestId` but agree on everything that decides
 * what gets built. Persisted, so a restart can still tell a retry from a
 * different request reusing the key.
 */
function fingerprintCreateRequest(request: CreateTeamRequest): string {
  const canonical = {
    name: request.name,
    workspaceId: request.workspaceId,
    task: request.task,
    templateId: request.templateId,
    // The lead's role is fixed when the plan is built, whatever the request
    // called it, so the fingerprint has to use the same fixed value — two
    // requests that produce an identical team must not look different here.
    lead: canonicalMember({ ...request.lead, role: TEAM_LEAD_ROLE }),
    members: request.members.map(canonicalMember),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function canonicalMember(member: TeamMemberRequest): unknown {
  return {
    // Trimmed, because the plan stores the trimmed role: two requests that
    // build the identical team must not look different here.
    role: member.role.trim(),
    provider: member.provider,
    title: member.title,
    briefing: member.briefing,
    settings: canonicalValue(member.settings),
  };
}

/**
 * Orders every object key, at every depth. Sorting only the top level would
 * make `{features: {a: 1, b: 2}}` and `{features: {b: 2, a: 1}}` look like
 * different requests, and a retry would come back as a conflict.
 */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

/**
 * Settings arrive as `Record<string, unknown>`, which is wider than what the
 * wire can carry. The fingerprint has to be total over whatever it is handed:
 * `undefined` would collide with an absent key, a `Date` or a `Map` would
 * flatten to `{}`, and a `BigInt` would throw during serialization — all of
 * which turn a retry into a conflict, or worse, two different requests into
 * one. Anything that is not JSON is refused where it enters.
 */
function assertJsonValue(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null) return;
  if (Array.isArray(value)) {
    guardAgainstCycle(value, path, seen);
    for (let index = 0; index < value.length; index += 1) {
      // A hole is not `undefined` you can see — `forEach` skips it and JSON
      // writes `null` — so the length is walked rather than the entries.
      if (!(index in value)) {
        throw new TeamCreateValidationError(`${path}[${index}] must not be a hole`);
      }
      assertJsonValue(value[index], `${path}[${index}]`, seen);
    }
    seen.delete(value);
    return;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      // Both serialize as `null`, which would make `{x: NaN}` and `{x: null}`
      // the same request as far as the fingerprint can tell.
      if (!Number.isFinite(value)) {
        throw new TeamCreateValidationError(`${path} must be a finite number`);
      }
      return;
    case "object": {
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TeamCreateValidationError(`${path} must be a plain JSON object`);
      }
      guardAgainstCycle(value, path, seen);
      // Symbol keys are invisible to `Object.entries` and to JSON, so a value
      // carrying one would be silently different from what gets stored.
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TeamCreateValidationError(`${path} must not have symbol keys`);
      }
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        assertJsonValue(nested, `${path}.${key}`, seen);
      }
      seen.delete(value);
      return;
    }
    default:
      throw new TeamCreateValidationError(`${path} must be a JSON value`);
  }
}

function guardAgainstCycle(value: object, path: string, seen: Set<object>): void {
  if (seen.has(value)) {
    throw new TeamCreateValidationError(`${path} must not contain a cycle`);
  }
  seen.add(value);
}

function buildAllocatedTeam(
  request: CreateTeamRequest,
  fingerprint: string,
): Omit<NewTeam, "idempotencyKey"> {
  const now = new Date().toISOString();
  // Every id is allocated here, before anything is written. The room is named
  // after the team, and the plan has to be complete enough to replay from — so
  // the team's own id cannot be something the store decides later.
  const teamId = randomUUID();
  const leadAgentId = randomUUID();
  const roomId = randomUUID();

  const planMembers: TeamCreationPlan["members"] = [
    {
      agentId: leadAgentId,
      isLead: true,
      role: TEAM_LEAD_ROLE,
      title: request.lead.title,
      provider: request.lead.provider,
      settings: request.lead.settings,
      briefing: request.lead.briefing,
    },
    ...request.members.map((member) => ({
      agentId: randomUUID(),
      isLead: false,
      role: member.role.trim(),
      title: member.title,
      provider: member.provider,
      settings: member.settings,
      briefing: member.briefing,
    })),
  ];

  const roster: TeamMemberEntry[] = planMembers.map((member) => ({
    agentId: member.agentId,
    role: member.role,
    joinedAt: now,
    leftAt: null,
    state: "active" as const,
    removalReason: null,
  }));

  return {
    id: teamId,
    name: request.name,
    workspaceId: request.workspaceId,
    chatRoomId: roomId,
    leadAgentId,
    members: roster,
    lifecycle: "creating",
    requestFingerprint: fingerprint,
    creationPlan: {
      task: request.task,
      // Unique across every chat room; the team's own name is the display name.
      room: { roomId, internalName: `team-${teamId}` },
      members: planMembers,
    },
    creationStage: "allocated",
    templateId: request.templateId,
    archivedAt: null,
    failedCleanupAt: null,
    pendingRecruitments: null,
  };
}
