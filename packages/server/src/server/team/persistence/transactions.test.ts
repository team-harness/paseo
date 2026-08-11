import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { MissionStartConflictError, MissionStore } from "./mission-store.js";
import { TeamProfileStore } from "./profile-store.js";
import type { TeamMissionFinishIntent, TeamMissionStartIntent } from "./schemas.js";
import {
  TeamMissionPersistenceTransactions,
  type TeamPersistenceFaultPoint,
} from "./transactions.js";

const NOW = "2026-08-08T09:00:00.000Z";

function teamProfile(): Omit<TeamV2, "revision" | "createdAt" | "updatedAt"> {
  return {
    id: "team-transaction",
    name: "Transaction team",
    workspaceId: "workspace-transaction",
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
    intentId: "start-team-transaction",
    idempotencyKey: "start-key-transaction",
    requestFingerprint: "start-fingerprint-transaction",
    expectedTeamRevision: 1,
    missionId: "mission-transaction",
    chatRoomId: "room-transaction",
    teamName: profile.name,
    leadAgentId: "agent-transaction-lead",
    bindingEpoch: 1,
    objective: "Recover a cross-file transaction",
    constraints: ["Do not duplicate durable resources"],
    acceptanceCriteria: ["Every crash window converges"],
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
    intentId: "finish-mission-transaction",
    idempotencyKey: "finish-key-transaction",
    requestFingerprint: "finish-fingerprint-transaction",
    completionEventId: "completion-mission-transaction",
    kind: "canceled",
    reason: "User canceled the Mission",
    stage: "requested",
    requestedAt: NOW,
    updatedAt: NOW,
  };
}

