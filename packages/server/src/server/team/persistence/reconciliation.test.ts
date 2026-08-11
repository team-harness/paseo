import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { MissionStore } from "./mission-store.js";
import { TeamProfileStore } from "./profile-store.js";
import { TeamPersistenceReconciler } from "./reconciliation.js";
import type {
  TeamArchiveIntent,
  TeamMissionFinishIntent,
  TeamMissionStartIntent,
} from "./schemas.js";
import { TeamMissionPersistenceTransactions } from "./transactions.js";

const NOW = "2026-08-08T10:00:00.000Z";

function teamProfile(): Omit<TeamV2, "revision" | "createdAt" | "updatedAt"> {
  return {
    id: "team-reconcile",
    name: "Reconciliation team",
    workspaceId: "workspace-reconcile",
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
    intentId: "start-team-reconcile",
    idempotencyKey: "start-key-reconcile",
    requestFingerprint: "start-fingerprint-reconcile",
    expectedTeamRevision: 1,
    missionId: "mission-reconcile",
    chatRoomId: "room-reconcile",
    teamName: profile.name,
    leadAgentId: "agent-reconcile-lead",
    bindingEpoch: 1,
    objective: "Reconcile durable Team state",
    constraints: ["Do not repeat side effects"],
    acceptanceCriteria: ["Startup converges deterministically"],
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

function finishIntent(): TeamMissionFinishIntent {
  return {
    intentId: "finish-mission-reconcile",
    idempotencyKey: "finish-key-reconcile",
    requestFingerprint: "finish-fingerprint-reconcile",
    completionEventId: "completion-mission-reconcile",
    kind: "canceled",
    reason: "User canceled the Mission",
    stage: "requested",
    requestedAt: NOW,
    updatedAt: NOW,
  };
}

function archiveIntent(): TeamArchiveIntent {
  return {
    intentId: "archive-team-reconcile",
    idempotencyKey: "archive-key-reconcile",
    requestFingerprint: "archive-fingerprint-reconcile",
    expectedTeamRevision: 1,
    missionId: null,
    missionFinishIntent: null,
    stage: "requested",
    requestedAt: NOW,
    updatedAt: NOW,
  };
}

describe("TeamPersistenceReconciler", () => {
  let rootDirectory: string;
  let profiles: TeamProfileStore;
  let missions: MissionStore;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-persistence-reconcile-"));
    ({ profiles, missions } = createStores(rootDirectory));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test.each(["reserved", "mission_written", "room_created", "lead_created"] as const)(
    "returns an external action for a start at %s",
    async (stage) => {
      if (stage === "reserved") {
        await createPendingStart(profiles);
      } else if (stage === "lead_created") {
        await createLeadCreatedStart(profiles, missions);
      } else {
        await createMissionWrittenStart(profiles, missions);
      }
      if (stage === "room_created") {
        await profiles.advanceMissionStart({
          teamId: "team-reconcile",
          intentId: "start-team-reconcile",
          from: "mission_written",
          to: "room_created",
        });
      }

      const result = await createReconciler(profiles, missions).reconcile();

      expect(result.actions).toEqual([
        {
          kind: "resume_mission_start",
          teamId: "team-reconcile",
          missionId: "mission-reconcile",
          intentId: "start-team-reconcile",
          stage: stage === "reserved" ? "mission_written" : stage,
        },
      ]);
      expect(await missions.list()).toHaveLength(1);
    },
  );

  test("returns an external action for a pending Team archive", async () => {
    await createProfile(profiles);
    await profiles.beginArchive({ teamId: "team-reconcile", intent: archiveIntent() });

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toEqual([
      {
        kind: "resume_team_archive",
        teamId: "team-reconcile",
        missionId: "",
        intentId: "archive-team-reconcile",
        stage: "requested",
      },
    ]);
  });

  test("leaves Lead-created Mission activation to application recovery", async () => {
    await createLeadCreatedStart(profiles, missions);

    const result = await createReconciler(profiles, missions).reconcile();

    const expectedAction = {
      kind: "resume_mission_start" as const,
      teamId: "team-reconcile",
      missionId: "mission-reconcile",
      intentId: "start-team-reconcile",
      stage: "lead_created" as const,
    };
    expect(result.actions).toEqual([expectedAction]);
    expect(await profiles.get("team-reconcile")).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: { stage: "lead_created" },
    });
    expect((await missions.get("mission-reconcile"))?.mission.participants).toMatchObject([
      {
        memberId: "member-lead",
        agentId: "agent-reconcile-lead",
        bindingEpoch: 1,
      },
    ]);
    expect((await createReconciler(profiles, missions).reconcile()).actions).toEqual([
      {
        ...expectedAction,
      },
    ]);
  });

  test.each(["requested", "dispatch_stopped"] as const)(
    "returns an external action for a finish at %s",
    async (stage) => {
      await createActiveMission(profiles, missions);
      await missions.beginFinish({
        missionId: "mission-reconcile",
        expectedRevision: 1,
        intent: finishIntent(),
      });
      if (stage === "dispatch_stopped") {
        await missions.advanceFinish({
          missionId: "mission-reconcile",
          intentId: "finish-mission-reconcile",
          from: "requested",
          to: "dispatch_stopped",
        });
      }

      const result = await createReconciler(profiles, missions).reconcile();

      expect(result.actions).toEqual([
        {
          kind: "resume_mission_finish",
          teamId: "team-reconcile",
          missionId: "mission-reconcile",
          intentId: "finish-mission-reconcile",
          stage,
        },
      ]);
    },
  );

  test("returns pending recipient attention as a stable delivery action", async () => {
    await createActiveMission(profiles, missions);
    await missions.updateRecoveryState({
      missionId: "mission-reconcile",
      expectedStorageRevision: 1,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: [
          {
            deliveryId: "attention-lead",
            idempotencyKey: "message-key-lead",
            requestFingerprint: "message-fingerprint-lead",
            roomMessageId: "message-blocked",
            senderMemberId: "member-sender",
            senderAgentId: "agent-sender",
            recipientMemberId: "member-lead",
            bindingEpoch: 1,
            mentionHandle: "lead-engineer",
            body: "@lead-engineer The delivery is blocked",
            roomPostedAt: NOW,
            roomCursor: 1,
            state: "pending",
            attempts: 0,
            createdAt: NOW,
            lastAttemptAt: null,
            nextEligibleAt: NOW,
            acknowledgedAt: null,
            canceledAt: null,
            cancelReason: null,
            successorDeliveryId: null,
          },
        ],
      }),
    });

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toEqual([
      {
        kind: "deliver_recipient_attention",
        teamId: "team-reconcile",
        missionId: "mission-reconcile",
        deliveryId: "attention-lead",
      },
    ]);
    expect((await createReconciler(profiles, missions).reconcile()).actions).toEqual(
      result.actions,
    );
  });

  test("posts a durable Team message before delivering recipient attention", async () => {
    await createActiveMission(profiles, missions);
    await missions.updateRecoveryState({
      missionId: "mission-reconcile",
      expectedStorageRevision: 1,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: [
          {
            deliveryId: "attention-unposted",
            idempotencyKey: "message-key-unposted",
            requestFingerprint: "message-fingerprint-unposted",
            roomMessageId: "message-unposted",
            senderMemberId: "member-sender",
            senderAgentId: "agent-sender",
            recipientMemberId: "member-lead",
            bindingEpoch: 1,
            mentionHandle: "lead-engineer",
            body: "@lead-engineer Please review the plan",
            roomPostedAt: null,
            roomCursor: null,
            state: "pending",
            attempts: 0,
            createdAt: NOW,
            lastAttemptAt: null,
            nextEligibleAt: NOW,
            acknowledgedAt: null,
            canceledAt: null,
            cancelReason: null,
            successorDeliveryId: null,
          },
        ],
      }),
    });

    expect((await createReconciler(profiles, missions).reconcile()).actions).toEqual([
      {
        kind: "post_recipient_message",
        teamId: "team-reconcile",
        missionId: "mission-reconcile",
        deliveryId: "attention-unposted",
      },
    ]);
  });

  test("does not replay an acknowledged completion delivery", async () => {
    await createActiveMission(profiles, missions);
    const current = await missions.get("mission-reconcile");
    if (!current) throw new Error("Mission was not activated");
    await missions.updateRecoveryState({
      missionId: current.mission.id,
      expectedStorageRevision: current.storageRevision,
      update: (recovery) => ({
        ...recovery,
        completionOutbox: [
          {
            eventId: "completion-recovered",
            missionStatus: "completed" as const,
            attempts: 1,
            createdAt: NOW,
            state: "acknowledged" as const,
            lastAttemptAt: NOW,
            acknowledgedAt: NOW,
          },
        ],
      }),
    });

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toEqual([]);
  });

  test("leaves finish evidence preparation to application recovery", async () => {
    await createActiveMission(profiles, missions);
    await missions.beginFinish({
      missionId: "mission-reconcile",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
    ] as const) {
      await missions.advanceFinish({
        missionId: "mission-reconcile",
        intentId: "finish-mission-reconcile",
        from,
        to,
      });
    }

    const result = await createReconciler(profiles, missions).reconcile();

    expect((await profiles.get("team-reconcile"))?.profile.activeMissionId).toBe(
      "mission-reconcile",
    );
    expect((await missions.get("mission-reconcile"))?.mission.status).toBe("planning");
    expect(result.actions).toEqual([
      {
        kind: "resume_mission_finish",
        teamId: "team-reconcile",
        missionId: "mission-reconcile",
        intentId: "finish-mission-reconcile",
        stage: "participants_archived",
      },
    ]);
  });

  test("surfaces an active Team link whose Mission file is absent", async () => {
    await createActiveMission(profiles, missions);
    const missionPath = join(rootDirectory, "missions", "mission-reconcile.json");
    const persistedMission = await readFile(missionPath, "utf8");
    await rm(missionPath);

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toEqual([
      {
        kind: "persistence_attention",
        teamId: "team-reconcile",
        missionId: "mission-reconcile",
        code: "active_mission_missing",
      },
    ]);
    expect(await profiles.get("team-reconcile")).toMatchObject({
      persistenceAttentions: [
        {
          attentionId: "mission-reconcile:active_mission_missing",
          missionId: "mission-reconcile",
          code: "active_mission_missing",
          detectedAt: NOW,
        },
      ],
    });

    await writeFile(missionPath, persistedMission, "utf8");
    expect((await createReconciler(profiles, missions).reconcile()).actions).toEqual([]);
    expect((await profiles.get("team-reconcile"))?.persistenceAttentions).toEqual([]);
  });

  test("surfaces an unscoped Mission without writing an absent Team profile", async () => {
    await createActiveMission(profiles, missions);
    await rm(join(rootDirectory, "profiles", "team-reconcile.json"));

    await expect(createReconciler(profiles, missions).reconcile()).resolves.toEqual({
      actions: [
        {
          kind: "persistence_attention",
          teamId: "team-reconcile",
          missionId: "mission-reconcile",
          code: "team_profile_missing",
        },
      ],
    });
    await expect(
      readFile(join(rootDirectory, "profiles", "team-reconcile.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("isolates a corrupt Team profile while a healthy Team start advances", async () => {
    await createActiveMission(profiles, missions);
    const healthyProfile = {
      ...teamProfile(),
      id: "team-healthy",
      name: "Healthy reconciliation team",
      workspaceId: "workspace-healthy",
    };
    await profiles.createIfAbsent({
      idempotencyKey: "create-team-healthy",
      requestFingerprint: "create-fingerprint-healthy",
      profile: healthyProfile,
    });
    await profiles.beginMissionStart({
      teamId: healthyProfile.id,
      intent: {
        ...startIntent(),
        intentId: "start-team-healthy",
        idempotencyKey: "start-key-healthy",
        requestFingerprint: "start-fingerprint-healthy",
        missionId: "mission-healthy",
        chatRoomId: "room-healthy",
        teamName: healthyProfile.name,
        rosterSnapshot: {
          ...startIntent().rosterSnapshot,
          members: healthyProfile.members.map((member) =>
            Object.assign({}, member, {
              runtimeSnapshot: {
                providerAvailable: true,
                toolIds: ["shell"],
                capabilityIds: ["filesystem"],
              },
            }),
          ),
        },
      },
    });
    await writeFile(join(rootDirectory, "profiles", "team-reconcile.json"), "{broken-json", "utf8");

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toContainEqual({
      kind: "persistence_attention",
      teamId: "team-reconcile",
      missionId: "mission-reconcile",
      code: "team_profile_missing",
    });
    expect(result.actions).toContainEqual({
      kind: "resume_mission_start",
      teamId: "team-healthy",
      missionId: "mission-healthy",
      intentId: "start-team-healthy",
      stage: "mission_written",
    });
    expect(await missions.get("mission-healthy")).not.toBeNull();
  });

  test("surfaces a nonterminal Mission that is no longer active on its Team", async () => {
    await createActiveMission(profiles, missions);
    await profiles.clearActiveMission({
      teamId: "team-reconcile",
      missionId: "mission-reconcile",
    });

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toEqual([
      {
        kind: "persistence_attention",
        teamId: "team-reconcile",
        missionId: "mission-reconcile",
        code: "mission_not_active",
      },
    ]);
  });

  test.each([
    ["teamId", "team-other", "active_mission_team_mismatch"],
    ["workspaceId", "workspace-other", "active_mission_workspace_mismatch"],
  ] as const)("rejects an active Mission with the wrong %s", async (field, value, code) => {
    await createActiveMission(profiles, missions);
    const missionPath = join(rootDirectory, "missions", "mission-reconcile.json");
    const stored = JSON.parse(await readFile(missionPath, "utf8"));
    stored.mission[field] = value;
    await writeFile(missionPath, JSON.stringify(stored), "utf8");

    const result = await createReconciler(profiles, missions).reconcile();

    expect(result.actions).toContainEqual({
      kind: "persistence_attention",
      teamId: "team-reconcile",
      missionId: "mission-reconcile",
      code,
    });
    expect((await profiles.get("team-reconcile"))?.profile.activeMissionId).toBe(
      "mission-reconcile",
    );
    expect((await profiles.get("team-reconcile"))?.persistenceAttentions).toEqual([
      {
        attentionId: `mission-reconcile:${code}`,
        missionId: "mission-reconcile",
        code,
        detectedAt: NOW,
      },
    ]);
  });

  test.each([
    ["teamId", "team-other", "archive_mission_team_mismatch"],
    ["workspaceId", "workspace-other", "archive_mission_workspace_mismatch"],
  ] as const)(
    "does not resume Team archive when its Mission has the wrong %s",
    async (field, value, code) => {
      await createActiveMission(profiles, missions);
      await profiles.beginArchive({
        teamId: "team-reconcile",
        intent: {
          ...archiveIntent(),
          expectedTeamRevision: 2,
          missionId: "mission-reconcile",
          missionFinishIntent: finishIntent(),
        },
      });
      const missionPath = join(rootDirectory, "missions", "mission-reconcile.json");
      const stored = JSON.parse(await readFile(missionPath, "utf8"));
      stored.mission[field] = value;
      await writeFile(missionPath, JSON.stringify(stored), "utf8");

      const result = await createReconciler(profiles, missions).reconcile();

      expect(result.actions).toContainEqual({
        kind: "persistence_attention",
        teamId: "team-reconcile",
        missionId: "mission-reconcile",
        code,
      });
      expect(result.actions).not.toContainEqual(
        expect.objectContaining({ kind: "resume_team_archive", teamId: "team-reconcile" }),
      );
    },
  );
});

function createStores(rootDirectory: string) {
  return {
    profiles: new TeamProfileStore({
      directory: join(rootDirectory, "profiles"),
      logger: createTestLogger(),
      now: () => NOW,
    }),
    missions: new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    }),
  };
}

