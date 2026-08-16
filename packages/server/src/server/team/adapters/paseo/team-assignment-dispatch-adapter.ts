import type { Logger } from "pino";

import { TEAM_ID_LABEL } from "@getpaseo/protocol/agent-labels";

import type { AgentManager } from "../../../agent/agent-manager.js";
import {
  formatSystemNotificationPrompt,
  sendPromptToAgent,
  UnknownAgentRunAcceptanceError,
} from "../../../agent/agent-prompt.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import type { TeamAssignmentDispatchPort } from "../../application/team-mission-scheduler.js";
import { TEAM_BINDING_EPOCH_LABEL, TEAM_MISSION_ID_LABEL } from "./team-participant-adapter.js";
import {
  TEAM_ROOM_COLLABORATION_PROMPT,
  teamRoomReportRecoveryPrompt,
} from "./team-room-collaboration-contract.js";

interface PaseoTeamAssignmentDispatchAdapterOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

type DispatchInput = Parameters<TeamAssignmentDispatchPort["dispatch"]>[0];
type ReportRecoveryInput = Parameters<TeamAssignmentDispatchPort["requestReport"]>[0];

export class PaseoTeamAssignmentDispatchAdapter implements TeamAssignmentDispatchPort {
  private readonly logger: Logger;

  constructor(private readonly options: PaseoTeamAssignmentDispatchAdapterOptions) {
    this.logger = options.logger.child({ module: "team", component: "v2-assignment-dispatch" });
  }

  async dispatch(input: DispatchInput) {
    return this.dispatchPrompt(
      input,
      `Call mission_status with missionId "${input.missionId}" now.`,
      [
        `Assignment "${input.assignmentId}" is ready. Execute only the persisted Assignment contract.`,
        "Treat the persisted Assignment as the complete scope for this turn; do not start a separate agent or review orchestration loop.",
        "Before this turn ends, call assignment_report exactly once unless the final-verification closeout rule above explicitly requires you to wait for the Lead summary. Do not end with only prose or shell output.",
      ].join("\n"),
      TEAM_ROOM_COLLABORATION_PROMPT,
    );
  }

  async requestReport(input: ReportRecoveryInput) {
    return this.dispatchPrompt(
      input,
      `Call mission_status with missionId "${input.missionId}" now.`,
      `Assignment "${input.assignmentId}" is waiting for its structured report (recovery attempt ${input.attempt}).`,
      teamRoomReportRecoveryPrompt(input.assignmentId),
    );
  }

  private async dispatchPrompt(
    input: DispatchInput | ReportRecoveryInput,
    runtimeBody: string,
    assignmentFacts: string,
    collaborationPrompt: string | null,
  ): Promise<Awaited<ReturnType<TeamAssignmentDispatchPort["dispatch"]>>> {
    const replayTurnId = await this.findAcceptedTurnId(input.agentId, input.messageId);
    if (replayTurnId) return { kind: "accepted", turnId: replayTurnId };
    if (this.options.agentManager.hasInFlightRun(input.agentId)) return { kind: "busy" };

    const record = await this.options.agentStorage.get(input.agentId);
    if (
      !record ||
      record.archivedAt ||
      record.labels?.[TEAM_ID_LABEL] !== input.teamId ||
      record.labels?.[TEAM_MISSION_ID_LABEL] !== input.missionId ||
      record.labels?.[TEAM_BINDING_EPOCH_LABEL] !== String(input.bindingEpoch)
    ) {
      return { kind: "provider_unavailable", reason: "Participant binding is unavailable" };
    }

    try {
      const promptBody = [
        runtimeBody,
        ...input.methodologyPromptSections.map((section) => section.content),
        ...(collaborationPrompt ? [collaborationPrompt] : []),
        assignmentFacts,
      ].join("\n\n");
      const result = await sendPromptToAgent({
        agentManager: this.options.agentManager,
        agentStorage: this.options.agentStorage,
        agentId: input.agentId,
        prompt: formatSystemNotificationPrompt(promptBody),
        messageId: input.messageId,
        fenceUnknownAcceptance: true,
        unarchive: false,
        replaceRunning: false,
        logger: this.logger,
      });
      return result.turnId
        ? { kind: "accepted", turnId: result.turnId }
        : { kind: "provider_unavailable", reason: "Provider did not expose an accepted turn" };
    } catch (error) {
      if (error instanceof UnknownAgentRunAcceptanceError) {
        return { kind: "acceptance_unknown", reason: error.message };
      }
      const reason = error instanceof Error ? error.message : String(error);
      return reason.includes("already has an active run")
        ? { kind: "busy" }
        : { kind: "provider_unavailable", reason };
    }
  }

  private async findAcceptedTurnId(agentId: string, messageId: string): Promise<string | null> {
    return await this.options.agentManager.getAcceptedTurnId(agentId, messageId);
  }
}
