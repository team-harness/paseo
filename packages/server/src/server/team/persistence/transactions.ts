import type { TeamMission } from "@getpaseo/protocol/team/v2-types";

import { MissionStore } from "./mission-store.js";
import { TeamProfileStore } from "./profile-store.js";
import type { StoredMission, StoredTeamProfile, TeamMissionStartIntent } from "./schemas.js";

export type TeamPersistenceFaultPoint =
  | "after_mission_write"
  | "after_start_stage"
  | "after_lead_participant_write"
  | "after_mission_finalize";

export interface TeamPersistenceFaultInjector {
  hit(point: TeamPersistenceFaultPoint): Promise<void>;
}

export interface CommitMissionStartInput {
  teamId: string;
  intentId: string;
  missionId: string;
}

export interface BeginMissionStartInput {
  teamId: string;
  intent: TeamMissionStartIntent;
}

export interface CommitMissionFinishInput {
  teamId: string;
  missionId: string;
  intentId: string;
}

export interface TeamMissionPersistenceResult {
  profile: StoredTeamProfile;
  mission: StoredMission;
}

interface TeamMissionPersistenceTransactionsOptions {
  profiles: TeamProfileStore;
  missions: MissionStore;
  faultInjector?: TeamPersistenceFaultInjector;
}

export class TeamPersistenceTransactionConflictError extends Error {
  constructor(
    readonly teamId: string,
    message: string,
  ) {
    super(`Team ${teamId} persistence transaction conflict: ${message}`);
    this.name = "TeamPersistenceTransactionConflictError";
  }
}

export class TeamMissionPersistenceTransactions {
  private readonly profiles: TeamProfileStore;
  private readonly missions: MissionStore;
  private readonly faultInjector: TeamPersistenceFaultInjector;
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(options: TeamMissionPersistenceTransactionsOptions) {
    this.profiles = options.profiles;
    this.missions = options.missions;
    this.faultInjector = options.faultInjector ?? NOOP_FAULT_INJECTOR;
  }

  async beginMissionStart(input: BeginMissionStartInput): Promise<TeamMissionPersistenceResult> {
    return this.serialize(input.teamId, async () => {
      let profile = await this.requireProfile(input.teamId);
      const existing = await this.missions.findStartedMission({
        teamId: input.teamId,
        idempotencyKey: input.intent.idempotencyKey,
        requestFingerprint: input.intent.requestFingerprint,
      });
      if (existing) {
        assertMissionBelongsToProfile(profile, existing);
        const pending = profile.startIntent;
        const resumesPendingStart =
          pending?.idempotencyKey === input.intent.idempotencyKey &&
          pending.requestFingerprint === input.intent.requestFingerprint &&
          pending.missionId === existing.mission.id;
        if (!resumesPendingStart) {
          return { profile, mission: existing };
        }
        return this.resumeMissionStart(profile, pending);
      }

      profile = await this.profiles.beginMissionStart({
        teamId: input.teamId,
        intent: input.intent,
      });
      if (!profile.startIntent) {
        throw new TeamPersistenceTransactionConflictError(
          input.teamId,
          "start intent disappeared before Mission persistence",
        );
      }
      return this.resumeMissionStart(profile, profile.startIntent);
    });
  }

  async commitMissionStart(input: CommitMissionStartInput): Promise<TeamMissionPersistenceResult> {
    return this.serialize(input.teamId, async () => {
      const profile = await this.requireProfile(input.teamId);
      if (!profile.startIntent) {
        if (profile.profile.activeMissionId !== input.missionId) {
          throw new TeamPersistenceTransactionConflictError(
            input.teamId,
            "the requested Mission is neither pending nor active",
          );
        }
        return {
          profile,
          mission: await this.requireMission(profile, input.missionId),
        };
      }

      const intent = profile.startIntent;
      assertStartIdentity(input, intent);
      return this.resumeMissionStart(profile, intent);
    });
  }

  async commitMissionFinish(
    input: CommitMissionFinishInput,
  ): Promise<TeamMissionPersistenceResult> {
    return this.serialize(input.teamId, async () => {
      const profileBeforeFinish = await this.requireProfile(input.teamId);
      const missionBeforeFinish = await this.requireMission(profileBeforeFinish, input.missionId);
      const isCompletedReplay =
        profileBeforeFinish.profile.activeMissionId === null &&
        isTerminalMission(missionBeforeFinish.mission.status);
      const isPendingStart = profileBeforeFinish.startIntent?.missionId === input.missionId;
      if (
        profileBeforeFinish.profile.activeMissionId !== input.missionId &&
        !isPendingStart &&
        !isCompletedReplay
      ) {
        throw new TeamPersistenceTransactionConflictError(
          input.teamId,
          `active Mission is ${String(profileBeforeFinish.profile.activeMissionId)}`,
        );
      }
      const mission = await this.missions.finalize({
        missionId: input.missionId,
        intentId: input.intentId,
      });
      if (mission.mission.teamId !== input.teamId) {
        throw new TeamPersistenceTransactionConflictError(
          input.teamId,
          `Mission ${input.missionId} belongs to ${mission.mission.teamId}`,
        );
      }
      await this.faultInjector.hit("after_mission_finalize");
      const profile = await this.profiles.clearActiveMission({
        teamId: input.teamId,
        missionId: input.missionId,
      });
      return { profile, mission };
    });
  }

