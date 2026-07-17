import type {
  HostStatusSummaryPayload,
  StatusAgentSnapshot,
  StatusPinnedSession,
  StatusSummaryUsageTotals,
} from "@getpaseo/protocol/messages";
import { deriveAgentStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type { Logger } from "pino";
import type { UsageLedger, UsageTotalsDelta } from "../usage-ledger/index.js";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { SessionPinStore, SetSessionPinnedInput } from "./session-pin-store.js";

const RECENTLY_COMPLETED_WINDOW_MS = 15 * 60 * 1000;

export interface StatusSummaryAgentSource {
  listAgents(): ManagedAgent[];
  subscribe(
    callback: (event: AgentManagerEvent) => void,
    options?: { replayState?: boolean },
  ): () => void;
}

export interface StatusSummaryServiceOptions {
  usageLedger: UsageLedger;
  agentSource: StatusSummaryAgentSource;
  sessionPinStore?: Pick<SessionPinStore, "list" | "setPinned">;
  logger: Logger;
  clock?: () => Date;
  coalesceMs?: number;
}

export type StatusSummaryListener = (summary: HostStatusSummaryPayload) => void;

export class StatusSummaryService {
  private readonly usageLedger: UsageLedger;
  private readonly agentSource: StatusSummaryAgentSource;
  private readonly sessionPinStore?: Pick<SessionPinStore, "list" | "setPinned">;
  private readonly logger: Logger;
  private readonly clock: () => Date;
  private readonly coalesceMs: number;
  private readonly listeners = new Set<StatusSummaryListener>();
  private readonly unsubscribeAgentEvents: () => void;
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(options: StatusSummaryServiceOptions) {
    this.usageLedger = options.usageLedger;
    this.agentSource = options.agentSource;
    this.sessionPinStore = options.sessionPinStore;
    this.logger = options.logger;
    this.clock = options.clock ?? (() => new Date());
    this.coalesceMs = options.coalesceMs ?? 250;
    this.unsubscribeAgentEvents = this.agentSource.subscribe(
      (event) => {
        if (event.type === "agent_state" || event.type === "agent_stream") {
          this.notifyMayHaveChanged(event.type);
        }
      },
      { replayState: false },
    );
  }

  async getSummary(): Promise<HostStatusSummaryPayload> {
    const now = this.clock();
    const [lifetime, today, pinnedSessions] = await Promise.all([
      this.readLedgerTotals("lifetime", () => this.usageLedger.getTotals()),
      this.readLedgerTotals("today", () => this.usageLedger.getTodayTotals(now)),
      this.readPinnedSessions(),
    ]);
    return {
      generatedAt: now.toISOString(),
      usage: {
        lifetime: normalizeTotals(lifetime),
        today: {
          ...normalizeTotals(today),
          windowStart: getLocalDayStart(now).toISOString(),
          windowEnd: now.toISOString(),
        },
        byProvider: [],
        byModel: [],
      },
      activity: buildActivity(this.agentSource.listAgents(), now),
      pinnedSessions,
    };
  }

  async setSessionPin(input: SetSessionPinnedInput): Promise<StatusPinnedSession[]> {
    if (!this.sessionPinStore) {
      throw new Error("Status summary session pin store is not configured");
    }
    const pinnedSessions = await this.sessionPinStore.setPinned(input);
    await this.emitUpdated("session_pin_changed");
    return pinnedSessions;
  }

  subscribe(listener: StatusSummaryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyMayHaveChanged(reason: string): void {
    if (this.disposed || this.listeners.size === 0 || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.emitUpdated(reason);
    }, this.coalesceMs);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
    this.unsubscribeAgentEvents();
  }

  private async emitUpdated(reason: string): Promise<void> {
    try {
      const summary = await this.getSummary();
      for (const listener of this.listeners) {
        try {
          listener(summary);
        } catch (error) {
          this.logger.warn({ err: error, reason }, "Failed to emit status summary update");
        }
      }
    } catch (error) {
      this.logger.warn({ err: error, reason }, "Failed to build status summary update");
    }
  }

  private async readLedgerTotals(
    scope: string,
    read: () => Promise<UsageTotalsDelta>,
  ): Promise<UsageTotalsDelta> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn({ err: error, scope }, "Failed to read status summary usage totals");
      return {};
    }
  }

  private async readPinnedSessions(): Promise<StatusPinnedSession[]> {
    if (!this.sessionPinStore) {
      return [];
    }
    try {
      return await this.sessionPinStore.list();
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to read status summary session pins");
      return [];
    }
  }
}

