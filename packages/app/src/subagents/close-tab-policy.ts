import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy =
  | { kind: "archive-on-close" }
  | { kind: "layout-only" }
  /**
   * Archiving this agent ends a team. The user is told which one, and how many
   * agents go with it, before anything happens.
   */
  | { kind: "confirm-team-lead"; teamId: string; teamName: string; agentCount: number };

/**
 * What closing an agent's tab does.
 *
 * A root agent's tab is the agent: closing it archives. A subagent's is not —
 * it lives in its parent's track and the tab is only a view of it.
 *
 * A team lead is a root agent, so the default would archive it — and archiving
 * a lead converges the whole team (DEC-12). That is a reasonable thing to want
 * and an unreasonable thing to do without saying so, because from the tab it
 * looks like closing one agent.
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
    return {
      kind: "confirm-team-lead",
      teamId: led.id,
      teamName: led.name,
      agentCount: led.members.filter((member) => member.state === "active").length,
    };
  }

  return { kind: "archive-on-close" };
}

/**
 * A team this agent leads that is still running and still has members.
 *
 * One that is over, or that everyone has left, has nothing left to end.
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
