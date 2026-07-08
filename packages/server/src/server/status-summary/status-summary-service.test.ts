import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { UsageLedger, UsageTotalsDelta } from "../usage-ledger/index.js";
import { StatusSummaryService } from "./status-summary-service.js";
import type { SessionPinStore } from "./session-pin-store.js";

class FakeUsageLedger {
  lifetime: UsageTotalsDelta = {};
  today: UsageTotalsDelta = {};

  async initialize(): Promise<void> {}
  enqueueEvent(): void {}
  async getTotals(): Promise<UsageTotalsDelta> {
    return this.lifetime;
  }
  async getTodayTotals(): Promise<UsageTotalsDelta> {
    return this.today;
  }
  async flush(): Promise<void> {}
}

class FakeAgentSource {
  agents: ManagedAgent[] = [];
  subscribers: Array<(event: AgentManagerEvent) => void> = [];

  listAgents(): ManagedAgent[] {
    return this.agents;
  }

  subscribe(callback: (event: AgentManagerEvent) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((entry) => entry !== callback);
    };
  }

  emit(event: AgentManagerEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

class FakeSessionPinStore implements Pick<SessionPinStore, "list"> {
  pinnedSessions = [
    {
      agentId: "pinned",
      workspaceId: "workspace-1",
      title: "Pinned agent",
      provider: "codex" as const,
      updatedAt: "2026-07-06T03:59:00.000Z",
      pinnedAt: "2026-07-06T04:00:00.000Z",
    },
  ];

  async list() {
    return this.pinnedSessions;
  }
}

function agent(overrides: Partial<ManagedAgent>): ManagedAgent {
  const now = new Date("2026-07-06T04:00:00.000Z");
  return {
    id: "agent-1",
    provider: "codex",
    cwd: "/repo",
    workspaceId: "workspace-1",
    title: "Agent",
    lifecycle: "idle",
    createdAt: now,
    updatedAt: now,
    labels: {},
    config: { provider: "codex", cwd: "/repo" },
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsRewindBoth: false,
    },
    availableModes: [],
    currentModeId: null,
    pendingPermissions: [],
    attention: {
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: now,
    },
    activeForegroundTurnId: null,
    session: null,
    persistence: null,
    runtimeInfo: null,
    features: [],
    lastError: undefined,
    lastUsage: undefined,
    lastUserMessageAt: null,
    internal: false,
    ...overrides,
  } as ManagedAgent;
}

function createService(
  options: {
    ledger?: FakeUsageLedger;
    source?: FakeAgentSource;
    sessionPinStore?: Pick<SessionPinStore, "list">;
    now?: Date;
    coalesceMs?: number;
  } = {},
): { service: StatusSummaryService; ledger: FakeUsageLedger; source: FakeAgentSource } {
  const ledger = options.ledger ?? new FakeUsageLedger();
  const source = options.source ?? new FakeAgentSource();
  const service = new StatusSummaryService({
    usageLedger: ledger as unknown as UsageLedger,
    agentSource: source,
    sessionPinStore: options.sessionPinStore,
    logger: pino({ level: "silent" }),
    clock: () => options.now ?? new Date("2026-07-06T04:00:00.000Z"),
    coalesceMs: options.coalesceMs ?? 5,
  });
  return { service, ledger, source };
}

describe("StatusSummaryService", () => {
  test("aggregates lifetime and today usage totals with generated local-day window", async () => {
    const { service, ledger } = createService();
    ledger.lifetime = {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      totalCostUsd: 1.25,
    };
    ledger.today = {
      inputTokens: 10,
      outputTokens: 5,
    };

    const summary = await service.getSummary();

    expect(summary.usage.lifetime).toEqual({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      totalCostUsd: 1.25,
      totalTokens: 150,
    });
    expect(summary.usage.today).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      windowStart: new Date(2026, 6, 6).toISOString(),
      windowEnd: "2026-07-06T04:00:00.000Z",
    });
  });

  test("includes host-owned pinned sessions in the summary", async () => {
    const { service } = createService({ sessionPinStore: new FakeSessionPinStore() });

    const summary = await service.getSummary();

    expect(summary.pinnedSessions).toEqual([
      {
        agentId: "pinned",
        workspaceId: "workspace-1",
        title: "Pinned agent",
        provider: "codex",
        updatedAt: "2026-07-06T03:59:00.000Z",
        pinnedAt: "2026-07-06T04:00:00.000Z",
      },
    ]);
  });

  test("builds activity snapshots, parentAgentId, counts, and recently completed window", async () => {
    const { service, source } = createService();
    source.agents = [
      agent({ id: "running", lifecycle: "running" }),
      agent({
        id: "permission",
        lifecycle: "running",
        pendingPermissions: new Map([
          ["perm-1", { id: "perm-1", toolName: "write", description: "Write" }],
        ]),
      }),
      agent({ id: "failed", lifecycle: "error" }),
      agent({
        id: "done",
        lifecycle: "idle",
        labels: { "paseo.parent-agent-id": "parent-1" },
        attention: {
          requiresAttention: true,
          attentionReason: "finished",
          attentionTimestamp: new Date("2026-07-06T03:55:00.000Z"),
        },
      }),
      agent({
        id: "old-done",
        lifecycle: "idle",
        attention: {
          requiresAttention: true,
          attentionReason: "finished",
          attentionTimestamp: new Date("2026-07-06T03:30:00.000Z"),
        },
      }),
      agent({ id: "closed", lifecycle: "closed" }),
    ];

    const summary = await service.getSummary();

    expect(summary.activity.counts).toEqual({
      running: 1,
      needsAttention: 3,
      idle: 0,
      error: 1,
    });
    expect(summary.activity.runningAgents.map((item) => item.agentId)).toEqual(["running"]);
    expect(summary.activity.needsAttentionAgents.map((item) => item.agentId)).toEqual([
      "permission",
      "done",
      "old-done",
    ]);
    expect(summary.activity.recentlyCompletedAgents.map((item) => item.agentId)).toEqual(["done"]);
    expect(summary.activity.recentlyCompletedAgents[0]?.parentAgentId).toBe("parent-1");
  });

  test("coalesces agent events into one full snapshot push", async () => {
    vi.useFakeTimers();
    try {
      const { service, source } = createService({ coalesceMs: 25 });
      source.agents = [agent({ id: "running", lifecycle: "running" })];
      const listener = vi.fn();
      service.subscribe(listener);

      source.emit({ type: "agent_state", agent: source.agents[0]! });
      source.emit({
        type: "agent_stream",
        agentId: "running",
        seq: 1,
        epoch: 1,
        event: { type: "text_delta", text: "hello", provider: "codex" },
      });
      await vi.advanceTimersByTimeAsync(25);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0].activity.runningAgents[0]?.agentId).toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });
});
