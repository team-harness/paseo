import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { isLiveTeam } from "@/runtime/team-sync/team-replica";
import {
  selectTeamActivity,
  selectTeamRoster,
  type TeamMemberAgent,
} from "@/runtime/team-sync/selectors";
import { describeTeamPanel } from "@/teams/team-panel-descriptor";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface WorkspaceTeamRow {
  teamId: string;
  name: string;
  statusBucket: SidebarStateBucket | null;
}

/**
 * The teams a workspace row lists beneath itself.
 *
 * Only live teams: an archived one is history, and a sidebar that keeps every
 * team a workspace ever had is a list that only grows. `creating` counts —
 * creation takes seconds and several agents, and a team that appears only once
 * it is finished looks like nothing happened.
 */
export function selectWorkspaceTeamRows(
  teams: ReadonlyMap<string, TeamSnapshot>,
  workspaceId: string,
  agents: ReadonlyMap<string, TeamMemberAgent>,
): WorkspaceTeamRow[] {
  const rows: WorkspaceTeamRow[] = [];
  for (const team of teams.values()) {
    if (team.workspaceId !== workspaceId) continue;
    if (!isLiveTeam(team)) continue;
    const activity = selectTeamActivity(selectTeamRoster(team, agents));
    rows.push({
      teamId: team.id,
      name: team.name,
      statusBucket: describeTeamPanel(team, activity, team.id).statusBucket,
    });
  }
  // Name, then id. Two teams with the same name would otherwise swap places
  // whenever the map's iteration order changed.
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.teamId.localeCompare(b.teamId));
  return rows;
}
