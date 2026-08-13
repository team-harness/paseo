export interface SidebarTeamHubSelection {
  serverId: string;
}

export interface SidebarTeamHubFeatures {
  teamMissions?: boolean;
  globalTeamProfiles?: boolean;
  teamMethodologies?: boolean;
}

export function selectSidebarTeamHubServerId(
  selection: SidebarTeamHubSelection | null,
  features: SidebarTeamHubFeatures | null,
): string | null {
  if (
    !selection ||
    features?.teamMissions !== true ||
    features.globalTeamProfiles !== true ||
    features.teamMethodologies !== true
  ) {
    return null;
  }

  return selection.serverId;
}
