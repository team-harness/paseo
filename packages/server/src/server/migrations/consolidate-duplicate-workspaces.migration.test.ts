import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage } from "../agent/agent-storage.js";
import {
  FileBackedWorkspaceRegistry,
  createPersistedWorkspaceRecord,
} from "../workspace-registry.js";
import { consolidateDuplicateWorkspaces } from "./consolidate-duplicate-workspaces.migration.js";

describe("consolidateDuplicateWorkspaces", () => {
  let home: string;
  let agentStorage: AgentStorage;
  let workspaceRegistry: FileBackedWorkspaceRegistry;

  beforeEach(async () => {
    home = mkdtempSync(path.join(tmpdir(), "paseo-consolidate-workspaces-"));
    agentStorage = new AgentStorage(path.join(home, "agents"), createTestLogger());
    await agentStorage.initialize();
    workspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(home, "workspaces.json"),
      createTestLogger(),
    );
    await workspaceRegistry.initialize();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  async function seedWorkspace(input: {
    id: string;
    cwd: string;
    createdAt: string;
  }): Promise<void> {
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: input.id,
        projectId: "project",
        cwd: input.cwd,
        kind: "local_checkout",
        displayName: "main",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }),
    );
  }

  async function seedAgent(id: string, workspaceId: string): Promise<void> {
    await agentStorage.upsert({
      id,
      provider: "codex",
      cwd: "/tmp/repo",
      workspaceId,
      createdAt: "2026-07-14T12:00:00.000Z",
      updatedAt: "2026-07-14T12:00:00.000Z",
      lastActivityAt: "2026-07-14T12:00:00.000Z",
      lastUserMessageAt: null,
      title: null,
      labels: {},
      lastStatus: "closed",
      lastModeId: null,
      config: null,
      runtimeInfo: { provider: "codex", sessionId: null },
      persistence: null,
      archivedAt: null,
    });
  }

  test("reassigns agents before archiving duplicate active workspaces", async () => {
    await seedWorkspace({
      id: "ws-canonical",
      cwd: "/tmp/repo",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    await seedWorkspace({
      id: "ws-duplicate",
      cwd: "/tmp/repo",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    await seedWorkspace({
      id: "ws-other",
      cwd: "/tmp/other-repo",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    await seedAgent("agent-canonical", "ws-canonical");
    await seedAgent("agent-duplicate", "ws-duplicate");

    const result = await consolidateDuplicateWorkspaces({
      agentStorage,
      workspaceRegistry,
      logger: createTestLogger(),
    });

    expect(result).toEqual({ archivedWorkspaces: 1, reassignedAgents: 1 });
    expect((await agentStorage.get("agent-canonical"))?.workspaceId).toBe("ws-canonical");
    expect((await agentStorage.get("agent-duplicate"))?.workspaceId).toBe("ws-canonical");
    expect((await workspaceRegistry.get("ws-canonical"))?.archivedAt).toBeNull();
    expect((await workspaceRegistry.get("ws-duplicate"))?.archivedAt).not.toBeNull();
    expect((await workspaceRegistry.get("ws-other"))?.archivedAt).toBeNull();
  });

  test("is idempotent after duplicate workspaces have been archived", async () => {
    await seedWorkspace({
      id: "ws-first",
      cwd: "/tmp/repo",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    await seedWorkspace({
      id: "ws-second",
      cwd: "/tmp/repo",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    await seedAgent("agent", "ws-second");

    await consolidateDuplicateWorkspaces({
      agentStorage,
      workspaceRegistry,
      logger: createTestLogger(),
    });
    const repeated = await consolidateDuplicateWorkspaces({
      agentStorage,
      workspaceRegistry,
      logger: createTestLogger(),
    });

    expect(repeated).toEqual({ archivedWorkspaces: 0, reassignedAgents: 0 });
    expect((await agentStorage.get("agent"))?.workspaceId).toBe("ws-first");
  });
});
