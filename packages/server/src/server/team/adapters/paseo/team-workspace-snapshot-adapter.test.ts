import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PaseoTeamWorkspaceSnapshotAdapter } from "./team-workspace-snapshot-adapter.js";

const execFileAsync = promisify(execFile);
const NOW = "2026-08-08T12:00:00.000Z";

describe("PaseoTeamWorkspaceSnapshotAdapter", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "team-workspace-snapshot-"));
    await execFileAsync("git", ["init", workspace]);
    await mkdir(join(workspace, "packages/server"), { recursive: true });
    await writeFile(join(workspace, ".gitignore"), "dist/\n", "utf8");
    await writeFile(join(workspace, "packages/server/api.ts"), "export const api = 1;\n", "utf8");
    await execFileAsync("git", ["-C", workspace, "add", ".gitignore", "packages/server/api.ts"]);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  test("captures tracked and non-ignored changes while excluding ignored build output", async () => {
    const adapter = new PaseoTeamWorkspaceSnapshotAdapter({
      resolveWorkspaceCwd: async () => workspace,
      clock: { now: () => NOW },
    });
    const policy = {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    };
    const baseline = await adapter.captureBaseline({
      workspaceId: "workspace-1",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      policy,
    });
    await writeFile(join(workspace, "packages/server/api.ts"), "export const api = 2;\n", "utf8");
    await mkdir(join(workspace, "packages/app"), { recursive: true });
    await writeFile(join(workspace, "packages/app/unsafe.ts"), "export const unsafe = true;\n");
    await mkdir(join(workspace, "dist"), { recursive: true });
    await writeFile(join(workspace, "dist/output.js"), "ignored\n");

    const delta = await adapter.captureDelta({
      workspaceId: "workspace-1",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      baseline,
      policy,
    });

    expect(delta.capturedDelta.map((entry) => entry.path).toSorted()).toEqual([
      "packages/app/unsafe.ts",
      "packages/server/api.ts",
    ]);
    expect(delta.violations).toEqual([
      expect.objectContaining({ path: "packages/app/unsafe.ts", fingerprint: expect.any(String) }),
    ]);
    expect(delta.capturedDelta).not.toContainEqual(
      expect.objectContaining({ path: "dist/output.js" }),
    );
  });

  test("does not attribute a path owned by another active workspace lease", async () => {
    const ownershipRequests: Array<Record<string, string>> = [];
    const adapter = new PaseoTeamWorkspaceSnapshotAdapter({
      resolveWorkspaceCwd: async () => workspace,
      clock: { now: () => NOW },
      classifyPathOwnership: async (input) => {
        ownershipRequests.push(input as unknown as Record<string, string>);
        return input.path.startsWith("packages/app/") ? "external" : "unowned";
      },
    });
    const policy = {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    };
    const baseline = await adapter.captureBaseline({
      workspaceId: "workspace-1",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      policy,
    });
    await mkdir(join(workspace, "packages/app"), { recursive: true });
    await writeFile(join(workspace, "packages/app/owned.ts"), "export const owned = true;\n");

    const delta = await adapter.captureDelta({
      workspaceId: "workspace-1",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      baseline,
      policy,
    });

    expect(delta).toEqual({ capturedDelta: [], violations: [] });
    expect(ownershipRequests).toEqual([
      {
        workspaceId: "workspace-1",
        assignmentId: "assignment-api",
        path: "packages/app/owned.ts",
        intervalStartedAt: NOW,
        intervalEndedAt: NOW,
      },
    ]);
  });

  test("includes explicitly declared ignored artifacts but excludes ordinary ignored output", async () => {
    const adapter = new PaseoTeamWorkspaceSnapshotAdapter({
      resolveWorkspaceCwd: async () => workspace,
      clock: { now: () => NOW },
    });
    const policy = {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    };
    await mkdir(join(workspace, "dist"), { recursive: true });
    await writeFile(join(workspace, "dist/report.json"), '{"version":1}\n');
    const baseline = await adapter.captureBaseline({
      workspaceId: "workspace-1",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server", "dist/report.json"] },
      policy,
    });

    await writeFile(join(workspace, "dist/report.json"), '{"version":2}\n');
    await writeFile(join(workspace, "dist/output.js"), "ordinary ignored build output\n");
    await mkdir(join(workspace, "packages/server/dist"), { recursive: true });
    await writeFile(
      join(workspace, "packages/server/dist/output.js"),
      "ignored output inside a mutable directory\n",
    );
    const delta = await adapter.captureDelta({
      workspaceId: "workspace-1",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server", "dist/report.json"] },
      baseline,
      policy,
    });

    expect(baseline.entries).toContainEqual(
      expect.objectContaining({ path: "dist/report.json", classification: "declared_artifact" }),
    );
    expect(baseline.entries).not.toContainEqual(
      expect.objectContaining({ path: "dist/output.js" }),
    );
    expect(delta.capturedDelta).toContainEqual(
      expect.objectContaining({ path: "dist/report.json", fingerprint: expect.any(String) }),
    );
    expect(delta.capturedDelta).not.toContainEqual(
      expect.objectContaining({ path: "dist/output.js" }),
    );
    expect(delta.capturedDelta).not.toContainEqual(
      expect.objectContaining({ path: "packages/server/dist/output.js" }),
    );
  });
});
