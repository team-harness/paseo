import type { Logger } from "pino";

import { MissionStore } from "./mission-store.js";
import { TeamProfileStore } from "./profile-store.js";
import type {
  StoredMission,
  StoredTeamProfile,
  TeamPersistenceAttentionCode,
  TeamArchiveStage,
  TeamMissionFinishStage,
  TeamMissionStartStage,
} from "./schemas.js";
import { TeamMissionPersistenceTransactions } from "./transactions.js";

export type { TeamPersistenceAttentionCode } from "./schemas.js";

export type TeamPersistenceRecoveryAction =
  | {
      kind: "resume_mission_start";
      teamId: string;
      missionId: string;
      intentId: string;
      stage: TeamMissionStartStage;
    }
  | {
      kind: "resume_mission_finish";
      teamId: string;
      missionId: string;
      intentId: string;
      stage: TeamMissionFinishStage;
    }
  | {
      kind: "resume_team_archive";
      teamId: string;
      missionId: string;
      intentId: string;
      stage: TeamArchiveStage;
    }
  | {
      kind: "post_recipient_message";
      teamId: string;
      missionId: string;
      deliveryId: string;
    }
  | {
      kind: "deliver_recipient_attention";
      teamId: string;
      missionId: string;
      deliveryId: string;
    }
  | {
      kind: "deliver_mission_completion";
      teamId: string;
      missionId: string;
      eventId: string;
    }
  | {
      kind: "persistence_attention";
      teamId: string;
      missionId: string;
      code: TeamPersistenceAttentionCode;
    };

export interface TeamPersistenceReconciliationResult {
  actions: TeamPersistenceRecoveryAction[];
}

interface TeamPersistenceReconcilerOptions {
  profiles: TeamProfileStore;
  missions: MissionStore;
  logger: Logger;
}

export class TeamPersistenceReconciler {
  private readonly profiles: TeamProfileStore;
  private readonly missions: MissionStore;
  private readonly transactions: TeamMissionPersistenceTransactions;
  private readonly logger: Logger;

  constructor(options: TeamPersistenceReconcilerOptions) {
    this.profiles = options.profiles;
    this.missions = options.missions;
    this.transactions = new TeamMissionPersistenceTransactions(options);
    this.logger = options.logger.child({ module: "team", component: "v2-reconciler" });
  }

  async reconcile(): Promise<TeamPersistenceReconciliationResult> {
    const actions: TeamPersistenceRecoveryAction[] = [];
    const failedStarts = new Set<string>();
    const failedFinishes = new Set<string>();

    for (const profile of await this.profiles.list()) {
      const intent = profile.startIntent;
      if (!intent || intent.stage !== "reserved") {
        continue;
      }
      try {
        await this.transactions.commitMissionStart({
          teamId: profile.profile.id,
          missionId: intent.missionId,
          intentId: intent.intentId,
        });
      } catch (error) {
        failedStarts.add(profile.profile.id);
        this.logger.warn(
          { err: error, teamId: profile.profile.id, missionId: intent.missionId },
          "failed to reconcile Mission start",
        );
        actions.push({
          kind: "persistence_attention",
          teamId: profile.profile.id,
          missionId: intent.missionId,
          code: "start_reconciliation_failed",
        });
      }
    }

    for (const mission of await this.missions.list()) {
      const intent = mission.finishIntent;
      if (!intent || intent.stage !== "finalized") {
        continue;
      }
      try {
        await this.transactions.commitMissionFinish({
          teamId: mission.mission.teamId,
          missionId: mission.mission.id,
          intentId: intent.intentId,
        });
      } catch (error) {
        failedFinishes.add(mission.mission.id);
        this.logger.warn(
          { err: error, teamId: mission.mission.teamId, missionId: mission.mission.id },
          "failed to reconcile Mission finish",
        );
        actions.push({
          kind: "persistence_attention",
          teamId: mission.mission.teamId,
          missionId: mission.mission.id,
          code: "finish_reconciliation_failed",
        });
      }
    }

    const missionsById = indexMissions(await this.missions.list());
    for (const profile of await this.profiles.list()) {
      const missionId = profile.profile.activeMissionId;
      if (!missionId) continue;
      const mission = missionsById.get(missionId);
      if (!mission) continue;
      if (!missionMatchesProfile(mission, profile)) continue;
      if (!isTerminalMission(mission) || failedFinishes.has(missionId)) continue;
      try {
        await this.profiles.clearActiveMission({
          teamId: profile.profile.id,
          missionId,
        });
      } catch (error) {
        this.logger.warn(
          { err: error, teamId: profile.profile.id, missionId },
          "failed to clear terminal Mission link",
        );
        actions.push({
          kind: "persistence_attention",
          teamId: profile.profile.id,
          missionId,
          code: "terminal_link_reconciliation_failed",
        });
      }
    }

    const finalProfiles = await this.profiles.list();
    const finalMissions = await this.missions.list();
    actions.push(
      ...collectExternalArchiveActions(finalProfiles, finalMissions),
      ...collectExternalStartActions(finalProfiles, failedStarts),
      ...collectExternalFinishActions(finalMissions, failedFinishes),
      ...collectPersistenceLinkActions(finalProfiles, finalMissions),
      ...collectOutboxActions(finalMissions),
    );
    const sortedActions = actions.toSorted(compareRecoveryActions);
    await this.syncPersistenceAttentions(finalProfiles, sortedActions);
    return { actions: sortedActions };
  }

