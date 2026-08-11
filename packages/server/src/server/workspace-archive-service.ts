import { resolve } from "node:path";

import type { Logger } from "pino";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { ForgeService } from "../services/forge-service.js";
import {
  deletePaseoWorktree,
  isPaseoOwnedWorktreeCwd,
  runWorktreeTeardownCommands,
  WorktreeTeardownError,
} from "../utils/worktree.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type {
  PersistedWorkspaceRecord,
  WorkspaceArchiveIntent,
  WorkspaceArchiveContext,
  WorkspaceRegistry,
} from "./workspace-registry.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";
import { runWithGitCommandPriority } from "../utils/run-git-command.js";
import {
  type WorkspaceLifecyclePort,
  workspaceLifecycleCoordinator,
} from "./workspace-lifecycle-coordinator.js";

export type ActiveWorkspaceRef = Pick<
  PersistedWorkspaceRecord,
  "workspaceId" | "cwd" | "kind" | "worktreeRoot" | "isPaseoOwnedWorktree" | "mainRepoRoot"
>;

export interface ArchiveDependencies {
  paseoHome?: string;
  // Base directory that may hold worktrees across repositories.
  paseoWorktreesBaseRoot?: string;
  github: ForgeService;
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot">;
  agentManager: Pick<AgentManager, "listAgents" | "getAgent" | "archiveAgent" | "archiveSnapshot">;
  agentStorage: Pick<AgentStorage, "listByWorkspace">;
  // Resolves the worktree at a path to its workspaceId for archive-by-path. The
  // path uniquely identifies a worktree workspace; this is a directory lookup for
  // the archive target, not status/ownership.
  findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
  getWorkspace?: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
  // Active (non-archived) workspaces, used to decide whether the workspace being
  // archived is the last reference to its backing worktree directory, and to
  // break a same-cwd tie in favor of the worktree-kind record when archiving by
  // path (no explicit workspaceId).
  listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
  beginWorkspaceArchive?: (
    workspaceId: string,
    intent: WorkspaceArchiveIntent,
  ) => Promise<PersistedWorkspaceRecord | null>;
  archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
  emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
  markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
  clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
  killTerminalsForWorkspace: (workspaceId: string) => Promise<void>;
  stopWorkspaceSetup?: (workspaceId: string) => Promise<void>;
  workspaceLifecycle?: WorkspaceLifecyclePort;
  sessionLogger?: Logger;
}

export interface KillTerminalsForWorkspaceDependencies {
  detachTerminalStream?: (terminalId: string, options: { emitExit: boolean }) => void;
  sessionLogger: Logger;
  terminalManager: TerminalManager | null;
}

export type ArchiveScope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "worktree"; targetPath: string };

export interface ArchiveResult {
  archivedAgentIds: string[];
  archivedWorkspaceIds: string[];
  removedDirectory: boolean;
}

export interface ArchiveByScopeRequest {
  scope: ArchiveScope;
  requestId: string;
}

export async function requireActiveWorkspaceForArchive(
  dependencies: Pick<ArchiveDependencies, "listActiveWorkspaces">,
  workspaceId: string,
): Promise<ActiveWorkspaceRef> {
  const workspace = (await dependencies.listActiveWorkspaces()).find(
    (candidate) => candidate.workspaceId === workspaceId,
  );
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return workspace;
}

interface BackingDirectory {
  path: string;
  isPaseoOwnedWorktree: boolean;
  mainRepoRoot: string | null;
  paseoWorktreesRoot: string | null;
}

interface ArchiveTarget {
  backing: BackingDirectory | null;
  teardownTargets: Array<{ workspaceId: string | null; cwd: string }>;
  setupWorkspaceIds: string[];
  workspaceIds: string[];
}

