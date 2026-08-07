import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy =
  | { kind: "archive-on-close" }
  | { kind: "layout-only" }
  /**
   * The tab closes and the agent keeps running, because archiving it would end
   * a team. The team panel is where a team is ended, and the only place that
   * can say what ending one costs.
   */
  | { kind: "team-lead"; teamId: string; teamName: string };

/**
 * What closing an agent's tab does.
 *
 * A root agent's tab is the agent: closing it archives. A subagent's is not —
 * it lives in its parent's track and the tab is only a view of it.
 *
 * A team lead is a root agent, so the default would archive it — and archiving
 * a lead ends the whole team (DEC-12). Closing a tab is a layout gesture, and a
 * layout gesture cannot be how an eight-agent team ends, however loudly it asks
 * first. The lead's tab closes and everything keeps running.
 */
export function resolveCloseAgentTabPolicy(
  agent: Pick<Agent, "id" | "parentAgentId"> | null | undefined,
  teams?: ReadonlyMap<string, TeamSnapshot>,
): CloseAgentTabPolicy {
  if (agent?.parentAgentId) {
    return { kind: "layout-only" };
  }

  const led = agent ? findLiveTeamLedBy(teams, agent.id) : null;
  if (led) {
    return { kind: "team-lead", teamId: led.id, teamName: led.name };
  }

  return { kind: "archive-on-close" };
}

/** Whether closing this tab leaves its agent running. */
export function closesWithoutArchiving(policy: CloseAgentTabPolicy): boolean {
  return policy.kind !== "archive-on-close";
}

/**
 * A team this agent leads that is still running and still has members.
 *
 * `creating` counts: the team is mid-transaction, and archiving its lead there
 * leaves the daemon in a state only reconciliation repairs. One that is over,
 * or that everyone has left, has nothing to protect.
 */
function findLiveTeamLedBy(
  teams: ReadonlyMap<string, TeamSnapshot> | undefined,
  agentId: string,
): TeamSnapshot | null {
  if (!teams) return null;
  for (const team of teams.values()) {
    if (team.leadAgentId !== agentId) continue;
    if (team.lifecycle !== "active" && team.lifecycle !== "creating") continue;
    if (!team.members.some((member) => member.state === "active")) continue;
    return team;
  }
  return null;
}
