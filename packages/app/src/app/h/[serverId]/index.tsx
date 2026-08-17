import { Redirect } from "expo-router";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  resolveHostIndexRouteDecision,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";

export default function HostIndexRoute() {
  const serverId = useHostRouteServerId();
  const workspaceSelection = useLastWorkspaceSelection();
  const runtime = useHostRuntimeSnapshot(serverId ?? "");
  const features = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features ?? null,
  );
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const workspaceSelectionWorkspaceId =
    workspaceSelection?.serverId === serverId ? workspaceSelection.workspaceId : null;
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(serverId);
  const workspaceSelectionExists = useWorkspaceExists(serverId, workspaceSelectionWorkspaceId);

  if (!serverId || !isWorkspaceSelectionLoaded) {
    return <StartupSplashScreen />;
  }

  const decision = resolveHostIndexRouteDecision({
    serverId,
    workspaceSelection,
    workspaceSelectionStatus: resolveWorkspaceSelectionStatus({
      hasHydratedWorkspaces,
      workspaceExists: workspaceSelectionExists,
    }),
    connectionStatus: runtime?.connectionStatus ?? "idle",
    features,
  });

  if (decision.kind === "loading") {
    return <StartupSplashScreen />;
  }
  if (decision.kind === "waitingForHost") {
    return <Redirect href={`/h/${serverId}/teams`} />;
  }
  return <Redirect href={decision.href} />;
}
