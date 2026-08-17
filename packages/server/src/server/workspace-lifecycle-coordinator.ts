import { normalizePathForIdentity } from "../utils/path.js";

export interface WorkspaceLifecyclePort {
  serialize<T>(workspaceIds: readonly string[], operation: () => Promise<T>): Promise<T>;
  serializeBackingDirectories<T>(
    backingDirectories: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T>;
  prepareForArchive(workspaceId: string): Promise<void>;
}

type WorkspaceArchivePreparation = (workspaceId: string) => Promise<void>;

export class WorkspaceLifecycleCoordinator implements WorkspaceLifecyclePort {
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly archivePreparations = new Set<WorkspaceArchivePreparation>();

  async serialize<T>(workspaceIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    return this.serializeKeys(
      workspaceIds.map((workspaceId) => `workspace:${workspaceId}`),
      operation,
    );
  }

  async serializeBackingDirectories<T>(
    backingDirectories: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.serializeKeys(
      backingDirectories.map(
        (backingDirectory) => `backing:${normalizePathForIdentity(backingDirectory)}`,
      ),
      operation,
    );
  }

  private async serializeKeys<T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> {
    const orderedKeys = [...new Set(keys)].toSorted();
    const acquire = (index: number): Promise<T> => {
      const key = orderedKeys[index];
      if (key === undefined) return operation();
      return this.serializeOne(key, () => acquire(index + 1));
    };
    return acquire(0);
  }

  registerArchivePreparation(preparation: WorkspaceArchivePreparation): () => void {
    this.archivePreparations.add(preparation);
    return () => this.archivePreparations.delete(preparation);
  }

  async prepareForArchive(workspaceId: string): Promise<void> {
    for (const preparation of this.archivePreparations) {
      await preparation(workspaceId);
    }
  }

  private async serializeOne<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(workspaceId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.operations.set(workspaceId, next);
    try {
      return await next;
    } finally {
      if (this.operations.get(workspaceId) === next) this.operations.delete(workspaceId);
    }
  }
}

export const workspaceLifecycleCoordinator = new WorkspaceLifecycleCoordinator();
