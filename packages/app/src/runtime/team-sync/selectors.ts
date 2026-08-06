import { deriveAgentStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import { getTeamIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import { isLiveTeam } from "./team-replica";

/** What a selector needs from an agent; the rest of the record is not its business. */
export interface TeamMemberAgent {
  id: string;
  title: string | null;
  status: "idle" | "running" | "initializing" | "error" | "closed";
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  /**
   * The requests this agent is blocked on.
   *
   * Taken as a list rather than a count because that is the shape the store
   * holds. Asking callers for a count is how this arrived `undefined` at every
   * call site while typecheck stayed quiet — the field is optional, and a
   * structural match does not notice a missing one.
   */
  pendingPermissions?: readonly unknown[];
  archivedAt?: Date | null;
  labels: Record<string, string>;
}

export interface TeamMemberRow {
  entry: TeamMemberEntry;
  agent: TeamMemberAgent | null;
  isLead: boolean;
}

/**
 * What a team as a whole is doing.
 *
 * Ordered by what a person needs to act on: something is waiting for them,
 * something is working, or nothing is. The most urgent member decides, because
 * a team with one member blocked on a permission is a team that is blocked —
 * averaging that away is how a request for input goes unnoticed.
 */
export type TeamActivity = "needs_input" | "running" | "idle";

const ACTIVITY_RANK: Record<TeamActivity, number> = {
  needs_input: 3,
  running: 2,
  idle: 1,
};

/**
 * Joins the roster to the agents the client holds.
 *
 * Entries with no agent are kept, with a null agent: a member whose agent has
 * not loaded is still a member, and dropping the row would silently shrink the
 * team rather than show it incompletely.
 */
export function selectTeamRoster(
  team: TeamSnapshot,
  agents: ReadonlyMap<string, TeamMemberAgent>,
): TeamMemberRow[] {
  return team.members.map((entry) => ({
    entry,
    agent: agents.get(entry.agentId) ?? null,
    isLead: entry.agentId === team.leadAgentId,
  }));
}

/**
 * Where the team is in its own life, in the terms the panel acts on.
 *
 * `lifecycle` has five values and the panel cares about three questions: is it
 * still being built, is it on its way out, and is it over. `archiving` and the
 * two end states differ to the daemon and not to a person looking at a roster
 * they can no longer change.
 */
export type TeamStage = "creating" | "active" | "archiving" | "ended";

export function selectTeamStage(team: TeamSnapshot): TeamStage {
  switch (team.lifecycle) {
    case "creating":
      return "creating";
    case "archiving":
      return "archiving";
    case "archived":
    case "failed":
      return "ended";
    default:
      return "active";
  }
}

/** Whether the panel's lifecycle actions still do anything. */
export function teamStageAcceptsActions(stage: TeamStage): boolean {
  return stage === "creating" || stage === "active";
}

/**
 * What one member is doing.
 *
 * `needs_input` means a person has to answer something, which is what
 * `deriveAgentStateBucket` means by it too. `requiresAttention` alone does not:
 * a member that finished its turn sets it, and reading that as "waiting on you"
 * puts a permanent badge on the team over a panel with nothing to press.
 */
export function selectMemberActivity(agent: TeamMemberAgent | null): TeamActivity {
  if (!agent) return "idle";
  const bucket = deriveAgentStateBucket({
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason ?? null,
    pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
  });
  if (bucket === "needs_input") return "needs_input";
  // `initializing` is not `running` to the shared rule, but a member still
  // starting up is a team that is working rather than one that is idle.
  if (bucket === "running" || agent.status === "initializing") return "running";
  return "idle";
}

/**
 * What the team is doing, taken from the member with the most urgent state.
 *
 * Only members still on the team count. One that left is not the team's
 * business, and a permission it happens to be blocked on is not the team's
 * problem to display.
 */
export function selectTeamActivity(rows: readonly TeamMemberRow[]): TeamActivity {
  let activity: TeamActivity = "idle";
  for (const row of rows) {
    if (row.entry.state !== "active") continue;
    const member = selectMemberActivity(row.agent);
    if (ACTIVITY_RANK[member] > ACTIVITY_RANK[activity]) activity = member;
  }
  return activity;
}

/**
 * Removes from a subagents track the agents that are already shown as team
 * members.
 *
 * A recruit is stamped with its recruiter as parent, so it is a subagent and a
 * team member at once — both are true, and both surfaces would otherwise draw
 * it. The team panel is the more specific one, so the track gives way.
 */
export function selectSubagentsWithoutTeamMembers<T extends { id: string; labels?: unknown }>(
  subagents: readonly T[],
  liveTeamIds: ReadonlySet<string>,
): T[] {
  return subagents.filter((subagent) => {
    const labels = subagent.labels;
    if (!labels || typeof labels !== "object") return true;
    const teamId = getTeamIdFromLabels(labels as Record<string, unknown>);
    // A team that is over has no panel drawing its members, so hiding them
    // from the track as well would hide them everywhere.
    return teamId === null || !liveTeamIds.has(teamId);
  });
}

/** The teams that still have a panel of their own. */
export function selectLiveTeamIds(teams: ReadonlyMap<string, TeamSnapshot>): Set<string> {
  const live = new Set<string>();
  for (const team of teams.values()) {
    if (isLiveTeam(team)) live.add(team.id);
  }
  return live;
}
