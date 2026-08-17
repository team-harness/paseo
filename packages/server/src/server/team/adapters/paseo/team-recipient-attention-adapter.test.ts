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
  let steerInputs: Parameters<AgentManager["steerActiveTurn"]>[0][];
  let steerStatus: Awaited<ReturnType<AgentManager["steerActiveTurn"]>>["status"];
  let sendPromptError: Error | null;
  let adapter: PaseoTeamRecipientAttentionAdapter;

  beforeEach(() => {
    lifecycle = "idle";
    recordChangeListener = null;
    sentPrompts = [];
    steerInputs = [];
    steerStatus = "delivered";
    sendPromptError = null;
    const agentManager = {
      getAgent: () => ({ lifecycle }),
      hasInFlightRun: () => lifecycle === "running",
      steerActiveTurn: async (input: Parameters<AgentManager["steerActiveTurn"]>[0]) => {
        steerInputs.push(input);
        return { status: steerStatus, turnId: "turn-1" };
      },
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
        if (sendPromptError) throw sendPromptError;
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

  test("keeps delivery pending when a resumed provider reports an active turn", async () => {
    sendPromptError = new Error("Session resumed-session already has an active turn");

    await expect(adapter.attempt(attemptInput())).resolves.toBe("busy");
    expect(sentPrompts).toEqual([]);
  });

  test("steers a busy human mention into the active turn without starting another turn", async () => {
    lifecycle = "running";

    await expect(adapter.attempt({ ...attemptInput(), origin: "human_mention" })).resolves.toBe(
      "notified",
    );

    expect(sentPrompts).toEqual([]);
    expect(steerInputs).toHaveLength(1);
    expect(steerInputs[0]).toMatchObject({
      agentId: "agent-member",
      clientMessageId: "team-message:delivery-1:binding:1:attempt:1",
    });
    expect(steerInputs[0]?.prompt).toContain("chat_read");
    expect(steerInputs[0]?.prompt).toContain("chat_post");
    expect(steerInputs[0]?.prompt).toContain("Continue the same Assignment");
  });

  test("keeps a human mention pending when the active provider cannot steer", async () => {
    lifecycle = "running";
    steerStatus = "unsupported";

    await expect(adapter.attempt({ ...attemptInput(), origin: "human_mention" })).resolves.toBe(
      "busy",
    );

    expect(sentPrompts).toEqual([]);
    expect(steerInputs).toHaveLength(1);
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
    expect(sentPrompts[0]?.prompt).toContain("brief acknowledgment or current status");
    expect(sentPrompts[0]?.prompt).toContain("continue the same Assignment");
    expect(sentPrompts[0]?.prompt).toContain("without a mention or replyToMessageId");
    expect(sentPrompts[0]?.prompt).toContain(
      'Use idempotencyKey "assignment:<assignmentId>:lead-final-summary"',
    );
    expect(sentPrompts[0]?.prompt).toContain("mention the verifier who requested it");
    expect(sentPrompts[0]?.prompt).toContain(
      "submit the pending final verification assignment_report",
    );
    expect(sentPrompts[0]?.prompt).not.toContain('replyToMessageId "room-message-1"');
    expect(sentPrompts[0]?.prompt).not.toContain("objective");
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

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("agent-member"));
  });

  test("does not await recipient reconciliation inside the Agent settlement callback", async () => {
    let finishReconciliation: (() => void) | null = null;
    const listener = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          finishReconciliation = resolve;
        }),
    );
    adapter.onEligibilityChange(listener);

    const callbackResult = recordChangeListener?.({
      kind: "turn_settled",
      agentId: "agent-member",
      turnId: "turn-1",
      outcome: "completed",
    });

    expect(callbackResult).toBeUndefined();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("agent-member"));
    finishReconciliation?.();
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
    origin: "agent_message" as const,
    roomMessageId: "room-message-1",
    recipientAgentId: "agent-member",
    bindingEpoch: 1,
    attempt: 1,
  };
}
