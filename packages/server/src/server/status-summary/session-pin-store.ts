import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";
import type { StatusPinnedSession } from "@getpaseo/protocol/messages";
import { AGENT_LIFECYCLE_STATUSES } from "@getpaseo/protocol/agent-lifecycle";
import { writeJsonFileAtomic } from "../atomic-file.js";

const PersistedSessionPinSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  status: z.enum(AGENT_LIFECYCLE_STATUSES).nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  pendingPermissionCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string().nullable().optional(),
  pinnedAt: z.string(),
});

const SessionPinsFileSchema = z.object({
  version: z.literal(1),
  pinnedSessions: z.array(PersistedSessionPinSchema),
});

export interface SessionPinStoreOptions {
  filePath: string;
  logger: Logger;
  clock?: () => Date;
}

export interface SetSessionPinnedInput {
  agentId: string;
  pinned: boolean;
  workspaceId?: string | null;
  title?: string | null;
  provider?: string | null;
  cwd?: string | null;
  status?: StatusPinnedSession["status"];
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
  updatedAt?: string | null;
}

export class SessionPinStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly clock: () => Date;
  private pinnedSessions: StatusPinnedSession[] = [];
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: SessionPinStoreOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    this.clock = options.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    this.pinnedSessions = await this.read();
  }

  async list(): Promise<StatusPinnedSession[]> {
    return this.pinnedSessions.map((session) => ({ ...session }));
  }

  async setPinned(input: SetSessionPinnedInput): Promise<StatusPinnedSession[]> {
    return this.enqueueMutation(() => this.setPinnedUnsafe(input));
  }

  private async setPinnedUnsafe(input: SetSessionPinnedInput): Promise<StatusPinnedSession[]> {
    const next = this.pinnedSessions.filter((entry) => entry.agentId !== input.agentId);
    if (input.pinned) {
      const previous = this.pinnedSessions.find((entry) => entry.agentId === input.agentId);
      next.push({
        agentId: input.agentId,
        workspaceId: input.workspaceId ?? null,
        title: input.title ?? null,
        provider: input.provider ?? null,
        cwd: input.cwd ?? null,
        status: input.status ?? null,
        requiresAttention: input.requiresAttention ?? false,
        attentionReason: input.attentionReason ?? null,
        pendingPermissionCount: input.pendingPermissionCount ?? 0,
        updatedAt: input.updatedAt ?? null,
        pinnedAt: previous?.pinnedAt ?? this.clock().toISOString(),
      });
    }
    await this.persist(next);
    this.pinnedSessions = next;
    return this.list();
  }

  private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<StatusPinnedSession[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      this.logger.warn({ err: error }, "Failed to read session pins");
      return [];
    }

    try {
      const parsed = SessionPinsFileSchema.parse(JSON.parse(raw));
      return parsed.pinnedSessions as StatusPinnedSession[];
    } catch (error) {
      this.logger.warn({ err: error }, "Ignoring invalid session pins file");
      return [];
    }
  }

  private async persist(pinnedSessions: StatusPinnedSession[]): Promise<void> {
    await writeJsonFileAtomic(this.filePath, {
      version: 1,
      pinnedSessions,
    });
  }
}

export function createSessionPinStorePath(paseoHome: string): string {
  return path.join(paseoHome, "status-summary", "session-pins.json");
}
