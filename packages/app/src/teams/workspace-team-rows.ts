import type { TeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { describeTeamPanel } from "@/teams/team-panel-descriptor";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface WorkspaceTeamRow {
  teamId: string;
  name: string;
  statusBucket: SidebarStateBucket | null;
}

/** Places active Teams by Mission workspace, with a capability-gated idle fallback. */
export function selectWorkspaceTeamRows(
  replica: TeamMissionsReplica,
  workspaceId: string,
  liveWorkspaceIds: readonly string[],
  globalTeamProfilesSupported: boolean,
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
    } else if (liveWorkspaceIdSet.has(team.workspaceId)) {
      placementWorkspaceId = team.workspaceId;
    } else {
      // COMPAT(globalTeamProfiles): added in v0.3.1, remove after 2027-02-11 when legacy creation-workspace binding is retired.
      placementWorkspaceId = null;
      if (globalTeamProfilesSupported) {
        placementWorkspaceId = firstLiveWorkspaceId;
      }
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
