import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  TeamArchiveConflictError,
  TeamActiveMissionConflictError,
  TeamProfileCreateConflictError,
  TeamProfileIdConflictError,
  TeamProfileUpdateConflictError,
  TeamMissionStartConflictError,
  TeamMissionStartStageConflictError,
  TeamProfileStore,
  TeamProfileTransactionFieldConflictError,
  TeamProfileUnreadableError,
} from "./profile-store.js";
import type { TeamArchiveIntent, TeamMissionStartIntent } from "./schemas.js";

const NOW = "2026-08-08T06:00:00.000Z";

function teamProfile(): Omit<TeamV2, "revision" | "createdAt" | "updatedAt"> {
  return {
    id: "team-storage",
    name: "Storage team",
    workspaceId: "workspace-storage",
    leadMemberId: "member-lead",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    members: [
      {
        memberId: "member-lead",
        role: "Lead engineer",
        level: 4,
        skillIds: ["typescript"],
        executionProfile: {
          provider: "codex",
          model: "gpt-5.6-sol",
          modeId: null,
          thinkingOptionId: "high",
          featureValues: {},
        },
        mentionHandle: "lead-engineer",
      },
    ],
    lifecycle: "active",
    activeMissionId: null,
    lifecycleRecoveryFailure: null,
    archivedAt: null,
  };
}

function startIntent(): TeamMissionStartIntent {
  const profile = teamProfile();
  return {
    intentId: "start-team-storage",
    idempotencyKey: "start-key-storage",
    requestFingerprint: "start-fingerprint-storage",
    expectedTeamRevision: 1,
    missionId: "mission-storage",
    chatRoomId: "room-storage",
    teamName: profile.name,
    leadAgentId: "agent-storage-lead",
    bindingEpoch: 1,
    objective: "Implement durable Team storage",
    constraints: ["Keep persistence feature-owned"],
    acceptanceCriteria: ["Crash recovery is deterministic"],
    rosterSnapshot: {
      revision: 1,
      teamRevision: 1,
      leadMemberId: profile.leadMemberId,
      reason: "initial",
      skills: profile.skills,
      members: profile.members.map((member) =>
        Object.assign({}, member, {
          runtimeSnapshot: {
            providerAvailable: true,
            toolIds: ["shell"],
            capabilityIds: ["filesystem"],
          },
        }),
      ),
      createdAt: NOW,
    },
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [".git"],
    },
    stage: "reserved",
    requestedAt: NOW,
    updatedAt: NOW,
  };
}

function archiveIntent(): TeamArchiveIntent {
  return {
    intentId: "archive-team-storage",
    idempotencyKey: "archive-key-storage",
    requestFingerprint: "archive-fingerprint-storage",
    expectedTeamRevision: 1,
    missionId: null,
    missionFinishIntent: null,
    stage: "requested",
    requestedAt: NOW,
    updatedAt: NOW,
  };
}

