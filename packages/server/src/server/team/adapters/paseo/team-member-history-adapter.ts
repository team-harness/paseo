import type { Logger } from "pino";

import { curateAgentActivity } from "../../../agent/activity-curator.js";
import type { AgentManager } from "../../../agent/agent-manager.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import { ensureAgentLoaded } from "../../../agent/agent-loading.js";
import { selectItemsByProjectedLimit } from "../../../agent/timeline-projection.js";
import type { TeamMemberHistoryPort } from "../../application/ports.js";

interface PaseoTeamMemberHistoryAdapterOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

export class PaseoTeamMemberHistoryAdapter implements TeamMemberHistoryPort {
  constructor(private readonly options: PaseoTeamMemberHistoryAdapterOptions) {}

  async read(input: Parameters<TeamMemberHistoryPort["read"]>[0]) {
    await ensureAgentLoaded(input.agentId, {
      agentManager: this.options.agentManager,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    const timeline = this.options.agentManager.getTimeline(input.agentId);
    const snapshot = this.options.agentManager.getAgent(input.agentId);
    const selection = selectItemsByProjectedLimit({
      items: timeline,
      direction: "tail",
      limit: input.limit,
    });
    return {
      agentId: input.agentId,
      updateCount: timeline.length,
      totalActivities: selection.totalProjected,
      shownActivities: selection.shownProjected,
      currentModeId: snapshot?.currentModeId ?? null,
      content: curateAgentActivity(selection.items),
    };
  }
}
