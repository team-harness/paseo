import type { TeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { describeTeamPanel } from "@/teams/team-panel-descriptor";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface WorkspaceTeamRow {
  teamId: string;
  name: string;
  statusBucket: SidebarStateBucket | null;
}

/** Places active Teams by Mission workspace, with a stable idle fallback. */
export function selectWorkspaceTeamRows(
  replica: TeamMissionsReplica,
  workspaceId: string,
  liveWorkspaceIds: readonly string[],
): WorkspaceTeamRow[] {
  const rows: WorkspaceTeamRow[] = [];
  const liveWorkspaceIdSet = new Set(liveWorkspaceIds);
  const firstLiveWorkspaceId = [...liveWorkspaceIdSet].sort()[0] ?? null;
  for (const team of replica.profiles.values()) {
    if (team.lifecycle !== "active") continue;
    const mission = team.activeMissionId
      ? (replica.missions.get(team.activeMissionId) ?? null)
      : null;
    let placementWorkspaceId: string | null | undefined;
    if (team.activeMissionId) {
      placementWorkspaceId = mission?.workspaceId;
    } else {
      placementWorkspaceId = liveWorkspaceIdSet.has(team.workspaceId)
        ? team.workspaceId
        : firstLiveWorkspaceId;
    }
    if (placementWorkspaceId !== workspaceId) continue;
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
