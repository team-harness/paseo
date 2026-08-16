import type { Logger } from "pino";

import type { AgentManager, AgentRecordChange } from "../../../agent/agent-manager.js";
import {
  formatSystemNotificationPrompt,
  sendPromptToAgent,
  type SendPromptToAgentParams,
} from "../../../agent/agent-prompt.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import { isAgentWakeable } from "../../../agent/agent-wakeability.js";
import type { TeamRecipientAttentionPort } from "../../application/ports.js";
import {
  LEAD_FINAL_SUMMARY_PREFIX,
  leadFinalSummaryIdempotencyKey,
} from "../../application/team-room-closeout.js";

interface PaseoTeamRecipientAttentionAdapterOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  sendPrompt?: (params: SendPromptToAgentParams) => Promise<{ outOfBand: boolean }>;
}

export class PaseoTeamRecipientAttentionAdapter implements TeamRecipientAttentionPort {
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly logger: Logger;
  private readonly sendPrompt: (params: SendPromptToAgentParams) => Promise<{ outOfBand: boolean }>;
  private readonly unsubscribeAgentChanges: () => void;
  private eligibilityListener: ((agentId: string) => Promise<void>) | null = null;
  private stopped = false;

  constructor(options: PaseoTeamRecipientAttentionAdapterOptions) {
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.logger = options.logger.child({ module: "team", component: "v2-recipient-attention" });
    this.sendPrompt = options.sendPrompt ?? sendPromptToAgent;
    this.unsubscribeAgentChanges = this.agentManager.onAgentRecordChange((change) => {
      if (this.stopped || !isEligibilityChange(change)) return;
      void this.eligibilityListener?.(change.agentId).catch((error: unknown) => {
        this.logger.warn(
          { err: error, agentId: change.agentId },
          "Deferred Team recipient reconciliation failed",
        );
      });
    });
  }

  onEligibilityChange(listener: (agentId: string) => Promise<void>): void {
    this.eligibilityListener = listener;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.eligibilityListener = null;
    this.unsubscribeAgentChanges();
  }

  async attempt(input: Parameters<TeamRecipientAttentionPort["attempt"]>[0]) {
    const record = await this.agentStorage.get(input.recipientAgentId);
    if (!record || record.archivedAt) return "unavailable" as const;
    const live = this.agentManager.getAgent(input.recipientAgentId);
    const prompt = formatSystemNotificationPrompt(
      input.origin === "human_mention"
        ? `A human mentioned you in Mission "${input.missionId}". Call chat_read with missionId "${input.missionId}" now. Do that before anything else, then call chat_post with missionId "${input.missionId}", replyToMessageId "${input.roomMessageId}", idempotencyKey "${input.deliveryId}:ack", and a brief acknowledgment or current status. Continue the same Assignment after the room reply is posted; do not treat this notification as new work.`
        : `A teammate messaged you in Mission "${input.missionId}". Call chat_read with missionId "${input.missionId}" now. Do that before anything else, then call chat_post with missionId "${input.missionId}", idempotencyKey "${input.deliveryId}:ack", and a brief acknowledgment or current status without a mention or replyToMessageId. This keeps the acknowledgment visible without interrupting another teammate. If the message asks you as Lead for the final Mission summary, take the Assignment id from the verifier outcome and post the summary in a separate chat_post after the acknowledgment. Use idempotencyKey "${leadFinalSummaryIdempotencyKey("<assignmentId>")}", start the body with "${LEAD_FINAL_SUMMARY_PREFIX}", and mention the verifier who requested it so they are woken to submit their report. If the message is the Lead's final Mission summary addressed to you as final verifier, acknowledge it, call mission_status, and submit the pending final verification assignment_report. Otherwise continue the same Assignment after the room update is posted; do not treat this notification as new work.`,
    );
    const messageId = `team-message:${input.deliveryId}:binding:${input.bindingEpoch}:attempt:${input.attempt}`;
    if (input.origin === "human_mention" && live?.lifecycle === "running") {
      const steered = await this.agentManager.steerActiveTurn({
        agentId: input.recipientAgentId,
        prompt,
        clientMessageId: messageId,
      });
      return steered.status === "delivered" ? ("notified" as const) : ("busy" as const);
    }
    if (!isAgentWakeable({ live, record })) return "busy" as const;

    try {
      await this.sendPrompt({
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        agentId: input.recipientAgentId,
        prompt,
        messageId,
        unarchive: false,
        replaceRunning: false,
        logger: this.logger,
      });
      return "notified" as const;
    } catch (error) {
      if (
        this.agentManager.hasInFlightRun(input.recipientAgentId) ||
        (error instanceof Error && error.message.includes("already has an active turn"))
      ) {
        return "busy" as const;
      }
      throw error;
    }
  }
}

function isEligibilityChange(change: AgentRecordChange): boolean {
  return change.kind === "turn_settled" || change.kind === "unarchived";
}
