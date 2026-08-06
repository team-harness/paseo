import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export type TeamRouteResolution =
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "resolved"; workspaceId: string }
  | {
      kind: "waitingForHost";
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
    }
  | { kind: "hydrating" }
  | { kind: "notFound" };

/**
 * Where a `/h/:serverId/team/:teamId` URL should land.
 *
 * A team URL carries no workspace, the same way an agent URL does not, so the
 * route waits for the host and reads the workspace off the team itself.
 */
export function resolveTeamRoute(input: {
  serverId: string;
  teamId: string;
  supported: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  hydrated: boolean;
  workspaceId: string | null | undefined;
}): TeamRouteResolution {
  if (!input.serverId.trim() || !input.teamId.trim()) {
    return { kind: "invalid" };
  }

  // The team may already be here from a `team_update` that beat the list. That
  // is an answer, and waiting past it is a wait for nothing.
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (workspaceId) {
    return { kind: "resolved", workspaceId };
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

  return { kind: "notFound" };
}