describe("TeamProfileStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "team-profile-store-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("persists a new Team profile before returning it", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    const created = await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    expect(created).toEqual({
      storageRevision: 1,
      profile: {
        ...teamProfile(),
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
      createIdempotencyKey: "create-team-storage",
      createRequestFingerprint: "fingerprint-storage",
      updateReceipts: [],
      retiredMentionHandles: [],
      startIntent: null,
      archiveIntent: null,
    });
    expect(JSON.parse(await readFile(join(directory, "team-storage.json"), "utf8"))).toEqual(
      created,
    );

    const restarted = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => "2026-08-08T07:00:00.000Z",
    });
    expect(await restarted.get("team-storage")).toEqual(created);
  });

  test("uses revision compare-and-swap for concurrent profile changes", async () => {
    let now = NOW;
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    now = "2026-08-08T06:05:00.000Z";

    const changes = await Promise.allSettled([
      store.update({
        teamId: "team-storage",
        expectedRevision: 1,
        update: (profile) => ({ ...profile, name: "Storage platform" }),
      }),
      store.update({
        teamId: "team-storage",
        expectedRevision: 1,
        update: (profile) => ({ ...profile, name: "Persistence platform" }),
      }),
    ]);

    expect(changes.map((change) => change.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await store.get("team-storage"))?.profile).toMatchObject({
      revision: 2,
      updatedAt: "2026-08-08T06:05:00.000Z",
    });
    expect((await store.get("team-storage"))?.storageRevision).toBe(2);
  });

  test("persists retired mention handles atomically across restart", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    const updated = await store.update({
      teamId: "team-storage",
      expectedRevision: 1,
      update: (profile, context) => {
        expect(context.retiredMentionHandles).toEqual([]);
        return {
          profile: { ...profile, name: "Storage platform" },
          retireMentionHandles: ["Lead-Engineer", "lead-engineer"],
        };
      },
    });

    expect(updated.retiredMentionHandles).toEqual(["lead-engineer"]);
    const restarted = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    expect((await restarted.get("team-storage"))?.retiredMentionHandles).toEqual(["lead-engineer"]);
  });

  test("rejects changing the active Mission through the generic profile update", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    await expect(
      store.update({
        teamId: "team-storage",
        expectedRevision: 1,
        update: (profile) => ({ ...profile, activeMissionId: "mission-bypass" }),
      }),
    ).rejects.toBeInstanceOf(TeamProfileTransactionFieldConflictError);
    expect((await store.get("team-storage"))?.profile.activeMissionId).toBeNull();
  });

  test("rejects an updater that mutates the active Mission before returning a copy", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    await expect(
      store.update({
        teamId: "team-storage",
        expectedRevision: 1,
        update: (profile) => {
          profile.activeMissionId = "mission-bypass";
          return { ...profile };
        },
      }),
    ).rejects.toBeInstanceOf(TeamProfileTransactionFieldConflictError);
    expect((await store.get("team-storage"))?.profile.activeMissionId).toBeNull();
  });

  test("deduplicates a retried create and rejects key reuse with different input", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const first = await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    const replay = await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: { ...teamProfile(), name: "Ignored replay input" },
    });

    expect(replay).toEqual(first);
    await expect(
      store.createIfAbsent({
        idempotencyKey: "create-team-storage",
        requestFingerprint: "different-fingerprint",
        profile: { ...teamProfile(), id: "team-other" },
      }),
    ).rejects.toBeInstanceOf(TeamProfileCreateConflictError);
    expect(await store.list()).toEqual([first]);
  });

  test("persists update idempotency across revision changes and restart", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    const first = await store.update({
      idempotencyKey: "update-team-storage",
      requestFingerprint: "update-fingerprint-storage",
      teamId: "team-storage",
      expectedRevision: 1,
      update: (profile) => ({ ...profile, name: "Updated once" }),
    });
    const restarted = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => "2026-08-08T07:00:00.000Z",
    });
    const replay = await restarted.update({
      idempotencyKey: "update-team-storage",
      requestFingerprint: "update-fingerprint-storage",
      teamId: "team-storage",
      expectedRevision: 1,
      update: () => {
        throw new Error("A replay must not execute the mutation again");
      },
    });

    expect(replay).toEqual(first);
    await expect(
      restarted.update({
        idempotencyKey: "update-team-storage",
        requestFingerprint: "different-update-fingerprint",
        teamId: "team-storage",
        expectedRevision: first.profile.revision,
        update: (profile) => profile,
      }),
    ).rejects.toBeInstanceOf(TeamProfileUpdateConflictError);
  });

  test("initializes the create-key index once across concurrent keys", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const persistedList = store.list.bind(store);
    let listCalls = 0;
    let releaseSecondLoad!: () => void;
    const secondLoadGate = new Promise<void>((resolve) => {
      releaseSecondLoad = resolve;
    });
    store.list = async () => {
      listCalls += 1;
      if (listCalls === 2) await secondLoadGate;
      return [];
    };

    const firstPromise = store.createIfAbsent({
      idempotencyKey: "create-a",
      requestFingerprint: "fingerprint-a",
      profile: { ...teamProfile(), id: "team-a" },
    });
    const secondPromise = store.createIfAbsent({
      idempotencyKey: "create-b",
      requestFingerprint: "fingerprint-b",
      profile: { ...teamProfile(), id: "team-b" },
    });
    const first = await firstPromise;
    releaseSecondLoad();
    await secondPromise;

    const replay = await store.createIfAbsent({
      idempotencyKey: "create-a",
      requestFingerprint: "fingerprint-a",
      profile: { ...teamProfile(), id: "team-a-retry" },
    });
    expect(replay).toEqual(first);
    expect(await persistedList()).toHaveLength(2);
  });

  test("serializes different create keys that target the same preallocated id", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const attempts = await Promise.allSettled([
      store.createIfAbsent({
        idempotencyKey: "create-a",
        requestFingerprint: "fingerprint-a",
        profile: teamProfile(),
      }),
      store.createIfAbsent({
        idempotencyKey: "create-b",
        requestFingerprint: "fingerprint-b",
        profile: teamProfile(),
      }),
    ]);

    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(TeamProfileIdConflictError) });
    expect(await store.list()).toHaveLength(1);
  });

  test("isolates a corrupt profile and refuses to overwrite it", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const healthy = await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    const brokenPath = join(directory, "team-broken.json");
    await writeFile(brokenPath, "{not-json", "utf8");

    expect(await store.list()).toEqual([healthy]);
    await expect(store.get("team-broken")).rejects.toBeInstanceOf(TeamProfileUnreadableError);
    await expect(
      store.createIfAbsent({
        idempotencyKey: "create-team-broken",
        requestFingerprint: "fingerprint-broken",
        profile: { ...teamProfile(), id: "team-broken" },
      }),
    ).rejects.toBeInstanceOf(TeamProfileUnreadableError);
    expect(await readFile(brokenPath, "utf8")).toBe("{not-json");
  });

  test("rejects a profile whose stored identity does not match its file name", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const healthy = await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    await writeFile(join(directory, "team-alias.json"), JSON.stringify(healthy), "utf8");

    expect(await store.list()).toEqual([healthy]);
    await expect(store.get("team-alias")).rejects.toBeInstanceOf(TeamProfileUnreadableError);
  });

  test("rejects ids that could escape the profile directory", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    await expect(store.get("../outside")).rejects.toThrow("Invalid Team profile id");
  });

  test("persists one Mission start intent and advances its stages monotonically", async () => {
    let now = NOW;
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    const reserved = await store.beginMissionStart({
      teamId: "team-storage",
      intent: startIntent(),
    });
    expect(reserved).toMatchObject({ storageRevision: 2, profile: { revision: 1 } });
    expect(reserved.startIntent).toEqual(startIntent());
    expect(
      await store.beginMissionStart({ teamId: "team-storage", intent: startIntent() }),
    ).toEqual(reserved);

    await expect(
      store.beginMissionStart({
        teamId: "team-storage",
        intent: {
          ...startIntent(),
          intentId: "start-competing",
          idempotencyKey: "start-key-competing",
          requestFingerprint: "start-fingerprint-competing",
          missionId: "mission-competing",
        },
      }),
    ).rejects.toBeInstanceOf(TeamMissionStartConflictError);

    await expect(
      store.advanceMissionStart({
        teamId: "team-storage",
        intentId: "start-team-storage",
        from: "reserved",
        to: "lead_created",
      }),
    ).rejects.toBeInstanceOf(TeamMissionStartStageConflictError);

    now = "2026-08-08T06:10:00.000Z";
    const missionWritten = await store.advanceMissionStart({
      teamId: "team-storage",
      intentId: "start-team-storage",
      from: "reserved",
      to: "mission_written",
    });
    expect(missionWritten).toMatchObject({
      storageRevision: 3,
      profile: { revision: 1, updatedAt: NOW },
      startIntent: { stage: "mission_written", updatedAt: now },
    });
    expect(
      await store.advanceMissionStart({
        teamId: "team-storage",
        intentId: "start-team-storage",
        from: "reserved",
        to: "mission_written",
      }),
    ).toEqual(missionWritten);
  });

  test("persists and finalizes one idempotent Team archive intent", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    const pending = await store.beginArchive({
      teamId: "team-storage",
      intent: archiveIntent(),
    });
    expect(pending).toMatchObject({
      storageRevision: 2,
      profile: { lifecycle: "active", revision: 1 },
      archiveIntent: { stage: "requested" },
    });
    expect(await store.beginArchive({ teamId: "team-storage", intent: archiveIntent() })).toEqual(
      pending,
    );
    await expect(
      store.beginArchive({
        teamId: "team-storage",
        intent: {
          ...archiveIntent(),
          idempotencyKey: "archive-key-other",
          requestFingerprint: "archive-fingerprint-other",
        },
      }),
    ).rejects.toBeInstanceOf(TeamArchiveConflictError);

    const missionFinished = await store.advanceArchive({
      teamId: "team-storage",
      intentId: archiveIntent().intentId,
      from: "requested",
      to: "mission_finished",
    });
    const archived = await store.finalizeArchive({
      teamId: "team-storage",
      intentId: archiveIntent().intentId,
    });

    expect(missionFinished.archiveIntent?.stage).toBe("mission_finished");
    expect(archived).toMatchObject({
      storageRevision: 4,
      profile: { lifecycle: "archived", revision: 2, archivedAt: NOW },
      archiveIntent: null,
    });
  });

  test("serializes competing Mission starts for the same Team", async () => {
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });

    const attempts = await Promise.allSettled([
      store.beginMissionStart({ teamId: "team-storage", intent: startIntent() }),
      store.beginMissionStart({
        teamId: "team-storage",
        intent: {
          ...startIntent(),
          intentId: "start-team-competing",
          idempotencyKey: "start-key-competing",
          requestFingerprint: "start-fingerprint-competing",
          missionId: "mission-competing",
        },
      }),
    ]);

    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: expect.any(TeamMissionStartConflictError),
    });
    expect((await store.get("team-storage"))?.storageRevision).toBe(2);
  });

  test("activates only the Mission written by the durable start intent", async () => {
    let now = NOW;
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    await store.beginMissionStart({ teamId: "team-storage", intent: startIntent() });
    for (const [from, to] of [
      ["reserved", "mission_written"],
      ["mission_written", "room_created"],
      ["room_created", "lead_created"],
    ] as const) {
      await store.advanceMissionStart({
        teamId: "team-storage",
        intentId: "start-team-storage",
        from,
        to,
      });
    }
    now = "2026-08-08T06:15:00.000Z";

    const activated = await store.activateMission({
      teamId: "team-storage",
      intentId: "start-team-storage",
      missionId: "mission-storage",
    });

    expect(activated).toMatchObject({
      storageRevision: 6,
      profile: {
        revision: 2,
        activeMissionId: "mission-storage",
        updatedAt: now,
      },
      startIntent: null,
    });
    expect(
      await store.activateMission({
        teamId: "team-storage",
        intentId: "start-team-storage",
        missionId: "mission-storage",
      }),
    ).toEqual(activated);
  });

  test("clears only the active Mission and makes retries idempotent", async () => {
    let now = NOW;
    const store = new TeamProfileStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "create-team-storage",
      requestFingerprint: "fingerprint-storage",
      profile: teamProfile(),
    });
    await store.beginMissionStart({ teamId: "team-storage", intent: startIntent() });
    for (const [from, to] of [
      ["reserved", "mission_written"],
      ["mission_written", "room_created"],
      ["room_created", "lead_created"],
    ] as const) {
      await store.advanceMissionStart({
        teamId: "team-storage",
        intentId: "start-team-storage",
        from,
        to,
      });
    }
    await store.activateMission({
      teamId: "team-storage",
      intentId: "start-team-storage",
      missionId: "mission-storage",
    });
    await expect(
      store.clearActiveMission({ teamId: "team-storage", missionId: "mission-other" }),
    ).rejects.toBeInstanceOf(TeamActiveMissionConflictError);
    now = "2026-08-08T06:20:00.000Z";

    const cleared = await store.clearActiveMission({
      teamId: "team-storage",
      missionId: "mission-storage",
    });

    expect(cleared).toMatchObject({
      storageRevision: 7,
      profile: { revision: 3, activeMissionId: null, updatedAt: now },
      startIntent: null,
    });
    expect(
      await store.clearActiveMission({
        teamId: "team-storage",
        missionId: "mission-storage",
      }),
    ).toEqual(cleared);
  });
});
