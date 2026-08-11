import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

export async function recoverPendingWorkspaceArchives(input: {
  listWorkspaces(): Promise<PersistedWorkspaceRecord[]>;
  archiveWorkspace(workspaceId: string, requestId: string): Promise<unknown>;
}): Promise<void> {
  const pendingWorkspaces = (await input.listWorkspaces())
    .filter((workspace) => workspace.archivedAt === null && workspace.archiveIntent !== null)
    .toSorted((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const failures: unknown[] = [];

  for (const workspace of pendingWorkspaces) {
    const archiveIntent = workspace.archiveIntent;
    if (!archiveIntent) continue;
    try {
      await input.archiveWorkspace(workspace.workspaceId, archiveIntent.requestId);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to recover pending workspace archives");
  }
}
