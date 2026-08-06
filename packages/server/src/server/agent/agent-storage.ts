import { randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";

import { writeJsonFileAtomic } from "../atomic-file.js";
import { AgentFeatureSchema, AgentStatusSchema } from "../messages.js";
import { toStoredAgentRecord } from "./agent-projections.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { AgentOwnerSchema, daemonExecutionKey, type DaemonAgentOwner } from "./agent-owner.js";

const SERIALIZABLE_CONFIG_SCHEMA = z
  .object({
    modeId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    thinkingOptionId: z.string().nullable().optional(),
    featureValues: z.record(z.string(), z.unknown()).nullable().optional(),
    extra: z.record(z.string(), z.any()).nullable().optional(),
    systemPrompt: z.string().nullable().optional(),
    mcpServers: z.record(z.string(), z.any()).nullable().optional(),
  })
  .nullable()
  .optional();

const PERSISTENCE_HANDLE_SCHEMA = z
  .object({
    provider: z.string(),
    sessionId: z.string(),
    nativeHandle: z.any().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .nullable()
  .optional();

/** How many terminal turn facts a record keeps before the oldest roll out. */
export const TURN_OUTCOME_HISTORY_LIMIT = 100;

const TurnOutcomeSchema = z.object({
  turnId: z.string(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  endedAt: z.string(),
});

export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

const ActiveTurnSchema = z.object({
  turnId: z.string(),
  startedAt: z.string(),
  daemonRunId: z.string(),
});

export type ActiveTurn = z.infer<typeof ActiveTurnSchema>;

const STORED_AGENT_SCHEMA = z.object({
  id: z.string(),
  provider: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().optional(),
  lastUserMessageAt: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  lastStatus: AgentStatusSchema.default("closed"),
  lastModeId: z.string().nullable().optional(),
  config: SERIALIZABLE_CONFIG_SCHEMA,
  runtimeInfo: z
    .object({
      provider: z.string(),
      sessionId: z.string().nullable(),
      model: z.string().nullable().optional(),
      thinkingOptionId: z.string().nullable().optional(),
      modeId: z.string().nullable().optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  features: z.array(AgentFeatureSchema).optional(),
  persistence: PERSISTENCE_HANDLE_SCHEMA,
  lastError: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  internal: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
  owner: AgentOwnerSchema.optional(),
  // A bounded, queryable record of how recent turns ended. The team task ledger
  // settles an assignment against the outcome of the exact turn the provider
  // accepted, which it cannot do from `lastStatus` alone.
  turnOutcomes: z.array(TurnOutcomeSchema).optional(),
  // The turn currently in flight, stamped with the daemon run that started it.
  // A turn cannot outlive its daemon, so an entry from an older run is stale and
  // gets dropped on load — otherwise a ledger would wait on it forever.
  activeTurn: ActiveTurnSchema.nullable().optional(),
});

export type SerializableAgentConfig = Pick<
  AgentSessionConfig,
  | "modeId"
  | "model"
  | "thinkingOptionId"
  | "featureValues"
  | "extra"
  | "systemPrompt"
  | "mcpServers"
>;

export type StoredAgentRecord = z.infer<typeof STORED_AGENT_SCHEMA>;
export function parseStoredAgentRecord(value: unknown): StoredAgentRecord {
  return STORED_AGENT_SCHEMA.parse(value);
}

export class AgentStorage {
  private cache: Map<string, StoredAgentRecord> = new Map();
  private pathById: Map<string, string> = new Map();
  private pathsById: Map<string, Set<string>> = new Map();
  private pendingWrites: Map<string, Promise<void>> = new Map();
  private deleting: Set<string> = new Set();
  private daemonAgentIdsByExecution: Map<string, string> = new Map();
  private daemonExecutionKeysByAgentId: Map<string, string> = new Map();
  private loaded = false;
  private baseDir: string;
  private loadPromise: Promise<StoredAgentRecord[]> | null = null;
  private logger: Logger;
  /** Identifies this daemon run so stale active turns can be told apart. */
  readonly runId: string;

  constructor(baseDir: string, logger: Logger, options?: { runId?: string }) {
    this.baseDir = baseDir;
    this.logger = logger.child({ module: "agent", component: "agent-storage" });
    this.runId = options?.runId ?? randomUUID();
  }

  async initialize(): Promise<void> {
    await this.load();
    await this.clearStaleActiveTurns();
  }

  /**
   * A turn belongs to the daemon run that started it: the provider process dies
   * with the daemon, so a turn from an earlier run can never reach a terminal
   * event. Leaving it in place would make a ledger wait on it forever.
   */
  private async clearStaleActiveTurns(): Promise<void> {
    const stale = Array.from(this.cache.values()).filter(
      (record) => record.activeTurn && record.activeTurn.daemonRunId !== this.runId,
    );
    for (const record of stale) {
      await this.upsert({ ...record, activeTurn: null });
      this.logger.debug(
        { agentId: record.id, turnId: record.activeTurn?.turnId },
        "cleared active turn from a previous daemon run",
      );
    }
  }

  /** Returns whether the marker actually reached the record. */
  async setActiveTurn(
    agentId: string,
    turn: { turnId: string; startedAt: string } | null,
  ): Promise<boolean> {
    await this.load();
    let written = false;
    await this.queueRecordMutation(agentId, (current) => {
      if (!current) return null;
      written = true;
      return { ...current, activeTurn: turn ? { ...turn, daemonRunId: this.runId } : null };
    });
    return written;
  }

  /**
   * Appends a terminal turn fact and clears the active turn in one write, so a
   * reader never sees a turn that is both finished and still in flight.
   */
  /** Returns whether the outcome actually reached the record. */
  async recordTurnOutcome(agentId: string, outcome: TurnOutcome): Promise<boolean> {
    await this.load();
    let written = false;
    await this.queueRecordMutation(agentId, (current) => {
      if (!current) return null;
      written = true;
      const history = [
        ...(current.turnOutcomes ?? []).filter((entry) => entry.turnId !== outcome.turnId),
        outcome,
      ];
      return {
        ...current,
        turnOutcomes: history.slice(-TURN_OUTCOME_HISTORY_LIMIT),
        activeTurn:
          current.activeTurn?.turnId === outcome.turnId ? null : (current.activeTurn ?? null),
      };
    });
    return written;
  }

  async getTurnOutcome(agentId: string, turnId: string): Promise<TurnOutcome | null> {
    await this.load();
    const record = await this.get(agentId);
    return record?.turnOutcomes?.find((entry) => entry.turnId === turnId) ?? null;
  }

  async list(): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values());
  }

  async get(agentId: string): Promise<StoredAgentRecord | null> {
    await this.load();
    return this.cache.get(agentId) ?? null;
  }

  async findByDaemonExecution(owner: DaemonAgentOwner): Promise<StoredAgentRecord | null> {
    await this.load();
    const agentId = this.daemonAgentIdsByExecution.get(daemonExecutionKey(owner));
    return agentId ? (this.cache.get(agentId) ?? null) : null;
  }

  async upsert(record: StoredAgentRecord): Promise<void> {
    await this.load();
    await this.queueRecordWrite(record);
  }

  /**
   * Updates a record from its current state, inside the write queue.
   *
   * Prefer this over `get` + spread + `upsert`: that shape reads outside the
   * queue, so a write that lands in between is carried away by the stale copy
   * the caller already holds. Fields the caller does not mention keep whatever
   * the record has when the queue reaches it.
   *
   * Returns the written record, or null if the agent is gone.
   */
  async mutate<T extends StoredAgentRecord>(
    agentId: string,
    mutate: (current: StoredAgentRecord) => T,
  ): Promise<T | null> {
    await this.load();
    let written: T | null = null;
    await this.queueRecordMutation(agentId, (current) => {
      if (!current) return null;
      written = mutate(current);
      return written;
    });
    return written;
  }

  private queueRecordWrite(record: StoredAgentRecord): Promise<void> {
    return this.queueRecordMutation(record.id, () => record);
  }

  /**
   * Runs a read-modify-write inside the per-agent write queue, against the
   * record as it stands when the queue reaches it.
   *
   * Reading outside the queue is not safe: two turns settling back to back both
   * read the record before either write lands, and the second one writes its
   * stale copy over the first one's result. Carrying fields forward cannot fix
   * that, because a stale explicit value is indistinguishable from an intended
   * one.
   */
  private queueRecordMutation(
    agentId: string,
    mutate: (current: StoredAgentRecord | null) => StoredAgentRecord | null,
  ): Promise<void> {
    const prev = this.pendingWrites.get(agentId) ?? Promise.resolve();
    const next = prev.then(async () => {
      if (this.deleting.has(agentId)) {
        return undefined;
      }

      const record = mutate(this.cache.get(agentId) ?? null);
      if (record) {
        await this.writeRecord(this.carryForwardRecordOnlyFields(record));
      }
      return undefined;
    });

    const tracked = next.finally(() => {
      if (this.pendingWrites.get(agentId) === tracked) {
        this.pendingWrites.delete(agentId);
      }
    });

    this.pendingWrites.set(agentId, tracked);
    return tracked;
  }

  /**
   * Some fields live only on the record — a ManagedAgent snapshot knows nothing
   * about them, so projecting one would drop them. Resolved here, once the write
   * queue has reached this record and the cache is current, rather than at each
   * call site: a caller that reads before an earlier queued write lands would
   * otherwise carry a stale value forward and undo it.
   *
   * `undefined` means "not specified, keep what is there"; `null` means "clear
   * it" and is passed through. Archive status is here for the same reason: a
   * ManagedAgent snapshot has no idea whether the agent is archived, so a plain
   * projection would un-archive it on the next ordinary persist.
   */
  private carryForwardRecordOnlyFields(record: StoredAgentRecord): StoredAgentRecord {
    const current = this.cache.get(record.id);
    if (!current) return record;
    const merged = { ...record };
    if (merged.turnOutcomes === undefined && current.turnOutcomes !== undefined) {
      merged.turnOutcomes = current.turnOutcomes;
    }
    if (merged.activeTurn === undefined && current.activeTurn !== undefined) {
      merged.activeTurn = current.activeTurn;
    }
    if (merged.archivedAt === undefined && current.archivedAt !== undefined) {
      merged.archivedAt = current.archivedAt;
    }
    return merged;
  }

  private async writeRecord(record: StoredAgentRecord): Promise<void> {
    const agentId = record.id;
    const nextPath = this.buildRecordPath(record);
    const previousPath = this.pathById.get(agentId);

    await writeJsonFileAtomic(nextPath, record);
    this.addIndexedPath(agentId, nextPath);

    if (previousPath && previousPath !== nextPath) {
      try {
        await fs.unlink(previousPath);
      } catch {
        // ignore cleanup errors
      }
      this.removeIndexedPath(agentId, previousPath);
    }

    this.cache.set(agentId, record);
    this.indexOwner(record);
    this.pathById.set(agentId, nextPath);
  }

  beginDelete(agentId: string): void {
    this.deleting.add(agentId);
  }

  async remove(agentId: string): Promise<void> {
    await this.load();
    this.beginDelete(agentId);
    await (this.pendingWrites.get(agentId) ?? Promise.resolve());
    const paths = Array.from(this.pathsById.get(agentId) ?? []);
    await Promise.all(
      paths.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code && code !== "ENOENT") {
            this.logger.warn(
              { err: error, agentId, filePath },
              "Failed to remove agent record file",
            );
          }
        }
      }),
    );

    this.cache.delete(agentId);
    this.removeOwnerIndex(agentId);
    this.pathById.delete(agentId);
    this.pathsById.delete(agentId);
  }

  async applySnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    await this.load();
    await this.waitForPendingWrite(agent.id);
    const existing = (await this.get(agent.id)) ?? null;
    const hasTitleOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "title");
    const hasInternalOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "internal");
    const record = toStoredAgentRecord(agent, {
      title: hasTitleOverride ? (options?.title ?? null) : (existing?.title ?? null),
      createdAt: existing?.createdAt,
      internal: hasInternalOverride ? options?.internal : (agent.internal ?? existing?.internal),
    });

    // Archive status, turn history and active-turn identity are carried forward
    // inside the write queue (see carryForwardRecordOnlyFields), where the cache
    // is current — reading them here would race an in-flight write.
    await this.upsert(record);
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    const written = await this.mutate(agentId, (current) => ({ ...current, title }));
    if (!written) {
      throw new Error(`Agent ${agentId} not found`);
    }
  }

  async flush(): Promise<void> {
    await this.load().catch(() => undefined);
    const writes = Array.from(this.pendingWrites.values());
    await Promise.allSettled(writes);
  }

  private async load(): Promise<StoredAgentRecord[]> {
    if (this.loaded) {
      return Array.from(this.cache.values());
    }

    if (!this.loadPromise) {
      this.loadPromise = this.doLoad();
    }

    return this.loadPromise;
  }

  private async doLoad(): Promise<StoredAgentRecord[]> {
    this.cache.clear();
    this.pathById.clear();
    this.pathsById.clear();
    this.daemonAgentIdsByExecution.clear();
    this.daemonExecutionKeysByAgentId.clear();

    try {
      const records = await this.scanDisk();
      this.loaded = true;
      return records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.loaded = true;
        return [];
      }
      this.logger.error({ err: error }, "Failed to load agents");
      this.loaded = true;
      return [];
    }
  }

  private async scanDisk(): Promise<StoredAgentRecord[]> {
    const records: StoredAgentRecord[] = [];
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const rootRecordPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.baseDir, entry.name));

    const projectDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.baseDir, entry.name));

    const projectFileLists = await Promise.all(
      projectDirs.map(async (projectDir) => {
        try {
          const files = await fs.readdir(projectDir, { withFileTypes: true });
          return files
            .filter((file) => file.isFile() && file.name.endsWith(".json"))
            .map((file) => path.join(projectDir, file.name));
        } catch {
          return [];
        }
      }),
    );

    const allFilePaths = [...rootRecordPaths, ...projectFileLists.flat()];
    const loaded = await Promise.all(
      allFilePaths.map(async (filePath) => {
        const record = await this.readRecordFile(filePath);
        return record ? { record, filePath } : null;
      }),
    );

    for (const item of loaded) {
      if (!item) continue;
      const { record, filePath } = item;
      records.push(record);
      this.cache.set(record.id, record);
      this.indexOwner(record);
      this.pathById.set(record.id, filePath);
      this.addIndexedPath(record.id, filePath);
    }

    return records;
  }

  private async readRecordFile(filePath: string): Promise<StoredAgentRecord | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      return parseStoredAgentRecord(parsed);
    } catch (error) {
      this.logger.error({ err: error, filePath }, "Skipping invalid agent record");
      return null;
    }
  }

  private buildRecordPath(record: StoredAgentRecord): string {
    const projectDir = projectDirNameFromCwd(record.cwd);
    return path.join(this.baseDir, projectDir, `${record.id}.json`);
  }

  private addIndexedPath(agentId: string, filePath: string): void {
    const paths = this.pathsById.get(agentId) ?? new Set<string>();
    paths.add(filePath);
    this.pathsById.set(agentId, paths);
  }

  private removeIndexedPath(agentId: string, filePath: string): void {
    const paths = this.pathsById.get(agentId);
    if (!paths) {
      return;
    }
    paths.delete(filePath);
    if (paths.size === 0) {
      this.pathsById.delete(agentId);
    }
  }

  private indexOwner(record: StoredAgentRecord): void {
    this.removeOwnerIndex(record.id);
    if (record.owner?.kind === "daemon") {
      const key = daemonExecutionKey(record.owner);
      const previousAgentId = this.daemonAgentIdsByExecution.get(key);
      if (previousAgentId && previousAgentId !== record.id) {
        this.daemonExecutionKeysByAgentId.delete(previousAgentId);
      }
      this.daemonAgentIdsByExecution.set(key, record.id);
      this.daemonExecutionKeysByAgentId.set(record.id, key);
    }
  }

  private removeOwnerIndex(agentId: string): void {
    const key = this.daemonExecutionKeysByAgentId.get(agentId);
    if (!key) return;
    if (this.daemonAgentIdsByExecution.get(key) === agentId) {
      this.daemonAgentIdsByExecution.delete(key);
    }
    this.daemonExecutionKeysByAgentId.delete(agentId);
  }

  private async waitForPendingWrite(agentId: string): Promise<void> {
    await (this.pendingWrites.get(agentId) ?? Promise.resolve()).catch(() => undefined);
  }
}

function projectDirNameFromCwd(cwd: string): string {
  // path.win32.parse handles drive letters, UNC roots, and Unix roots on all platforms
  const { root } = path.win32.parse(cwd);
  const withoutRoot = cwd.slice(root.length).replace(/[\\/]+$/, "");
  // Sanitize root: strip colons and separators, keep letters (e.g. "C:\" → "C", "\\server\share\" → "server-share")
  const sanitizedRoot = root.replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
  const prefix = sanitizedRoot ? sanitizedRoot + "-" : "";
  if (!withoutRoot) {
    return sanitizedRoot || "root";
  }
  return prefix + withoutRoot.replace(/[\\/]+/g, "-");
}
