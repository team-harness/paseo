import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";

import { StoredTeamSchema, type StoredTeam } from "@getpaseo/protocol/team/types";
import { writeJsonFileAtomic } from "../atomic-file.js";

export type TeamUpdater = (team: StoredTeam) => StoredTeam | Promise<StoredTeam>;

/**
 * Everything the caller supplies; the store owns revision and timestamps.
 *
 * The id is optional and generated when absent. A caller that has to name
 * resources after the team — the chat room does — allocates it up front so the
 * whole creation plan can be written in one go and replayed from it later.
 */
export type NewTeam = Omit<StoredTeam, "id" | "revision" | "createdAt" | "updatedAt"> & {
  id?: string;
};

function generateTeamId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * One JSON file per team, written atomically and serialized per id.
 *
 * Unlike the schedule store this one tolerates a damaged file: teams are
 * independent, and refusing to load any of them because one is unreadable would
 * strand every other team's reconciliation. A bad file is logged and skipped.
 */
export class TeamStore {
  private readonly dir: string;
  private readonly logger: Logger;
  private readonly mutations = new Map<string, Promise<unknown>>();
  private idempotencyIndex = new Map<string, string>();
  /**
   * Members of teams that are still being created, by agent id.
   *
   * Synchronous on purpose: the deletion guard has to refuse before the delete
   * happens, and hard delete leaves no tombstone to correct the decision with
   * afterwards.
   */
  private creatingMembers = new Map<string, { teamId: string; teamName: string }>();
  private indexLoaded = false;

  constructor(dir: string, logger: Logger) {
    this.dir = dir;
    this.logger = logger.child({ module: "team", component: "team-store" });
  }

  async initialize(): Promise<void> {
    await this.rebuildIdempotencyIndex();
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<StoredTeam[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir);
    const teams: StoredTeam[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const team = await this.readFile(join(this.dir, entry));
      if (team) {
        teams.push(team);
      }
    }
    return teams.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async readFile(filePath: string): Promise<StoredTeam | null> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      this.logger.warn({ err: error, filePath }, "failed to read team file");
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.logger.warn({ err: error, filePath }, "skipping unparseable team file");
      return null;
    }

    const result = StoredTeamSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn({ filePath, issues: result.error.issues }, "skipping invalid team file");
      return null;
    }
    return result.data;
  }

  async get(id: string): Promise<StoredTeam | null> {
    await this.ensureDir();
    return this.readFile(this.filePath(id));
  }

  private async rebuildIdempotencyIndex(): Promise<void> {
    const teams = await this.list();
    this.idempotencyIndex = new Map(teams.map((team) => [team.idempotencyKey, team.id]));
    this.creatingMembers = new Map();
    for (const team of teams) {
      this.indexCreatingMembers(team);
    }
    this.indexLoaded = true;
  }

  /**
   * Rewrites this team's contribution to the creating-member index.
   *
   * Dropping the team's old entries first is what makes a member that left, or
   * a team that finished, actually disappear — merging would only ever add.
   */
  private indexCreatingMembers(team: StoredTeam): void {
    for (const [agentId, entry] of this.creatingMembers) {
      if (entry.teamId === team.id) this.creatingMembers.delete(agentId);
    }
    if (team.lifecycle !== "creating") return;
    for (const member of team.members) {
      this.creatingMembers.set(member.agentId, { teamId: team.id, teamName: team.name });
    }
  }

  /** The name of the team this agent is mid-creation for, or null. */
  creatingTeamNameOf(agentId: string): string | null {
    return this.creatingMembers.get(agentId)?.teamName ?? null;
  }

  /**
   * Resolves a create request that may be a retry. The index is rebuilt from
   * disk on first use so a restart cannot turn a retry into a second team.
   */
  async findByIdempotencyKey(key: string): Promise<StoredTeam | null> {
    if (!this.indexLoaded) {
      await this.rebuildIdempotencyIndex();
    }
    const id = this.idempotencyIndex.get(key);
    return id ? this.get(id) : null;
  }

  async create(team: NewTeam): Promise<StoredTeam> {
    const now = new Date().toISOString();
    const created: StoredTeam = {
      ...team,
      id: team.id ?? generateTeamId(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.write(created);
    this.idempotencyIndex.set(created.idempotencyKey, created.id);
    this.indexCreatingMembers(created);
    return created;
  }

  /**
   * Resolves a create request that may be a retry, holding the key for the whole
   * decision. Looking the key up and then creating leaves a window where two
   * concurrent retries both find nothing and both create — and the index, being
   * one entry per key, would then hide the duplicate rather than reveal it.
   */
  async createIfAbsent(
    idempotencyKey: string,
    build: () => Omit<NewTeam, "idempotencyKey">,
  ): Promise<StoredTeam> {
    return this.serialize(`key:${idempotencyKey}`, async () => {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return existing;
      }
      // The key is supplied here rather than by the builder: locking one key and
      // writing another would index the team under a key nobody is holding, and
      // the next call for this one would build a second team.
      return this.create({ ...build(), idempotencyKey });
    });
  }

  /**
   * Read-modify-write inside the per-team lock, so a caller never bases an
   * update on a snapshot another update has already replaced. The revision is
   * the store's to bump; an updater cannot change the id.
   */
  async update(id: string, updater: TeamUpdater): Promise<StoredTeam | null> {
    return this.serialize(id, async () => {
      const current = await this.get(id);
      if (!current) return null;

      const next = await updater(current);
      if (next.id !== current.id) {
        throw new Error(`TeamStore.update must not change the team id (${current.id})`);
      }
      // The key identifies the create request this team came from; rewriting it
      // would leave the old index entry pointing here and let the original
      // request build a second team.
      if (next.idempotencyKey !== current.idempotencyKey) {
        throw new Error(`TeamStore.update must not change the idempotency key (${current.id})`);
      }
      const stamped: StoredTeam = {
        ...next,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.write(stamped);
      this.idempotencyIndex.set(stamped.idempotencyKey, stamped.id);
      this.indexCreatingMembers(stamped);
      return stamped;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serialize(id, async () => {
      const current = await this.get(id);
      await rm(this.filePath(id), { force: true });
      if (current) {
        this.idempotencyIndex.delete(current.idempotencyKey);
        this.indexCreatingMembers({ ...current, lifecycle: "archived" });
      }
    });
  }

  private async write(team: StoredTeam): Promise<void> {
    await this.ensureDir();
    await writeJsonFileAtomic(this.filePath(team.id), team);
  }

  private serialize<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.mutations.set(id, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.mutations.get(id) === next) {
          this.mutations.delete(id);
        }
      });
    return next;
  }
}
