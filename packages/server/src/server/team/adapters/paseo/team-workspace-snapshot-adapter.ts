import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  MissionMutableScope,
  MissionWorkspaceAuditPolicy,
  MissionWorkspaceBaseline,
} from "@getpaseo/protocol/team/v2-types";

import type { TeamClockPort } from "../../application/ports.js";
import type { TeamWorkspaceSnapshotPort } from "../../application/team-mission-scheduler.js";

const execFileAsync = promisify(execFile);

export type TeamPathOwnership = "current" | "external" | "unowned" | "ambiguous";

interface PaseoTeamWorkspaceSnapshotAdapterOptions {
  resolveWorkspaceCwd(workspaceId: string): Promise<string | null>;
  classifyPathOwnership?(input: {
    workspaceId: string;
    assignmentId: string;
    path: string;
    intervalStartedAt: string;
    intervalEndedAt: string;
  }): Promise<TeamPathOwnership>;
  clock: TeamClockPort;
}

type BaselineEntry = MissionWorkspaceBaseline["entries"][number];

export class PaseoTeamWorkspaceSnapshotAdapter implements TeamWorkspaceSnapshotPort {
  constructor(private readonly options: PaseoTeamWorkspaceSnapshotAdapterOptions) {}

  async captureBaseline(
    input: Parameters<TeamWorkspaceSnapshotPort["captureBaseline"]>[0],
  ): Promise<MissionWorkspaceBaseline> {
    const cwd = await this.requireWorkspaceCwd(input.workspaceId);
    const entries = await captureWorkspaceEntries(cwd, input.policy, input.scope);
    const capturedAt = this.options.clock.now();
    return {
      baselineId: baselineId(input.workspaceId, input.assignmentId, capturedAt, entries),
      workspaceId: input.workspaceId,
      assignmentId: input.assignmentId,
      policyRevision: input.policy.revision,
      capturedAt,
      entries,
    };
  }

  async captureDelta(
    input: Parameters<TeamWorkspaceSnapshotPort["captureDelta"]>[0],
  ): Promise<Awaited<ReturnType<TeamWorkspaceSnapshotPort["captureDelta"]>>> {
    const cwd = await this.requireWorkspaceCwd(input.workspaceId);
    const current = await captureWorkspaceEntries(cwd, input.policy, input.scope);
    const capturedAt = this.options.clock.now();
    const baselineByPath = new Map(input.baseline.entries.map((entry) => [entry.path, entry]));
    const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
    const changedPaths = [...new Set([...baselineByPath.keys(), ...currentByPath.keys()])]
      .filter(
        (candidatePath) =>
          baselineByPath.get(candidatePath)?.fingerprint !==
          currentByPath.get(candidatePath)?.fingerprint,
      )
      .toSorted();
    const capturedDelta: Array<{ path: string; fingerprint: string }> = [];
    const violations: Array<{ path: string; fingerprint: string }> = [];
    for (const changedPath of changedPaths) {
      const fingerprint = currentByPath.get(changedPath)?.fingerprint ?? "deleted";
      if (!scopeContainsPath(input.scope, changedPath)) {
        const ownership = await this.options.classifyPathOwnership?.({
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          path: changedPath,
          intervalStartedAt: input.baseline.capturedAt,
          intervalEndedAt: capturedAt,
        });
        if (ownership === "external") continue;
        violations.push({ path: changedPath, fingerprint });
      }
      capturedDelta.push({ path: changedPath, fingerprint });
    }
    return { capturedDelta, violations };
  }

  private async requireWorkspaceCwd(workspaceId: string): Promise<string> {
    const cwd = await this.options.resolveWorkspaceCwd(workspaceId);
    if (!cwd) throw new Error(`Workspace ${workspaceId} has no directory for audit capture`);
    return cwd;
  }
}

async function captureWorkspaceEntries(
  cwd: string,
  policy: MissionWorkspaceAuditPolicy,
  scope: MissionMutableScope,
): Promise<BaselineEntry[]> {
  const entries = new Map<string, BaselineEntry["classification"]>();
  if (policy.includeTrackedPaths) {
    for (const trackedPath of await gitPaths(cwd, ["--cached"])) {
      entries.set(trackedPath, "tracked");
    }
  }
  if (policy.includeNonIgnoredUntrackedPaths) {
    for (const untrackedPath of await gitPaths(cwd, ["--others", "--exclude-standard"])) {
      if (!entries.has(untrackedPath)) entries.set(untrackedPath, "non_ignored_untracked");
    }
  }
  if (policy.includeDeclaredArtifactPaths && scope.kind === "paths") {
    for (const ignoredPath of await gitPaths(cwd, [
      "--others",
      "--ignored",
      "--exclude-standard",
    ])) {
      if (scope.pathPrefixes.includes(ignoredPath) && !entries.has(ignoredPath)) {
        entries.set(ignoredPath, "declared_artifact");
      }
    }
  }
  return Promise.all(
    [...entries]
      .filter(([candidatePath]) => !isExcludedPath(candidatePath, policy.excludedPathPrefixes))
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(async ([candidatePath, classification]) => ({
        path: candidatePath,
        fingerprint: await fingerprintPath(path.join(cwd, candidatePath)),
        classification,
      })),
  );
}

async function gitPaths(cwd: string, selectors: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "ls-files", ...selectors, "-z"], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

async function fingerprintPath(filePath: string): Promise<string> {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) {
      return `sha256:${createHash("sha256")
        .update(`symlink:${await readlink(filePath)}`)
        .digest("hex")}`;
    }
    if (!stat.isFile()) return `type:${stat.mode}`;
    return `sha256:${createHash("sha256")
      .update(await readFile(filePath))
      .digest("hex")}`;
  } catch (error) {
    if (isMissingFile(error)) return "deleted";
    throw error;
  }
}

function scopeContainsPath(scope: MissionMutableScope, candidatePath: string): boolean {
  if (scope.kind === "workspace") return true;
  if (scope.kind === "read_only") return false;
  return scope.pathPrefixes.some(
    (prefix) => candidatePath === prefix || candidatePath.startsWith(`${prefix}/`),
  );
}

function isExcludedPath(candidatePath: string, excludedPathPrefixes: string[]): boolean {
  return excludedPathPrefixes.some(
    (prefix) => candidatePath === prefix || candidatePath.startsWith(`${prefix}/`),
  );
}

function baselineId(
  workspaceId: string,
  assignmentId: string,
  capturedAt: string,
  entries: BaselineEntry[],
): string {
  return `baseline:${createHash("sha256")
    .update(JSON.stringify({ workspaceId, assignmentId, capturedAt, entries }))
    .digest("hex")}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
