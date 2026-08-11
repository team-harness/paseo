import { basename, resolve } from "node:path";
import type { Logger } from "pino";
import {
  generateWorkspaceId,
  initialWorkspacePlacement,
  reconcileWorkspacePlacement,
} from "../../workspace-registry-model.js";
import {
  createPersistedWorkspaceRecord,
  isWorkspaceRecordAvailable,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "../../workspace-registry.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../../worktree-session.js";
import { deriveProjectKey } from "../../project-key.js";
import {
  areEquivalentPaths,
  createRealpathAwarePathMatcher,
  normalizePathForIdentity,
} from "../../../utils/path.js";
import {
  type WorkspaceLifecyclePort,
  workspaceLifecycleCoordinator,
} from "../../workspace-lifecycle-coordinator.js";

export interface ResolveOrCreateWorkspaceIdInput {
  createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
  requestedWorkspaceId?: string;
  cwd: string;
  initialTitle: string | null;
}

export interface ImportWorkspaceInput {
  cwd: string;
  requestedWorkspaceId?: string;
}

export interface ImportWorkspaceResult<T> {
  value: T;
  createdWorkspace: PersistedWorkspaceRecord | null;
}

export interface CreateWorktreeWorkspaceInput {
  sourceCwd: string;
  projectId?: string;
  repoRoot: string;
  cwd: string;
  worktreeRoot: string;
  branch: string | null;
  baseBranch: string | null;
  title: string | null;
  expectsInitialAgent?: boolean;
}

export interface WorkspaceProvisioningService {
  runInImportWorkspace<T>(
    input: ImportWorkspaceInput,
    operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
  ): Promise<ImportWorkspaceResult<T>>;
  findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord>;
  resolveOrCreateWorkspaceIdForCreateAgent(input: ResolveOrCreateWorkspaceIdInput): Promise<string>;
  createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
    projectId?: string,
    context?: { expectsInitialAgent?: boolean },
  ): Promise<PersistedWorkspaceRecord>;
  createWorkspaceForWorktree(
    input: CreateWorktreeWorkspaceInput,
  ): Promise<PersistedWorkspaceRecord>;
  findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord>;
  ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord>;
}

export type WorkspaceProvisioningErrorCode =
  | "unknown_project"
  | "archived_project"
  | "workspace_archive_in_progress";

function workspaceProvisioningErrorMessage(
  code: WorkspaceProvisioningErrorCode,
  subjectId: string,
): string {
  if (code === "unknown_project") return `Unknown project: ${subjectId}`;
  if (code === "archived_project") return `Archived project: ${subjectId}`;
  return `Workspace archive in progress: ${subjectId}`;
}

export class WorkspaceProvisioningError extends Error {
  constructor(
    readonly code: WorkspaceProvisioningErrorCode,
    subjectId: string,
  ) {
    super(workspaceProvisioningErrorMessage(code, subjectId));
    this.name = "WorkspaceProvisioningError";
  }
}