  private async syncPersistenceAttentions(
    profiles: StoredTeamProfile[],
    actions: TeamPersistenceRecoveryAction[],
  ): Promise<void> {
    const attentions = actions.filter((action) => action.kind === "persistence_attention");
    for (const profile of profiles) {
      await this.profiles.syncPersistenceAttentions({
        teamId: profile.profile.id,
        attentions: attentions
          .filter((attention) => attention.teamId === profile.profile.id)
          .map((attention) => ({ missionId: attention.missionId, code: attention.code })),
      });
    }
  }
}

function collectPersistenceLinkActions(
  profiles: StoredTeamProfile[],
  missions: StoredMission[],
): TeamPersistenceRecoveryAction[] {
  const profilesById = new Map(profiles.map((profile) => [profile.profile.id, profile]));
  const missionsById = indexMissions(missions);
  const referencedMissionIds = new Set<string>();
  const actions: TeamPersistenceRecoveryAction[] = [];

  for (const profile of profiles) {
    const missionId = profile.profile.activeMissionId;
    if (!missionId) continue;
    referencedMissionIds.add(missionId);
    const mission = missionsById.get(missionId);
    if (!mission) {
      actions.push({
        kind: "persistence_attention",
        teamId: profile.profile.id,
        missionId,
        code: "active_mission_missing",
      });
      continue;
    }
    if (mission.mission.teamId !== profile.profile.id) {
      actions.push({
        kind: "persistence_attention",
        teamId: profile.profile.id,
        missionId,
        code: "active_mission_team_mismatch",
      });
      continue;
    }
    if (mission.mission.workspaceId !== profile.profile.workspaceId) {
      actions.push({
        kind: "persistence_attention",
        teamId: profile.profile.id,
        missionId,
        code: "active_mission_workspace_mismatch",
      });
    }
  }

  actions.push(...collectArchiveMissionLinkActions(profiles, missionsById));

  for (const mission of missions) {
    if (isTerminalMission(mission) || referencedMissionIds.has(mission.mission.id)) continue;
    const profile = profilesById.get(mission.mission.teamId);
    if (!profile) {
      actions.push({
        kind: "persistence_attention",
        teamId: mission.mission.teamId,
        missionId: mission.mission.id,
        code: "team_profile_missing",
      });
      continue;
    }
    const belongsToPendingStart = profile.startIntent?.missionId === mission.mission.id;
    if (profile.profile.activeMissionId !== mission.mission.id && !belongsToPendingStart) {
      actions.push({
        kind: "persistence_attention",
        teamId: mission.mission.teamId,
        missionId: mission.mission.id,
        code: "mission_not_active",
      });
    }
  }

  return actions;
}

function collectArchiveMissionLinkActions(
  profiles: StoredTeamProfile[],
  missionsById: ReadonlyMap<string, StoredMission>,
): TeamPersistenceRecoveryAction[] {
  return profiles.flatMap((profile): TeamPersistenceRecoveryAction[] => {
    const missionId = profile.archiveIntent?.missionId;
    if (!missionId) return [];
    const mission = missionsById.get(missionId);
    if (!mission) {
      if (profile.startIntent?.missionId === missionId) return [];
      return [
        {
          kind: "persistence_attention" as const,
          teamId: profile.profile.id,
          missionId,
          code: "archive_mission_missing" as const,
        },
      ];
    }
    if (mission.mission.teamId !== profile.profile.id) {
      return [
        {
          kind: "persistence_attention" as const,
          teamId: profile.profile.id,
          missionId,
          code: "archive_mission_team_mismatch" as const,
        },
      ];
    }
    if (mission.mission.workspaceId !== profile.profile.workspaceId) {
      return [
        {
          kind: "persistence_attention" as const,
          teamId: profile.profile.id,
          missionId,
          code: "archive_mission_workspace_mismatch" as const,
        },
      ];
    }
    return [];
  });
}

