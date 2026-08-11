import type { TeamMissionsReplica } from "@/runtime/team-missions-sync/replica";

export interface HostLevelTeamRow {
  teamId: string;
  name: string;
}

/** Active Team profiles that remain reachable without a workspace shell. */
export function selectHostLevelTeamRows(replica: TeamMissionsReplica): HostLevelTeamRow[] {
  if (replica.status !== "ready") return [];

  return [...replica.profiles.values()]
    .filter((team) => team.lifecycle === "active")
    .map((team) => ({ teamId: team.id, name: team.name }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.teamId.localeCompare(right.teamId),
    );
}
