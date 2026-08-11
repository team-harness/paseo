import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino, { type Logger } from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ForgeService } from "../services/forge-service.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";
import { createWorktree, type WorktreeConfig } from "../utils/worktree.js";
import type { ManagedAgent } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import {
  type WorkspaceLifecyclePort,
  WorkspaceLifecycleCoordinator,
} from "./workspace-lifecycle-coordinator.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";
import { createWorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { TerminalSession } from "../terminal/terminal.js";
import {
  archiveByScope,
  type ActiveWorkspaceRef,
  type ArchiveDependencies,
  type ArchiveResult,
  killTerminalsForWorkspace,
  resolveWorkspaceIdAtPath,
} from "./workspace-archive-service.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createLogger(): Logger {
  const logger = pino({ level: "silent" });
  vi.spyOn(logger, "info").mockImplementation(() => undefined);
  vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
  return logger;
}

function createGitHubServiceStub(): ForgeService {
  return {
    listPullRequests: async () => [],
    listIssues: async () => [],
    searchIssuesAndPrs: async () => ({
      items: [],
      featuresEnabled: true,
      githubFeaturesEnabled: true,
    }),
    getPullRequest: async ({ number }) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/repo/pull/${number}`,
      state: "OPEN",
      body: null,
      baseRefName: "main",
      headRefName: `pr-${number}`,
      labels: [],
    }),
    getPullRequestHeadRef: async ({ number }) => `pr-${number}`,
    getPullRequestCheckoutTarget: async ({ number }) => ({
      number,
      baseRefName: "main",
      headRefName: `pr-${number}`,
      headOwnerLogin: null,
      headRepositorySshUrl: null,
      headRepositoryUrl: null,
      isCrossRepository: false,
    }),
    getCurrentPullRequestStatus: async () => null,
    createPullRequest: async () => ({
      number: 1,
      url: "https://github.com/acme/repo/pull/1",
    }),
    mergePullRequest: async () => ({ success: true }),
    isAuthenticated: async () => true,
    invalidate: () => {},
  };
}

function createGitRepo(): { tempDir: string; repoDir: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), "workspace-archive-service-"));
  cleanupPaths.push(tempDir);
  const repoDir = path.join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@getpaseo.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Paseo Test"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return { tempDir, repoDir };
}

async function createPaseoOwnedWorktree(
  repoDir: string,
  paseoHome: string,
  worktreeSlug: string,
): Promise<WorktreeConfig> {
  return createWorktree({
    cwd: repoDir,
    worktreeSlug,
    source: {
      kind: "branch-off",
      baseBranch: "main",
      branchName: worktreeSlug,
    },
    runSetup: false,
    paseoHome,
  });
}

interface ArchiveDepsInput {
  paseoHome: string;
  activeWorkspaces: ActiveWorkspaceRef[];
  paseoWorktreesBaseRoot?: string;
  findWorkspaceIdForCwd?: (cwd: string) => Promise<string | null>;
}

interface ArchiveTestDependencies extends ArchiveDependencies {
  activeWorkspaces: ActiveWorkspaceRef[];
  archiveIntents: Map<string, { requestId: string; requestedAt: string }>;
  archivedAgentIds: string[];
  archivedSnapshotIds: string[];
}

function createArchiveDeps(input: ArchiveDepsInput): ArchiveTestDependencies {
  const archivedWorkspaceIds = new Set<string>();
  const archiveIntents = new Map<string, { requestId: string; requestedAt: string }>();
  const active = [...input.activeWorkspaces];
  const archivedAgentIds: string[] = [];
  const archivedSnapshotIds: string[] = [];

  return {
    paseoHome: input.paseoHome,
    paseoWorktreesBaseRoot: input.paseoWorktreesBaseRoot,
    github: createGitHubServiceStub(),
    workspaceGitService: {
      getSnapshot: vi.fn(async () => null),
    } as unknown as Pick<WorkspaceGitService, "getSnapshot">,
    agentManager: {
      listAgents: () => [],
      getAgent: () => null,
      archiveAgent: vi.fn(async (agentId: string) => {
        archivedAgentIds.push(agentId);
        return { archivedAt: new Date().toISOString() };
      }),
      archiveSnapshot: vi.fn(async (agentId: string, _archivedAt: string) => {
        archivedSnapshotIds.push(agentId);
        return {};
      }),
    },
    agentStorage: {
      listByWorkspace: async (): Promise<StoredAgentRecord[]> => [],
    } as Pick<AgentStorage, "listByWorkspace">,
    findWorkspaceIdForCwd: input.findWorkspaceIdForCwd ?? vi.fn(async () => null),
    listActiveWorkspaces: async () =>
      active.filter((workspace) => !archivedWorkspaceIds.has(workspace.workspaceId)),
    beginWorkspaceArchive: async (workspaceId, intent) => {
      if (!archiveIntents.has(workspaceId)) {
        archiveIntents.set(workspaceId, intent);
      }
      return null;
    },
    archiveWorkspaceRecord: async (workspaceId: string) => {
      archivedWorkspaceIds.add(workspaceId);
      archiveIntents.delete(workspaceId);
      const index = active.findIndex((workspace) => workspace.workspaceId === workspaceId);
      if (index !== -1) {
        active.splice(index, 1);
      }
    },
    emitWorkspaceUpdatesForWorkspaceIds: vi.fn(async () => {}),
    markWorkspaceArchiving: vi.fn(),
    clearWorkspaceArchiving: vi.fn(),
    killTerminalsForWorkspace: vi.fn(async () => {}),
    sessionLogger: createLogger(),
    activeWorkspaces: active,
    archiveIntents,
    archivedAgentIds,
    archivedSnapshotIds,
  };
}

function assertArchiveResult(
  result: ArchiveResult,
  expected: {
    archivedWorkspaceIds: string[];
    removedDirectory: boolean;
  },
): void {
  expect(result.archivedWorkspaceIds).toEqual(expected.archivedWorkspaceIds);
  expect(result.removedDirectory).toBe(expected.removedDirectory);
}

function createArchiveRaceCheckout(
  worktreePath: string,
  repoDir: string,
): Pick<WorkspaceGitService, "getCheckout" | "getSnapshot" | "peekSnapshot"> {
  const matchesWorktree = createRealpathAwarePathMatcher(worktreePath);
  return {
    getCheckout: async (cwd) => {
      if (existsSync(worktreePath) && matchesWorktree(cwd)) {
        return {
          cwd,
          isGit: true,
          currentBranch: "provisioning-wins",
          remoteUrl: null,
          worktreeRoot: worktreePath,
          isPaseoOwnedWorktree: true,
          mainRepoRoot: repoDir,
        };
      }
      if (existsSync(repoDir) && createRealpathAwarePathMatcher(repoDir)(cwd)) {
        return {
          cwd,
          isGit: true,
          currentBranch: "main",
          remoteUrl: null,
          worktreeRoot: repoDir,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        };
      }
      return {
        cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      };
    },
    getSnapshot: async () => null,
    peekSnapshot: () => null,
  } as unknown as Pick<WorkspaceGitService, "getCheckout" | "getSnapshot" | "peekSnapshot">;
}

function createRegistryBackedArchiveDeps(input: {
  paseoHome: string;
  coordinator: WorkspaceLifecycleCoordinator;
  workspaceRegistry: WorkspaceRegistry;
}): ArchiveDependencies {
  const deps = createArchiveDeps({ paseoHome: input.paseoHome, activeWorkspaces: [] });
  deps.workspaceLifecycle = input.coordinator;
  deps.getWorkspace = (workspaceId) => input.workspaceRegistry.get(workspaceId);
  deps.listActiveWorkspaces = async () =>
    (await input.workspaceRegistry.list()).filter(
      (workspace) => workspace.archivedAt === null && workspace.archiveIntent === null,
    );
  deps.beginWorkspaceArchive = (workspaceId, intent) =>
    input.workspaceRegistry.beginArchive!(workspaceId, intent);
  deps.archiveWorkspaceRecord = (workspaceId) =>
    input.workspaceRegistry.archive(workspaceId, new Date().toISOString());
  return deps;
}

describe("archiveByScope", () => {
  test("fails before cleanup when durable archive intent persistence is unavailable", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-missing-intent-adapter";
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    deps.stopWorkspaceSetup = vi.fn(async () => {});
    delete deps.beginWorkspaceArchive;

    await expect(
      archiveByScope(deps, {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-missing-intent-adapter",
      }),
    ).rejects.toThrow("Durable workspace archive intent adapter is required");

    expect(deps.markWorkspaceArchiving).not.toHaveBeenCalled();
    expect(deps.stopWorkspaceSetup).not.toHaveBeenCalled();
    expect(deps.killTerminalsForWorkspace).not.toHaveBeenCalled();
    expect(deps.archiveIntents).toEqual(new Map());
    expect(deps.activeWorkspaces.map((workspace) => workspace.workspaceId)).toEqual([workspaceId]);
  });

  test("fails before cleanup when durable archive intent persistence fails", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-intent-write-failure";
    const coordinator = new WorkspaceLifecycleCoordinator();
    const prepare = vi.fn(async () => {});
    const unregister = coordinator.registerArchivePreparation(prepare);
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    deps.workspaceLifecycle = coordinator;
    deps.stopWorkspaceSetup = vi.fn(async () => {});
    deps.beginWorkspaceArchive = vi.fn(async () => {
      throw new Error("intent write failed");
    });

    await expect(
      archiveByScope(deps, {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-intent-write-failure",
      }),
    ).rejects.toThrow("intent write failed");
    unregister();

    expect(deps.stopWorkspaceSetup).not.toHaveBeenCalled();
    expect(deps.markWorkspaceArchiving).not.toHaveBeenCalled();
    expect(deps.killTerminalsForWorkspace).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(deps.activeWorkspaces.map((workspace) => workspace.workspaceId)).toEqual([workspaceId]);
  });

  test("claims the durable archive intent only after acquiring the workspace lifecycle fence", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-intent-lifecycle-fence";
    const coordinator = new WorkspaceLifecycleCoordinator();
    let releaseLifecycleFence!: () => void;
    let markLifecycleFenceEntered!: () => void;
    let markArchiveFenceRequested!: () => void;
    const lifecycleFenceGate = new Promise<void>((resolve) => {
      releaseLifecycleFence = resolve;
    });
    const lifecycleFenceEntered = new Promise<void>((resolve) => {
      markLifecycleFenceEntered = resolve;
    });
    const archiveFenceRequested = new Promise<void>((resolve) => {
      markArchiveFenceRequested = resolve;
    });
    const heldLifecycleFence = coordinator.serialize([workspaceId], async () => {
      markLifecycleFenceEntered();
      await lifecycleFenceGate;
    });
    await lifecycleFenceEntered;

    const archiveLifecycle: WorkspaceLifecyclePort = {
      serialize: (workspaceIds, operation) => {
        markArchiveFenceRequested();
        return coordinator.serialize(workspaceIds, operation);
      },
      serializeBackingDirectories: (backingDirectories, operation) =>
        coordinator.serializeBackingDirectories(backingDirectories, operation),
      prepareForArchive: (candidateWorkspaceId) =>
        coordinator.prepareForArchive(candidateWorkspaceId),
    };
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    deps.workspaceLifecycle = archiveLifecycle;
    const beginWorkspaceArchive = vi.fn(deps.beginWorkspaceArchive!);
    deps.beginWorkspaceArchive = beginWorkspaceArchive;

    const archive = archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      requestId: "req-intent-lifecycle-fence",
    });
    await archiveFenceRequested;
    const claimCountWhileFenceWasHeld = beginWorkspaceArchive.mock.calls.length;

    releaseLifecycleFence();
    await heldLifecycleFence;
    await archive;

    expect(claimCountWhileFenceWasHeld).toBe(0);
    expect(beginWorkspaceArchive).toHaveBeenCalledOnce();
  });

  test("stops workspace setup outside the lifecycle fence after persisting the archive intent", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-setup-reentrant-archive";
    const coordinator = new WorkspaceLifecycleCoordinator();
    const events: string[] = [];
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    deps.workspaceLifecycle = coordinator;

    const beginWorkspaceArchive = deps.beginWorkspaceArchive!;
    deps.beginWorkspaceArchive = async (candidateWorkspaceId, intent) => {
      events.push(`intent:${intent.requestId}`);
      return beginWorkspaceArchive(candidateWorkspaceId, intent);
    };

    let stopCalls = 0;
    deps.stopWorkspaceSetup = async (candidateWorkspaceId) => {
      stopCalls += 1;
      events.push(`stop:${stopCalls}`);
      expect(deps.archiveIntents.get(candidateWorkspaceId)?.requestId).toBe("req-outer");
      if (stopCalls === 1) {
        await archiveByScope(deps, {
          scope: { kind: "workspace", workspaceId: candidateWorkspaceId },
          requestId: "req-setup-failure",
        });
        events.push("nested-complete");
      }
    };

    let teardownCalls = 0;
    let lifecycleProbe = Promise.resolve();
    deps.killTerminalsForWorkspace = async () => {
      teardownCalls += 1;
      events.push(`contents:${teardownCalls}`);
      if (teardownCalls === 2) {
        lifecycleProbe = coordinator.serialize([workspaceId], async () => {
          events.push("lifecycle-probe");
        });
        await Promise.resolve();
        expect(events).not.toContain("lifecycle-probe");
      }
    };
    const archiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = async (candidateWorkspaceId) => {
      events.push(`record:${teardownCalls}`);
      await archiveWorkspaceRecord(candidateWorkspaceId);
    };

    await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      requestId: "req-outer",
    });
    await lifecycleProbe;

    expect(stopCalls).toBe(2);
    expect(teardownCalls).toBe(2);
    expect(events).toEqual([
      "intent:req-outer",
      "stop:1",
      "intent:req-setup-failure",
      "stop:2",
      "contents:1",
      "record:1",
      "nested-complete",
      "contents:2",
      "record:2",
      "lifecycle-probe",
    ]);
  }, 1_000);

  test("prepares Team Missions inside the workspace fence before archiving the record", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-team-lifecycle";
    const coordinator = new WorkspaceLifecycleCoordinator();
    const events: string[] = [];
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    deps.workspaceLifecycle = coordinator;
    const beginWorkspaceArchive = deps.beginWorkspaceArchive!;
    deps.beginWorkspaceArchive = async (candidateWorkspaceId, intent) => {
      events.push(`intent:${candidateWorkspaceId}`);
      return beginWorkspaceArchive(candidateWorkspaceId, intent);
    };
    deps.stopWorkspaceSetup = async (candidateWorkspaceId) => {
      events.push(`stop:${candidateWorkspaceId}`);
    };
    deps.killTerminalsForWorkspace = async (candidateWorkspaceId) => {
      events.push(`contents:${candidateWorkspaceId}`);
    };
    const archiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = async (candidateWorkspaceId) => {
      events.push(`record:${candidateWorkspaceId}`);
      await archiveWorkspaceRecord(candidateWorkspaceId);
    };
    const unregister = coordinator.registerArchivePreparation(async (candidateWorkspaceId) => {
      events.push(`prepare:${candidateWorkspaceId}`);
    });

    await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      requestId: "req-team-lifecycle",
    });
    unregister();

    expect(events).toEqual([
      `intent:${workspaceId}`,
      `stop:${workspaceId}`,
      `prepare:${workspaceId}`,
      `contents:${workspaceId}`,
      `record:${workspaceId}`,
    ]);
  });

  test("workspace scope archives the record and removes the directory on last reference", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "last-ref-workspace");
    const workspaceId = "ws-last-ref";

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          {
            workspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-last-ref-workspace",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceId],
      removedDirectory: true,
    });
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("workspace scope runs teardown while keeping a directory referenced by a sibling", async () => {
    const { tempDir, repoDir } = createGitRepo();
    writeFileSync(
      path.join(repoDir, "paseo.json"),
      JSON.stringify({
        worktree: {
          teardown: [
            "node -e \"require('fs').writeFileSync(process.env.PASEO_SOURCE_CHECKOUT_PATH + '/shared-teardown.log', 'ok')\"",
          ],
        },
      }),
    );
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "shared teardown"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "sibling-workspace");
    const workspaceA = "ws-sibling-a";
    const workspaceB = "ws-sibling-b";

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
          { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "local_checkout" },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId: workspaceA },
        requestId: "req-sibling-workspace",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceA],
      removedDirectory: false,
    });
    expect(existsSync(worktree.worktreePath)).toBe(true);
    expect(readFileSync(path.join(repoDir, "shared-teardown.log"), "utf8")).toBe("ok");
  });

  test("workspace scope keeps a worktree for an active workspace in a subdirectory", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "subdirectory-sibling");
    const sourceWorkspaceId = "ws-subdirectory-source";
    const siblingWorkspaceId = "ws-subdirectory-sibling";
    const siblingDirectory = path.join(worktree.worktreePath, "packages", "app");
    mkdirSync(siblingDirectory, { recursive: true });

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          {
            workspaceId: sourceWorkspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
          {
            workspaceId: siblingWorkspaceId,
            cwd: siblingDirectory,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId: sourceWorkspaceId },
        requestId: "req-subdirectory-sibling",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [sourceWorkspaceId],
      removedDirectory: false,
    });
    expect(existsSync(worktree.worktreePath)).toBe(true);
  });

  test("archiving a subdirectory workspace keeps its active worktree root", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "subdirectory-target");
    const rootWorkspaceId = "ws-subdirectory-root";
    const subdirectoryWorkspaceId = "ws-subdirectory-target";
    const subdirectory = path.join(worktree.worktreePath, "packages", "app");
    mkdirSync(subdirectory, { recursive: true });

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          {
            workspaceId: rootWorkspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
          {
            workspaceId: subdirectoryWorkspaceId,
            cwd: subdirectory,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId: subdirectoryWorkspaceId },
        requestId: "req-subdirectory-target",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [subdirectoryWorkspaceId],
      removedDirectory: false,
    });
    expect(existsSync(worktree.worktreePath)).toBe(true);
  });

  test("workspace scope runs teardown from the exact nested workspace before deleting its worktree", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const nestedRelative = path.join("packages", "app");
    const sourceNested = path.join(repoDir, nestedRelative);
    mkdirSync(sourceNested, { recursive: true });
    writeFileSync(
      path.join(sourceNested, "paseo.json"),
      JSON.stringify({
        worktree: {
          teardown: [
            "node -e \"require('fs').writeFileSync(process.env.PASEO_SOURCE_CHECKOUT_PATH + '/nested-teardown.log', process.cwd())\"",
          ],
        },
      }),
    );
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "nested teardown"], {
      cwd: repoDir,
      stdio: "pipe",
    });

    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "nested-teardown");
    const workspaceCwd = path.join(worktree.worktreePath, nestedRelative);
    const matchesWorkspaceCwd = createRealpathAwarePathMatcher(workspaceCwd);
    const workspaceId = "ws-nested-teardown";

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          {
            workspaceId,
            cwd: workspaceCwd,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
            mainRepoRoot: repoDir,
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-nested-teardown",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceId],
      removedDirectory: true,
    });
    expect(existsSync(worktree.worktreePath)).toBe(false);
    expect(
      matchesWorkspaceCwd(readFileSync(path.join(repoDir, "nested-teardown.log"), "utf8")),
    ).toBe(true);
  });

  test("worktree scope archives root and subdirectory workspaces before removing the backing worktree", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const nestedRelative = path.join("packages", "app");
    const sourceNested = path.join(repoDir, nestedRelative);
    mkdirSync(sourceNested, { recursive: true });
    writeFileSync(
      path.join(repoDir, "paseo.json"),
      JSON.stringify({
        worktree: {
          teardown: [
            "node -e \"const fs=require('fs');const out=process.env.PASEO_SOURCE_CHECKOUT_PATH+'/root-scope-teardown.log';if(fs.existsSync(out))process.exit(2);fs.writeFileSync(out,'ok')\"",
          ],
        },
      }),
    );
    writeFileSync(
      path.join(sourceNested, "paseo.json"),
      JSON.stringify({
        worktree: {
          teardown: [
            "node -e \"require('fs').writeFileSync(process.env.PASEO_SOURCE_CHECKOUT_PATH+'/nested-scope-teardown.log','ok')\"",
          ],
        },
      }),
    );
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "scope teardown"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "worktree-scope");
    const workspaceA = "ws-worktree-a";
    const workspaceB = "ws-worktree-b";
    const workspaceC = "ws-worktree-subdirectory";
    const subdirectory = path.join(worktree.worktreePath, nestedRelative);

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          {
            workspaceId: workspaceA,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
          {
            workspaceId: workspaceB,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
          {
            workspaceId: workspaceC,
            cwd: subdirectory,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isPaseoOwnedWorktree: true,
          },
        ],
      }),
      {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        requestId: "req-worktree-scope",
      },
    );

    expect(result.archivedWorkspaceIds).toEqual(
      expect.arrayContaining([workspaceA, workspaceB, workspaceC]),
    );
    expect(result.archivedWorkspaceIds).toHaveLength(3);
    expect(result.removedDirectory).toBe(true);
    expect(existsSync(worktree.worktreePath)).toBe(false);
    expect(readFileSync(path.join(repoDir, "root-scope-teardown.log"), "utf8")).toBe("ok");
    expect(readFileSync(path.join(repoDir, "nested-scope-teardown.log"), "utf8")).toBe("ok");
  });

  test("workspace scope never removes a non-Paseo-owned directory", async () => {
    const { tempDir } = createGitRepo();
    const localCheckoutDir = mkdtempSync(path.join(tempDir, "local-checkout-"));
    const workspaceId = "ws-local-checkout";

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome: path.join(tempDir, ".paseo"),
        activeWorkspaces: [{ workspaceId, cwd: localCheckoutDir, kind: "local_checkout" }],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-local-checkout",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceId],
      removedDirectory: false,
    });
    expect(existsSync(localCheckoutDir)).toBe(true);
  });

  test("replays a retained archive intent after record finalization fails", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "partial-failure");
    const workspaceA = "ws-partial-a";
    const workspaceB = "ws-partial-b";

    const deps = createArchiveDeps({
      paseoHome,
      activeWorkspaces: [
        {
          workspaceId: workspaceA,
          cwd: worktree.worktreePath,
          kind: "worktree",
          worktreeRoot: worktree.worktreePath,
          isPaseoOwnedWorktree: true,
          mainRepoRoot: repoDir,
        },
        {
          workspaceId: workspaceB,
          cwd: worktree.worktreePath,
          kind: "worktree",
          worktreeRoot: worktree.worktreePath,
          isPaseoOwnedWorktree: true,
          mainRepoRoot: repoDir,
        },
      ],
    });
    const originalArchiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    let failWorkspaceA = true;
    deps.archiveWorkspaceRecord = async (workspaceId: string) => {
      if (workspaceId === workspaceA && failWorkspaceA) {
        throw new Error("intentional teardown failure");
      }
      return originalArchiveWorkspaceRecord(workspaceId);
    };

    await expect(
      archiveByScope(deps, {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        requestId: "req-partial-failure",
      }),
    ).rejects.toThrow("Failed to archive 1 workspace record");

    expect(deps.archiveIntents.get(workspaceA)).toMatchObject({
      requestId: "req-partial-failure",
    });
    expect(deps.archiveIntents.has(workspaceB)).toBe(false);
    expect(deps.activeWorkspaces.map((workspace) => workspace.workspaceId)).toEqual([workspaceA]);
    expect(existsSync(worktree.worktreePath)).toBe(false);

    failWorkspaceA = false;
    const replay = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: workspaceA },
      requestId: "req-partial-failure-replay",
    });

    assertArchiveResult(replay, {
      archivedWorkspaceIds: [workspaceA],
      removedDirectory: true,
    });
    expect(deps.archiveIntents.has(workspaceA)).toBe(false);
    expect(deps.activeWorkspaces).toEqual([]);
  });

  test("workspace scope with unknown workspace id is a clean no-op", async () => {
    const { tempDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");

    const deps = createArchiveDeps({
      paseoHome,
      activeWorkspaces: [],
    });
    const originalArchiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = vi.fn(async (workspaceId: string) => {
      return originalArchiveWorkspaceRecord(workspaceId);
    });

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: "ws-does-not-exist" },
      requestId: "req-unknown-workspace",
    });

    assertArchiveResult(result, {
      archivedWorkspaceIds: [],
      removedDirectory: false,
    });
    expect(deps.markWorkspaceArchiving).not.toHaveBeenCalled();
    expect(deps.archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(deps.emitWorkspaceUpdatesForWorkspaceIds).not.toHaveBeenCalled();
  });

  test("worktree scope removes an owned directory with zero matching records", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "zero-records");

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [],
      }),
      {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        requestId: "req-zero-records",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [],
      removedDirectory: true,
    });
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("keeps an owned worktree when provisioning wins the backing-directory fence", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "provisioning-wins");
    const logger = createLogger();
    const coordinator = new WorkspaceLifecycleCoordinator();
    let markArchiveBackingFenceRequested!: () => void;
    const archiveBackingFenceRequested = new Promise<void>((resolve) => {
      markArchiveBackingFenceRequested = resolve;
    });
    const serializeBackingDirectories = coordinator.serializeBackingDirectories.bind(coordinator);
    let backingFenceRequests = 0;
    coordinator.serializeBackingDirectories = function <T>(backingDirectories, operation) {
      backingFenceRequests += 1;
      if (backingFenceRequests === 2) markArchiveBackingFenceRequested();
      return serializeBackingDirectories(backingDirectories, operation) as Promise<T>;
    };
    const workspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(tempDir, "state", "workspaces.json"),
      logger,
    );
    const projectRegistry = new FileBackedProjectRegistry(
      path.join(tempDir, "state", "projects.json"),
      logger,
    );
    await Promise.all([workspaceRegistry.initialize(), projectRegistry.initialize()]);
    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: repoDir,
      kind: "git",
      displayName: "repo",
      timestamp: "2026-08-11T00:00:00.000Z",
    });
    const checkout = createArchiveRaceCheckout(worktree.worktreePath, repoDir);
    const provisioning = createWorkspaceProvisioningService({
      workspaceRegistry,
      projectRegistry,
      workspaceGitService: checkout,
      workspaceLifecycle: coordinator,
      logger,
    });

    let releaseUpsert!: () => void;
    let markUpsertEntered!: () => void;
    const upsertGate = new Promise<void>((resolve) => {
      releaseUpsert = resolve;
    });
    const upsertEntered = new Promise<void>((resolve) => {
      markUpsertEntered = resolve;
    });
    const originalUpsert = workspaceRegistry.upsert.bind(workspaceRegistry);
    workspaceRegistry.upsert = async (record, context) => {
      markUpsertEntered();
      await upsertGate;
      await originalUpsert(record, context);
    };

    const provision = provisioning.createWorkspaceForDirectory(
      worktree.worktreePath,
      null,
      project.projectId,
    );
    await upsertEntered;
    const archiveDeps = createRegistryBackedArchiveDeps({
      paseoHome,
      coordinator,
      workspaceRegistry,
    });
    const archive = archiveByScope(archiveDeps, {
      scope: { kind: "worktree", targetPath: worktree.worktreePath },
      requestId: "req-provisioning-wins",
    });

    await archiveBackingFenceRequested;
    releaseUpsert();
    const [workspace, archiveResult] = await Promise.all([provision, archive]);

    expect(await workspaceRegistry.get(workspace.workspaceId)).toEqual(workspace);
    expect(archiveResult.removedDirectory).toBe(false);
    expect(existsSync(worktree.worktreePath)).toBe(true);
  });

  test("does not provision after a zero-record archive wins the backing-directory fence", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "archive-wins");
    const logger = createLogger();
    const coordinator = new WorkspaceLifecycleCoordinator();
    const workspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(tempDir, "state", "workspaces.json"),
      logger,
    );
    const projectRegistry = new FileBackedProjectRegistry(
      path.join(tempDir, "state", "projects.json"),
      logger,
    );
    await Promise.all([workspaceRegistry.initialize(), projectRegistry.initialize()]);
    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: repoDir,
      kind: "git",
      displayName: "repo",
      timestamp: "2026-08-11T00:00:00.000Z",
    });
    const baseCheckout = createArchiveRaceCheckout(worktree.worktreePath, repoDir);
    let markProvisioningObservedCheckout!: () => void;
    const provisioningObservedCheckout = new Promise<void>((resolve) => {
      markProvisioningObservedCheckout = resolve;
    });
    const checkout = {
      ...baseCheckout,
      getCheckout: async (cwd: string) => {
        const result = await baseCheckout.getCheckout(cwd);
        if (createRealpathAwarePathMatcher(worktree.worktreePath)(cwd)) {
          markProvisioningObservedCheckout();
        }
        return result;
      },
    };
    const provisioning = createWorkspaceProvisioningService({
      workspaceRegistry,
      projectRegistry,
      workspaceGitService: checkout,
      workspaceLifecycle: coordinator,
      logger,
    });
    const archiveDeps = createRegistryBackedArchiveDeps({
      paseoHome,
      coordinator,
      workspaceRegistry,
    });
    const listActiveWorkspaces = archiveDeps.listActiveWorkspaces;
    let archiveListCalls = 0;
    let releaseFinalReferenceCheck!: () => void;
    let markFinalReferenceCheckEntered!: () => void;
    const finalReferenceCheckGate = new Promise<void>((resolve) => {
      releaseFinalReferenceCheck = resolve;
    });
    const finalReferenceCheckEntered = new Promise<void>((resolve) => {
      markFinalReferenceCheckEntered = resolve;
    });
    archiveDeps.listActiveWorkspaces = async () => {
      const active = await listActiveWorkspaces();
      archiveListCalls += 1;
      if (archiveListCalls === 2) {
        markFinalReferenceCheckEntered();
        await finalReferenceCheckGate;
      }
      return active;
    };

    const archive = archiveByScope(archiveDeps, {
      scope: { kind: "worktree", targetPath: worktree.worktreePath },
      requestId: "req-archive-wins",
    });
    await finalReferenceCheckEntered;
    const provision = provisioning.createWorkspaceForDirectory(
      worktree.worktreePath,
      null,
      project.projectId,
    );
    await provisioningObservedCheckout;
    releaseFinalReferenceCheck();

    const archiveResult = await archive;
    await expect(provision).rejects.toThrow(
      "Workspace backing directory changed during provisioning",
    );

    expect(archiveResult.removedDirectory).toBe(true);
    expect(await workspaceRegistry.list()).toEqual([]);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("does not restore an archived workspace after its backing directory is deleted", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "archive-beats-restore");
    const logger = createLogger();
    const coordinator = new WorkspaceLifecycleCoordinator();
    let markRestoreBackingFenceRequested!: () => void;
    const restoreBackingFenceRequested = new Promise<void>((resolve) => {
      markRestoreBackingFenceRequested = resolve;
    });
    const serializeBackingDirectories = coordinator.serializeBackingDirectories.bind(coordinator);
    let backingFenceRequests = 0;
    coordinator.serializeBackingDirectories = function <T>(backingDirectories, operation) {
      backingFenceRequests += 1;
      if (backingFenceRequests === 2) markRestoreBackingFenceRequested();
      return serializeBackingDirectories(backingDirectories, operation) as Promise<T>;
    };
    const workspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(tempDir, "state", "workspaces.json"),
      logger,
    );
    const projectRegistry = new FileBackedProjectRegistry(
      path.join(tempDir, "state", "projects.json"),
      logger,
    );
    await Promise.all([workspaceRegistry.initialize(), projectRegistry.initialize()]);
    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: repoDir,
      kind: "git",
      displayName: "repo",
      timestamp: "2026-08-11T00:00:00.000Z",
    });
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "ws-archive-beats-restore",
      projectId: project.projectId,
      cwd: worktree.worktreePath,
      kind: "worktree",
      displayName: "archive-beats-restore",
      branch: "archive-beats-restore",
      worktreeRoot: worktree.worktreePath,
      isPaseoOwnedWorktree: true,
      mainRepoRoot: repoDir,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      archivedAt: "2026-08-11T00:01:00.000Z",
    });
    await workspaceRegistry.upsert(workspace);
    const provisioning = createWorkspaceProvisioningService({
      workspaceRegistry,
      projectRegistry,
      workspaceGitService: createArchiveRaceCheckout(worktree.worktreePath, repoDir),
      workspaceLifecycle: coordinator,
      logger,
    });
    const archiveDeps = createRegistryBackedArchiveDeps({
      paseoHome,
      coordinator,
      workspaceRegistry,
    });
    const listActiveWorkspaces = archiveDeps.listActiveWorkspaces;
    let archiveListCalls = 0;
    let releaseFinalReferenceCheck!: () => void;
    let markFinalReferenceCheckEntered!: () => void;
    const finalReferenceCheckGate = new Promise<void>((resolve) => {
      releaseFinalReferenceCheck = resolve;
    });
    const finalReferenceCheckEntered = new Promise<void>((resolve) => {
      markFinalReferenceCheckEntered = resolve;
    });
    archiveDeps.listActiveWorkspaces = async () => {
      const active = await listActiveWorkspaces();
      archiveListCalls += 1;
      if (archiveListCalls === 2) {
        markFinalReferenceCheckEntered();
        await finalReferenceCheckGate;
      }
      return active;
    };

    const archive = archiveByScope(archiveDeps, {
      scope: { kind: "worktree", targetPath: worktree.worktreePath },
      requestId: "req-archive-beats-restore",
    });
    await finalReferenceCheckEntered;
    const restore = provisioning.ensureWorkspaceRecordUnarchived(workspace);
    await restoreBackingFenceRequested;
    releaseFinalReferenceCheck();

    const archiveResult = await archive;
    await expect(restore).rejects.toThrow(
      "Workspace backing directory changed during provisioning",
    );

    expect(archiveResult.removedDirectory).toBe(true);
    expect(await workspaceRegistry.get(workspace.workspaceId)).toEqual(workspace);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("marks archiving, emits an upsert carrying the archiving state, then clears it and emits a remove", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "lifecycle");
    const workspaceId = "ws-lifecycle";

    const deps = createArchiveDeps({
      paseoHome,
      activeWorkspaces: [{ workspaceId, cwd: worktree.worktreePath, kind: "worktree" }],
    });

    const archivingByWorkspaceId = new Map<string, string>();
    type LifecycleEvent =
      | { type: "mark"; workspaceIds: string[]; archivingAt: string }
      | {
          type: "emit";
          workspaceIds: string[];
          updates: Array<{
            kind: "upsert" | "remove";
            workspaceId: string;
            archivingAt: string | null;
          }>;
        }
      | { type: "archive"; workspaceId: string }
      | { type: "clear"; workspaceIds: string[] };
    const events: LifecycleEvent[] = [];

    const originalArchiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = async (id: string) => {
      await originalArchiveWorkspaceRecord(id);
      events.push({ type: "archive", workspaceId: id });
    };
    deps.markWorkspaceArchiving = vi.fn((workspaceIds: Iterable<string>, archivingAt: string) => {
      for (const id of workspaceIds) {
        archivingByWorkspaceId.set(id, archivingAt);
      }
      events.push({ type: "mark", workspaceIds: Array.from(workspaceIds), archivingAt });
    });
    deps.clearWorkspaceArchiving = vi.fn((workspaceIds: Iterable<string>) => {
      for (const id of workspaceIds) {
        archivingByWorkspaceId.delete(id);
      }
      events.push({ type: "clear", workspaceIds: Array.from(workspaceIds) });
    });
    deps.emitWorkspaceUpdatesForWorkspaceIds = vi.fn(async (workspaceIds: Iterable<string>) => {
      const ids = Array.from(workspaceIds);
      const activeIds = new Set<string>();
      for (const workspace of deps.activeWorkspaces) {
        activeIds.add(workspace.workspaceId);
      }
      const updates: Array<{
        kind: "upsert" | "remove";
        workspaceId: string;
        archivingAt: string | null;
      }> = [];
      for (const id of ids) {
        const archivingAt = archivingByWorkspaceId.get(id) ?? null;
        if (archivingAt && activeIds.has(id)) {
          updates.push({ kind: "upsert", workspaceId: id, archivingAt });
        } else {
          updates.push({ kind: "remove", workspaceId: id, archivingAt: null });
        }
      }
      events.push({ type: "emit", workspaceIds: ids, updates });
    });

    await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      requestId: "req-lifecycle",
    });

    expect(events.map((event) => event.type)).toEqual(["mark", "emit", "archive", "clear", "emit"]);

    const firstEmit = events[1] as Extract<LifecycleEvent, { type: "emit" }>;
    expect(firstEmit.workspaceIds).toEqual([workspaceId]);
    expect(firstEmit.updates).toEqual([
      { kind: "upsert", workspaceId, archivingAt: expect.any(String) },
    ]);

    const secondEmit = events[4] as Extract<LifecycleEvent, { type: "emit" }>;
    expect(secondEmit.workspaceIds).toEqual([workspaceId]);
    expect(secondEmit.updates).toEqual([{ kind: "remove", workspaceId, archivingAt: null }]);
  });

  test("archives stored snapshots only for the target workspace", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "snapshot-scope");
    const targetWorkspaceId = "ws-snapshot-target";
    const otherWorkspaceId = "ws-snapshot-other";
    const liveAgentId = "agent-live";
    const targetStoredAgentId = "agent-stored-target";
    const otherStoredAgentId = "agent-stored-other";

    const deps = createArchiveDeps({
      paseoHome,
      activeWorkspaces: [
        { workspaceId: targetWorkspaceId, cwd: worktree.worktreePath, kind: "worktree" },
      ],
    });
    deps.agentManager = {
      listAgents: () => [{ id: liveAgentId, workspaceId: targetWorkspaceId }] as ManagedAgent[],
      getAgent: (agentId: string) =>
        agentId === liveAgentId ? ({ id: liveAgentId } as ManagedAgent) : null,
      archiveAgent: vi.fn(async (agentId: string) => {
        deps.archivedAgentIds.push(agentId);
        return { archivedAt: new Date().toISOString() };
      }),
      archiveSnapshot: vi.fn(async (agentId: string, _archivedAt: string) => {
        deps.archivedSnapshotIds.push(agentId);
        return {};
      }),
    };
    deps.agentStorage = {
      listByWorkspace: async (workspaceId: string) =>
        workspaceId === targetWorkspaceId
          ? ([
              { id: targetStoredAgentId, workspaceId: targetWorkspaceId, archivedAt: null },
            ] as StoredAgentRecord[])
          : ([
              { id: otherStoredAgentId, workspaceId: otherWorkspaceId, archivedAt: null },
            ] as StoredAgentRecord[]),
    } as Pick<AgentStorage, "listByWorkspace">;

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: targetWorkspaceId },
      requestId: "req-snapshot-scope",
    });

    assertArchiveResult(result, {
      archivedWorkspaceIds: [targetWorkspaceId],
      removedDirectory: true,
    });
    expect(result.archivedAgentIds).toContain(liveAgentId);
    expect(result.archivedAgentIds).toContain(targetStoredAgentId);
    expect(result.archivedAgentIds).not.toContain(otherStoredAgentId);
    expect(deps.archivedSnapshotIds).toEqual([targetStoredAgentId]);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("retains the archive intent when stored ownership cannot be enumerated", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-storage-list-failure";
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    const archiveWorkspaceRecord = vi.fn(deps.archiveWorkspaceRecord);
    deps.archiveWorkspaceRecord = archiveWorkspaceRecord;
    deps.agentStorage = {
      listByWorkspace: vi.fn(async () => {
        throw new Error("stored ownership unavailable");
      }),
    } as Pick<AgentStorage, "listByWorkspace">;

    await expect(
      archiveByScope(deps, {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-storage-list-failure",
      }),
    ).rejects.toThrow("Failed to archive 1 workspace record");

    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(deps.archiveIntents.get(workspaceId)).toMatchObject({
      requestId: "req-storage-list-failure",
    });
  });

  test("retains the archive intent when owned runtime teardown fails", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-runtime-teardown-failure";
    const agentId = "agent-runtime-teardown-failure";
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    const archiveWorkspaceRecord = vi.fn(deps.archiveWorkspaceRecord);
    deps.archiveWorkspaceRecord = archiveWorkspaceRecord;
    deps.agentManager = {
      listAgents: () => [{ id: agentId, workspaceId }] as ManagedAgent[],
      getAgent: () => ({ id: agentId }) as ManagedAgent,
      archiveAgent: vi.fn(async () => {
        throw new Error("provider close failed");
      }),
      archiveSnapshot: vi.fn(async () => ({})),
    };

    await expect(
      archiveByScope(deps, {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-runtime-teardown-failure",
      }),
    ).rejects.toThrow("Failed to archive 1 workspace record");

    expect(deps.killTerminalsForWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(deps.archiveIntents.get(workspaceId)).toMatchObject({
      requestId: "req-runtime-teardown-failure",
    });
  });

  test("retains the archive intent after attempting every terminal enumeration and kill", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const workspaceId = "ws-terminal-teardown-failure";
    const deps = createArchiveDeps({
      paseoHome: path.join(tempDir, ".paseo"),
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    const archiveWorkspaceRecord = vi.fn(deps.archiveWorkspaceRecord);
    deps.archiveWorkspaceRecord = archiveWorkspaceRecord;

    const terminal = (id: string, terminalWorkspaceId = workspaceId) =>
      ({ id, workspaceId: terminalWorkspaceId }) as TerminalSession;
    const getTerminals = vi.fn(async (cwd: string) => {
      if (cwd === "/unreadable") {
        throw new Error("terminal enumeration failed");
      }
      return [
        terminal("terminal-fails"),
        terminal("terminal-closes"),
        terminal("terminal-other", "ws-other"),
      ];
    });
    const killTerminalAndWait = vi.fn(async (terminalId: string) => {
      if (terminalId === "terminal-fails") {
        throw new Error("terminal kill failed");
      }
    });
    const terminalManager = {
      listDirectories: () => ["/unreadable", "/readable"],
      getTerminals,
      killTerminalAndWait,
    } as unknown as TerminalManager;
    deps.killTerminalsForWorkspace = (candidateWorkspaceId) =>
      killTerminalsForWorkspace(
        {
          terminalManager,
          sessionLogger: deps.sessionLogger!,
        },
        candidateWorkspaceId,
      );

    await expect(
      archiveByScope(deps, {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-terminal-teardown-failure",
      }),
    ).rejects.toThrow("Failed to archive 1 workspace record");

    expect(getTerminals).toHaveBeenCalledTimes(2);
    expect(killTerminalAndWait.mock.calls.map(([terminalId]) => terminalId).toSorted()).toEqual([
      "terminal-closes",
      "terminal-fails",
    ]);
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(deps.archiveIntents.get(workspaceId)).toMatchObject({
      requestId: "req-terminal-teardown-failure",
    });
  });

  test("keeps every archive intent until the shared backing directory is physically removed", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(
      repoDir,
      paseoHome,
      "archive-intent-delete-fence",
    );
    const workspaceA = "ws-delete-fence-a";
    const workspaceB = "ws-delete-fence-b";
    const racingWorkspaceId = "ws-delete-fence-racing-create";
    const deps = createArchiveDeps({
      paseoHome,
      activeWorkspaces: [
        { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
        { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "worktree" },
      ],
    });

    let activeWorkspaceListCalls = 0;
    let racingCreateBlocked = false;
    const listActiveWorkspaces = deps.listActiveWorkspaces;
    deps.listActiveWorkspaces = async () => {
      activeWorkspaceListCalls += 1;
      const snapshot = await listActiveWorkspaces();
      if (activeWorkspaceListCalls === 2) {
        queueMicrotask(() => {
          if (deps.archiveIntents.has(workspaceA) && deps.archiveIntents.has(workspaceB)) {
            racingCreateBlocked = true;
            return;
          }
          deps.activeWorkspaces.push({
            workspaceId: racingWorkspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
          });
        });
      }
      return snapshot;
    };

    const finalizationSnapshots: Array<{
      workspaceId: string;
      directoryExists: boolean;
      ownIntentPresent: boolean;
    }> = [];
    const archiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = async (workspaceId) => {
      finalizationSnapshots.push({
        workspaceId,
        directoryExists: existsSync(worktree.worktreePath),
        ownIntentPresent: deps.archiveIntents.has(workspaceId),
      });
      await archiveWorkspaceRecord(workspaceId);
    };

    const result = await archiveByScope(deps, {
      scope: { kind: "worktree", targetPath: worktree.worktreePath },
      requestId: "req-archive-intent-delete-fence",
    });

    expect(result.archivedWorkspaceIds.toSorted()).toEqual([workspaceA, workspaceB]);
    expect(result.removedDirectory).toBe(true);
    expect(racingCreateBlocked).toBe(true);
    expect(deps.activeWorkspaces).not.toContainEqual(
      expect.objectContaining({ workspaceId: racingWorkspaceId }),
    );
    expect(finalizationSnapshots).toHaveLength(2);
    expect(finalizationSnapshots).toEqual(
      expect.arrayContaining([
        { workspaceId: workspaceA, directoryExists: false, ownIntentPresent: true },
        { workspaceId: workspaceB, directoryExists: false, ownIntentPresent: true },
      ]),
    );
  });

  test("archives the durable snapshot when an observed live agent closes before teardown", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const workspaceId = "ws-live-teardown-race";
    const agentId = "agent-live-teardown-race";
    const deps = createArchiveDeps({
      paseoHome,
      activeWorkspaces: [{ workspaceId, cwd: repoDir, kind: "local_checkout" }],
    });
    deps.agentManager = {
      listAgents: () => [{ id: agentId, workspaceId }] as ManagedAgent[],
      getAgent: () => null,
      archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
      archiveSnapshot: vi.fn(async (id: string) => {
        deps.archivedSnapshotIds.push(id);
        return {};
      }),
    };
    deps.agentStorage = {
      listByWorkspace: async () =>
        [{ id: agentId, workspaceId, archivedAt: null }] as StoredAgentRecord[],
    } as Pick<AgentStorage, "listByWorkspace">;

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      requestId: "req-live-teardown-race",
    });

    expect(result.archivedAgentIds).toContain(agentId);
    expect(deps.archivedSnapshotIds).toEqual([agentId]);
    expect(deps.agentManager.archiveAgent).not.toHaveBeenCalled();
  });

  test("worktree scope archives three workspaces on the directory and removes it", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const paseoHome = path.join(tempDir, ".paseo");
    const worktree = await createPaseoOwnedWorktree(repoDir, paseoHome, "worktree-scope-n3");
    const workspaceA = "ws-worktree-n3-a";
    const workspaceB = "ws-worktree-n3-b";
    const workspaceC = "ws-worktree-n3-c";

    const result = await archiveByScope(
      createArchiveDeps({
        paseoHome,
        activeWorkspaces: [
          { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
          { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "worktree" },
          { workspaceId: workspaceC, cwd: worktree.worktreePath, kind: "local_checkout" },
        ],
      }),
      {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        requestId: "req-worktree-scope-n3",
      },
    );

    expect(result.archivedWorkspaceIds).toEqual(
      expect.arrayContaining([workspaceA, workspaceB, workspaceC]),
    );
    expect(result.archivedWorkspaceIds).toHaveLength(3);
    expect(result.removedDirectory).toBe(true);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });
});

describe("resolveWorkspaceIdAtPath", () => {
  test("prefers the worktree-kind record on an exact cwd tie", async () => {
    const targetPath = "/worktrees/repo/feature";

    const result = await resolveWorkspaceIdAtPath(
      {
        listActiveWorkspaces: async () => [
          { workspaceId: "ws-local", cwd: targetPath, kind: "local_checkout" },
          { workspaceId: "ws-worktree", cwd: targetPath, kind: "worktree" },
        ],
        findWorkspaceIdForCwd: vi.fn(async () => "ws-local"),
      },
      targetPath,
    );

    expect(result).toBe("ws-worktree");
  });

  test("falls back to the path resolver when there is no exact match", async () => {
    const targetPath = "/worktrees/repo/feature";

    const result = await resolveWorkspaceIdAtPath(
      {
        listActiveWorkspaces: async () => [
          { workspaceId: "ws-nested", cwd: "/worktrees/repo", kind: "worktree" },
        ],
        findWorkspaceIdForCwd: vi.fn(async () => "ws-nested"),
      },
      targetPath,
    );

    expect(result).toBe("ws-nested");
  });
});