export async function resolveWorkspaceIdAtPath(
  dependencies: Pick<ArchiveDependencies, "findWorkspaceIdForCwd" | "listActiveWorkspaces">,
  targetPath: string,
): Promise<string | null> {
  const matchesTarget = createRealpathAwarePathMatcher(targetPath);
  const activeWorkspaces = await dependencies.listActiveWorkspaces();
  const exactMatches = activeWorkspaces.filter((workspace) => matchesTarget(workspace.cwd));
  const worktreeMatch = exactMatches.find((workspace) => workspace.kind === "worktree");
  if (worktreeMatch) {
    return worktreeMatch.workspaceId;
  }
  return dependencies.findWorkspaceIdForCwd(targetPath);
}

// Resolves the in-scope record set, persists an archive fence, tears down owned
// runtime state, removes the backing directory when unreferenced, then finalizes
// the records. The durable fence stays present through physical deletion.
export async function archiveByScope(
  dependencies: ArchiveDependencies,
  request: ArchiveByScopeRequest,
): Promise<ArchiveResult> {
  return runWithGitCommandPriority("high", () => archiveByScopeWithPriority(dependencies, request));
}

async function archiveByScopeWithPriority(
  dependencies: ArchiveDependencies,
  request: ArchiveByScopeRequest,
): Promise<ArchiveResult> {
  const target = await resolveArchiveTarget(dependencies, request.scope);
  const targetWorkspaceIds = target.workspaceIds;

  if (targetWorkspaceIds.length > 0 && !dependencies.beginWorkspaceArchive) {
    throw new Error("Durable workspace archive intent adapter is required");
  }
  const archiveIntent: WorkspaceArchiveIntent = {
    requestId: request.requestId,
    requestedAt: new Date().toISOString(),
  };
  const lifecycle = dependencies.workspaceLifecycle ?? workspaceLifecycleCoordinator;
  await lifecycle.serialize(target.workspaceIds, async () => {
    for (const workspaceId of targetWorkspaceIds.toSorted()) {
      await dependencies.beginWorkspaceArchive!(workspaceId, archiveIntent);
    }
  });

  await stopWorkspaceSetups(dependencies, target.setupWorkspaceIds, request.requestId);

  return lifecycle.serialize(target.workspaceIds, () =>
    lifecycle.serializeBackingDirectories(target.backing ? [target.backing.path] : [], () =>
      archiveResolvedTarget(dependencies, request, target, lifecycle),
    ),
  );
}

async function archiveResolvedTarget(
  dependencies: ArchiveDependencies,
  request: ArchiveByScopeRequest,
  target: ArchiveTarget,
  lifecycle: WorkspaceLifecyclePort,
): Promise<ArchiveResult> {
  const targetWorkspaceIds = target.workspaceIds;

  if (targetWorkspaceIds.length > 0) {
    dependencies.markWorkspaceArchiving(targetWorkspaceIds, new Date().toISOString());
  }

  let removedDirectory = false;

  try {
    if (targetWorkspaceIds.length > 0) {
      await dependencies.emitWorkspaceUpdatesForWorkspaceIds(targetWorkspaceIds);
    }

    for (const workspaceId of targetWorkspaceIds.toSorted()) {
      await lifecycle.prepareForArchive(workspaceId);
    }

    const archivedAgents = await teardownTargetWorkspaceContents(
      dependencies,
      targetWorkspaceIds,
      request.requestId,
    );

    if (target.backing?.mainRepoRoot) {
      try {
        await dependencies.workspaceGitService.getSnapshot(target.backing.mainRepoRoot, {
          force: true,
          reason: "archive-worktree",
        });
      } catch (error) {
        dependencies.sessionLogger?.warn(
          { err: error, cwd: target.backing.mainRepoRoot, requestId: request.requestId },
          "Failed to force-refresh workspace git snapshot after archiving",
        );
      }
    }

    if (target.backing !== null) {
      removedDirectory = await maybeRemoveDirectory(
        dependencies,
        request,
        target,
        targetWorkspaceIds,
      );
    }

    const archivedWorkspaceIds = await finalizeArchivedWorkspaceRecords(
      dependencies,
      targetWorkspaceIds,
      request.requestId,
    );

    return {
      archivedAgentIds: Array.from(archivedAgents),
      archivedWorkspaceIds,
      removedDirectory,
    };
  } finally {
    if (targetWorkspaceIds.length > 0) {
      dependencies.clearWorkspaceArchiving(targetWorkspaceIds);
      await dependencies.emitWorkspaceUpdatesForWorkspaceIds(targetWorkspaceIds);
    }
  }
}

