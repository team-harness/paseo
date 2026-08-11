import { describe, expect, test } from "vitest";

import type { AgentManager } from "../../../agent/agent-manager.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { PaseoTeamMemberHistoryAdapter } from "./team-member-history-adapter.js";

describe("PaseoTeamMemberHistoryAdapter", () => {
  test("curates the requested participant timeline with bounded counts", async () => {
    const agentManager = {
      getAgent: () => ({ currentModeId: "auto" }),
      getTimeline: () => [
        {
          type: "assistant_message",
          text: "Implemented the parser.",
        },
      ],
    } as unknown as AgentManager;
    const adapter = new PaseoTeamMemberHistoryAdapter({
      agentManager,
      agentStorage: {} as AgentStorage,
      logger: createTestLogger(),
    });

    const history = await adapter.read({ agentId: "agent-member", limit: 25 });

    expect(history).toMatchObject({
      agentId: "agent-member",
      updateCount: 1,
      totalActivities: 1,
      shownActivities: 1,
      currentModeId: "auto",
    });
    expect(history.content).toContain("Implemented the parser.");
  });
});