function createReconciler(profiles: TeamProfileStore, missions: MissionStore) {
  return new TeamPersistenceReconciler({
    profiles,
    missions,
    logger: createTestLogger(),
  });
}

async function createPendingStart(profiles: TeamProfileStore): Promise<void> {
  await createProfile(profiles);
  await profiles.beginMissionStart({ teamId: "team-reconcile", intent: startIntent() });
}

async function createProfile(profiles: TeamProfileStore): Promise<void> {
  await profiles.createIfAbsent({
    idempotencyKey: "create-team-reconcile",
    requestFingerprint: "create-fingerprint-reconcile",
    profile: teamProfile(),
  });
}

async function createMissionWrittenStart(
  profiles: TeamProfileStore,
  missions: MissionStore,
): Promise<void> {
  await createProfile(profiles);
  await new TeamMissionPersistenceTransactions({ profiles, missions }).beginMissionStart({
    teamId: "team-reconcile",
    intent: startIntent(),
  });
}

async function createLeadCreatedStart(
  profiles: TeamProfileStore,
  missions: MissionStore,
): Promise<void> {
  await createMissionWrittenStart(profiles, missions);
  for (const [from, to] of [
    ["mission_written", "room_created"],
    ["room_created", "lead_created"],
  ] as const) {
    await profiles.advanceMissionStart({
      teamId: "team-reconcile",
      intentId: "start-team-reconcile",
      from,
      to,
    });
  }
}

async function createActiveMission(
  profiles: TeamProfileStore,
  missions: MissionStore,
): Promise<void> {
  await createLeadCreatedStart(profiles, missions);
  await new TeamMissionPersistenceTransactions({ profiles, missions }).commitMissionStart({
    teamId: "team-reconcile",
    intentId: "start-team-reconcile",
    missionId: "mission-reconcile",
  });
}