async function resolveArchiveTarget(
  dependencies: ArchiveDependencies,
  scope: ArchiveScope,
): Promise<ArchiveTarget> {
  const activeWorkspaces = await dependencies.listActiveWorkspaces();

  if (scope.kind === "workspace") {
    const workspaceId = scope.workspaceId;
    const record =
      (await dependencies.getWorkspace?.(workspaceId)) ??
      activeWorkspaces.find((workspace) => workspace.workspaceId === workspaceId);
    if (!record) {
      dependencies.sessionLogger?.warn(
        { workspaceId },
        "Workspace not found for archive-by-scope; skipping",
      );
      return { backing: null, teardownTargets: [], setupWorkspaceIds: [], workspaceIds: [] };
    }
    const isArchived = "archivedAt" in record && Boolean(record.archivedAt);
    return {
      backing: await resolveWorkspaceBackingDirectory(record, dependencies),
      teardownTargets: isArchived ? [] : [{ workspaceId, cwd: record.cwd }],
      setupWorkspaceIds: [workspaceId],
      workspaceIds: isArchived ? [] : [workspaceId],
    };
  }

  const backing = await resolveBackingDirectory(scope.targetPath, dependencies);
  const matchesBackingDirectory = createRealpathAwarePathMatcher(backing.path);
  const targetWorkspaces = (
    await Promise.all(
      activeWorkspaces.map(async (workspace) => {
        const backingDirectory = await resolveWorkspaceBackingDirectory(workspace, dependencies);
        return matchesBackingDirectory(backingDirectory.path) ? workspace : null;
      }),
    )
  ).filter((workspace): workspace is ActiveWorkspaceRef => workspace !== null);
  const persistedMainRepoRoot = targetWorkspaces.find(
    (workspace) => workspace.mainRepoRoot,
  )?.mainRepoRoot;
  return {
    backing: {
      ...backing,
      mainRepoRoot: persistedMainRepoRoot ?? backing.mainRepoRoot,
    },
    teardownTargets:
      targetWorkspaces.length > 0
        ? targetWorkspaces.map((workspace) => ({
            workspaceId: workspace.workspaceId,
            cwd: workspace.cwd,
          }))
        : [{ workspaceId: null, cwd: scope.targetPath }],
    setupWorkspaceIds: targetWorkspaces.map((workspace) => workspace.workspaceId),
    workspaceIds: targetWorkspaces.map((workspace) => workspace.workspaceId),
  };
}

async function stopWorkspaceSetups(
  dependencies: ArchiveDependencies,
  workspaceIds: string[],
  requestId: string,
): Promise<void> {
  if (!dependencies.stopWorkspaceSetup) {
    return;
  }
  const results = await Promise.allSettled(
    workspaceIds.map((workspaceId) => dependencies.stopWorkspaceSetup!(workspaceId)),
  );
  for (const [index, result] of results.entries()) {
    if (result?.status === "rejected") {
      dependencies.sessionLogger?.warn(
        { err: result.reason, workspaceId: workspaceIds[index], requestId },
        "Failed to stop workspace setup during archive; continuing",
      );
    }
  }
}

