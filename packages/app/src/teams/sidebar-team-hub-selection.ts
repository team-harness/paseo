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
  routeServerId: string | null = null,
): string | null {
  const serverId = selection?.serverId ?? routeServerId;
  if (
    !serverId ||
    features?.teamMissions !== true ||
    features.globalTeamProfiles !== true ||
    features.teamMethodologies !== true
  ) {
    return null;
  }

  return serverId;
}
