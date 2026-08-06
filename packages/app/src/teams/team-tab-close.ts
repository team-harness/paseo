import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * What closing a tab should do.
 *
 * `close` puts the tab away and leaves everything running. `confirm` means the
 * tab is the only place a running thing is visible from, so putting it away
 * without saying so would look like ending it.
 */
export type TabCloseDecision =
  | { kind: "close" }
  | { kind: "confirm"; reason: "team_lead"; teamId: string; teamName: string; agentCount: number };

/**
 * Decides what closing this tab means.
 *
 * A team's lead is an ordinary agent with an ordinary tab, and closing an
 * agent tab has never ended the agent. But a lead is also the only thing whose
 * tab a user is likely to read as "the team" — so closing it silently would
 * either look like the team was archived when it was not, or, worse, invite
 * the reflex of closing it *in order to* archive. Ending a team is `archive`,
 * and it is a different decision made somewhere it can be named.
 *
 * Only while the team is live and has agents still on it. A team that is over
 * has nothing left to be mistaken about.
 */
export function decideTabClose(
  target: WorkspaceTabTarget,
  teams: ReadonlyMap<string, TeamSnapshot>,
): TabCloseDecision {
  if (target.kind !== "agent") return { kind: "close" };

  for (const team of teams.values()) {
    if (team.leadAgentId !== target.agentId) continue;
    if (team.lifecycle !== "active" && team.lifecycle !== "creating") continue;
    const active = team.members.filter((member) => member.state === "active");
    if (active.length === 0) continue;
    return {
      kind: "confirm",
      reason: "team_lead",
      teamId: team.id,
      teamName: team.name,
      agentCount: active.length,
    };
  }
  return { kind: "close" };
}