async function resolveWorkspaceBackingDirectory(
  workspace: ActiveWorkspaceRef,
  dependencies: Pick<ArchiveDependencies, "paseoHome" | "paseoWorktreesBaseRoot">,
): Promise<BackingDirectory> {
  if (workspace.isPaseoOwnedWorktree && workspace.worktreeRoot && workspace.mainRepoRoot) {
    return {
      path: resolve(workspace.worktreeRoot),
      isPaseoOwnedWorktree: true,
      mainRepoRoot: workspace.mainRepoRoot,
      paseoWorktreesRoot: null,
    };
  }
  if (workspace.kind !== "worktree") {
    return {
      path: resolve(workspace.cwd),
      isPaseoOwnedWorktree: false,
      mainRepoRoot: workspace.mainRepoRoot ?? null,
      paseoWorktreesRoot: null,
    };
  }

  // COMPAT(archiveMissingWorkspacePlacement): worktree records created before v0.1.110
  // lack durable backing ownership; remove filesystem discovery after 2027-01-17.
  const backing = await resolveBackingDirectory(
    workspace.worktreeRoot ?? workspace.cwd,
    dependencies,
  );
  return { ...backing, mainRepoRoot: workspace.mainRepoRoot ?? backing.mainRepoRoot };
}

async function resolveBackingDirectory(
  cwd: string,
  dependencies: Pick<ArchiveDependencies, "paseoHome" | "paseoWorktreesBaseRoot">,
): Promise<BackingDirectory> {
  const options = {
    paseoHome: dependencies.paseoHome,
    worktreesRoot: dependencies.paseoWorktreesBaseRoot,
  };
  const ownership = await isPaseoOwnedWorktreeCwd(cwd, options);
  return {
    path: resolve(ownership.allowed && ownership.worktreePath ? ownership.worktreePath : cwd),
    isPaseoOwnedWorktree: ownership.allowed,
    mainRepoRoot: ownership.repoRoot ?? null,
    paseoWorktreesRoot: ownership.worktreeRoot ?? null,
  };
}

async function teardownTargetWorkspaceContents(
  dependencies: ArchiveDependencies,
  targetWorkspaceIds: string[],
  requestId: string,
): Promise<Set<string>> {
  const archivedAgents = new Set<string>();
  const failures: unknown[] = [];

  const results = await Promise.allSettled(
    targetWorkspaceIds.map(async (workspaceId) => {
      const agents = await archiveWorkspaceContents(dependencies, workspaceId);
      return { workspaceId, agents };
    }),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      for (const agentId of result.value.agents) {
        archivedAgents.add(agentId);
      }
    } else {
      failures.push(result.reason);
      dependencies.sessionLogger?.warn(
        { err: result.reason, requestId, workspaceId: targetWorkspaceIds[index] },
        "archiveByScope workspace contents teardown failed",
      );
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to archive ${failures.length} workspace record${failures.length === 1 ? "" : "s"}`,
    );
  }

  return archivedAgents;
}

async function finalizeArchivedWorkspaceRecords(
  dependencies: ArchiveDependencies,
  targetWorkspaceIds: string[],
  requestId: string,
): Promise<string[]> {
  const archivedWorkspaceIds: string[] = [];
  const failures: unknown[] = [];
  const results = await Promise.allSettled(
    targetWorkspaceIds.map(async (workspaceId) => {
      await dependencies.archiveWorkspaceRecord(workspaceId);
      return workspaceId;
    }),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      archivedWorkspaceIds.push(result.value);
    } else {
      failures.push(result.reason);
      dependencies.sessionLogger?.warn(
        { err: result.reason, requestId, workspaceId: targetWorkspaceIds[index] },
        "archiveByScope workspace record finalization failed",
      );
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to archive ${failures.length} workspace record${failures.length === 1 ? "" : "s"}`,
    );
  }

  return archivedWorkspaceIds;
}