function collectExternalStartActions(
  profiles: StoredTeamProfile[],
  failedTeamIds: ReadonlySet<string>,
): TeamPersistenceRecoveryAction[] {
  return profiles.flatMap((profile) => {
    const intent = profile.startIntent;
    if (!intent || profile.archiveIntent || failedTeamIds.has(profile.profile.id)) return [];
    return [
      {
        kind: "resume_mission_start" as const,
        teamId: profile.profile.id,
        missionId: intent.missionId,
        intentId: intent.intentId,
        stage: intent.stage,
      },
    ];
  });
}

function collectExternalArchiveActions(
  profiles: StoredTeamProfile[],
  missions: StoredMission[],
): TeamPersistenceRecoveryAction[] {
  const missionsById = indexMissions(missions);
  return profiles.flatMap((profile) => {
    const intent = profile.archiveIntent;
    if (!intent) return [];
    if (intent.missionId) {
      const mission = missionsById.get(intent.missionId);
      const missingPendingMission = !mission && profile.startIntent?.missionId === intent.missionId;
      if (!missingPendingMission && (!mission || !missionMatchesProfile(mission, profile)))
        return [];
    }
    return [
      {
        kind: "resume_team_archive" as const,
        teamId: profile.profile.id,
        missionId: intent.missionId ?? "",
        intentId: intent.intentId,
        stage: intent.stage,
      },
    ];
  });
}

function collectExternalFinishActions(
  missions: StoredMission[],
  failedMissionIds: ReadonlySet<string>,
): TeamPersistenceRecoveryAction[] {
  return missions.flatMap((mission) => {
    const intent = mission.finishIntent;
    if (!intent || intent.stage === "finalized" || failedMissionIds.has(mission.mission.id)) {
      return [];
    }
    return [
      {
        kind: "resume_mission_finish" as const,
        teamId: mission.mission.teamId,
        missionId: mission.mission.id,
        intentId: intent.intentId,
        stage: intent.stage,
      },
    ];
  });
}

function collectOutboxActions(missions: StoredMission[]): TeamPersistenceRecoveryAction[] {
  return missions.flatMap((mission) => [
    ...mission.recipientAttentionOutbox.flatMap((delivery) =>
      delivery.state === "pending" || delivery.state === "notified"
        ? [
            {
              kind:
                delivery.roomPostedAt === null || delivery.roomCursor === null
                  ? ("post_recipient_message" as const)
                  : ("deliver_recipient_attention" as const),
              teamId: mission.mission.teamId,
              missionId: mission.mission.id,
              deliveryId: delivery.deliveryId,
            },
          ]
        : [],
    ),
    ...mission.completionOutbox.flatMap((delivery) =>
      shouldReconcileCompletionDelivery(delivery)
        ? [
            {
              kind: "deliver_mission_completion" as const,
              teamId: mission.mission.teamId,
              missionId: mission.mission.id,
              eventId: delivery.eventId,
            },
          ]
        : [],
    ),
  ]);
}

function shouldReconcileCompletionDelivery(
  delivery: StoredMission["completionOutbox"][number],
): boolean {
  return delivery.state === "pending" || delivery.state === "notified";
}

function indexMissions(missions: StoredMission[]): Map<string, StoredMission> {
  return new Map(missions.map((mission) => [mission.mission.id, mission]));
}

function isTerminalMission(mission: StoredMission): boolean {
  return (
    mission.mission.status === "completed" ||
    mission.mission.status === "failed" ||
    mission.mission.status === "canceled"
  );
}

function missionMatchesProfile(mission: StoredMission, profile: StoredTeamProfile): boolean {
  return (
    mission.mission.teamId === profile.profile.id &&
    mission.mission.workspaceId === profile.profile.workspaceId
  );
}

function compareRecoveryActions(
  left: TeamPersistenceRecoveryAction,
  right: TeamPersistenceRecoveryAction,
): number {
  return recoveryActionKey(left).localeCompare(recoveryActionKey(right));
}

function recoveryActionKey(action: TeamPersistenceRecoveryAction): string {
  let identity: string;
  switch (action.kind) {
    case "post_recipient_message":
    case "deliver_recipient_attention":
      identity = action.deliveryId;
      break;
    case "deliver_mission_completion":
      identity = action.eventId;
      break;
    case "persistence_attention":
      identity = action.code;
      break;
    default:
      identity = action.intentId;
  }
  return `${action.teamId}\0${action.missionId}\0${action.kind}\0${identity}`;
}
