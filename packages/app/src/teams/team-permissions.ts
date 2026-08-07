import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { PendingPermission } from "@/types/shared";

/** One member's request, kept whole so answering it names the agent it belongs to. */
export interface TeamPermissionRow {
  agentId: string;
  role: string;
  isLead: boolean;
  permission: PendingPermission;
}

/**
 * The requests a team is waiting on, one row per request.
 *
 * Per request rather than per member: two members blocked at once are two
 * decisions, and collapsing them into "the team needs input" gives the user a
 * single button for two different questions. Answering one must not answer or
 * dismiss the other.
 *
 * Only members still on the team. What an agent that left is blocked on is its
 * own business, and a team panel offering to answer it would be answering for
 * something it no longer speaks for.
 */
export function selectTeamPermissions(
  team: TeamSnapshot,
  pending: ReadonlyMap<string, PendingPermission>,
): TeamPermissionRow[] {
  const rows: TeamPermissionRow[] = [];
  for (const entry of team.members) {
    if (entry.state !== "active") continue;
    for (const permission of pending.values()) {
      if (permission.agentId !== entry.agentId) continue;
      rows.push({
        agentId: entry.agentId,
        role: entry.role,
        isLead: entry.agentId === team.leadAgentId,
        permission,
      });
    }
  }
  // The lead first: it is the one whose answer usually unblocks the rest.
  return rows.sort((left, right) => Number(right.isLead) - Number(left.isLead));
}