async function maybeRemoveDirectory(
  dependencies: ArchiveDependencies,
  request: Pick<ArchiveByScopeRequest, "requestId">,
  target: ArchiveTarget,
  targetWorkspaceIds: string[],
): Promise<boolean> {
  const backing = target.backing;
  if (!backing?.isPaseoOwnedWorktree) {
    return false;
  }

  const targetWorkspaceIdSet = new Set(targetWorkspaceIds);
  const teardownCwds = uniqueFilesystemPaths(
    target.teardownTargets
      .filter(
        (teardownTarget) =>
          teardownTarget.workspaceId === null ||
          targetWorkspaceIdSet.has(teardownTarget.workspaceId),
      )
      .map((teardownTarget) => teardownTarget.cwd),
  );

  try {
    for (const teardownCwd of teardownCwds) {
      await runWorktreeTeardownCommands({
        worktreePath: backing.path,
        teardownCwd,
        repoRootPath: backing.mainRepoRoot ?? undefined,
      });
    }
  } catch (error) {
    if (error instanceof WorktreeTeardownError) {
      dependencies.sessionLogger?.warn(
        { err: error, targetPath: backing.path, requestId: request.requestId },
        "Worktree teardown failed during archive; backing directory retained",
      );
      return false;
    }
    throw error;
  }

  const remainingActive = await dependencies.listActiveWorkspaces();
  if (
    !(await isDirectoryUnreferenced(
      remainingActive,
      backing.path,
      targetWorkspaceIdSet,
      dependencies,
    ))
  ) {
    return false;
  }

  try {
    await deletePaseoWorktree({
      cwd: backing.mainRepoRoot,
      worktreePath: backing.path,
      teardownCwds: [],
      worktreesRoot: backing.paseoWorktreesRoot ?? undefined,
      paseoHome: dependencies.paseoHome,
      worktreesBaseRoot: dependencies.paseoWorktreesBaseRoot,
    });
    dependencies.github.invalidate({ cwd: backing.path });
    return true;
  } catch (error) {
    dependencies.sessionLogger?.warn(
      { err: error, targetPath: backing.path, requestId: request.requestId },
      "Worktree disk removal failed during archive; backing directory retained",
    );
    return false;
  }
}

function uniqueFilesystemPaths(paths: string[]): string[] {
  const unique: string[] = [];
  for (const candidate of paths) {
    if (!unique.some((existing) => createRealpathAwarePathMatcher(existing)(candidate))) {
      unique.push(candidate);
    }
  }
  return unique;
}

export type ArchiveWorkspaceContentsDependencies = Pick<
  ArchiveDependencies,
  "agentManager" | "agentStorage" | "killTerminalsForWorkspace" | "sessionLogger"
>;

// Tears down everything OWNED by a single workspace record: its live agents,
// its persisted-but-not-running agent snapshots, and its terminals. Scoped by
// workspaceId so a sibling workspace sharing the same directory is untouched.
// Returns the set of archived agent ids.
export async function archiveWorkspaceContents(
  dependencies: ArchiveWorkspaceContentsDependencies,
  workspaceId: string,
): Promise<Set<string>> {
  const archivedAgents = new Set<string>();

  const liveAgents = dependencies.agentManager
    .listAgents()
    .filter((agent) => agent.workspaceId === workspaceId);
  for (const agent of liveAgents) {
    archivedAgents.add(agent.id);
  }

  const storedRecords: StoredAgentRecord[] =
    await dependencies.agentStorage.listByWorkspace(workspaceId);
  const matchingStoredRecords = storedRecords;
  for (const record of matchingStoredRecords) {
    archivedAgents.add(record.id);
  }

  const archivedAt = new Date().toISOString();
  const agentIdsToArchive = new Set([
    ...liveAgents.map((agent) => agent.id),
    ...matchingStoredRecords.filter((record) => !record.archivedAt).map((record) => record.id),
  ]);
  const archiveResults = await Promise.allSettled([
    ...[...agentIdsToArchive].map((agentId) =>
      dependencies.agentManager.getAgent(agentId)
        ? dependencies.agentManager.archiveAgent(agentId)
        : dependencies.agentManager.archiveSnapshot(agentId, archivedAt),
    ),
    dependencies.killTerminalsForWorkspace(workspaceId),
  ]);

  const teardownErrors: unknown[] = [];
  for (const result of archiveResults) {
    if (result.status === "rejected") {
      dependencies.sessionLogger?.warn(
        { err: result.reason, workspaceId },
        "Workspace archive teardown step failed",
      );
      teardownErrors.push(result.reason);
    }
  }
  if (teardownErrors.length > 0) {
    throw new AggregateError(
      teardownErrors,
      `Workspace ${workspaceId} teardown failed; archive intent retained`,
    );
  }

  return archivedAgents;
}

