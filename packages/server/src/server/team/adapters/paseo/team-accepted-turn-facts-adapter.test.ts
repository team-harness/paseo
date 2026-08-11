import { describe, expect, test, vi } from "vitest";

import type { AgentManager, AgentRecordChange } from "../../../agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../../../agent/agent-storage.js";
import { PaseoTeamAcceptedTurnFactsAdapter } from "./team-accepted-turn-facts-adapter.js";

describe("PaseoTeamAcceptedTurnFactsAdapter", () => {
  test("reads terminal, active, and unknown turn facts from durable Agent storage", async () => {
    const records = new Map<string, StoredAgentRecord>([
      [
        "agent-completed",
        {
          id: "agent-completed",
          activeTurn: { turnId: "turn-completed", startedAt: NOW, daemonRunId: "run-1" },
          turnOutcomes: [{ turnId: "turn-completed", outcome: "completed", endedAt: NOW }],
        } as StoredAgentRecord,
      ],
      [
        "agent-running",
        {
          id: "agent-running",
          activeTurn: { turnId: "turn-running", startedAt: NOW, daemonRunId: "run-1" },
        } as StoredAgentRecord,
      ],
    ]);
    const agentStorage = {
      get: vi.fn(async (agentId: string) => records.get(agentId) ?? null),
    } as unknown as AgentStorage;
    const adapter = new PaseoTeamAcceptedTurnFactsAdapter({
      agentStorage,
      agentManager: agentManagerWithoutEvents(),
    });

    await expect(
      adapter.read([
        turnReference("turn-completed", "agent-completed"),
        turnReference("turn-running", "agent-running"),
        turnReference("turn-missing", "agent-missing"),
      ]),
    ).resolves.toEqual(
      new Map([
        [
          "turn-completed",
          {
            assignmentId: "assignment-turn-completed",
            turnId: "turn-completed",
            runtimeAgentId: "agent-completed",
            outcome: "completed",
          },
        ],
        [
          "turn-running",
          {
            assignmentId: "assignment-turn-running",
            turnId: "turn-running",
            runtimeAgentId: "agent-running",
            outcome: "running",
          },
        ],
        [
          "turn-missing",
          {
            assignmentId: "assignment-turn-missing",
            turnId: "turn-missing",
            runtimeAgentId: "agent-missing",
            outcome: "unknown",
          },
        ],
      ]),
    );
  });

  test("forwards durable terminal turn events to the Mission ledger listener", async () => {
    let recordChangeListener: ((change: AgentRecordChange) => Promise<void> | void) | null = null;
    const agentManager = {
      onAgentRecordChange: (listener: (change: AgentRecordChange) => Promise<void> | void) => {
        recordChangeListener = listener;
        return () => undefined;
      },
    } as unknown as AgentManager;
    const adapter = new PaseoTeamAcceptedTurnFactsAdapter({
      agentStorage: {
        get: vi.fn(async (agentId: string) => ({
          id: agentId,
          labels: { "paseo.team-mission-id": "mission-1" },
        })),
      } as unknown as AgentStorage,
      agentManager,
    });
    const listener = vi.fn(async () => undefined);
    adapter.onTerminalFact(listener);

    await recordChangeListener?.({
      kind: "turn_settled",
      agentId: "agent-completed",
      turnId: "turn-completed",
      outcome: "completed",
    });

    expect(listener).toHaveBeenCalledWith({
      missionId: "mission-1",
      turnId: "turn-completed",
      runtimeAgentId: "agent-completed",
      outcome: "completed",
    });
  });

  test("stops routing terminal facts after the runtime disposes the adapter", async () => {
    let recordChangeListener: ((change: AgentRecordChange) => Promise<void> | void) | null = null;
    const unsubscribe = vi.fn();
    const adapter = new PaseoTeamAcceptedTurnFactsAdapter({
      agentStorage: {
        get: vi.fn(async (agentId: string) => ({
          id: agentId,
          labels: { "paseo.team-mission-id": "mission-1" },
        })),
      } as unknown as AgentStorage,
      agentManager: {
        onAgentRecordChange: (listener: (change: AgentRecordChange) => Promise<void> | void) => {
          recordChangeListener = listener;
          return unsubscribe;
        },
      } as unknown as AgentManager,
    });
    const listener = vi.fn(async () => undefined);
    adapter.onTerminalFact(listener);

    adapter.stop();
    await recordChangeListener?.({
      kind: "turn_settled",
      agentId: "agent-completed",
      turnId: "turn-completed",
      outcome: "completed",
    });

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  test("retries a failed Mission ledger write before routing 101 later turns", async () => {
    let recordChangeListener: ((change: AgentRecordChange) => Promise<void> | void) | null = null;
    const agentManager = {
      onAgentRecordChange: (listener: (change: AgentRecordChange) => Promise<void> | void) => {
        recordChangeListener = listener;
        return () => undefined;
      },
    } as unknown as AgentManager;
    const adapter = new PaseoTeamAcceptedTurnFactsAdapter({
      agentStorage: {
        get: vi.fn(async (agentId: string) => ({
          id: agentId,
          labels: { "paseo.team-mission-id": "mission-1" },
        })),
      } as unknown as AgentStorage,
      agentManager,
    });
    const acceptedTurnIds: string[] = [];
    const attemptedTurnIds: string[] = [];
    let failFirstWrite = true;
    adapter.onTerminalFact(async (fact) => {
      attemptedTurnIds.push(fact.turnId);
      if (failFirstWrite) {
        failFirstWrite = false;
        throw new Error("simulated Mission ledger write failure");
      }
      acceptedTurnIds.push(fact.turnId);
    });

    await expect(
      recordChangeListener?.({
        kind: "turn_settled",
        agentId: "agent-member",
        turnId: "turn-first",
        outcome: "completed",
      }),
    ).rejects.toThrow("simulated Mission ledger write failure");
    for (let index = 0; index < 101; index += 1) {
      await recordChangeListener?.({
        kind: "turn_settled",
        agentId: "agent-member",
        turnId: `turn-later-${index}`,
        outcome: "completed",
      });
    }

    expect(acceptedTurnIds).toHaveLength(102);
    expect(acceptedTurnIds[0]).toBe("turn-first");
    expect(attemptedTurnIds.filter((turnId) => turnId === "turn-first")).toHaveLength(2);
  });

  test("does not route non-Team terminal turns to Mission storage", async () => {
    let recordChangeListener: ((change: AgentRecordChange) => Promise<void> | void) | null = null;
    const agentManager = {
      onAgentRecordChange: (listener: (change: AgentRecordChange) => Promise<void> | void) => {
        recordChangeListener = listener;
        return () => undefined;
      },
    } as unknown as AgentManager;
    const adapter = new PaseoTeamAcceptedTurnFactsAdapter({
      agentStorage: {
        get: vi.fn(async (agentId: string) => ({ id: agentId, labels: {} })),
      } as unknown as AgentStorage,
      agentManager,
    });
    const listener = vi.fn(async () => undefined);
    adapter.onTerminalFact(listener);

    await recordChangeListener?.({
      kind: "turn_settled",
      agentId: "agent-outside-team",
      turnId: "turn-outside-team",
      outcome: "completed",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  test("keeps one failing Mission ledger from blocking another Mission", async () => {
    let recordChangeListener: ((change: AgentRecordChange) => Promise<void> | void) | null = null;
    const agentManager = {
      onAgentRecordChange: (listener: (change: AgentRecordChange) => Promise<void> | void) => {
        recordChangeListener = listener;
        return () => undefined;
      },
    } as unknown as AgentManager;
    const adapter = new PaseoTeamAcceptedTurnFactsAdapter({
      agentStorage: {
        get: vi.fn(async (agentId: string) => ({
          id: agentId,
          labels: {
            "paseo.team-mission-id":
              agentId === "agent-broken" ? "mission-broken" : "mission-healthy",
          },
        })),
      } as unknown as AgentStorage,
      agentManager,
    });
    const acceptedTurnIds: string[] = [];
    adapter.onTerminalFact(async (fact) => {
      if (fact.missionId === "mission-broken") throw new Error("broken Mission ledger");
      acceptedTurnIds.push(fact.turnId);
    });

    await expect(
      recordChangeListener?.({
        kind: "turn_settled",
        agentId: "agent-broken",
        turnId: "turn-broken",
        outcome: "completed",
      }),
    ).rejects.toThrow("broken Mission ledger");
    await expect(
      recordChangeListener?.({
        kind: "turn_settled",
        agentId: "agent-healthy",
        turnId: "turn-healthy",
        outcome: "completed",
      }),
    ).rejects.toThrow("broken Mission ledger");

    expect(acceptedTurnIds).toEqual(["turn-healthy"]);
  });
});

const NOW = "2026-08-08T10:00:00.000Z";

function turnReference(turnId: string, runtimeAgentId: string) {
  return {
    assignmentId: `assignment-${turnId}`,
    turnId,
    runtimeAgentId,
    semanticState: "running" as const,
  };
}

function agentManagerWithoutEvents(): AgentManager {
  return {
    onAgentRecordChange: () => () => undefined,
  } as unknown as AgentManager;
}
