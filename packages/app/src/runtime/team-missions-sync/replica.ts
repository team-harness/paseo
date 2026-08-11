import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

export type TeamMissionsReplicaStatus =
  | "checking_host"
  | "update_host"
  | "connecting"
  | "loading"
  | "ready"
  | "failed";

export interface TeamMissionHistoryRead {
  readonly status: "loading" | "ready" | "failed";
  readonly missionIds: readonly string[];
  readonly error: string | null;
}

export interface TeamMissionsReplica {
  readonly status: TeamMissionsReplicaStatus;
  readonly profiles: ReadonlyMap<string, TeamV2>;
  readonly missions: ReadonlyMap<string, TeamMission>;
  readonly historyReads: ReadonlyMap<string, TeamMissionHistoryRead>;
  readonly error: string | null;
}

export type TeamMissionsDelta =
  | { readonly kind: "profile"; readonly profile: TeamV2 }
  | { readonly kind: "mission"; readonly mission: TeamMission };

export interface TeamMissionsAuthoritativeSnapshot {
  readonly profiles: readonly TeamV2[];
  readonly missions: readonly TeamMission[];
}

interface CreateTeamMissionsReplicaInput {
  readonly status?: TeamMissionsReplicaStatus;
  readonly profiles?: ReadonlyMap<string, TeamV2>;
  readonly missions?: ReadonlyMap<string, TeamMission>;
  readonly historyReads?: ReadonlyMap<string, TeamMissionHistoryRead>;
  readonly error?: string | null;
}

export function createTeamMissionsReplica(
  input: CreateTeamMissionsReplicaInput = {},
): TeamMissionsReplica {
  return {
    status: input.status ?? "checking_host",
    profiles: new Map(input.profiles),
    missions: new Map(input.missions),
    historyReads: new Map(input.historyReads),
    error: input.error ?? null,
  };
}

export function setTeamMissionsReplicaStatus(
  replica: TeamMissionsReplica,
  status: TeamMissionsReplicaStatus,
  error: string | null = null,
): TeamMissionsReplica {
  if (replica.status === status && replica.error === error) return replica;
  return { ...replica, status, error };
}

export function clearTeamMissionsReplica(status: TeamMissionsReplicaStatus): TeamMissionsReplica {
  return createTeamMissionsReplica({ status });
}

export function applyTeamMissionsDelta(
  replica: TeamMissionsReplica,
  delta: TeamMissionsDelta,
): TeamMissionsReplica {
  if (delta.kind === "profile") {
    const current = replica.profiles.get(delta.profile.id);
    if (current && current.revision >= delta.profile.revision) return replica;
    const profiles = new Map(replica.profiles);
    profiles.set(delta.profile.id, delta.profile);
    return { ...replica, profiles };
  }

  const current = replica.missions.get(delta.mission.id);
  if (current && current.revision >= delta.mission.revision) return replica;
  const missions = new Map(replica.missions);
  missions.set(delta.mission.id, delta.mission);
  return { ...replica, missions };
}

export function replaceTeamMissionsAuthoritative(
  replica: TeamMissionsReplica,
  snapshot: TeamMissionsAuthoritativeSnapshot,
  replay: readonly TeamMissionsDelta[] = [],
): TeamMissionsReplica {
  const retainedMissionIds = new Set<string>();
  for (const read of replica.historyReads.values()) {
    for (const missionId of read.missionIds) retainedMissionIds.add(missionId);
  }
  const missions = new Map<string, TeamMission>();
  for (const missionId of retainedMissionIds) {
    const mission = replica.missions.get(missionId);
    if (mission) missions.set(missionId, mission);
  }
  for (const mission of snapshot.missions) missions.set(mission.id, mission);
  let next: TeamMissionsReplica = {
    ...replica,
    profiles: new Map(snapshot.profiles.map((profile) => [profile.id, profile])),
    missions,
  };
  for (const delta of replay) next = applyTeamMissionsDelta(next, delta);
  return next;
}

export function setTeamMissionHistoryRead(
  replica: TeamMissionsReplica,
  teamId: string,
  read: TeamMissionHistoryRead,
): TeamMissionsReplica {
  const historyReads = new Map(replica.historyReads);
  historyReads.set(teamId, read);
  return { ...replica, historyReads };
}

export function replaceTeamMissionHistory(
  replica: TeamMissionsReplica,
  teamId: string,
  listed: readonly TeamMission[],
  replay: readonly TeamMission[] = [],
): TeamMissionsReplica {
  const missions = new Map(replica.missions);
  for (const [missionId, mission] of missions) {
    if (mission.teamId === teamId) missions.delete(missionId);
  }
  for (const mission of listed) missions.set(mission.id, mission);
  let next: TeamMissionsReplica = { ...replica, missions };
  for (const mission of replay) {
    next = applyTeamMissionsDelta(next, { kind: "mission", mission });
  }
  return next;
}
