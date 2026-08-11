import type { TeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { describeTeamPanel } from "@/teams/team-panel-descriptor";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface WorkspaceTeamRow {
  teamId: string;
  name: string;
  statusBucket: SidebarStateBucket | null;
}

/** Active Team profiles owned by one workspace, with status from their active Mission. */
export function selectWorkspaceTeamRows(
  replica: TeamMissionsReplica,
  workspaceId: string,
): WorkspaceTeamRow[] {
  const rows: WorkspaceTeamRow[] = [];
  for (const team of replica.profiles.values()) {
    if (team.workspaceId !== workspaceId || team.lifecycle !== "active") continue;
    const mission = team.activeMissionId
      ? (replica.missions.get(team.activeMissionId) ?? null)
      : null;
    rows.push({
      teamId: team.id,
      name: team.name,
      statusBucket: describeTeamPanel(team, mission, team.id).statusBucket,
    });
  }
  rows.sort(
    (left, right) => left.name.localeCompare(right.name) || left.teamId.localeCompare(right.teamId),
  );
  return rows;
}
