import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import pino from "pino";
import { SessionPinStore } from "./session-pin-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "paseo-session-pins-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createStore(): SessionPinStore {
  return new SessionPinStore({
    filePath: path.join(tempDir, "status-summary", "session-pins.json"),
    logger: pino({ level: "silent" }),
    clock: () => new Date("2026-07-08T00:00:00.000Z"),
  });
}

describe("SessionPinStore", () => {
  test("sets, updates, unsets, and persists pinned sessions by agent id", async () => {
    const store = createStore();
    await store.initialize();

    await store.setPinned({
      agentId: "agent-1",
      pinned: true,
      workspaceId: "workspace-1",
      title: "First",
      provider: "codex",
      cwd: "/work/first",
      status: "running",
      requiresAttention: false,
      attentionReason: null,
      pendingPermissionCount: 0,
      updatedAt: "2026-07-08T00:00:00.000Z",
    });
    await store.setPinned({
      agentId: "agent-1",
      pinned: true,
      workspaceId: "workspace-2",
      title: "Updated",
      provider: "claude",
      cwd: "/work/updated",
      status: "idle",
      requiresAttention: true,
      attentionReason: "permission",
      pendingPermissionCount: 2,
      updatedAt: "2026-07-08T00:01:00.000Z",
    });

    expect(await store.list()).toEqual([
      {
        agentId: "agent-1",
        workspaceId: "workspace-2",
        title: "Updated",
        provider: "claude",
        cwd: "/work/updated",
        status: "idle",
        requiresAttention: true,
        attentionReason: "permission",
        pendingPermissionCount: 2,
        updatedAt: "2026-07-08T00:01:00.000Z",
        pinnedAt: "2026-07-08T00:00:00.000Z",
      },
    ]);

    const reloaded = createStore();
    await reloaded.initialize();
    expect(await reloaded.list()).toEqual(await store.list());

    await reloaded.setPinned({ agentId: "agent-1", pinned: false });
    expect(await reloaded.list()).toEqual([]);
  });

  test("falls back to an empty list when the persisted file is corrupt", async () => {
    const filePath = path.join(tempDir, "status-summary", "session-pins.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not-json", "utf8");

    const store = createStore();
    await store.initialize();
    expect(await store.list()).toEqual([]);
  });

  test("writes valid json atomically", async () => {
    const store = createStore();
    await store.initialize();
    await store.setPinned({
      agentId: "agent-1",
      pinned: true,
      title: "Pinned",
    });

    const contents = await readFile(
      path.join(tempDir, "status-summary", "session-pins.json"),
      "utf8",
    );
    expect(JSON.parse(contents)).toMatchObject({
      version: 1,
      pinnedSessions: [{ agentId: "agent-1", title: "Pinned" }],
    });
  });

  test("serializes concurrent mutations so persisted pins do not get lost", async () => {
    const store = createStore();
    await store.initialize();

    await Promise.all([
      store.setPinned({
        agentId: "agent-1",
        pinned: true,
        title: "First",
      }),
      store.setPinned({
        agentId: "agent-2",
        pinned: true,
        title: "Second",
      }),
    ]);

    expect((await store.list()).map((pin) => pin.agentId).sort()).toEqual(["agent-1", "agent-2"]);
    const reloaded = createStore();
    await reloaded.initialize();
    expect((await reloaded.list()).map((pin) => pin.agentId).sort()).toEqual([
      "agent-1",
      "agent-2",
    ]);
  });

  test("keeps in-memory state unchanged when persistence fails", async () => {
    const filePath = path.join(tempDir, "session-pins.json");
    const store = new SessionPinStore({
      filePath,
      logger: pino({ level: "silent" }),
      clock: () => new Date("2026-07-08T00:00:00.000Z"),
    });
    await store.initialize();
    await store.setPinned({
      agentId: "agent-1",
      pinned: true,
      title: "Pinned",
    });
    await writeFile(path.join(tempDir, "blocked"), "not a directory", "utf8");
    const failingStore = new SessionPinStore({
      filePath: path.join(tempDir, "blocked", "session-pins.json"),
      logger: pino({ level: "silent" }),
      clock: () => new Date("2026-07-08T00:00:00.000Z"),
    });
    await failingStore.initialize();

    await expect(
      failingStore.setPinned({
        agentId: "agent-2",
        pinned: true,
        title: "Fails",
      }),
    ).rejects.toBeTruthy();

    expect(await failingStore.list()).toEqual([]);
    expect(await store.list()).toEqual([
      {
        agentId: "agent-1",
        workspaceId: null,
        title: "Pinned",
        provider: null,
        cwd: null,
        status: null,
        requiresAttention: false,
        attentionReason: null,
        pendingPermissionCount: 0,
        updatedAt: null,
        pinnedAt: "2026-07-08T00:00:00.000Z",
      },
    ]);
  });
});
