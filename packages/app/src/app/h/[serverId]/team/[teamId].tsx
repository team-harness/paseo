import { useCallback, useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { resolveTeamRoute } from "@/navigation/team-route-resolution";
import { TeamRouteResolutionView } from "@/navigation/team-route-resolution-view";
import { useHostRuntimeSnapshot, useHosts, getHostRuntimeStore } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useTeamsSupported } from "@/teams/use-teams";
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
  const supported = useTeamsSupported(serverId);
  const hydrated = useSessionStore((state) => state.sessions[serverId]?.hasHydratedTeams === true);
  const workspaceId = useSessionStore(
    (state) => state.sessions[serverId]?.teams.get(teamId)?.workspaceId ?? null,
  );

  const resolution = resolveTeamRoute({
    serverId,
    teamId,
    supported,
    connectionStatus,
    hydrated,
    workspaceId,
  });

  useEffect(() => {
    // A team URL carries no workspace, so this route exists only to find one
    // and hand off. Each outcome fires once: re-running the navigation on every
    // store tick appends deck entries the user never asked for.
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

  return null;
}
