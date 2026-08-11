import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export type TeamRouteResolution =
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "resolved"; workspaceId: string }
  | { kind: "hostLevel" }
  | {
      kind: "waitingForHost";
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
    }
  | { kind: "hydrating" }
  | { kind: "notFound" };

/**
 * Where a `/h/:serverId/team/:teamId` URL should land.
 *
 * A Team URL carries no workspace. Active Teams follow their Mission; idle
 * Teams use their creation workspace or the first remaining live workspace.
 */
export function resolveTeamRoute(input: {
  serverId: string;
  teamId: string;
  supported: boolean;
  globalTeamProfilesSupported: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  hydrated: boolean;
  activeMissionId: string | null | undefined;
  missionWorkspaceId: string | null | undefined;
  creationWorkspaceId: string | null | undefined;
  liveWorkspaceIds: readonly string[];
}): TeamRouteResolution {
  if (!input.serverId.trim() || !input.teamId.trim()) {
    return { kind: "invalid" };
  }

  const creationWorkspaceId = normalizeWorkspaceOpaqueId(input.creationWorkspaceId);
  const missionWorkspaceId = normalizeWorkspaceOpaqueId(input.missionWorkspaceId);
  const liveWorkspaceIds = input.liveWorkspaceIds
    .map(normalizeWorkspaceOpaqueId)
    .filter((workspaceId): workspaceId is string => workspaceId !== null)
    .sort();

  if (input.activeMissionId && missionWorkspaceId) {
    return { kind: "resolved", workspaceId: missionWorkspaceId };
  }

  if (!input.activeMissionId && creationWorkspaceId) {
    const workspaceId = liveWorkspaceIds.includes(creationWorkspaceId)
      ? creationWorkspaceId
      : (liveWorkspaceIds[0] ?? null);
    if (workspaceId) return { kind: "resolved", workspaceId };
  }

  // Host first. `supported` comes from a handshake that lands after the
  // connection does, so before then it is false for every daemon — including
  // one that has teams. Answering "too old" there is wrong for the moment it
  // takes to connect, and permanently wrong for a host that never does.
  if (input.connectionStatus !== "online") {
    return { kind: "waitingForHost", connectionStatus: input.connectionStatus };
  }

  // A daemon without the feature never sends a list, so "not hydrated yet" is
  // permanent there and waiting on it never ends.
  if (!input.supported) {
    return { kind: "unsupported" };
  }

  // Before the list lands the client holds no teams, and every team looks
  // deleted.
  if (!input.hydrated) {
    return { kind: "hydrating" };
  }

  if (
    input.globalTeamProfilesSupported &&
    !input.activeMissionId &&
    creationWorkspaceId &&
    liveWorkspaceIds.length === 0
  ) {
    return { kind: "hostLevel" };
  }

  if (input.activeMissionId || creationWorkspaceId) {
    return { kind: "hydrating" };
  }

  return { kind: "notFound" };
}
