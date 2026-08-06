import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import { TEAM_ID_LABEL, TEAM_ROLE_LABEL } from "@getpaseo/protocol/agent-labels";
import { TEAM_MAX_NON_LEAD_MEMBERS } from "@getpaseo/protocol/team/rpc-schemas";
import type {
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
  /** Rejects when the agent is unknown, the same as the user-facing command. */
  archiveAgent(agentId: string): Promise<void>;
  /** Detaches an agent from its team without ending it. */
  clearTeamLabels(agentId: string): Promise<void>;
  restoreTeamLabels(input: { agentId: string; teamId: string; role: string }): Promise<void>;
  /**
   * What the daemon currently has for this agent. The reconciler needs it
   * because the events that would have told the team may never have arrived.
   */
  getAgentState(
    agentId: string,
  ): Promise<{ kind: "active" } | { kind: "archived" } | { kind: "missing" }>;
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

    // One plan per team at a time. Every step is idempotent on the resource it
    // creates — it has to be, for the reconciler — but two callers racing here
    // would still ask for the same agent twice and rely on that to sort it out.
    const running = this.creationRuns.get(allocated.id);
    if (running) {
      return await running;
    }
    const run = this.runCreationPlan(allocated).finally(() => {
      this.creationRuns.delete(allocated.id);
    });
    this.creationRuns.set(allocated.id, run);
    return await run;
  }

  /**
   * Drives an allocated team to `active`, one stage at a time. Safe to call
   * again from any stage: each step is idempotent on the resource it creates,
   * and the stage says which ones are already known to be done.
   */
  private async runCreationPlan(team: StoredTeam): Promise<StoredTeam> {
    const plan = team.creationPlan;
    if (!plan) {
      throw new Error(`Team ${team.id} has no creation plan to run`);
    }

    let current = team;
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
      lifecycle: "active" as const,
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
        await this.evictAgentsThatCameBack(team);
        await this.archive(team.id);
        return;
      case "failed":
        await this.cleanUpFailed(team);
        return;
      case "active":
        await this.reconcileActive(team);
        return;
      case "archived":
        await this.evictAgentsThatCameBack(team);
        return;
    }
  }

  private async resumeCreation(team: StoredTeam): Promise<void> {
    if (!team.creationPlan) {
      await this.markFailed(team.id);
      return;
    }
    // The plan says this agent exists. If it does not, the daemon cannot tell
    // "deleted" from "never created", and rebuilding could duplicate work that
    // already happened — so the team fails rather than guesses.
    if (isStageComplete(team.creationStage, "agents_created")) {
      const lead = await this.agents.getAgentState(team.leadAgentId);
      if (lead.kind === "missing") {
        this.logger.error(
          { teamId: team.id, leadAgentId: team.leadAgentId },
          "Failing a half-created team: its lead is gone and cannot be safely rebuilt",
        );
        await this.markFailed(team.id);
        return;
      }
    }
    await this.runCreationPlan(team);
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

    for (const member of team.members) {
      if (member.agentId === team.leadAgentId) continue;
      const state = await this.agents.getAgentState(member.agentId);
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
      }
    }
  }

  /**
   * DEC-11 applied to entries the event never reached: an agent that is active
   * again while its entry says otherwise gets the same question, and the same
   * answer, as it would have on the event path.
   */
  private async evictAgentsThatCameBack(team: StoredTeam): Promise<void> {
    for (const member of team.members) {
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

    const updated = await this.markRemoved(team.id, agentId, "hard_deleted");
    if (team.leadAgentId !== agentId || updated?.lifecycle !== "active") {
      return updated;
    }
    return await this.archive(team.id);
  }

  /** An agent archived outside the team. The lead taking that step ends the team. */
  async onAgentArchived(agentId: string): Promise<StoredTeam | null> {
    const team = await this.findTeamOf(agentId);
    if (!team) return null;

    if (team.leadAgentId === agentId && team.lifecycle === "active") {
      return await this.archive(team.id);
    }
    return await this.store.update(team.id, (current) => ({
      ...current,
      members: current.members.map((member) =>
        member.agentId === agentId && member.state === "active"
          ? { ...member, state: "archived" as const }
          : member,
      ),
    }));
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
      if (!entry || entry.state === "active") {
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
   */
  private async archiveAgentIdempotently(agentId: string): Promise<void> {
    try {
      await this.agents.archiveAgent(agentId);
    } catch (error) {
      this.logger.info(
        { err: error, agentId },
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

  private async findTeamOf(agentId: string): Promise<StoredTeam | null> {
    const teams = await this.store.list();
    return teams.find((team) => team.members.some((member) => member.agentId === agentId)) ?? null;
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

function assertMemberSpecsValid(request: CreateTeamRequest): void {
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
    lead: canonicalMember(request.lead),
    members: request.members.map(canonicalMember),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function canonicalMember(member: TeamMemberRequest): unknown {
  return {
    role: member.role,
    provider: member.provider,
    title: member.title,
    briefing: member.briefing,
    settings: member.settings === null ? null : sortKeys(member.settings),
  };
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
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
