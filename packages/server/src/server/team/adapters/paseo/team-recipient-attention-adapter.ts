import type { Logger } from "pino";

import type { AgentManager, AgentRecordChange } from "../../../agent/agent-manager.js";
import {
  formatSystemNotificationPrompt,
  sendPromptToAgent,
  type SendPromptToAgentParams,
} from "../../../agent/agent-prompt.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import { isAgentWakeable } from "../../../agent/agent-wakeability.js";
import type {
  TeamRecipientAttentionPort,
  TeamRoomMentionWakePort,
} from "../../application/ports.js";

interface PaseoTeamRecipientAttentionAdapterOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  sendPrompt?: (params: SendPromptToAgentParams) => Promise<{ outOfBand: boolean }>;
}

export class PaseoTeamRecipientAttentionAdapter
  implements TeamRecipientAttentionPort, TeamRoomMentionWakePort
{
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
    this.unsubscribeAgentChanges = this.agentManager.onAgentRecordChange(async (change) => {
      if (this.stopped || !isEligibilityChange(change)) return;
      await this.eligibilityListener?.(change.agentId);
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
    if (!isAgentWakeable({ live, record })) return "busy" as const;

    try {
      await this.sendPrompt({
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        agentId: input.recipientAgentId,
        prompt: formatSystemNotificationPrompt(
          `Team message ${input.deliveryId} is ready for Mission "${input.missionId}". Call chat_read with missionId "${input.missionId}" now.`,
        ),
        messageId: `team-message:${input.deliveryId}:binding:${input.bindingEpoch}:attempt:${input.attempt}`,
        unarchive: false,
        replaceRunning: false,
        logger: this.logger,
      });
      return "notified" as const;
    } catch (error) {
      if (this.agentManager.hasInFlightRun(input.recipientAgentId)) return "busy" as const;
      throw error;
    }
  }

  async wake(input: Parameters<TeamRoomMentionWakePort["wake"]>[0]): Promise<void> {
    const record = await this.agentStorage.get(input.recipientAgentId);
    if (!record || record.archivedAt) return;
    const live = this.agentManager.getAgent(input.recipientAgentId);
    if (!isAgentWakeable({ live, record })) return;

    try {
      await this.sendPrompt({
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        agentId: input.recipientAgentId,
        prompt: formatSystemNotificationPrompt(
          `You were mentioned in Mission "${input.missionId}". Call chat_read with missionId "${input.missionId}" now.`,
        ),
        messageId: `team-room-mention:${input.messageId}:binding:${input.bindingEpoch}`,
        unarchive: false,
        replaceRunning: false,
        logger: this.logger,
      });
    } catch (error) {
      if (this.agentManager.hasInFlightRun(input.recipientAgentId)) return;
      throw error;
    }
  }
}

function isEligibilityChange(change: AgentRecordChange): boolean {
  return change.kind === "turn_settled" || change.kind === "unarchived";
}
