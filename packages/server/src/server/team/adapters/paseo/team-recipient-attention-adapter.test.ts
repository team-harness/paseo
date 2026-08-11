import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentManager, AgentRecordChange } from "../../../agent/agent-manager.js";
import type { SendPromptToAgentParams } from "../../../agent/agent-prompt.js";
import type { AgentStorage, StoredAgentRecord } from "../../../agent/agent-storage.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { PaseoTeamRecipientAttentionAdapter } from "./team-recipient-attention-adapter.js";

describe("PaseoTeamRecipientAttentionAdapter", () => {
  let lifecycle: "idle" | "running";
  let recordChangeListener: ((change: AgentRecordChange) => Promise<void> | void) | null;
  let sentPrompts: SendPromptToAgentParams[];
  let adapter: PaseoTeamRecipientAttentionAdapter;

  beforeEach(() => {
    lifecycle = "idle";
    recordChangeListener = null;
    sentPrompts = [];
    const agentManager = {
      getAgent: () => ({ lifecycle }),
      hasInFlightRun: () => lifecycle === "running",
      onAgentRecordChange: (listener: (change: AgentRecordChange) => Promise<void> | void) => {
        recordChangeListener = listener;
        return () => undefined;
      },
    } as unknown as AgentManager;
    const record = {
      id: "agent-member",
      archivedAt: null,
      activeTurn: null,
      lastStatus: "idle",
    } as unknown as StoredAgentRecord;
    const agentStorage = {
      get: vi.fn(async () => record),
    } as unknown as AgentStorage;
    adapter = new PaseoTeamRecipientAttentionAdapter({
      agentManager,
      agentStorage,
      logger: createTestLogger(),
      sendPrompt: async (input) => {
        sentPrompts.push(input);
        return { outOfBand: false };
      },
    });
  });

  test("does not replace a busy turn", async () => {
    lifecycle = "running";

    await expect(adapter.attempt(attemptInput())).resolves.toBe("busy");
    expect(sentPrompts).toEqual([]);
  });

  test("sends a minimal cursor-read notification with deterministic identity", async () => {
    await expect(adapter.attempt(attemptInput())).resolves.toBe("notified");

    expect(sentPrompts).toHaveLength(1);
    expect(sentPrompts[0]).toMatchObject({
      agentId: "agent-member",
      messageId: "team-message:delivery-1:binding:1:attempt:1",
      unarchive: false,
      replaceRunning: false,
    });
    expect(sentPrompts[0]?.prompt).toContain('Call chat_read with missionId "mission-1" now.');
    expect(sentPrompts[0]?.prompt).not.toContain("objective");
  });

  test("wakes an idle room mention with a stable message identity", async () => {
    await adapter.wake({
      messageId: "room-message-1",
      missionId: "mission-1",
      recipientAgentId: "agent-member",
      bindingEpoch: 3,
    });

    expect(sentPrompts).toHaveLength(1);
    expect(sentPrompts[0]).toMatchObject({
      agentId: "agent-member",
      messageId: "team-room-mention:room-message-1:binding:3",
      unarchive: false,
      replaceRunning: false,
    });
    expect(sentPrompts[0]?.prompt).toContain('Call chat_read with missionId "mission-1" now.');
  });

  test("does not retry a room mention while the participant is busy", async () => {
    lifecycle = "running";

    await adapter.wake({
      messageId: "room-message-1",
      missionId: "mission-1",
      recipientAgentId: "agent-member",
      bindingEpoch: 3,
    });

    expect(sentPrompts).toEqual([]);
  });

  test("forwards durable turn settlement as an eligibility change", async () => {
    const listener = vi.fn(async () => undefined);
    adapter.onEligibilityChange(listener);

    await recordChangeListener?.({
      kind: "turn_settled",
      agentId: "agent-member",
      turnId: "turn-1",
      outcome: "completed",
    });

    expect(listener).toHaveBeenCalledWith("agent-member");
  });

  test("stops routing eligibility changes after the runtime disposes the adapter", async () => {
    const listener = vi.fn(async () => undefined);
    adapter.onEligibilityChange(listener);

    adapter.stop();
    await recordChangeListener?.({
      kind: "turn_settled",
      agentId: "agent-member",
      turnId: "turn-1",
      outcome: "completed",
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

function attemptInput() {
  return {
    deliveryId: "delivery-1",
    missionId: "mission-1",
    recipientAgentId: "agent-member",
    bindingEpoch: 1,
    attempt: 1,
  };
}
