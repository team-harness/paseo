import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import type { AgentManager } from "../../../agent/agent-manager.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import {
  buildProviderRegistry,
  type BuildProviderRegistryOptions,
} from "../../../agent/provider-registry.js";
import { TeamCollaborationService } from "../../application/team-collaboration-service.js";
import { TeamMissionScheduler } from "../../application/team-mission-scheduler.js";
import {
  TeamApplicationError,
  TeamMissionService,
} from "../../application/team-mission-service.js";
import { TeamOperationCoordinator } from "../../application/team-operation-coordinator.js";
import { MissionStore } from "../../persistence/mission-store.js";
import { MissionRoomStore } from "../../persistence/mission-room-store.js";
import { TeamProfileStore } from "../../persistence/profile-store.js";
import { TeamPersistenceReconciler } from "../../persistence/reconciliation.js";
import type { TeamPersistenceFaultInjector } from "../../persistence/transactions.js";
import { WorkspaceScopeLeaseStore } from "../../persistence/workspace-scope-lease-store.js";
import {
  type TeamMissionsRuntimeOptions,
  type TeamRuntime,
  type TeamRuntimeAgentTools,
  type TeamRuntimeService,
} from "../../team-runtime.js";
import { PaseoTeamAcceptedTurnFactsAdapter } from "./team-accepted-turn-facts-adapter.js";
import { PaseoTeamAssignmentDispatchAdapter } from "./team-assignment-dispatch-adapter.js";
import { PaseoTeamMemberHistoryAdapter } from "./team-member-history-adapter.js";
import { PaseoProviderCapabilityResolver } from "./provider-capability-resolver.js";
import { PaseoTeamParticipantAdapter } from "./team-participant-adapter.js";
import { PaseoTeamRecipientAttentionAdapter } from "./team-recipient-attention-adapter.js";
import { PaseoTeamRoomAdapter } from "./team-room-adapter.js";
import { PaseoTeamToolRegistrar } from "./team-tool-registrar.js";
import { PaseoTeamWorkspaceSnapshotAdapter } from "./team-workspace-snapshot-adapter.js";

export interface InstallPaseoTeamRuntimeOptions {
  runtime: TeamMissionsRuntimeOptions;
  paseoHome: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  resolveWorkspaceCwd(workspaceId: string): Promise<string | null>;
  publishTeamProfile(team: TeamV2): void;
  publishMission(mission: TeamMission): void;
  providerRegistryOptions?: BuildProviderRegistryOptions;
  persistenceFaultInjector?: TeamPersistenceFaultInjector;
  logger: Logger;
}

type TeamRuntimeFactory = (options: {
  runtime: TeamMissionsRuntimeOptions;
  service?: TeamRuntimeService;
  agentTools?: TeamRuntimeAgentTools;
  onReconcileError?: (error: unknown) => void;
}) => TeamRuntime;

