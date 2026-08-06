import { TEAM_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import { isLiveTeam } from "./team-replica";

/** What a selector needs from an agent; the rest of the record is not its business. */
export interface TeamMemberAgent {
  id: string;
  title: string | null;
  status: string;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
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

/** What one member is doing. */
export function selectMemberActivity(agent: TeamMemberAgent | null): TeamActivity {
  if (!agent) return "idle";
  if (agent.requiresAttention) return "needs_input";
  return agent.status === "running" || agent.status === "initializing" ? "running" : "idle";
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
    const teamId = (labels as Record<string, string>)[TEAM_ID_LABEL];
    // A team that is over has no panel drawing its members, so hiding them
    // from the track as well would hide them everywhere.
    return teamId === undefined || !liveTeamIds.has(teamId);
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

/** Teams whose lead or members include this agent, so a panel can find its team. */
export function selectTeamOfAgent(
  teams: ReadonlyMap<string, TeamSnapshot>,
  agentId: string,
): TeamSnapshot | null {
  for (const team of teams.values()) {
    // A team that is over is not one this agent belongs to. The list of teams
    // hides those; a panel resolving one by agent has to agree, or the two
    // disagree about what counts as a team.
    if (!isLiveTeam(team)) continue;
    const entry = team.members.find((member) => member.agentId === agentId);
    // `removed` is history: an agent that left is not on this team any more.
    if (entry && entry.state !== "removed") return team;
  }
  return null;
}
