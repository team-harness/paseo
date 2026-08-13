import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { MethodologyCatalogStatus } from "@/runtime/methodology-catalog-sync";
import type { TeamMissionsReplicaStatus } from "@/runtime/team-missions-sync/replica";

export type TeamHubState =
  | { kind: "waitingForHost" }
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "supported"; teamFailed: boolean; catalogFailed: boolean };

export function resolveTeamHubConnectionStatus(
  runtimeStatus: HostRuntimeConnectionStatus | undefined,
  _hasServerInfo: boolean,
): HostRuntimeConnectionStatus {
  return runtimeStatus ?? "idle";
}

export function resolveTeamHubState(input: {
  connectionStatus: HostRuntimeConnectionStatus;
  features: {
    teamMissions?: boolean;
    globalTeamProfiles?: boolean;
    teamMethodologies?: boolean;
  } | null;
  teamStatus: TeamMissionsReplicaStatus;
  catalogStatus: MethodologyCatalogStatus;
}): TeamHubState {
  if (input.connectionStatus !== "online") return { kind: "waitingForHost" };
  if (!input.features) return { kind: "loading" };
  if (
    !(
      input.features.teamMissions &&
      input.features.globalTeamProfiles &&
      input.features.teamMethodologies
    )
  )
    return { kind: "unsupported" };
  const teamFailed = input.teamStatus === "failed";
  const catalogFailed = input.catalogStatus === "failed";
  if (
    !teamFailed &&
    !catalogFailed &&
    (input.teamStatus !== "ready" || input.catalogStatus !== "ready")
  )
    return { kind: "loading" };
  return { kind: "supported", teamFailed, catalogFailed };
}

export function resolveTeamHubCreateEnabled(input: {
  hasLiveWorkspace: boolean;
  teamFailed: boolean;
  catalogFailed: boolean;
}): boolean {
  return input.hasLiveWorkspace && !input.teamFailed && !input.catalogFailed;
}
