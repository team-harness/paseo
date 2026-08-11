import { useMemo } from "react";
import { Redirect } from "expo-router";
import { HostLevelTeamList } from "@/components/teams/host-level-team-list";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  resolveHostIndexRouteDecision,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useSessionStore } from "@/stores/session-store";
import {
  useHasHydratedWorkspaces,
  useHasLiveWorkspaces,
  useWorkspaceExists,
} from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { selectHostLevelTeamRows } from "@/teams/host-level-team-rows";

export default function HostIndexRoute() {
  const serverId = useHostRouteServerId();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const workspaceSelectionWorkspaceId =
    workspaceSelection?.serverId === serverId ? workspaceSelection.workspaceId : null;
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(serverId);
  const hasLiveWorkspaces = useHasLiveWorkspaces(serverId);
  const workspaceSelectionExists = useWorkspaceExists(serverId, workspaceSelectionWorkspaceId);
  const globalTeamProfilesSupported = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.globalTeamProfiles === true,
  );
  const teamProfilesReplica = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.teamMissionsReplica,
  );
  const hostTeamRows = useMemo(
    () => (teamProfilesReplica ? selectHostLevelTeamRows(teamProfilesReplica) : []),
    [teamProfilesReplica],
  );

  if (!serverId || !isWorkspaceSelectionLoaded) {
    return <StartupSplashScreen />;
  }

  let teamProfilesStatus: "pending" | "ready" | "failed" = "pending";
  if (teamProfilesReplica?.status === "ready") teamProfilesStatus = "ready";
  else if (teamProfilesReplica?.status === "failed") teamProfilesStatus = "failed";

  const decision = resolveHostIndexRouteDecision({
    serverId,
    workspaceSelection,
    workspaceSelectionStatus: resolveWorkspaceSelectionStatus({
      hasHydratedWorkspaces,
      workspaceExists: workspaceSelectionExists,
    }),
    hasHydratedWorkspaces,
    hasLiveWorkspaces,
    globalTeamProfilesSupported,
    teamProfilesStatus,
    activeTeamCount: hostTeamRows.length,
  });

  if (decision.kind === "loading") {
    return <StartupSplashScreen />;
  }
  if (decision.kind === "renderTeams") {
    return <HostLevelTeamList serverId={serverId} rows={hostTeamRows} />;
  }
  return <Redirect href={decision.href} />;
}