function normalizeTotals(totals: UsageTotalsDelta): StatusSummaryUsageTotals {
  const normalized: StatusSummaryUsageTotals = {
    totalTokens:
      (totals.inputTokens ?? 0) + (totals.cachedInputTokens ?? 0) + (totals.outputTokens ?? 0),
  };
  if (totals.inputTokens !== undefined) normalized.inputTokens = totals.inputTokens;
  if (totals.cachedInputTokens !== undefined) {
    normalized.cachedInputTokens = totals.cachedInputTokens;
  }
  if (totals.outputTokens !== undefined) normalized.outputTokens = totals.outputTokens;
  if (totals.totalCostUsd !== undefined) normalized.totalCostUsd = totals.totalCostUsd;
  return normalized;
}

function getLocalDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function buildActivity(agents: ManagedAgent[], now: Date): HostStatusSummaryPayload["activity"] {
  const runningAgents: StatusAgentSnapshot[] = [];
  const needsAttentionAgents: StatusAgentSnapshot[] = [];
  const recentlyCompletedAgents: StatusAgentSnapshot[] = [];
  const counts = {
    running: 0,
    needsAttention: 0,
    idle: 0,
    error: 0,
  };

  for (const agent of agents) {
    if (agent.lifecycle === "closed") {
      continue;
    }
    const snapshot = toStatusAgentSnapshot(agent);
    if (snapshot.stateBucket === "needs_input" || snapshot.stateBucket === "attention") {
      counts.needsAttention += 1;
      needsAttentionAgents.push(snapshot);
    } else if (snapshot.stateBucket === "failed") {
      counts.error += 1;
    } else if (agent.lifecycle === "initializing" || snapshot.stateBucket === "running") {
      counts.running += 1;
      runningAgents.push(snapshot);
    } else {
      counts.idle += 1;
    }

    if (
      agent.attention.requiresAttention &&
      agent.attention.attentionReason === "finished" &&
      isWithinRecentlyCompletedWindow(agent, now)
    ) {
      recentlyCompletedAgents.push(snapshot);
    }
  }

  return {
    runningAgents,
    needsAttentionAgents,
    recentlyCompletedAgents,
    counts,
  };
}

function toStatusAgentSnapshot(agent: ManagedAgent): StatusAgentSnapshot {
  const pendingPermissionCount = agent.pendingPermissions.size;
  let attentionReason = agent.attention.requiresAttention ? agent.attention.attentionReason : null;
  // Pending permissions are level-triggered and take priority over edge-triggered attention.
  if (pendingPermissionCount > 0) {
    attentionReason = "permission";
  }
  const stateBucket = deriveAgentStateBucket({
    status: agent.lifecycle,
    pendingPermissionCount,
    requiresAttention: agent.attention.requiresAttention,
    attentionReason,
  });
  const snapshot: StatusAgentSnapshot = {
    agentId: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId ?? null,
    title: agent.config.title ?? null,
    status: agent.lifecycle,
    stateBucket,
    updatedAt: agent.updatedAt.toISOString(),
    attentionReason,
    attentionTimestamp:
      agent.attention.requiresAttention && "attentionTimestamp" in agent.attention
        ? agent.attention.attentionTimestamp.toISOString()
        : null,
    parentAgentId: getParentAgentIdFromLabels(agent.labels) ?? null,
  };
  return snapshot;
}

function isWithinRecentlyCompletedWindow(agent: ManagedAgent, now: Date): boolean {
  const timestamp = agent.attention.requiresAttention
    ? agent.attention.attentionTimestamp
    : agent.updatedAt;
  return now.getTime() - timestamp.getTime() <= RECENTLY_COMPLETED_WINDOW_MS;
}