  private async resumeMissionStart(
    profileBeforeStart: StoredTeamProfile,
    intent: TeamMissionStartIntent,
  ): Promise<TeamMissionPersistenceResult> {
    let profile = profileBeforeStart;
    let mission = await this.missions.createIfAbsent({
      idempotencyKey: intent.idempotencyKey,
      requestFingerprint: intent.requestFingerprint,
      mission: missionFromStartIntent(profile, intent),
    });
    assertMissionMatchesIntent(profile, intent, mission);

    if (intent.stage === "reserved") {
      await this.faultInjector.hit("after_mission_write");
      profile = await this.profiles.advanceMissionStart({
        teamId: profile.profile.id,
        intentId: intent.intentId,
        from: "reserved",
        to: "mission_written",
      });
      await this.faultInjector.hit("after_start_stage");
      return { profile, mission };
    }
    if (intent.stage === "mission_written" || intent.stage === "room_created") {
      return { profile, mission };
    }

    mission = await this.ensureLeadParticipant(mission, intent);
    await this.faultInjector.hit("after_lead_participant_write");
    profile = await this.profiles.activateMission({
      teamId: profile.profile.id,
      intentId: intent.intentId,
      missionId: intent.missionId,
    });
    return { profile, mission };
  }

  private async ensureLeadParticipant(
    stored: StoredMission,
    intent: TeamMissionStartIntent,
  ): Promise<StoredMission> {
    const expected = {
      memberId: intent.rosterSnapshot.leadMemberId,
      agentId: intent.leadAgentId,
      bindingEpoch: intent.bindingEpoch,
      joinedAt: intent.updatedAt,
      archivedAt: null,
    };
    return this.missions.update({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: (mission) => {
        const current = mission.participants.find(
          (participant) =>
            participant.memberId === expected.memberId || participant.agentId === expected.agentId,
        );
        if (!current) {
          return { ...mission, participants: [...mission.participants, expected] };
        }
        const isReplay =
          current.memberId === expected.memberId &&
          current.agentId === expected.agentId &&
          current.bindingEpoch === expected.bindingEpoch &&
          current.archivedAt === null;
        if (!isReplay) {
          throw new TeamPersistenceTransactionConflictError(
            stored.mission.teamId,
            "Lead participant identity conflicts with the start intent",
          );
        }
        return mission;
      },
    });
  }

  private async requireProfile(teamId: string): Promise<StoredTeamProfile> {
    const profile = await this.profiles.get(teamId);
    if (!profile) {
      throw new TeamPersistenceTransactionConflictError(teamId, "profile does not exist");
    }
    return profile;
  }

  private async requireMission(
    profile: StoredTeamProfile,
    missionId: string,
  ): Promise<StoredMission> {
    const mission = await this.missions.get(missionId);
    if (!mission) {
      throw new TeamPersistenceTransactionConflictError(
        profile.profile.id,
        `active Mission ${missionId} does not exist`,
      );
    }
    assertMissionBelongsToProfile(profile, mission);
    return mission;
  }

  private async serialize<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(teamId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.mutations.set(teamId, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(teamId) === next) {
        this.mutations.delete(teamId);
      }
    }
  }
}

const NOOP_FAULT_INJECTOR: TeamPersistenceFaultInjector = {
  hit: async () => undefined,
};

function assertStartIdentity(input: CommitMissionStartInput, intent: TeamMissionStartIntent): void {
  const matches = intent.intentId === input.intentId && intent.missionId === input.missionId;
  if (!matches) {
    throw new TeamPersistenceTransactionConflictError(
      input.teamId,
      `start intent identifies Mission ${intent.missionId}`,
    );
  }
}

function missionFromStartIntent(
  profile: StoredTeamProfile,
  intent: TeamMissionStartIntent,
): Omit<TeamMission, "revision" | "createdAt" | "updatedAt" | "completedAt"> {
  return {
    id: intent.missionId,
    teamId: profile.profile.id,
    workspaceId: profile.profile.workspaceId,
    objective: intent.objective,
    constraints: intent.constraints,
    acceptanceCriteria: intent.acceptanceCriteria,
    status: "planning",
    suspendedStatus: null,
    activeRosterSnapshotRevision: intent.rosterSnapshot.revision,
    rosterSnapshots: [intent.rosterSnapshot],
    planRevision: 0,
    workspaceAuditPolicy: intent.workspaceAuditPolicy,
    chatRoomId: intent.chatRoomId,
    participants: [
      {
        memberId: intent.rosterSnapshot.leadMemberId,
        agentId: intent.leadAgentId,
        bindingEpoch: intent.bindingEpoch,
        joinedAt: intent.updatedAt,
        archivedAt: null,
      },
    ],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
  };
}

function isTerminalMission(status: TeamMission["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function assertMissionMatchesIntent(
  profile: StoredTeamProfile,
  intent: TeamMissionStartIntent,
  mission: StoredMission,
): void {
  assertMissionBelongsToProfile(profile, mission);
  if (mission.mission.id !== intent.missionId) {
    throw new TeamPersistenceTransactionConflictError(
      profile.profile.id,
      `start key resolved Mission ${mission.mission.id}, expected ${intent.missionId}`,
    );
  }
}

function assertMissionBelongsToProfile(profile: StoredTeamProfile, mission: StoredMission): void {
  if (mission.mission.teamId !== profile.profile.id) {
    throw new TeamPersistenceTransactionConflictError(
      profile.profile.id,
      `Mission ${mission.mission.id} belongs to ${mission.mission.teamId}`,
    );
  }
  if (mission.mission.workspaceId !== profile.profile.workspaceId) {
    throw new TeamPersistenceTransactionConflictError(
      profile.profile.id,
      `Mission ${mission.mission.id} belongs to workspace ${mission.mission.workspaceId}`,
    );
  }
}