// True when no active workspace outside the archive-fenced target set still
// points at targetDir. Derived from records each call — no stored counter.
async function isDirectoryUnreferenced(
  activeWorkspaces: ActiveWorkspaceRef[],
  targetDir: string,
  archivedWorkspaceIds: ReadonlySet<string>,
  dependencies: Pick<ArchiveDependencies, "paseoHome" | "paseoWorktreesBaseRoot">,
): Promise<boolean> {
  const target = resolve(targetDir);
  const matchesTarget = createRealpathAwarePathMatcher(target);
  for (const workspace of activeWorkspaces) {
    if (archivedWorkspaceIds.has(workspace.workspaceId)) continue;
    const backingDirectory = await resolveWorkspaceBackingDirectory(workspace, dependencies);
    if (matchesTarget(backingDirectory.path)) return false;
  }
  return true;
}

export async function killTerminalsForWorkspace(
  dependencies: KillTerminalsForWorkspaceDependencies,
  workspaceId: string,
): Promise<void> {
  const terminalManager = dependencies.terminalManager;
  if (!terminalManager) {
    return;
  }

  const failures: unknown[] = [];
  let terminalDirectories: string[] = [];
  try {
    terminalDirectories = terminalManager.listDirectories();
  } catch (error) {
    failures.push(error);
    dependencies.sessionLogger.warn(
      { err: error, workspaceId },
      "Failed to list terminal directories during workspace archive",
    );
  }

  const terminalIds = new Set<string>();
  const terminalListResults = await Promise.allSettled(
    terminalDirectories.map((terminalCwd) =>
      terminalManager.getTerminals(terminalCwd, { workspaceId }),
    ),
  );
  for (const [index, result] of terminalListResults.entries()) {
    if (result.status === "rejected") {
      failures.push(result.reason);
      dependencies.sessionLogger.warn(
        { err: result.reason, cwd: terminalDirectories[index], workspaceId },
        "Failed to enumerate workspace terminals during archive",
      );
      continue;
    }
    for (const terminal of result.value) {
      if (terminal.workspaceId === workspaceId) {
        terminalIds.add(terminal.id);
      }
    }
  }

  const terminalIdList = Array.from(terminalIds);
  const terminalKillResults = await Promise.allSettled(
    terminalIdList.map(async (terminalId) => {
      try {
        dependencies.detachTerminalStream?.(terminalId, { emitExit: true });
      } catch (error) {
        failures.push(error);
        dependencies.sessionLogger.warn(
          { err: error, terminalId, workspaceId },
          "Failed to detach terminal stream during workspace archive",
        );
      }

      await terminalManager.killTerminalAndWait(terminalId, {
        gracefulTimeoutMs: 2000,
        forceTimeoutMs: 1500,
      });
    }),
  );
  for (const [index, result] of terminalKillResults.entries()) {
    if (result.status === "rejected") {
      failures.push(result.reason);
      dependencies.sessionLogger.warn(
        { err: result.reason, terminalId: terminalIdList[index], workspaceId },
        "Terminal kill escalation failed during workspace archive",
      );
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Workspace ${workspaceId} terminal teardown failed; archive intent retained`,
    );
  }
}

// Archiving the last workspace of a project leaves the project record active.
// The user removes the project explicitly, so we never archive the parent here.
export async function archivePersistedWorkspaceRecord(input: {
  workspaceId: string;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "archive">;
  archivedAt?: string;
  context?: WorkspaceArchiveContext;
}): Promise<PersistedWorkspaceRecord | null> {
  const existingWorkspace = await input.workspaceRegistry.get(input.workspaceId);
  if (!existingWorkspace) {
    return null;
  }

  if (existingWorkspace.archivedAt) {
    return existingWorkspace;
  }

  const archivedAt = input.archivedAt ?? new Date().toISOString();
  await input.workspaceRegistry.archive(input.workspaceId, archivedAt, input.context);

  return existingWorkspace;
}