export function createWorkspaceProvisioningService(deps: {
  serverId?: string;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout" | "getSnapshot" | "peekSnapshot">;
  workspaceLifecycle?: WorkspaceLifecyclePort;
  logger: Logger;
}): WorkspaceProvisioningService {
  const { serverId, workspaceRegistry, projectRegistry, workspaceGitService, logger } = deps;
  const workspaceLifecycle = deps.workspaceLifecycle ?? workspaceLifecycleCoordinator;

  async function runInImportWorkspace<T>(
    input: ImportWorkspaceInput,
    operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
  ): Promise<ImportWorkspaceResult<T>> {
    if (input.requestedWorkspaceId) {
      const workspace = await workspaceRegistry.get(input.requestedWorkspaceId);
      if (!workspace || !isWorkspaceRecordAvailable(workspace)) {
        throw new Error(`Workspace not found: ${input.requestedWorkspaceId}`);
      }
      const project = await projectRegistry.get(workspace.projectId);
      if (!project || project.archivedAt) {
        throw new Error(`Project not found: ${workspace.projectId}`);
      }
      if (!createRealpathAwarePathMatcher(workspace.cwd)(input.cwd)) {
        throw new Error(`Import cwd does not match workspace: ${workspace.workspaceId}`);
      }
      return {
        value: await operation(workspace),
        createdWorkspace: null,
      };
    }

    const projectsBeforeImport = await projectRegistry.list();
    const workspace = await createWorkspaceForDirectory(input.cwd);
    const previousProject =
      projectsBeforeImport.find((project) => project.projectId === workspace.projectId) ?? null;

    try {
      return {
        value: await operation(workspace),
        createdWorkspace: workspace,
      };
    } catch (error) {
      await rollbackFailedImportWorkspace(workspace, previousProject);
      throw error;
    }
  }

  async function rollbackFailedImportWorkspace(
    workspace: PersistedWorkspaceRecord,
    previousProject: PersistedProjectRecord | null,
  ): Promise<void> {
    try {
      await workspaceRegistry.remove(workspace.workspaceId);
      const projectHasActiveWorkspace = (await workspaceRegistry.list()).some(
        (candidate) =>
          candidate.projectId === workspace.projectId && isWorkspaceRecordAvailable(candidate),
      );
      if (projectHasActiveWorkspace) {
        return;
      }
      if (previousProject?.archivedAt) {
        await projectRegistry.upsert(previousProject);
      } else if (!previousProject) {
        await projectRegistry.remove(workspace.projectId);
      }
    } catch (error) {
      logger.error(
        { err: error, workspaceId: workspace.workspaceId, projectId: workspace.projectId },
        "Failed to restore workspace state after provider import failure",
      );
    }
  }

  async function findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord> {
    const rootPath = resolve(cwd);
    const checkout = await workspaceGitService.getCheckout(rootPath);
    const timestamp = new Date().toISOString();
    return projectRegistry.getOrCreateActiveByRoot({
      rootPath,
      kind: checkout.isGit ? "git" : "non_git",
      displayName: basename(rootPath) || rootPath,
      projectKey: deriveProjectKey({
        rootPath,
        remoteUrl: checkout.remoteUrl,
        worktreeRoot: checkout.worktreeRoot,
        mainRepoRoot: checkout.mainRepoRoot,
        serverId,
      }),
      timestamp,
    });
  }

  async function requireActiveProject(projectId: string): Promise<PersistedProjectRecord> {
    const project = await projectRegistry.get(projectId);
    if (!project) throw new WorkspaceProvisioningError("unknown_project", projectId);
    if (project.archivedAt) throw new WorkspaceProvisioningError("archived_project", projectId);
    return project;
  }

  async function createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
    projectId?: string,
    context?: { expectsInitialAgent?: boolean },
  ): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(cwd);
    await assertNoPendingWorkspaceArchive([normalizedCwd]);
    const observedCheckout = await workspaceGitService.getCheckout(normalizedCwd);
    const backingDirectory = checkoutBackingDirectory(normalizedCwd, observedCheckout);
    return workspaceLifecycle.serializeBackingDirectories([backingDirectory], async () => {
      await assertNoPendingWorkspaceArchive([normalizedCwd]);
      const checkout = await workspaceGitService.getCheckout(normalizedCwd);
      assertUnchangedBackingDirectory(normalizedCwd, observedCheckout, checkout);
      const project = projectId
        ? await refreshProjectKind(await requireActiveProject(projectId), normalizedCwd, checkout)
        : // COMPAT(workspaceCreateMissingProjectId): added in v0.1.107, remove after 2027-01-15.
          await findOrCreateProjectForDirectory(normalizedCwd);
      const timestamp = new Date().toISOString();
      const workspace = createPersistedWorkspaceRecord({
        workspaceId: generateWorkspaceId(),
        projectId: project.projectId,
        ...initialWorkspacePlacement({ source: "checkout", cwd: normalizedCwd, checkout }),
        title: title?.trim() || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await workspaceRegistry.upsert(workspace, context);
      return workspace;
    });
  }

  async function createWorkspaceForWorktree(
    input: CreateWorktreeWorkspaceInput,
  ): Promise<PersistedWorkspaceRecord> {
    const sourceCwd = resolve(input.sourceCwd);
    const repoRoot = resolve(input.repoRoot);
    const cwd = resolve(input.cwd);
    const worktreeRoot = resolve(input.worktreeRoot);
    await assertNoPendingWorkspaceArchive([sourceCwd, repoRoot, cwd, worktreeRoot]);
    return workspaceLifecycle.serializeBackingDirectories([worktreeRoot], async () => {
      await assertNoPendingWorkspaceArchive([sourceCwd, repoRoot, cwd, worktreeRoot]);
      const checkout = await workspaceGitService.getCheckout(cwd);
      if (
        !checkout.isGit ||
        normalizePathForIdentity(checkoutBackingDirectory(cwd, checkout)) !==
          normalizePathForIdentity(worktreeRoot)
      ) {
        throw new Error("Workspace backing directory changed during provisioning");
      }
      const project = await resolveSourceProjectForWorktree({
        sourceCwd,
        projectId: input.projectId,
        repoRoot,
      });
      const timestamp = new Date().toISOString();
      const workspace = createPersistedWorkspaceRecord({
        workspaceId: generateWorkspaceId(),
        projectId: project.projectId,
        ...initialWorkspacePlacement({
          source: "created_worktree",
          cwd,
          worktreeRoot,
          branch: input.branch,
          baseBranch: input.baseBranch,
          mainRepoRoot: repoRoot,
        }),
        title: input.title,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await workspaceRegistry.upsert(workspace, {
        expectsInitialAgent: input.expectsInitialAgent,
      });
      return workspace;
    });
  }

  async function resolveSourceProjectForWorktree(input: {
    sourceCwd: string;
    projectId?: string;
    repoRoot: string;
  }): Promise<PersistedProjectRecord> {
    if (input.projectId) {
      return refreshProjectKind(await requireActiveProject(input.projectId));
    }

    const workspaces = await workspaceRegistry.list();
    const sourceWorkspace =
      workspaces.find(
        (workspace) =>
          isWorkspaceRecordAvailable(workspace) &&
          areEquivalentPaths(workspace.cwd, input.sourceCwd),
      ) ??
      workspaces.find(
        (workspace) =>
          isWorkspaceRecordAvailable(workspace) &&
          areEquivalentPaths(workspace.cwd, input.repoRoot),
      );
    if (sourceWorkspace) {
      const project = await projectRegistry.get(sourceWorkspace.projectId);
      if (project) return refreshProjectKind(project);
      // COMPAT(worktreeMissingSourceProject): added in v0.1.107, remove after 2027-01-15.
      // Orphaned legacy workspace FKs fall through to exact-root allocation.
    }

    const checkout = await workspaceGitService.getCheckout(input.repoRoot);
    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: input.repoRoot,
      kind: "git",
      displayName: basename(input.repoRoot) || input.repoRoot,
      projectKey: deriveProjectKey({
        rootPath: input.repoRoot,
        remoteUrl: checkout.remoteUrl,
        worktreeRoot: checkout.worktreeRoot,
        mainRepoRoot: checkout.mainRepoRoot,
        serverId,
      }),
      timestamp: new Date().toISOString(),
    });
    return refreshProjectKind(project);
  }

  async function findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(cwd);
    const workspaces = await workspaceRegistry.list();
    const pendingArchive = workspaces.find(
      (workspace) =>
        workspace.archivedAt === null &&
        workspace.archiveIntent !== null &&
        areEquivalentPaths(workspace.cwd, normalizedCwd),
    );
    if (pendingArchive) {
      throw new WorkspaceProvisioningError(
        "workspace_archive_in_progress",
        pendingArchive.workspaceId,
      );
    }
    const active = workspaces
      .filter(
        (workspace) =>
          isWorkspaceRecordAvailable(workspace) && areEquivalentPaths(workspace.cwd, normalizedCwd),
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      )[0];
    if (active) return refreshWorkspaceRecord(active);
    const archived = workspaces
      .filter(
        (workspace) => workspace.archivedAt && areEquivalentPaths(workspace.cwd, normalizedCwd),
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      )[0];
    if (archived) {
      const project = await projectRegistry.get(archived.projectId);
      if (project && !project.archivedAt) return ensureWorkspaceRecordUnarchived(archived);
    }
    return createWorkspaceForDirectory(normalizedCwd);
  }

  async function resolveOrCreateWorkspaceIdForCreateAgent(
    input: ResolveOrCreateWorkspaceIdInput,
  ): Promise<string> {
    if (input.createdWorktree) return input.createdWorktree.workspace.workspaceId;
    if (input.requestedWorkspaceId) {
      const requested = await workspaceRegistry.get(input.requestedWorkspaceId);
      if (!requested || !isWorkspaceRecordAvailable(requested)) {
        throw new Error(`Workspace not found: ${input.requestedWorkspaceId}`);
      }
      return requested.workspaceId;
    }
    return (
      await createWorkspaceForDirectory(input.cwd, input.initialTitle, undefined, {
        expectsInitialAgent: true,
      })
    ).workspaceId;
  }

  async function resolveRestoredAutoArchiveChangeRequestUrl(
    workspace: PersistedWorkspaceRecord,
  ): Promise<string | null> {
    if (!workspace.archivedAt) {
      return workspace.autoArchivedChangeRequestUrl;
    }
    const snapshot = await workspaceGitService.getSnapshot(workspace.cwd, {
      force: true,
      includeForge: true,
      reason: "workspace-restore-auto-archive-latch",
    });
    return snapshot.forge.pullRequest?.isMerged
      ? snapshot.forge.pullRequest.url
      : workspace.autoArchivedChangeRequestUrl;
  }

  async function ensureWorkspaceRecordUnarchived(
    observedWorkspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    const observedBackingDirectory = workspaceBackingDirectory(observedWorkspace);
    return workspaceLifecycle.serializeBackingDirectories([observedBackingDirectory], async () => {
      const workspace = await requireWorkspaceForBackingRestore(
        observedWorkspace.workspaceId,
        observedBackingDirectory,
      );
      const project = await projectRegistry.get(workspace.projectId);
      if (!project) throw new Error(`Unknown project: ${workspace.projectId}`);
      const timestamp = new Date().toISOString();
      const checkout =
        workspace.archivedAt || project.archivedAt
          ? await workspaceGitService.getCheckout(workspace.cwd)
          : null;
      if (checkout && workspace.isPaseoOwnedWorktree) {
        assertCheckoutMatchesOwnedWorkspace(workspace, checkout);
      }
      const autoArchivedChangeRequestUrl =
        await resolveRestoredAutoArchiveChangeRequestUrl(workspace);
      let next: PersistedWorkspaceRecord | null = null;
      if (workspace.archivedAt && checkout) {
        const placementUpdate = reconcileWorkspacePlacement({
          workspace,
          checkout,
          updatedAt: timestamp,
        });
        next = {
          ...(placementUpdate?.workspace ?? workspace),
          archivedAt: null,
          autoArchivedChangeRequestUrl,
          updatedAt: timestamp,
        };
      }
      await restoreProjectForWorkspace(project, workspace, checkout, timestamp);
      if (!next) return workspace;
      await workspaceRegistry.upsert(next, { restoreArchivedRecord: true });
      return next;
    });
  }

  async function requireWorkspaceForBackingRestore(
    workspaceId: string,
    expectedBackingDirectory: string,
  ): Promise<PersistedWorkspaceRecord> {
    const workspace = await workspaceRegistry.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    if (workspace.archiveIntent) {
      throw new WorkspaceProvisioningError("workspace_archive_in_progress", workspace.workspaceId);
    }
    if (
      normalizePathForIdentity(workspaceBackingDirectory(workspace)) !==
      normalizePathForIdentity(expectedBackingDirectory)
    ) {
      throw new Error("Workspace backing directory changed during provisioning");
    }
    return workspace;
  }

  async function restoreProjectForWorkspace(
    project: PersistedProjectRecord,
    workspace: PersistedWorkspaceRecord,
    checkout: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>> | null,
    timestamp: string,
  ): Promise<void> {
    if (!checkout || (!project.archivedAt && !workspace.archivedAt)) return;
    const projectCheckout = areEquivalentPaths(project.rootPath, workspace.cwd)
      ? checkout
      : await workspaceGitService.getCheckout(project.rootPath);
    const kind = projectCheckout.isGit ? "git" : "non_git";
    const projectKey = deriveProjectKey({
      rootPath: project.rootPath,
      remoteUrl: projectCheckout.remoteUrl,
      worktreeRoot: projectCheckout.worktreeRoot,
      mainRepoRoot: projectCheckout.mainRepoRoot,
      serverId,
    });
    if (!project.archivedAt && project.kind === kind && project.projectKey === projectKey) return;
    await projectRegistry.upsert({
      ...project,
      kind,
      projectKey,
      archivedAt: null,
      updatedAt: timestamp,
    });
  }

  async function refreshWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    const checkout = await workspaceGitService.getCheckout(workspace.cwd);
    const project = await projectRegistry.get(workspace.projectId);
    if (project && !project.archivedAt) {
      await refreshProjectKind(project, workspace.cwd, checkout);
    }
    const update = reconcileWorkspacePlacement({
      workspace,
      checkout,
      updatedAt: new Date().toISOString(),
    });
    if (!update) return workspace;
    await workspaceRegistry.upsert(update.workspace);
    return update.workspace;
  }

  async function refreshProjectKind(
    project: PersistedProjectRecord,
    workspaceCwd?: string,
    workspaceCheckout?: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
  ): Promise<PersistedProjectRecord> {
    const projectCheckout =
      workspaceCwd && workspaceCheckout && areEquivalentPaths(project.rootPath, workspaceCwd)
        ? workspaceCheckout
        : await workspaceGitService.getCheckout(project.rootPath);
    const kind: PersistedProjectRecord["kind"] = projectCheckout.isGit ? "git" : "non_git";
    const projectKey = deriveProjectKey({
      rootPath: project.rootPath,
      remoteUrl: projectCheckout.remoteUrl,
      worktreeRoot: projectCheckout.worktreeRoot,
      mainRepoRoot: projectCheckout.mainRepoRoot,
      serverId,
    });
    if (project.kind === kind && project.projectKey === projectKey) return project;
    const refreshed = {
      ...project,
      kind,
      projectKey,
      updatedAt: new Date().toISOString(),
    };
    await projectRegistry.upsert(refreshed);
    return refreshed;
  }

  async function assertNoPendingWorkspaceArchive(cwds: readonly string[]): Promise<void> {
    const pending = (await workspaceRegistry.list()).find(
      (workspace) =>
        workspace.archivedAt === null &&
        workspace.archiveIntent !== null &&
        cwds.some((cwd) => areEquivalentPaths(workspace.cwd, cwd)),
    );
    if (pending) {
      throw new WorkspaceProvisioningError("workspace_archive_in_progress", pending.workspaceId);
    }
  }

  function checkoutBackingDirectory(
    cwd: string,
    checkout: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
  ): string {
    return resolve(checkout.isGit ? (checkout.worktreeRoot ?? cwd) : cwd);
  }

  function assertUnchangedBackingDirectory(
    cwd: string,
    observed: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
    current: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
  ): void {
    if (
      observed.isGit !== current.isGit ||
      observed.isPaseoOwnedWorktree !== current.isPaseoOwnedWorktree ||
      normalizePathForIdentity(checkoutBackingDirectory(cwd, observed)) !==
        normalizePathForIdentity(checkoutBackingDirectory(cwd, current))
    ) {
      throw new Error("Workspace backing directory changed during provisioning");
    }
  }

  function workspaceBackingDirectory(workspace: PersistedWorkspaceRecord): string {
    return resolve(
      workspace.kind === "worktree" ? (workspace.worktreeRoot ?? workspace.cwd) : workspace.cwd,
    );
  }

  function assertCheckoutMatchesOwnedWorkspace(
    workspace: PersistedWorkspaceRecord,
    checkout: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
  ): void {
    if (
      !checkout.isGit ||
      !checkout.isPaseoOwnedWorktree ||
      normalizePathForIdentity(checkoutBackingDirectory(workspace.cwd, checkout)) !==
        normalizePathForIdentity(workspaceBackingDirectory(workspace))
    ) {
      throw new Error("Workspace backing directory changed during provisioning");
    }
  }

  return {
    runInImportWorkspace,
    findOrCreateWorkspaceForDirectory,
    resolveOrCreateWorkspaceIdForCreateAgent,
    createWorkspaceForDirectory,
    createWorkspaceForWorktree,
    findOrCreateProjectForDirectory,
    ensureWorkspaceRecordUnarchived,
  };
}