describe("TeamMissionPersistenceTransactions", () => {
  let rootDirectory: string;
  let profileDirectory: string;
  let missionDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-persistence-transactions-"));
    profileDirectory = join(rootDirectory, "profiles");
    missionDirectory = join(rootDirectory, "missions");
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test.each<TeamPersistenceFaultPoint>(["after_mission_write", "after_start_stage"])(
    "replays Mission start after a crash at %s",
    async (faultPoint) => {
      const stores = createStores(profileDirectory, missionDirectory);
      await createProfile(stores.profiles);
      const crashing = new TeamMissionPersistenceTransactions({
        ...stores,
        faultInjector: throwOnceAt(faultPoint),
      });

      await expect(
        crashing.beginMissionStart({
          teamId: "team-transaction",
          intent: startIntent(),
        }),
      ).rejects.toThrow(`simulated crash at ${faultPoint}`);

      const restarted = createStores(profileDirectory, missionDirectory);
      const transaction = new TeamMissionPersistenceTransactions(restarted);
      const persisted = await transaction.beginMissionStart({
        teamId: "team-transaction",
        intent: startIntent(),
      });
      expect(persisted.profile).toMatchObject({
        profile: { activeMissionId: null },
        startIntent: { stage: "mission_written" },
      });
      expect(persisted.mission.mission.participants).toMatchObject([
        {
          memberId: "member-lead",
          agentId: "agent-transaction-lead",
          bindingEpoch: 1,
        },
      ]);

      await advanceExternalStart(restarted.profiles);
      const completed = await transaction.commitMissionStart({
        teamId: "team-transaction",
        intentId: "start-team-transaction",
        missionId: "mission-transaction",
      });

      expect(completed.profile).toMatchObject({
        profile: { activeMissionId: "mission-transaction" },
        startIntent: null,
      });
      expect(completed.mission).toMatchObject({
        mission: {
          id: "mission-transaction",
          teamId: "team-transaction",
          chatRoomId: "room-transaction",
          participants: [
            {
              memberId: "member-lead",
              agentId: "agent-transaction-lead",
              bindingEpoch: 1,
              archivedAt: null,
            },
          ],
        },
      });
      expect(await restarted.missions.list()).toHaveLength(1);
      expect(
        await transaction.commitMissionStart({
          teamId: "team-transaction",
          intentId: "start-team-transaction",
          missionId: "mission-transaction",
        }),
      ).toEqual(completed);
    },
  );

  test("replays Mission start after the Lead participant write", async () => {
    const stores = createStores(profileDirectory, missionDirectory);
    await beginMissionWritten(stores.profiles, stores.missions);
    await advanceExternalStart(stores.profiles);
    const crashing = new TeamMissionPersistenceTransactions({
      ...stores,
      faultInjector: throwOnceAt("after_lead_participant_write"),
    });

    await expect(
      crashing.commitMissionStart({
        teamId: "team-transaction",
        intentId: "start-team-transaction",
        missionId: "mission-transaction",
      }),
    ).rejects.toThrow("simulated crash at after_lead_participant_write");
    expect((await stores.profiles.get("team-transaction"))?.startIntent?.stage).toBe(
      "lead_created",
    );
    expect((await stores.missions.get("mission-transaction"))?.mission.participants).toHaveLength(
      1,
    );

    const restarted = createStores(profileDirectory, missionDirectory);
    const completed = await new TeamMissionPersistenceTransactions(restarted).commitMissionStart({
      teamId: "team-transaction",
      intentId: "start-team-transaction",
      missionId: "mission-transaction",
    });

    expect(completed.profile.profile.activeMissionId).toBe("mission-transaction");
    expect(completed.mission.mission.participants).toHaveLength(1);
  });

  test("writes the Mission before external resources and permanently replays the start key", async () => {
    const stores = createStores(profileDirectory, missionDirectory);
    await stores.profiles.createIfAbsent({
      idempotencyKey: "create-team-transaction",
      requestFingerprint: "create-fingerprint-transaction",
      profile: teamProfile(),
    });
    const transaction = new TeamMissionPersistenceTransactions(stores);

    const persisted = await transaction.beginMissionStart({
      teamId: "team-transaction",
      intent: startIntent(),
    });

    expect(persisted.profile).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: { stage: "mission_written" },
    });
    expect(persisted.mission.mission.participants).toHaveLength(1);
    for (const [from, to] of [
      ["mission_written", "room_created"],
      ["room_created", "lead_created"],
    ] as const) {
      await stores.profiles.advanceMissionStart({
        teamId: "team-transaction",
        intentId: "start-team-transaction",
        from,
        to,
      });
    }
    const active = await transaction.commitMissionStart({
      teamId: "team-transaction",
      intentId: "start-team-transaction",
      missionId: "mission-transaction",
    });
    expect(active.profile.profile.activeMissionId).toBe("mission-transaction");
    expect(active.mission.mission.participants).toHaveLength(1);

    const restarted = createStores(profileDirectory, missionDirectory);
    const replay = await new TeamMissionPersistenceTransactions(restarted).beginMissionStart({
      teamId: "team-transaction",
      intent: startIntent(),
    });
    expect(replay).toEqual(active);
    await expect(
      new TeamMissionPersistenceTransactions(restarted).beginMissionStart({
        teamId: "team-transaction",
        intent: { ...startIntent(), requestFingerprint: "different-fingerprint" },
      }),
    ).rejects.toBeInstanceOf(MissionStartConflictError);

    await restarted.missions.beginFinish({
      missionId: "mission-transaction",
      expectedRevision: active.mission.mission.revision,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
    ] as const) {
      await restarted.missions.advanceFinish({
        missionId: "mission-transaction",
        intentId: "finish-mission-transaction",
        from,
        to,
      });
    }
    const terminal = await new TeamMissionPersistenceTransactions(restarted).commitMissionFinish({
      teamId: "team-transaction",
      missionId: "mission-transaction",
      intentId: "finish-mission-transaction",
    });
    const terminalRestart = createStores(profileDirectory, missionDirectory);
    const terminalReplay = await new TeamMissionPersistenceTransactions(
      terminalRestart,
    ).beginMissionStart({
      teamId: "team-transaction",
      intent: startIntent(),
    });
    expect(terminalReplay).toEqual(terminal);
  });

  test("replays Mission finish after the terminal Mission write", async () => {
    const stores = createStores(profileDirectory, missionDirectory);
    await createActiveMission(stores.profiles, stores.missions);
    await stores.missions.beginFinish({
      missionId: "mission-transaction",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
    ] as const) {
      await stores.missions.advanceFinish({
        missionId: "mission-transaction",
        intentId: "finish-mission-transaction",
        from,
        to,
      });
    }
    const crashing = new TeamMissionPersistenceTransactions({
      ...stores,
      faultInjector: throwOnceAt("after_mission_finalize"),
    });

    await expect(
      crashing.commitMissionFinish({
        teamId: "team-transaction",
        missionId: "mission-transaction",
        intentId: "finish-mission-transaction",
      }),
    ).rejects.toThrow("simulated crash at after_mission_finalize");

    const restarted = createStores(profileDirectory, missionDirectory);
    expect((await restarted.profiles.get("team-transaction"))?.profile.activeMissionId).toBe(
      "mission-transaction",
    );
    expect((await restarted.missions.get("mission-transaction"))?.mission.status).toBe("canceled");
    const transaction = new TeamMissionPersistenceTransactions(restarted);
    const completed = await transaction.commitMissionFinish({
      teamId: "team-transaction",
      missionId: "mission-transaction",
      intentId: "finish-mission-transaction",
    });

    expect(completed.profile.profile.activeMissionId).toBeNull();
    expect(completed.mission).toMatchObject({
      mission: { status: "canceled" },
      finishIntent: { stage: "finalized" },
    });
    expect(completed.mission.completionOutbox).toHaveLength(1);
    expect(
      await transaction.commitMissionFinish({
        teamId: "team-transaction",
        missionId: "mission-transaction",
        intentId: "finish-mission-transaction",
      }),
    ).toEqual(completed);
  });

  test("rejects the wrong Team before changing Mission finish state", async () => {
    const stores = createStores(profileDirectory, missionDirectory);
    const transaction = new TeamMissionPersistenceTransactions(stores);
    await createActiveMission(stores.profiles, stores.missions);
    await stores.missions.beginFinish({
      missionId: "mission-transaction",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
    ] as const) {
      await stores.missions.advanceFinish({
        missionId: "mission-transaction",
        intentId: "finish-mission-transaction",
        from,
        to,
      });
    }

    await expect(
      transaction.commitMissionFinish({
        teamId: "team-other",
        missionId: "mission-transaction",
        intentId: "finish-mission-transaction",
      }),
    ).rejects.toThrow("Team team-other persistence transaction conflict");
    expect(await stores.missions.get("mission-transaction")).toMatchObject({
      mission: { status: "planning", revision: 1 },
      finishIntent: { stage: "participants_archived" },
      completionOutbox: [],
    });
  });

  test("ignores atomic-write temp files before and after rename", async () => {
    await mkdir(profileDirectory, { recursive: true });
    await mkdir(missionDirectory, { recursive: true });
    await writeFile(
      join(profileDirectory, ".team-transaction.json.1.1.pre.tmp"),
      "{partial",
      "utf8",
    );
    const stores = createStores(profileDirectory, missionDirectory);
    await writeFile(
      join(missionDirectory, ".mission-transaction.json.1.1.pre.tmp"),
      "{partial",
      "utf8",
    );
    expect(await stores.profiles.list()).toEqual([]);
    expect(await stores.missions.list()).toEqual([]);

    await createActiveMission(stores.profiles, stores.missions);

    const restarted = createStores(profileDirectory, missionDirectory);
    expect(await restarted.profiles.list()).toHaveLength(1);
    expect(await restarted.missions.list()).toHaveLength(1);
  });
});

