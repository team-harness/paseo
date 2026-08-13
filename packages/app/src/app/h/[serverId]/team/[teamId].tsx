import { useCallback, useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { TeamPanel } from "@/components/teams/team-panel";
import { resolveTeamRoute } from "@/navigation/team-route-resolution";
import { TeamRouteResolutionView } from "@/navigation/team-route-resolution-view";
import { useHostRuntimeSnapshot, useHosts, getHostRuntimeStore } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useLiveWorkspaceIds } from "@/stores/session-store-hooks";
import { buildHostRootRoute } from "@/utils/host-routes";

export default function HostTeamRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostTeamRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostTeamRouteContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serverId?: string; teamId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const handledRef = useRef<string | null>(null);

  const hosts = useHosts();
  const hostName = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const connectionStatus = runtimeSnapshot?.connectionStatus ?? "connecting";
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.teamMissions === true,
  );
  const globalTeamProfilesSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.globalTeamProfiles === true,
  );
  const hydrated = useSessionStore(
    (state) => state.sessions[serverId]?.teamMissionsReplica.status === "ready",
  );
  const profile = useSessionStore(
    (state) => state.sessions[serverId]?.teamMissionsReplica.profiles.get(teamId) ?? null,
  );
  const missionWorkspaceId = useSessionStore((state) => {
    const replica = state.sessions[serverId]?.teamMissionsReplica;
    const missionId = replica?.profiles.get(teamId)?.activeMissionId;
    return missionId ? (replica?.missions.get(missionId)?.workspaceId ?? null) : null;
  });
  const liveWorkspaceIds = useLiveWorkspaceIds(serverId);

  const resolution = resolveTeamRoute({
    serverId,
    teamId,
    supported,
    globalTeamProfilesSupported,
    connectionStatus,
    hydrated,
    activeMissionId: profile?.activeMissionId,
    missionWorkspaceId,
    creationWorkspaceId: profile?.creationWorkspaceId,
    liveWorkspaceIds,
  });

  useEffect(() => {
    // A Team URL carries no workspace. A Mission hands off to its workspace;
    // an idle Team with no live workspace stays on this host route. Each
    // navigation outcome fires once so store ticks do not append deck entries.
    let key: string | null = null;
    if (resolution.kind === "resolved") key = `workspace:${resolution.workspaceId}`;
    else if (resolution.kind === "invalid") key = "invalid";
    else if (resolution.kind === "notFound") key = "not-found";
    if (!key || handledRef.current === key) return;
    handledRef.current = key;

    if (resolution.kind === "resolved") {
      navigateToWorkspace({
        serverId,
        workspaceId: resolution.workspaceId,
        target: { kind: "team", teamId },
      });
      return;
    }
    router.replace(resolution.kind === "invalid" ? ("/" as Href) : buildHostRootRoute(serverId));
  }, [resolution, router, serverId, teamId]);

  const handleRetry = useCallback(() => {
    if (serverId) void getHostRuntimeStore().runProbeCycleNow(serverId);
  }, [serverId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(serverId ? buildHostRootRoute(serverId) : ("/" as Href));
  }, [router, serverId]);

  if (
    resolution.kind === "waitingForHost" ||
    resolution.kind === "hydrating" ||
    resolution.kind === "unsupported"
  ) {
    return (
      <TeamRouteResolutionView
        resolution={resolution}
        hostName={hostName}
        lastHostError={runtimeSnapshot?.lastError ?? null}
        onRetry={handleRetry}
        onBack={handleBack}
      />
    );
  }

  if (resolution.kind === "hostLevel") {
    return <TeamPanel serverId={serverId} workspaceId={null} teamId={teamId} />;
  }

  return null;
}
