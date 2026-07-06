import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { AgentProvider, AgentUsage } from "../agent/agent-sdk-types.js";

export interface UsageTotalsDelta {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}

export interface UsageLedgerRecord {
  id: string;
  agentId: string;
  provider: AgentProvider;
  basisScope: "turn";
  usageTurnKey: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  cwd: string;
  model?: string | null;
  turnId?: string | null;
  sourceEventType: "usage_updated" | "turn_completed";
  timestamp: string;
  basisKey: string;
  usage: AgentUsage;
  contribution: UsageTotalsDelta;
}

export interface UsageSnapshotBasis {
  basisKey: string;
  basisScope: "turn";
  usageTurnKey: string;
  agentId: string;
  provider: AgentProvider;
  sessionId?: string | null;
  turnId?: string | null;
  lastSnapshot: AgentUsage;
  updatedAt: string;
}

export interface UsageLedgerEventInput {
  agentId: string;
  provider: AgentProvider;
  usageTurnKey: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  cwd: string;
  model?: string | null;
  turnId?: string | null;
  sourceEventType: "usage_updated" | "turn_completed";
  usage: AgentUsage;
  observedAt: Date;
}

export interface UsageLedgerQuery {
  from?: string;
  to?: string;
  provider?: AgentProvider;
  workspaceId?: string;
  agentId?: string;
}

export interface UsageLedger {
  initialize(): Promise<void>;
  enqueueEvent(input: UsageLedgerEventInput): void;
  getTotals(query?: UsageLedgerQuery): Promise<UsageTotalsDelta>;
  getTodayTotals(
    now?: Date,
    query?: Omit<UsageLedgerQuery, "from" | "to">,
  ): Promise<UsageTotalsDelta>;
  flush(): Promise<void>;
  deleteAgentUsage(agentId: string): Promise<void>;
}

interface UsageLedgerStorePayload {
  version: 1;
  records: UsageLedgerRecord[];
  snapshotBases: UsageSnapshotBasis[];
}

const UsageNumberSchema = z.number().finite().nonnegative();
const AgentUsageSchema = z.object({
  inputTokens: UsageNumberSchema.optional(),
  cachedInputTokens: UsageNumberSchema.optional(),
  outputTokens: UsageNumberSchema.optional(),
  totalCostUsd: UsageNumberSchema.optional(),
  contextWindowMaxTokens: UsageNumberSchema.optional(),
  contextWindowUsedTokens: UsageNumberSchema.optional(),
});

const UsageTotalsDeltaSchema = z.object({
  inputTokens: UsageNumberSchema.optional(),
  cachedInputTokens: UsageNumberSchema.optional(),
  outputTokens: UsageNumberSchema.optional(),
  totalCostUsd: UsageNumberSchema.optional(),
});

const UsageLedgerRecordSchema: z.ZodType<UsageLedgerRecord> = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  provider: z.string().min(1),
  basisScope: z.literal("turn"),
  usageTurnKey: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  cwd: z.string().min(1),
  model: z.string().nullable().optional(),
  turnId: z.string().nullable().optional(),
  sourceEventType: z.enum(["usage_updated", "turn_completed"]),
  timestamp: z.string().datetime(),
  basisKey: z.string().min(1),
  usage: AgentUsageSchema,
  contribution: UsageTotalsDeltaSchema,
});

const UsageSnapshotBasisSchema: z.ZodType<UsageSnapshotBasis> = z.object({
  basisKey: z.string().min(1),
  basisScope: z.literal("turn"),
  usageTurnKey: z.string().min(1),
  agentId: z.string().min(1),
  provider: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  turnId: z.string().nullable().optional(),
  lastSnapshot: AgentUsageSchema,
  updatedAt: z.string().datetime(),
});

const UsageLedgerStorePayloadSchema: z.ZodType<UsageLedgerStorePayload> = z.object({
  version: z.literal(1),
  records: z.array(UsageLedgerRecordSchema),
  snapshotBases: z.array(UsageSnapshotBasisSchema),
});

const CONTRIBUTION_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "totalCostUsd",
] as const;

