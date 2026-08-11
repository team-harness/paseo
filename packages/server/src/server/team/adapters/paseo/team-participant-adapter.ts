import type { Logger } from "pino";

import { TEAM_ID_LABEL, TEAM_ROLE_LABEL } from "@getpaseo/protocol/agent-labels";

import { AgentAlreadyExistsError, type AgentManager } from "../../../agent/agent-manager.js";
import { ensureUnarchivedAgentLoaded } from "../../../agent/agent-loading.js";
import {
  formatSystemNotificationPrompt,
  sendPromptToAgent,
  waitForAgentRunStartWithTimeout,
} from "../../../agent/agent-prompt.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import { archiveAgentCommand } from "../../../agent/lifecycle-command.js";
import type { TeamParticipantPort } from "../../application/ports.js";
import type { TeamParticipantProvisionPort } from "../../application/team-mission-scheduler.js";

export const TEAM_MISSION_ID_LABEL = "paseo.team-mission-id";
export const TEAM_MEMBER_ID_LABEL = "paseo.team-member-id";
export const TEAM_BINDING_EPOCH_LABEL = "paseo.team-binding-epoch";
const MAX_LEAD_WAKE_ATTEMPTS = 2;

type TeamParticipantAgentManager = AgentManager;

interface PaseoTeamParticipantAdapterOptions {
  agentManager: TeamParticipantAgentManager;
  agentStorage: AgentStorage;
  resolveWorkspaceCwd(workspaceId: string): Promise<string | null>;
  logger: Logger;
}

type ParticipantProvisionInput =
  | Parameters<TeamParticipantPort["createLead"]>[0]
  | Parameters<TeamParticipantProvisionPort["ensureParticipant"]>[0];