function createStores(profileDirectory: string, missionDirectory: string) {
  return {
    profiles: new TeamProfileStore({
      directory: profileDirectory,
      logger: createTestLogger(),
      now: () => NOW,
    }),
    missions: new MissionStore({
      directory: missionDirectory,
      logger: createTestLogger(),
      now: () => NOW,
    }),
  };
}

async function createProfile(profiles: TeamProfileStore): Promise<void> {
  await profiles.createIfAbsent({
    idempotencyKey: "create-team-transaction",
    requestFingerprint: "create-fingerprint-transaction",
    profile: teamProfile(),
  });
}

async function beginMissionWritten(
  profiles: TeamProfileStore,
  missions: MissionStore,
): Promise<void> {
  await createProfile(profiles);
  await new TeamMissionPersistenceTransactions({ profiles, missions }).beginMissionStart({
    teamId: "team-transaction",
    intent: startIntent(),
  });
}

async function advanceExternalStart(profiles: TeamProfileStore): Promise<void> {
  for (const [from, to] of [
    ["mission_written", "room_created"],
    ["room_created", "lead_created"],
  ] as const) {
    await profiles.advanceMissionStart({
      teamId: "team-transaction",
      intentId: "start-team-transaction",
      from,
      to,
    });
  }
}

async function createActiveMission(
  profiles: TeamProfileStore,
  missions: MissionStore,
): Promise<void> {
  await beginMissionWritten(profiles, missions);
  await advanceExternalStart(profiles);
  await new TeamMissionPersistenceTransactions({ profiles, missions }).commitMissionStart({
    teamId: "team-transaction",
    intentId: "start-team-transaction",
    missionId: "mission-transaction",
  });
}

function throwOnceAt(point: TeamPersistenceFaultPoint) {
  let armed = true;
  return {
    hit: async (candidate: TeamPersistenceFaultPoint) => {
      if (armed && candidate === point) {
        armed = false;
        throw new Error(`simulated crash at ${point}`);
      }
    },
  };
}