export class FileBackedUsageLedger implements UsageLedger {
  private readonly dir: string;
  private readonly logger: Logger;
  private readonly recordsByAgent = new Map<string, UsageLedgerRecord[]>();
  private readonly basesByKey = new Map<string, UsageSnapshotBasis>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: { paseoHome: string; logger: Logger }) {
    this.dir = path.join(options.paseoHome, "usage-ledger");
    this.logger = options.logger.child({ module: "usage-ledger" });
  }

  async initialize(): Promise<void> {
    this.recordsByAgent.clear();
    this.basesByKey.clear();

    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      await this.loadAgentFile(path.join(this.dir, entry));
    }
  }

  enqueueEvent(input: UsageLedgerEventInput): void {
    void this.enqueueOperation(async () => {
      await this.processEvent(input);
    }).catch((error) => {
      this.logger.error(
        { err: error, agentId: input.agentId, provider: input.provider },
        "Failed to record usage ledger event",
      );
    });
  }

  async getTotals(query: UsageLedgerQuery = {}): Promise<UsageTotalsDelta> {
    await this.flush();
    const totals: UsageTotalsDelta = {};
    for (const records of this.recordsByAgent.values()) {
      for (const record of records) {
        if (!recordMatchesQuery(record, query)) {
          continue;
        }
        addContribution(totals, record.contribution);
      }
    }
    return totals;
  }

  async getTodayTotals(
    now: Date = new Date(),
    query: Omit<UsageLedgerQuery, "from" | "to"> = {},
  ): Promise<UsageTotalsDelta> {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.getTotals({
      ...query,
      from: start.toISOString(),
      to: now.toISOString(),
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async deleteAgentUsage(agentId: string): Promise<void> {
    await this.enqueueOperation(async () => {
      this.recordsByAgent.delete(agentId);
      for (const [basisKey, basis] of this.basesByKey) {
        if (basis.agentId === agentId) {
          this.basesByKey.delete(basisKey);
        }
      }
      await fs.rm(this.filePath(agentId), { force: true });
    });
  }

  private async loadAgentFile(filePath: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      this.logger.error({ err: error, filePath }, "Failed to read usage ledger file");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      this.logger.error({ err: error, filePath }, "Failed to parse usage ledger file");
      return;
    }

    const parsed = UsageLedgerStorePayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.logger.error(
        { err: parsed.error, filePath },
        "Usage ledger file failed schema validation",
      );
      return;
    }

    for (const record of parsed.data.records) {
      const records = this.recordsByAgent.get(record.agentId) ?? [];
      records.push(record);
      this.recordsByAgent.set(record.agentId, records);
    }
    for (const basis of parsed.data.snapshotBases) {
      this.basesByKey.set(basis.basisKey, basis);
    }
  }

  private async processEvent(input: UsageLedgerEventInput): Promise<void> {
    const parsedUsage = AgentUsageSchema.safeParse(input.usage);
    if (!parsedUsage.success) {
      this.logger.warn(
        { err: parsedUsage.error, agentId: input.agentId, provider: input.provider },
        "Dropping invalid usage ledger event",
      );
      return;
    }

    const basisKey = buildBasisKey(input);
    const previousBasis = this.basesByKey.get(basisKey);
    const contribution = computeContribution(previousBasis?.lastSnapshot, parsedUsage.data);
    if (contribution.kind === "stale") {
      this.logger.warn(
        { agentId: input.agentId, provider: input.provider, basisKey },
        "Dropping stale usage ledger snapshot",
      );
      return;
    }

    if (contribution.kind === "empty") {
      return;
    }

    const timestamp = input.observedAt.toISOString();
    const nextBasis: UsageSnapshotBasis = {
      basisKey,
      basisScope: "turn",
      usageTurnKey: input.usageTurnKey,
      agentId: input.agentId,
      provider: input.provider,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      lastSnapshot: contribution.nextSnapshot,
      updatedAt: timestamp,
    };
    const record: UsageLedgerRecord = {
      id: buildRecordId(basisKey, contribution.nextSnapshot),
      agentId: input.agentId,
      provider: input.provider,
      basisScope: "turn",
      usageTurnKey: input.usageTurnKey,
      sessionId: input.sessionId ?? null,
      workspaceId: input.workspaceId ?? null,
      cwd: input.cwd,
      model: input.model ?? null,
      turnId: input.turnId ?? null,
      sourceEventType: input.sourceEventType,
      timestamp,
      basisKey,
      usage: parsedUsage.data,
      contribution: contribution.delta,
    };

    const records = this.recordsByAgent.get(input.agentId) ?? [];
    if (records.some((existing) => existing.id === record.id)) {
      this.basesByKey.set(basisKey, nextBasis);
      return;
    }

    records.push(record);
    this.recordsByAgent.set(input.agentId, records);
    this.basesByKey.set(basisKey, nextBasis);
    await this.persistAgent(input.agentId);
  }

  private async persistAgent(agentId: string): Promise<void> {
    const records = this.recordsByAgent.get(agentId) ?? [];
    const snapshotBases = Array.from(this.basesByKey.values()).filter(
      (basis) => basis.agentId === agentId,
    );
    const payload: UsageLedgerStorePayload = {
      version: 1,
      records,
      snapshotBases,
    };
    await writeJsonFileAtomic(this.filePath(agentId), payload);
  }

  private filePath(agentId: string): string {
    return path.join(this.dir, `${agentId}.json`);
  }

  private enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function buildBasisKey(input: UsageLedgerEventInput): string {
  return `${input.agentId}:${input.provider}:${input.usageTurnKey}`;
}

function buildRecordId(basisKey: string, snapshot: AgentUsage): string {
  const hash = createHash("sha256");
  hash.update(basisKey);
  hash.update("\0");
  hash.update(JSON.stringify(canonicalContributionSnapshot(snapshot)));
  return hash.digest("hex");
}

function computeContribution(
  previousSnapshot: AgentUsage | undefined,
  nextUsage: AgentUsage,
):
  | { kind: "record"; delta: UsageTotalsDelta; nextSnapshot: AgentUsage }
  | { kind: "empty" }
  | { kind: "stale" } {
  const nextSnapshot = mergeContributionSnapshot(previousSnapshot, nextUsage);
  const delta: UsageTotalsDelta = {};
  for (const field of CONTRIBUTION_FIELDS) {
    const nextValue = finiteNumber(nextUsage[field]);
    if (nextValue === undefined) {
      continue;
    }
    const previousValue = finiteNumber(previousSnapshot?.[field]);
    if (previousValue === undefined) {
      delta[field] = nextValue;
      continue;
    }
    const difference = nextValue - previousValue;
    if (difference < 0) {
      return { kind: "stale" };
    }
    if (difference > 0) {
      delta[field] = difference;
    }
  }
  if (!hasContribution(delta)) {
    return { kind: "empty" };
  }
  return { kind: "record", delta, nextSnapshot };
}

function mergeContributionSnapshot(
  previousSnapshot: AgentUsage | undefined,
  nextUsage: AgentUsage,
): AgentUsage {
  const merged: AgentUsage = {};
  for (const field of CONTRIBUTION_FIELDS) {
    const previousValue = finiteNumber(previousSnapshot?.[field]);
    const nextValue = finiteNumber(nextUsage[field]);
    if (nextValue !== undefined) {
      merged[field] = nextValue;
    } else if (previousValue !== undefined) {
      merged[field] = previousValue;
    }
  }
  return merged;
}

function canonicalContributionSnapshot(snapshot: AgentUsage): UsageTotalsDelta {
  const canonical: UsageTotalsDelta = {};
  for (const field of CONTRIBUTION_FIELDS) {
    const value = finiteNumber(snapshot[field]);
    if (value !== undefined) {
      canonical[field] = value;
    }
  }
  return canonical;
}

function hasContribution(delta: UsageTotalsDelta): boolean {
  return CONTRIBUTION_FIELDS.some((field) => delta[field] !== undefined);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addContribution(totals: UsageTotalsDelta, delta: UsageTotalsDelta): void {
  for (const field of CONTRIBUTION_FIELDS) {
    const value = delta[field];
    if (value === undefined) {
      continue;
    }
    totals[field] = (totals[field] ?? 0) + value;
  }
}

function recordMatchesQuery(record: UsageLedgerRecord, query: UsageLedgerQuery): boolean {
  if (query.agentId && record.agentId !== query.agentId) {
    return false;
  }
  if (query.provider && record.provider !== query.provider) {
    return false;
  }
  if (query.workspaceId && record.workspaceId !== query.workspaceId) {
    return false;
  }
  const timestamp = Date.parse(record.timestamp);
  if (query.from && timestamp < Date.parse(query.from)) {
    return false;
  }
  if (query.to && timestamp >= Date.parse(query.to)) {
    return false;
  }
  return true;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