export class PaseoTeamParticipantAdapter
  implements TeamParticipantPort, TeamParticipantProvisionPort
{
  private readonly agentManager: TeamParticipantAgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly resolveWorkspaceCwd: (workspaceId: string) => Promise<string | null>;
  private readonly logger: Logger;
  private readonly leadWakePromises = new Map<string, Promise<void>>();

  constructor(options: PaseoTeamParticipantAdapterOptions) {
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.resolveWorkspaceCwd = options.resolveWorkspaceCwd;
    this.logger = options.logger.child({ module: "team", component: "v2-participant-adapter" });
  }

  async createLead(input: Parameters<TeamParticipantPort["createLead"]>[0]): Promise<void> {
    await this.ensureParticipantAgent(input);
    await this.wakeLead(input);
  }

  async ensureParticipant(
    input: Parameters<TeamParticipantProvisionPort["ensureParticipant"]>[0],
  ): Promise<void> {
    await this.ensureParticipantAgent(input);
  }

  async inspectParticipant(
    input: Parameters<NonNullable<TeamParticipantProvisionPort["inspectParticipant"]>>[0],
  ): Promise<"active" | "archived" | "missing"> {
    const stored = await this.agentStorage.get(input.agentId);
    if (!stored || !ownsParticipant(stored.labels, input)) return "missing";
    return stored.archivedAt ? "archived" : "active";
  }

  private async ensureParticipantAgent(input: ParticipantProvisionInput): Promise<void> {
    const cwd = await this.resolveWorkspaceCwd(input.workspaceId);
    if (!cwd) {
      throw new Error(`Workspace ${input.workspaceId} has no directory for Team participants`);
    }
    const labels = {
      [TEAM_ID_LABEL]: input.teamId,
      [TEAM_ROLE_LABEL]: input.role,
      [TEAM_MISSION_ID_LABEL]: input.missionId,
      [TEAM_MEMBER_ID_LABEL]: input.memberId,
      [TEAM_BINDING_EPOCH_LABEL]: String("bindingEpoch" in input ? input.bindingEpoch : 1),
    };
    try {
      await this.agentManager.createAgent(
        {
          provider: input.executionProfile.provider,
          cwd,
          title: input.role,
          ...(input.executionProfile.model ? { model: input.executionProfile.model } : {}),
          ...(input.executionProfile.modeId ? { modeId: input.executionProfile.modeId } : {}),
          ...(input.executionProfile.thinkingOptionId
            ? { thinkingOptionId: input.executionProfile.thinkingOptionId }
            : {}),
          featureValues: structuredClone(input.executionProfile.featureValues),
        },
        input.agentId,
        {
          workspaceId: input.workspaceId,
          labels,
          initialTitle: input.role,
          reuseIfOwnedBy: {
            [TEAM_ID_LABEL]: input.teamId,
            [TEAM_MISSION_ID_LABEL]: input.missionId,
            [TEAM_MEMBER_ID_LABEL]: input.memberId,
            [TEAM_BINDING_EPOCH_LABEL]: String("bindingEpoch" in input ? input.bindingEpoch : 1),
          },
        },
      );
    } catch (error) {
      if (!(error instanceof AgentAlreadyExistsError)) throw error;
      if (!ownsParticipant(error.record.labels, input)) throw error;
      await ensureUnarchivedAgentLoaded(input.agentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.logger,
      });
    }
  }

  async archiveParticipant(
    input: Parameters<TeamParticipantPort["archiveParticipant"]>[0],
  ): Promise<void> {
    const stored = await this.agentStorage.get(input.agentId);
    if (!stored) return;
    if (!ownsMission(stored.labels, input)) {
      throw new Error(
        `Agent ${input.agentId} is not owned by Team ${input.teamId} Mission ${input.missionId}`,
      );
    }
    try {
      await archiveAgentCommand(
        {
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          logger: this.logger,
        },
        input.agentId,
      );
    } catch (error) {
      if ((await this.agentStorage.get(input.agentId)) === null) return;
      throw error;
    }
  }

  private wakeLead(input: Parameters<TeamParticipantPort["createLead"]>[0]): Promise<void> {
    const wakeKey = `team-mission:${input.missionId}:member:${input.memberId}:wake:${input.bindingEpoch}`;
    const existing = this.leadWakePromises.get(wakeKey);
    if (existing) return existing;

    const pending = this.wakeLeadWithRecovery(input, wakeKey);
    this.leadWakePromises.set(wakeKey, pending);
    return pending.finally(() => {
      if (this.leadWakePromises.get(wakeKey) === pending) {
        this.leadWakePromises.delete(wakeKey);
      }
    });
  }

  private async wakeLeadWithRecovery(
    input: Parameters<TeamParticipantPort["createLead"]>[0],
    wakeKey: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_LEAD_WAKE_ATTEMPTS; attempt += 1) {
      const messageId = attempt === 0 ? wakeKey : `${wakeKey}:recovery:${attempt}`;
      const acceptedTurnId = await this.agentManager.getAcceptedTurnId(input.agentId, messageId);
      if (!acceptedTurnId) {
        await this.wakeLeadOnce(input, messageId, attempt > 0);
        return;
      }
      const record = await this.agentStorage.get(input.agentId);
      if (record?.activeTurn?.turnId === acceptedTurnId) return;
      const outcome = await this.agentStorage.getTurnOutcome(input.agentId, acceptedTurnId);
      if (!outcome) {
        throw new Error(
          `Lead ${input.memberId} wake ${messageId} has unknown outcome after acceptance`,
        );
      }
      // A durable terminal turn cannot finish planning after restart. Advance to
      // one deterministic successor instead of replaying its message id.
    }
    throw new Error(
      `Lead ${input.memberId} exhausted ${MAX_LEAD_WAKE_ATTEMPTS} planning wake attempts for Mission ${input.missionId}`,
    );
  }

  private async wakeLeadOnce(
    input: Parameters<TeamParticipantPort["createLead"]>[0],
    messageId: string,
    recovery: boolean,
  ): Promise<void> {
    if (await this.agentManager.getAcceptedTurnId(input.agentId, messageId)) return;

    const prompt = formatSystemNotificationPrompt(
      recovery
        ? [
            `Resume Lead planning for Mission "${input.missionId}" in Team "${input.teamId}" after the previous wake was interrupted.`,
            `Call mission_status with missionId "${input.missionId}" now. If planRevision is 0, use one mission_plan call with the complete Workstream DAG and its assignments field covering every delivery and integration Workstream. If the Mission is planning with an existing staged plan, use one assign_task batch to complete it. If it is active, do not rewrite it.`,
          ].join("\n")
        : [
            `You are Team Member "${input.memberId}" (@${input.mentionHandle}), the Lead for Mission "${input.missionId}" in Team "${input.teamId}".`,
            `Call mission_status with missionId "${input.missionId}" now. Then use one mission_plan call with the complete Workstream DAG and its assignments field covering every delivery and integration Workstream, including nodes whose dependencies are not ready yet. The daemon derives Assignment dependencies from the Workstream DAG, gates dispatch, and materializes required review and final verification Assignments.`,
          ].join("\n"),
    );
    const result = await sendPromptToAgent({
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      agentId: input.agentId,
      prompt,
      messageId,
      fenceUnknownAcceptance: true,
      unarchive: false,
      replaceRunning: false,
      logger: this.logger,
    });
    if (!result.outOfBand) {
      await waitForAgentRunStartWithTimeout(this.agentManager, input.agentId);
    }
  }
}

function ownsParticipant(
  labels: Record<string, string> | undefined,
  input: {
    teamId: string;
    missionId: string;
    memberId: string;
    bindingEpoch?: number;
  },
): boolean {
  return (
    ownsMission(labels, input) &&
    labels?.[TEAM_MEMBER_ID_LABEL] === input.memberId &&
    labels[TEAM_BINDING_EPOCH_LABEL] === String(input.bindingEpoch ?? 1)
  );
}

function ownsMission(
  labels: Record<string, string> | undefined,
  input: { teamId: string; missionId: string },
): boolean {
  return (
    labels?.[TEAM_ID_LABEL] === input.teamId && labels[TEAM_MISSION_ID_LABEL] === input.missionId
  );
}
