import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamStore, type TeamUpdater } from "./team-store.js";

const logger = createTestLogger();

function buildTeam(overrides: Partial<Parameters<TeamStore["create"]>[0]> = {}) {
  return {
    name: "Disk usage",
    workspaceId: "wks_1",
    chatRoomId: "room-1",
    leadAgentId: "agent-lead",
    members: [
      {
        agentId: "agent-lead",
        role: "lead",
        joinedAt: "2026-08-06T10:00:00.000Z",
        leftAt: null,
        state: "active" as const,
        removalReason: null,
      },
    ],
    lifecycle: "creating" as const,
    idempotencyKey: "idem-1",
    requestFingerprint: "fingerprint-1",
    creationPlan: null,
    creationStage: "allocated" as const,
    templateId: null,
    archivedAt: null,
    failedCleanupAt: null,
    pendingRecruitments: null,
    ...overrides,
  };
}

const markActive: TeamUpdater = (current) => ({ ...current, lifecycle: "active" as const });

const addSecondMember: TeamUpdater = (current) => ({
  ...current,
  members: [
    ...current.members,
    {
      agentId: "agent-2",
      role: "server",
      joinedAt: "2026-08-06T10:01:00.000Z",
      leftAt: null,
      state: "active" as const,
      removalReason: null,
    },
  ],
});