export async function installPaseoTeamRuntimeAdapter(
  options: InstallPaseoTeamRuntimeOptions,
  createRuntime: TeamRuntimeFactory,
): Promise<TeamRuntime> {
  if (!options.runtime.enabled) {
    return createRuntime({ runtime: options.runtime });
  }

  const teamRoot = path.join(options.paseoHome, "team-missions");
  const now = () => new Date().toISOString();
  const profiles = new TeamProfileStore({
    directory: path.join(teamRoot, "profiles"),
    logger: options.logger,
    now,
  });
  const missions = new MissionStore({
    directory: path.join(teamRoot, "missions"),
    logger: options.logger,
    now,
  });
  const roomStore = new MissionRoomStore(path.join(teamRoot, "rooms"), now);
  const rooms = new PaseoTeamRoomAdapter(roomStore);
  const events = {
    publishTeam: async (team: TeamV2) => options.publishTeamProfile(team),
    publishMission: async (mission: TeamMission) => options.publishMission(mission),
  };
  const clock = { now };
  const ids = { next: () => randomUUID() };
  const operations = new TeamOperationCoordinator();
  const participants = new PaseoTeamParticipantAdapter({
    agentManager: options.agentManager,
    agentStorage: options.agentStorage,
    resolveWorkspaceCwd: options.resolveWorkspaceCwd,
    logger: options.logger,
  });
  let scheduler!: TeamMissionScheduler;
  const service = new TeamMissionService({
    profiles,
    missions,
    recovery: new TeamPersistenceReconciler({ profiles, missions, logger: options.logger }),
    rooms,
    participants,
    capabilities: new PaseoProviderCapabilityResolver({
      registry: buildProviderRegistry(options.logger, options.providerRegistryOptions),
      toolIds: options.runtime.toolIds ?? [],
      logger: options.logger,
    }),
    events,
    clock,
    ids,
    operations,
    persistenceFaultInjector: options.persistenceFaultInjector,
    finishQuiescence: {
      prepareEvidence: (input) => scheduler.prepareFinishEvidence(input),
    },
  });
  const leases = new WorkspaceScopeLeaseStore({
    filePath: path.join(teamRoot, "workspace-scope-leases.json"),
    resolveWorkspaceIdentity: async (workspaceId) => {
      const cwd = await options.resolveWorkspaceCwd(workspaceId);
      if (!cwd) throw new Error(`Workspace ${workspaceId} has no canonical directory`);
      try {
        return await realpath(cwd);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
        return path.resolve(cwd);
      }
    },
    clock,
    ids,
  });
  const turnFacts = new PaseoTeamAcceptedTurnFactsAdapter({
    agentStorage: options.agentStorage,
    agentManager: options.agentManager,
  });
  scheduler = new TeamMissionScheduler({
    missions,
    turnFacts,
    leases,
    workspace: new PaseoTeamWorkspaceSnapshotAdapter({
      resolveWorkspaceCwd: options.resolveWorkspaceCwd,
      classifyPathOwnership: (input) => leases.classifyPathOwnership(input),
      clock,
    }),
    dispatch: new PaseoTeamAssignmentDispatchAdapter({
      agentManager: options.agentManager,
      agentStorage: options.agentStorage,
      logger: options.logger,
    }),
    participants,
    lifecycle: service,
    events,
    clock,
    operations,
  });
  const recipientAttention = new PaseoTeamRecipientAttentionAdapter({
    agentManager: options.agentManager,
    agentStorage: options.agentStorage,
    logger: options.logger,
  });
  const collaboration = new TeamCollaborationService({
    profiles,
    missions,
    memberHistory: new PaseoTeamMemberHistoryAdapter({
      agentManager: options.agentManager,
      agentStorage: options.agentStorage,
      logger: options.logger,
    }),
    messages: rooms,
    turnFacts,
    recipientAttention,
    events,
    clock,
    ids,
    scheduler,
    operations,
    onBackgroundError: (error, context) => {
      options.logger.warn({ err: error, ...context }, "Deferred Team reconciliation failed");
    },
  });
  const toolRegistrar = new PaseoTeamToolRegistrar({
    service: collaboration,
    logger: options.logger,
  });
  let agentToolsStopped = false;
  const unsubscribeParticipantChanges = options.agentManager.onAgentRecordChange(async (change) => {
    if (agentToolsStopped) return;
    if (change.kind !== "archived" && change.kind !== "deleted") return;
    try {
      await scheduler.handleParticipantUnavailable(change.agentId);
    } catch (error) {
      options.logger.warn(
        { err: error, agentId: change.agentId },
        "Failed to record unavailable Team participant",
      );
    }
  });
  const agentTools: TeamRuntimeAgentTools = {
    reconcile: () => Promise.resolve(),
    register: (callerAgentId, registerTool) => toolRegistrar.register(callerAgentId, registerTool),
    stop: () => {
      if (agentToolsStopped) return;
      agentToolsStopped = true;
      unsubscribeParticipantChanges();
      turnFacts.stop();
      recipientAttention.stop();
    },
  };
  const recordPendingMessageRecovery = async (
    recovery: Awaited<ReturnType<TeamCollaborationService["reconcilePendingMessages"]>>,
  ) => {
    for (const failure of recovery.failures) {
      try {
        await service.recordRecoveryAttention({
          missionId: failure.missionId,
          attentionId: `notification:${failure.deliveryId}`,
          kind: "notification_unacknowledged",
          summary: `Pending message recovery failed: ${failure.error}`,
        });
      } catch (error) {
        options.logger.warn(
          { err: error, missionId: failure.missionId, deliveryId: failure.deliveryId },
          "Failed to persist pending Team message recovery Attention",
        );
      }
    }
  };
  const runtimeService: TeamRuntimeService = {
    reconcile: async () => {
      await service.reconcile();
      try {
        await recordPendingMessageRecovery(await collaboration.reconcilePendingMessages());
      } catch (error) {
        options.logger.warn({ err: error }, "Failed to reconcile pending Team messages");
      }
      for (const stored of await missions.list()) {
        let result: Awaited<ReturnType<TeamMissionScheduler["reconcileMission"]>>;
        try {
          result = await scheduler.reconcileMission(stored.mission.id);
        } catch (error) {
          try {
            await service.recordRecoveryAttention({
              missionId: stored.mission.id,
              attentionId: `runtime-scheduler:${stored.mission.id}`,
              kind: "lead_unavailable",
              summary: `Scheduler recovery failed: ${errorMessage(error)}`,
            });
          } catch (attentionError) {
            options.logger.warn(
              { err: attentionError, missionId: stored.mission.id },
              "Failed to persist Team scheduler recovery Attention",
            );
          }
          continue;
        }
        if (result.createdRecipientAttentionDeliveryIds.length === 0) continue;
        try {
          await recordPendingMessageRecovery(
            await collaboration.reconcilePendingMessageDeliveries({
              missionId: result.missionId,
              deliveryIds: result.createdRecipientAttentionDeliveryIds,
            }),
          );
        } catch (error) {
          options.logger.warn(
            { err: error, missionId: result.missionId },
            "Failed to reconcile targeted Team message recovery",
          );
        }
      }
    },
    createTeam: (input) => service.createTeam(input),
    listTeams: (includeArchived) => service.listTeams(includeArchived),
    inspectTeam: (teamId) => service.inspectTeam(teamId),
    updateTeam: (input) => service.updateTeam(input),
    archiveTeam: async (input) => {
      const team = await service.archiveTeam(input);
      const terminalMissions = (await service.listMissions(team.id, true)).filter(
        isTerminalMission,
      );
      for (const mission of terminalMissions) {
        await leases.releaseMission({ missionId: mission.id });
      }
      return team;
    },
    startMission: (input) => service.startMission(input),
    listMissions: (teamId, includeTerminal) => service.listMissions(teamId, includeTerminal),
    inspectMission: (missionId) => service.inspectMission(missionId),
    postMissionMessage: (input) => collaboration.postHumanRoomMessage(input),
    readMissionRoom: async (input) => {
      const stored = await missions.get(input.missionId);
      if (!stored) {
        throw new TeamApplicationError(
          "mission_not_found",
          `Mission ${input.missionId} does not exist`,
        );
      }
      return roomStore.read(input);
    },
    onMissionRoomMessage: (listener) => roomStore.onMessage(listener),
    cancelMission: async (input) => {
      const mission = await service.cancelMission(input);
      await scheduler.reconcileMission(mission.id);
      return mission;
    },
    resolveAttention: async (input) => {
      const mission = await service.resolveAttention(input);
      if (isTerminalMission(mission)) {
        await leases.releaseMission({ missionId: mission.id });
      } else {
        await scheduler.reconcileMission(mission.id);
      }
      return mission;
    },
  };
  return createRuntime({
    runtime: options.runtime,
    service: runtimeService,
    agentTools,
    onReconcileError: (error) => {
      options.logger.error({ err: error }, "Failed to reconcile Team Missions runtime");
    },
  });
}

function isTerminalMission(mission: TeamMission): boolean {
  return (
    mission.status === "completed" || mission.status === "failed" || mission.status === "canceled"
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