describe("TeamStore", () => {
  let dir: string;
  let store: TeamStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "team-store-test-"));
    store = new TeamStore(dir, logger);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("creates a team and reads it back from disk", async () => {
    const created = await store.create(buildTeam());

    expect(created.id).toMatch(/^[0-9a-f]{8}$/);
    expect(created.revision).toBe(1);

    const reloaded = new TeamStore(dir, logger);
    expect(await reloaded.get(created.id)).toEqual(created);
  });

  test("bumps the revision on every write so clients can order snapshots", async () => {
    const created = await store.create(buildTeam());

    const first = await store.update(created.id, (team) => ({ ...team, lifecycle: "active" }));
    const second = await store.update(created.id, (team) => ({ ...team, name: "Renamed" }));

    expect(first?.revision).toBe(2);
    expect(second?.revision).toBe(3);
    expect((await store.get(created.id))?.revision).toBe(3);
  });

  test("returns null when updating a team that does not exist", async () => {
    expect(await store.update("missing", (team) => team)).toBeNull();
  });

  test("serializes concurrent updates to the same team", async () => {
    const created = await store.create(buildTeam());

    const touch = (team: Parameters<TeamUpdater>[0]) => team;
    await Promise.all(Array.from({ length: 5 }, () => store.update(created.id, touch)));

    // Five serialized read-modify-writes on top of the create.
    expect((await store.get(created.id))?.revision).toBe(6);
  });

  // DEC-2: the key is what makes a retried create idempotent, and it has to
  // survive a restart — otherwise a reconnecting client builds a second team.
  test("finds a team by idempotency key after a reload", async () => {
    const created = await store.create(buildTeam({ idempotencyKey: "idem-abc" }));

    const reloaded = new TeamStore(dir, logger);
    await reloaded.initialize();

    expect(await reloaded.findByIdempotencyKey("idem-abc")).toEqual(created);
    expect(await reloaded.findByIdempotencyKey("idem-unknown")).toBeNull();
  });

  // DEC-2: two clients retrying the same create must not end up with two teams.
  // Checking the index and creating separately leaves a window where both see
  // nothing; the resolve-or-create boundary has to hold the key while it decides.
  test("creates one team when the same idempotency key arrives concurrently", async () => {
    const build = () => buildTeam({ idempotencyKey: "idem-race" });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.createIfAbsent("idem-race", build)),
    );

    const ids = new Set(results.map((team) => team.id));
    expect(ids.size).toBe(1);
    expect(await store.list()).toHaveLength(1);
  });

  test("returns the existing team when the key was already used", async () => {
    const first = await store.createIfAbsent("idem-reuse", () => buildTeam());
    const second = await store.createIfAbsent("idem-reuse", () => buildTeam({ name: "Different" }));

    expect(second).toEqual(first);
    expect(await store.list()).toHaveLength(1);
  });

  test("resolves a reused key against teams written by an earlier run", async () => {
    const first = await store.createIfAbsent("idem-restart", () => buildTeam());

    const reloaded = new TeamStore(dir, logger);
    const second = await reloaded.createIfAbsent("idem-restart", () => buildTeam());

    expect(second.id).toBe(first.id);
    expect(await reloaded.list()).toHaveLength(1);
  });

  test("stores the team under the key that was locked, not one the builder chose", async () => {
    const created = await store.createIfAbsent("idem-locked", () =>
      buildTeam({ idempotencyKey: "idem-something-else" }),
    );

    expect(created.idempotencyKey).toBe("idem-locked");
    expect((await store.findByIdempotencyKey("idem-locked"))?.id).toBe(created.id);
    // Retrying the locked key must not build a second team.
    await store.createIfAbsent("idem-locked", () => buildTeam());
    expect(await store.list()).toHaveLength(1);
  });

  test("refuses to rewrite the idempotency key of an existing team", async () => {
    const created = await store.create(buildTeam({ idempotencyKey: "idem-fixed" }));

    await expect(
      store.update(created.id, (team) => ({ ...team, idempotencyKey: "idem-other" })),
    ).rejects.toThrow(/idempotency key/i);
    expect((await store.get(created.id))?.idempotencyKey).toBe("idem-fixed");
  });

  test("keeps the surviving teams when one file is corrupt", async () => {
    const healthy = await store.create(buildTeam({ idempotencyKey: "idem-healthy" }));
    await writeFile(join(dir, "broken.json"), "{ this is not json", "utf8");

    const reloaded = new TeamStore(dir, logger);
    const teams = await reloaded.list();

    expect(teams.map((team) => team.id)).toEqual([healthy.id]);
  });

  test("keeps the surviving teams when one file fails validation", async () => {
    const healthy = await store.create(buildTeam({ idempotencyKey: "idem-healthy" }));
    await writeFile(join(dir, "invalid.json"), JSON.stringify({ id: "invalid" }), "utf8");

    const reloaded = new TeamStore(dir, logger);
    expect((await reloaded.list()).map((team) => team.id)).toEqual([healthy.id]);
  });

  test("removes a team", async () => {
    const created = await store.create(buildTeam());

    await store.delete(created.id);

    expect(await store.get(created.id)).toBeNull();
    expect(await new TeamStore(dir, logger).list()).toEqual([]);
  });

  /**
   * The deletion guard has to answer without awaiting: hard delete keeps no
   * tombstone, so a decision taken a moment too late cannot be corrected.
   */
  describe("the synchronous view of who is mid-creation", () => {
    test("names the team a member is still being created for", async () => {
      await store.create(buildTeam());

      expect(store.creatingTeamNameOf("agent-lead")).toBe("Disk usage");
      expect(store.creatingTeamNameOf("someone-else")).toBeNull();
    });

    test("lets go once the team is created", async () => {
      const created = await store.create(buildTeam());

      await store.update(created.id, markActive);

      expect(store.creatingTeamNameOf("agent-lead")).toBeNull();
    });

    test("lets go when the team is deleted", async () => {
      const created = await store.create(buildTeam());

      await store.delete(created.id);

      expect(store.creatingTeamNameOf("agent-lead")).toBeNull();
    });

    test("follows a roster that grows mid-creation", async () => {
      const created = await store.create(buildTeam());

      await store.update(created.id, addSecondMember);

      expect(store.creatingTeamNameOf("agent-2")).toBe("Disk usage");
    });

    test("is rebuilt from disk on a restart", async () => {
      await store.create(buildTeam());

      const restarted = new TeamStore(dir, logger);
      await restarted.initialize();

      // A daemon that died mid-creation comes back still refusing to delete
      // the agents it cannot yet tell apart from ones it never built.
      expect(restarted.creatingTeamNameOf("agent-lead")).toBe("Disk usage");
    });
  });
});
