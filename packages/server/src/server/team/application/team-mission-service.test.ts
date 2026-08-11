import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type {
  TeamMissionAttentionResolutionInput,
  TeamProfileMemberInput,
} from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { MissionAttentionItem, TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { MissionStore } from "../persistence/mission-store.js";
import { TeamProfileStore } from "../persistence/profile-store.js";
import { TeamPersistenceReconciler } from "../persistence/reconciliation.js";
import type {
  TeamPersistenceFaultInjector,
  TeamPersistenceFaultPoint,
} from "../persistence/transactions.js";
import type {
  ProviderCapabilityResolver,
  TeamParticipantPort,
  TeamRoomPort,
  TeamRuntimeEventPort,
} from "./ports.js";
import {
  TeamMissionService,
  type TeamMissionFinishQuiescencePort,
} from "./team-mission-service.js";
import { TeamOperationCoordinator } from "./team-operation-coordinator.js";

const NOW = "2026-08-08T10:00:00.000Z";

const LEAD: TeamProfileMemberInput = {
  role: "Technical lead",
  level: 5,
  skillIds: ["typescript"],
  executionProfile: {
    provider: "codex",
    model: "gpt-5.6-sol",
    modeId: "auto-review",
    thinkingOptionId: "high",
    featureValues: {},
  },
};

const MEMBER: TeamProfileMemberInput = {
  role: "Software engineer",
  level: 3,
  skillIds: ["typescript"],
  executionProfile: {
    provider: "claude",
    model: "sonnet",
    modeId: "auto",
    thinkingOptionId: null,
    featureValues: {},
  },
};

describe("TeamMissionService lifecycle", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-mission-service-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("creating a Team only persists its profile", async () => {
    const fixture = createFixture(rootDirectory);

    const team = await fixture.service.createTeam({
      idempotencyKey: "create-team",
      name: "Compiler team",
      workspaceId: "workspace-sdk",
      skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
      lead: LEAD,
      members: [MEMBER],
    });

    expect(team).toMatchObject({
      id: "team-1",
      leadMemberId: "member-1",
      activeMissionId: null,
      members: [
        { memberId: "member-1", mentionHandle: "technical-lead" },
        { memberId: "member-2", mentionHandle: "software-engineer" },
      ],
    });
    expect(fixture.effects).toEqual([]);
    expect(await fixture.missions.list()).toEqual([]);
  });

  test("starting a Mission persists each saga stage before room and Lead side effects", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);

    const mission = await fixture.service.startMission({
      idempotencyKey: "start-mission",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Implement a deterministic parser",
      constraints: ["Keep the public grammar stable"],
      acceptanceCriteria: ["Parser tests pass"],
    });

    expect(fixture.effects).toEqual(["room:room-1:mission_written", "lead:agent-1:room_created"]);
    expect(mission).toMatchObject({
      id: "mission-1",
      status: "planning",
      chatRoomId: "room-1",
      participants: [
        {
          memberId: "member-1",
          agentId: "agent-1",
          bindingEpoch: 1,
          archivedAt: null,
        },
      ],
    });
    expect(mission.participants).toHaveLength(1);
    expect((await fixture.profiles.get(team.id))?.profile.activeMissionId).toBe(mission.id);
  });

  test("persists one scoped Attention for repeated scheduler recovery failures", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-runtime-recovery-attention",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Persist runtime recovery failure",
      constraints: [],
      acceptanceCriteria: ["A restart retains one scoped Attention"],
    });
    const input = {
      missionId: mission.id,
      attentionId: `runtime-scheduler:${mission.id}`,
      kind: "lead_unavailable" as const,
      summary: "Scheduler recovery failed: workspace unavailable",
    };

    await fixture.service.recordRecoveryAttention(input);
    await fixture.service.recordRecoveryAttention(input);

    const restartedStore = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    expect(await restartedStore.get(mission.id)).toMatchObject({
      mission: {
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: `runtime-scheduler:${mission.id}`,
            kind: "lead_unavailable",
            status: "open",
            summary: "Scheduler recovery failed: workspace unavailable",
          },
        ],
      },
    });
  });

  test("direct cancellation resolves every open recovery Attention", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-cancel-open-attention",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Cancel a Mission with multiple recovery failures",
      constraints: [],
      acceptanceCriteria: ["Terminal Missions retain no open Attention"],
    });
    await fixture.service.recordRecoveryAttention({
      missionId: mission.id,
      attentionId: `runtime-scheduler:${mission.id}`,
      kind: "lead_unavailable",
      summary: "Scheduler recovery failed: Lead unavailable",
    });
    await fixture.service.recordRecoveryAttention({
      missionId: mission.id,
      attentionId: `notification:delivery-${mission.id}`,
      kind: "notification_unacknowledged",
      summary: "Pending message recovery failed: recipient unavailable",
    });
    const pending = await fixture.missions.get(mission.id);
    if (!pending) throw new Error("Expected the Mission with open Attention");

    const canceled = await fixture.service.cancelMission({
      idempotencyKey: "cancel-open-attention",
      missionId: mission.id,
      expectedRevision: pending.mission.revision,
      reason: "The user canceled the blocked Mission",
    });

    expect(canceled.status).toBe("canceled");
    expect(canceled.attentionItems).toHaveLength(2);
    expect(canceled.attentionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attentionId: `runtime-scheduler:${mission.id}`,
          status: "resolved",
          resolution: expect.objectContaining({
            kind: "cancel_mission",
            actorId: "team-runtime",
            reason: "The user canceled the blocked Mission",
          }),
        }),
        expect.objectContaining({
          attentionId: `notification:delivery-${mission.id}`,
          status: "resolved",
          resolution: expect.objectContaining({
            kind: "cancel_mission",
            actorId: "team-runtime",
            reason: "The user canceled the blocked Mission",
          }),
        }),
      ]),
    );
  });

  test("does not persist recovery Attention after the Mission finish fence", async () => {
    let releaseRecoveryUpdate!: () => void;
    let markRecoveryUpdateStarted!: () => void;
    const recoveryUpdateStarted = new Promise<void>((resolve) => {
      markRecoveryUpdateStarted = resolve;
    });
    const recoveryUpdateGate = new Promise<void>((resolve) => {
      releaseRecoveryUpdate = resolve;
    });
    let releaseArchive!: () => void;
    let markArchiveStarted!: () => void;
    const archiveStarted = new Promise<void>((resolve) => {
      markArchiveStarted = resolve;
    });
    const archiveGate = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeArchive: async () => {
        markArchiveStarted();
        await archiveGate;
      },
    });
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-finish-fenced-recovery-attention",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Do not reopen a finishing Mission",
      constraints: [],
      acceptanceCriteria: ["Terminal Missions have no unresolved Attention"],
    });
    const attentionInput = {
      missionId: mission.id,
      attentionId: `runtime-scheduler:${mission.id}`,
      kind: "lead_unavailable" as const,
      summary: "Scheduler recovery raced Mission completion",
    };

    const updateMission = fixture.missions.update.bind(fixture.missions);
    let gateNextMissionUpdate = true;
    fixture.missions.update = async (input) => {
      if (gateNextMissionUpdate) {
        gateNextMissionUpdate = false;
        markRecoveryUpdateStarted();
        await recoveryUpdateGate;
      }
      return updateMission(input);
    };
    const recordAttention = fixture.service.recordRecoveryAttention(attentionInput);
    await recoveryUpdateStarted;
    const cancellation = fixture.service.cancelMission({
      idempotencyKey: "cancel-finish-fenced-recovery-attention",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "Exercise the finish fence",
    });
    await archiveStarted;
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      finishIntent: { stage: "dispatch_stopped" },
    });
    releaseRecoveryUpdate();
    await recordAttention;
    releaseArchive();
    await cancellation;
    await fixture.service.recordRecoveryAttention({
      ...attentionInput,
      attentionId: `notification:late-${mission.id}`,
      kind: "notification_unacknowledged",
    });

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: { status: "canceled", attentionItems: [] },
      finishIntent: { stage: "finalized" },
    });
  });

  test("persists a Mission-scoped recovery Attention when its Team profile is missing", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-missing-profile-recovery",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Surface a missing Team profile",
      constraints: [],
      acceptanceCriteria: ["The Mission retains a durable recovery expression"],
    });
    const profilePath = join(rootDirectory, "profiles", `${team.id}.json`);
    const persistedProfile = await readFile(profilePath, "utf8");
    await rm(profilePath);

    await expect(fixture.service.reconcile()).resolves.toBeUndefined();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: {
        status: "needs_attention",
        attentionItems: [
          {
            attentionId: `persistence:team_profile_missing:${mission.id}`,
            kind: "ownership_violation",
            status: "open",
            summary: "Team profile is missing for this Mission",
          },
        ],
      },
    });

    const unlinkedProfile = JSON.parse(persistedProfile);
    unlinkedProfile.profile.activeMissionId = null;
    await writeFile(profilePath, JSON.stringify(unlinkedProfile), "utf8");
    await fixture.service.reconcile();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: {
        status: "needs_attention",
        attentionItems: [
          {
            attentionId: `persistence:team_profile_missing:${mission.id}`,
            status: "open",
          },
        ],
      },
    });

    await writeFile(profilePath, persistedProfile, "utf8");
    await fixture.service.reconcile();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: {
        status: "planning",
        suspendedStatus: null,
        attentionItems: [
          {
            attentionId: `persistence:team_profile_missing:${mission.id}`,
            status: "resolved",
            resolution: expect.objectContaining({
              kind: "external_change",
              actorId: "team-runtime",
            }),
          },
        ],
      },
    });
  });

  test("creates a new replay-safe Attention generation when the same failure recurs", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-recurrent-recovery-attention",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Recover recurrent Lead failures",
      constraints: [],
      acceptanceCriteria: ["Each recurrence remains independently resolvable"],
    });
    const attentionInput = {
      missionId: mission.id,
      attentionId: `runtime-scheduler:${mission.id}`,
      kind: "lead_unavailable" as const,
      summary: "Scheduler recovery failed: Lead unavailable",
    };
    await fixture.service.recordRecoveryAttention(attentionInput);
    const firstPending = await fixture.missions.get(mission.id);
    const firstResolved = await fixture.service.resolveAttention({
      idempotencyKey: "replace-first-recurrent-lead",
      missionId: mission.id,
      attentionId: attentionInput.attentionId,
      expectedRevision: firstPending?.mission.revision ?? -1,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead",
        replacementMemberId: team.members[1]?.memberId,
        reason: "Use the available engineer.",
      },
    });

    await fixture.service.recordRecoveryAttention(attentionInput);
    await fixture.service.recordRecoveryAttention(attentionInput);
    const recurrent = await fixture.missions.get(mission.id);
    const recurrentAttention = recurrent?.mission.attentionItems.find(
      (item) =>
        item.attentionId.startsWith(`${attentionInput.attentionId}:generation:`) &&
        item.status === "open",
    );
    expect(recurrentAttention).toBeDefined();
    expect(
      recurrent?.mission.attentionItems.filter(
        (item) => item.attentionId.startsWith(attentionInput.attentionId) && item.status === "open",
      ),
    ).toHaveLength(1);
    expect(
      recurrent?.mission.attentionItems.find(
        (item) => item.attentionId === attentionInput.attentionId,
      ),
    ).toMatchObject({ status: "resolved", resolution: { kind: "replace_lead" } });

    const secondResolved = await fixture.service.resolveAttention({
      idempotencyKey: "replace-second-recurrent-lead",
      missionId: mission.id,
      attentionId: recurrentAttention?.attentionId ?? "missing",
      expectedRevision: recurrent?.mission.revision ?? -1,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead",
        replacementMemberId: team.leadMemberId,
        reason: "Restore the original Lead after recovery.",
      },
    });

    expect(firstResolved.activeRosterSnapshotRevision).toBe(2);
    expect(secondResolved.activeRosterSnapshotRevision).toBe(3);
    expect(
      secondResolved.attentionItems.find(
        (item) => item.attentionId === recurrentAttention?.attentionId,
      ),
    ).toMatchObject({ status: "resolved", resolution: { kind: "replace_lead" } });
  });

  test("replays a completed Mission start before evaluating current Team readiness", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const request = {
      idempotencyKey: "start-replay",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep Mission start permanently idempotent",
      constraints: [],
      acceptanceCriteria: ["The original Mission is returned"],
    };

    const started = await fixture.service.startMission(request);
    const effectsAfterStart = [...fixture.effects];
    fixture.providerState.available = false;
    const replayed = await fixture.service.startMission(request);

    expect(replayed).toEqual(started);
    expect(fixture.effects).toEqual(effectsAfterStart);
    expect(await fixture.missions.list()).toHaveLength(1);
  });

  test("rejects updates for a Member that is not in the Team", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);

    await expect(
      fixture.service.updateTeam({
        teamId: team.id,
        expectedRevision: team.revision,
        memberUpdates: [{ memberId: "member-missing", level: 4 }],
      }),
    ).rejects.toMatchObject({ code: "member_not_found" });
  });

  test("deduplicates a profile update after its response is lost", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const request = {
      idempotencyKey: "update-team-after-lost-response",
      teamId: team.id,
      expectedRevision: team.revision,
      name: "Updated Team",
    };

    const first = await fixture.service.updateTeam(request);
    const replay = await fixture.service.updateTeam(request);

    expect(replay).toEqual(first);
    expect(replay.revision).toBe(team.revision + 1);
  });

  test("keeps a removed Member handle retired when the same role is added later", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const removedMember = team.members[1];
    expect(removedMember?.mentionHandle).toBe("software-engineer");

    const afterRemoval = await fixture.service.updateTeam({
      teamId: team.id,
      expectedRevision: team.revision,
      memberRemovals: [removedMember?.memberId ?? "missing"],
    });
    const restartedStore = new TeamProfileStore({
      directory: join(rootDirectory, "profiles"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    expect((await restartedStore.get(team.id))?.retiredMentionHandles).toEqual([
      "software-engineer",
    ]);

    const afterAddition = await fixture.service.updateTeam({
      teamId: team.id,
      expectedRevision: afterRemoval.revision,
      memberAdds: [MEMBER],
    });

    expect(afterAddition.members.map((member) => member.mentionHandle)).toEqual([
      "technical-lead",
      "software-engineer-2",
    ]);
  });

  test("rejects Member removal and Lead changes while a Mission is active", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    await fixture.service.startMission({
      idempotencyKey: "start-roster-fence",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep the active roster stable",
      constraints: [],
      acceptanceCriteria: ["Profile mutations cannot bypass Mission transition"],
    });
    const activeTeam = await fixture.service.inspectTeam(team.id);
    const memberId = team.members[1]?.memberId ?? "missing";

    await expect(
      fixture.service.updateTeam({
        teamId: team.id,
        expectedRevision: activeTeam?.revision ?? -1,
        memberRemovals: [memberId],
      }),
    ).rejects.toMatchObject({ code: "mission_roster_change_requires_transition" });
    await expect(
      fixture.service.updateTeam({
        teamId: team.id,
        expectedRevision: activeTeam?.revision ?? -1,
        leadMemberId: memberId,
      }),
    ).rejects.toMatchObject({ code: "mission_roster_change_requires_transition" });
  });

  test("rejects roster ownership changes while Mission start is pending", async () => {
    const fixture = createFixture(rootDirectory, { failLeadOnce: true });
    const team = await createTeam(fixture.service);
    await expect(
      fixture.service.startMission({
        idempotencyKey: "start-pending-roster-fence",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Keep a pending roster stable",
        constraints: [],
        acceptanceCriteria: ["The start saga can resume with its original roster"],
      }),
    ).rejects.toThrow("simulated Lead creation crash");

    await expect(
      fixture.service.updateTeam({
        teamId: team.id,
        expectedRevision: team.revision,
        memberRemovals: [team.members[1]?.memberId ?? "missing"],
      }),
    ).rejects.toMatchObject({ code: "mission_roster_change_requires_transition" });
  });

  test("archives a Team by canceling its pending Mission first", async () => {
    const fixture = createFixture(rootDirectory, { failLeadOnce: true });
    const team = await createTeam(fixture.service);
    await expect(
      fixture.service.startMission({
        idempotencyKey: "start-pending-archive-fence",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Keep start and archive serialized",
        constraints: [],
        acceptanceCriteria: ["Pending Mission resources remain owned"],
      }),
    ).rejects.toThrow("simulated Lead creation crash");

    const archived = await fixture.service.archiveTeam({
      idempotencyKey: "archive-pending-team",
      teamId: team.id,
      expectedRevision: team.revision,
    });

    expect(archived).toMatchObject({ lifecycle: "archived", activeMissionId: null });
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      profile: { lifecycle: "archived", activeMissionId: null },
      startIntent: null,
      archiveIntent: null,
    });
    expect((await fixture.missions.list())[0]?.mission.status).toBe("canceled");
  });

  test("archives a Team by canceling its active Mission first", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-before-team-archive",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Finish before Team archive",
      constraints: [],
      acceptanceCriteria: ["Mission is terminal before Team is archived"],
    });
    fixture.effects.length = 0;

    const archived = await fixture.service.archiveTeam({
      idempotencyKey: "archive-active-team",
      teamId: team.id,
      expectedRevision: team.revision + 1,
    });

    expect(archived).toMatchObject({ lifecycle: "archived", activeMissionId: null });
    expect((await fixture.missions.get(mission.id))?.mission.status).toBe("canceled");
    expect(fixture.effects).toEqual(["archive:agent-1"]);
  });

  test("archives a Team whose active Mission is durably marked missing", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-before-missing-mission-archive",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Recover a missing active Mission",
      constraints: [],
      acceptanceCriteria: ["The Team can still be archived"],
    });
    await rm(join(rootDirectory, "missions", `${mission.id}.json`));
    await fixture.service.reconcile();
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      persistenceAttentions: [{ missionId: mission.id, code: "active_mission_missing" }],
    });
    const current = await fixture.service.inspectTeam(team.id);
    if (!current) throw new Error("Expected persisted Team profile");

    const archived = await fixture.service.archiveTeam({
      idempotencyKey: "archive-team-with-missing-mission",
      teamId: team.id,
      expectedRevision: current.revision,
    });

    expect(archived).toMatchObject({ lifecycle: "archived", activeMissionId: null });
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      persistenceAttentions: [],
      profile: { lifecycle: "archived", activeMissionId: null },
    });
  });

  test("restart completes a Team archive after participant cleanup crashes", async () => {
    const first = createFixture(rootDirectory, { failArchiveOnce: true });
    const team = await createTeam(first.service);
    const mission = await first.service.startMission({
      idempotencyKey: "start-before-replayed-team-archive",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replay Team archive",
      constraints: [],
      acceptanceCriteria: ["Restart finishes the same archive intent"],
    });

    await expect(
      first.service.archiveTeam({
        idempotencyKey: "archive-team-with-crash",
        teamId: team.id,
        expectedRevision: team.revision + 1,
      }),
    ).rejects.toThrow("simulated participant archive crash");
    expect(await first.profiles.get(team.id)).toMatchObject({
      archiveIntent: { missionId: mission.id, stage: "requested" },
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect((await restarted.profiles.get(team.id))?.profile.lifecycle).toBe("archived");
    expect((await restarted.missions.get(mission.id))?.mission.status).toBe("canceled");
    expect(restarted.effects).toEqual(["archive:agent-1"]);
  });

  test("persists a Mission finish recovery failure and clears it after retry", async () => {
    const fixture = createFixture(rootDirectory, { failArchiveAgentIds: ["agent-1"] });
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-before-cancel-retry",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Expose a durable cancellation retry",
      constraints: [],
      acceptanceCriteria: ["A failed cleanup remains visible after restart"],
    });
    const request = {
      idempotencyKey: "cancel-with-durable-retry",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "Stop the Mission after preserving its recovery state",
    };

    await expect(fixture.service.cancelMission(request)).rejects.toThrow(
      "simulated participant archive failure",
    );

    const restartedStore = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    expect((await restartedStore.get(mission.id))?.mission.lifecycleRecoveryFailure).toEqual({
      operation: "mission_finish",
      intentId: "finish-1",
      idempotencyKey: request.idempotencyKey,
      code: "lifecycle_recovery_failed",
      message: "simulated participant archive failure",
      retryAction: "cancel_mission",
      attempts: 1,
      failedAt: NOW,
    });
    expect(fixture.publishedMissions.at(-1)?.lifecycleRecoveryFailure).toMatchObject({
      operation: "mission_finish",
      attempts: 1,
    });

    const retryRequest = {
      ...request,
      expectedRevision: (await fixture.missions.get(mission.id))?.mission.revision ?? -1,
      reason: "Retry the already persisted cancellation",
    };
    await expect(fixture.service.cancelMission(retryRequest)).rejects.toThrow(
      "simulated participant archive failure",
    );
    expect(
      (await fixture.missions.get(mission.id))?.mission.lifecycleRecoveryFailure?.attempts,
    ).toBe(2);

    fixture.failArchiveAgentIds.delete("agent-1");
    const recovered = await fixture.service.cancelMission(retryRequest);

    expect(recovered).toMatchObject({ status: "canceled", lifecycleRecoveryFailure: null });
    expect((await fixture.missions.get(mission.id))?.mission.lifecycleRecoveryFailure).toBeNull();
  });

  test("persists a Team archive recovery failure and clears it after retry", async () => {
    const fixture = createFixture(rootDirectory, { failArchiveAgentIds: ["agent-1"] });
    const team = await createTeam(fixture.service);
    await fixture.service.startMission({
      idempotencyKey: "start-before-archive-retry",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Expose a durable Team archive retry",
      constraints: [],
      acceptanceCriteria: ["The same archive operation converges after cleanup recovers"],
    });
    const request = {
      idempotencyKey: "archive-with-durable-retry",
      teamId: team.id,
      expectedRevision: team.revision + 1,
    };

    await expect(fixture.service.archiveTeam(request)).rejects.toThrow(
      "simulated participant archive failure",
    );

    const restartedStore = new TeamProfileStore({
      directory: join(rootDirectory, "profiles"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    expect((await restartedStore.get(team.id))?.profile.lifecycleRecoveryFailure).toEqual({
      operation: "team_archive",
      intentId: "archive-1",
      idempotencyKey: request.idempotencyKey,
      code: "lifecycle_recovery_failed",
      message: "simulated participant archive failure",
      retryAction: "archive_team",
      attempts: 1,
      failedAt: NOW,
    });
    expect(fixture.publishedTeams.at(-1)?.lifecycleRecoveryFailure).toMatchObject({
      operation: "team_archive",
      attempts: 1,
    });

    fixture.failArchiveAgentIds.delete("agent-1");
    const recovered = await fixture.service.archiveTeam({
      ...request,
      expectedRevision: (await fixture.profiles.get(team.id))?.profile.revision ?? -1,
    });

    expect(recovered).toMatchObject({ lifecycle: "archived", lifecycleRecoveryFailure: null });
    expect((await fixture.profiles.get(team.id))?.profile.lifecycleRecoveryFailure).toBeNull();
  });

  test("rejects a stale Team archive behind a Mission start that entered first", async () => {
    let releaseCapability!: () => void;
    let markCapabilityEntered!: () => void;
    const capabilityGate = new Promise<void>((resolve) => {
      releaseCapability = resolve;
    });
    const capabilityEntered = new Promise<void>((resolve) => {
      markCapabilityEntered = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeCapabilityResolve: async () => {
        markCapabilityEntered();
        await capabilityGate;
      },
    });
    const team = await createTeam(fixture.service);

    const starting = fixture.service.startMission({
      idempotencyKey: "start-archive-race",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Serialize lifecycle transitions",
      constraints: [],
      acceptanceCriteria: ["Exactly one transition wins"],
    });
    await capabilityEntered;
    const archiving = fixture.service.archiveTeam({
      idempotencyKey: "archive-race-winner",
      teamId: team.id,
      expectedRevision: team.revision,
    });
    const settledBeforeRelease = await settlesWithin(archiving, 20);
    releaseCapability();
    const [started, archived] = await Promise.allSettled([starting, archiving]);

    expect(settledBeforeRelease).toBe(false);
    expect(started).toMatchObject({ status: "fulfilled", value: { id: "mission-1" } });
    expect(archived).toMatchObject({
      status: "rejected",
      reason: { message: expect.stringContaining("revision 2 does not match 1") },
    });
    expect((await fixture.profiles.get(team.id))?.profile).toMatchObject({
      lifecycle: "active",
      activeMissionId: "mission-1",
    });
  });

  test("serializes cancel across the createLead side-effect window", async () => {
    let releaseLead!: () => void;
    let markLeadEntered!: () => void;
    const leadGate = new Promise<void>((resolve) => {
      releaseLead = resolve;
    });
    const leadEntered = new Promise<void>((resolve) => {
      markLeadEntered = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeLeadCreate: async () => {
        markLeadEntered();
        await leadGate;
      },
    });
    const team = await createTeam(fixture.service);
    const starting = fixture.service.startMission({
      idempotencyKey: "start-cancel-lead-window",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Fence Lead creation",
      constraints: [],
      acceptanceCriteria: ["Cancellation leaves no live participant"],
    });
    await leadEntered;
    const pending = (await fixture.missions.list())[0];
    expect(pending).toBeDefined();

    const canceling = fixture.service.cancelMission({
      idempotencyKey: "cancel-lead-window",
      missionId: pending!.mission.id,
      expectedRevision: pending!.mission.revision,
      reason: "Cancel while Lead creation is blocked",
    });
    const settledBeforeRelease = await settlesWithin(canceling, 20);
    releaseLead();
    const [started, canceled] = await Promise.allSettled([starting, canceling]);

    expect(settledBeforeRelease).toBe(false);
    expect(started.status).toBe("fulfilled");
    expect(canceled).toMatchObject({ status: "fulfilled", value: { status: "canceled" } });
    expect(fixture.liveAgents).toEqual(new Set());
  });

  test("serializes Team archive across the createLead side-effect window", async () => {
    let releaseLead!: () => void;
    let markLeadEntered!: () => void;
    const leadGate = new Promise<void>((resolve) => {
      releaseLead = resolve;
    });
    const leadEntered = new Promise<void>((resolve) => {
      markLeadEntered = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeLeadCreate: async () => {
        markLeadEntered();
        await leadGate;
      },
    });
    const team = await createTeam(fixture.service);
    const starting = fixture.service.startMission({
      idempotencyKey: "start-archive-lead-window",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Fence Team archive",
      constraints: [],
      acceptanceCriteria: ["Archive leaves no live participant"],
    });
    await leadEntered;

    const archiving = fixture.service.archiveTeam({
      idempotencyKey: "archive-lead-window",
      teamId: team.id,
      expectedRevision: team.revision,
    });
    const settledBeforeRelease = await settlesWithin(archiving, 20);
    releaseLead();
    const [started, archived] = await Promise.allSettled([starting, archiving]);

    expect(settledBeforeRelease).toBe(false);
    expect(started.status).toBe("fulfilled");
    expect(archived).toMatchObject({
      status: "rejected",
      reason: { message: expect.stringContaining("revision 2 does not match 1") },
    });
    expect(fixture.liveAgents).toEqual(new Set(["agent-1"]));
    expect((await fixture.profiles.get(team.id))?.profile.activeMissionId).toBe("mission-1");
  });

  test("restart resumes a partially created Mission without creating another resource", async () => {
    const first = createFixture(rootDirectory, { failLeadOnce: true });
    const team = await createTeam(first.service);

    await expect(
      first.service.startMission({
        idempotencyKey: "restart-mission",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Recover startup",
        constraints: [],
        acceptanceCriteria: ["One room and one Lead exist"],
      }),
    ).rejects.toThrow("simulated Lead creation crash");

    expect((await first.profiles.get(team.id))?.startIntent?.stage).toBe("room_created");

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect(restarted.effects).toEqual(["lead:agent-1:room_created"]);
    expect((await restarted.profiles.get(team.id))?.profile.activeMissionId).toBe("mission-1");
    expect((await restarted.missions.list()).map((entry) => entry.mission.id)).toEqual([
      "mission-1",
    ]);
  });

  test.each<TeamPersistenceFaultPoint>([
    "after_mission_write",
    "after_start_stage",
    "after_lead_participant_write",
  ])("restart replays the same Mission after the %s crash checkpoint", async (faultPoint) => {
    const first = createFixture(rootDirectory, {
      persistenceFaultInjector: throwOnceAt(faultPoint),
    });
    const team = await createTeam(first.service);
    const request = {
      idempotencyKey: "start-after-mission-write",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep Mission identity across a persistence crash",
      constraints: [],
      acceptanceCriteria: ["Only the reserved Mission and Lead are activated"],
    };

    await expect(first.service.startMission(request)).rejects.toThrow(
      `simulated crash at ${faultPoint}`,
    );

    const persistedBeforeRestart = await first.missions.list();
    expect(persistedBeforeRestart.map((entry) => entry.mission.id)).toEqual(["mission-1"]);
    expect(persistedBeforeRestart[0]?.mission.participants).toEqual([
      expect.objectContaining({ agentId: "agent-1", memberId: "member-1" }),
    ]);

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect((await restarted.profiles.get(team.id))?.startIntent).toBeNull();
    expect((await restarted.profiles.get(team.id))?.profile.activeMissionId).toBe("mission-1");
    expect((await restarted.missions.list()).map((entry) => entry.mission.id)).toEqual([
      "mission-1",
    ]);
    expect((await restarted.missions.get("mission-1"))?.mission.participants).toEqual([
      expect.objectContaining({ agentId: "agent-1", memberId: "member-1" }),
    ]);
    const replayed = await restarted.service.startMission(request);
    expect(replayed.id).toBe("mission-1");
    expect(replayed.participants).toEqual([
      expect.objectContaining({ agentId: "agent-1", memberId: "member-1" }),
    ]);
    const lifecycleEffects = [...first.effects, ...restarted.effects];
    expect(lifecycleEffects.filter((effect) => effect.startsWith("room:room-1:"))).toHaveLength(1);
    expect(lifecycleEffects.filter((effect) => effect.startsWith("lead:agent-1:"))).toHaveLength(
      faultPoint === "after_lead_participant_write" ? 2 : 1,
    );
    if (faultPoint === "after_lead_participant_write") {
      expect(restarted.effects).toContain("lead:agent-1:lead_created");
    }
  });

  test("does not re-wake the Lead when planning completed before start activation", async () => {
    const first = createFixture(rootDirectory, {
      persistenceFaultInjector: throwOnceAt("after_lead_participant_write"),
    });
    const team = await createTeam(first.service);
    const request = {
      idempotencyKey: "start-with-persisted-plan",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep the persisted plan authoritative",
      constraints: [],
      acceptanceCriteria: ["Restart does not duplicate Lead planning"],
    };

    await expect(first.service.startMission(request)).rejects.toThrow(
      "simulated crash at after_lead_participant_write",
    );
    const pending = (await first.missions.list())[0]!;
    await first.missions.update({
      missionId: pending.mission.id,
      expectedRevision: pending.mission.revision,
      update: (mission) => ({ ...mission, planRevision: 1 }),
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect(restarted.effects.filter((effect) => effect.startsWith("lead:"))).toEqual([]);
    expect((await restarted.profiles.get(team.id))?.profile.activeMissionId).toBe(
      pending.mission.id,
    );
  });

  test("canceling a pending Mission prevents restart from creating its Lead", async () => {
    const first = createFixture(rootDirectory, { failLeadOnce: true });
    const team = await createTeam(first.service);

    await expect(
      first.service.startMission({
        idempotencyKey: "start-then-cancel",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Do not revive canceled work",
        constraints: [],
        acceptanceCriteria: ["Restart creates no participant for canceled work"],
      }),
    ).rejects.toThrow("simulated Lead creation crash");
    const pending = (await first.missions.list())[0];
    expect(pending).toBeDefined();

    const canceled = await first.service.cancelMission({
      idempotencyKey: "cancel-pending-mission",
      missionId: pending!.mission.id,
      expectedRevision: pending!.mission.revision,
      reason: "The user canceled before the Lead became active",
    });

    expect(canceled.status).toBe("canceled");
    expect(await first.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: null,
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect(restarted.effects).toEqual([]);
    expect((await restarted.missions.get(canceled.id))?.mission.status).toBe("canceled");
  });

  test("Mission room replay keeps the Team name frozen by the start intent", async () => {
    const first = createFixture(rootDirectory, { failRoomOnce: true });
    const team = await createTeam(first.service);

    await expect(
      first.service.startMission({
        idempotencyKey: "start-room-replay",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Replay the same room contract",
        constraints: [],
        acceptanceCriteria: ["Room identity is idempotent across restart"],
      }),
    ).rejects.toThrow("simulated room stage crash");
    await first.service.updateTeam({
      teamId: team.id,
      expectedRevision: team.revision,
      name: "Renamed compiler team",
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect(first.roomNames).toEqual(["Compiler team"]);
    expect(restarted.roomNames).toEqual(["Compiler team"]);
  });

  test("reconciliation isolates one failed Team and records actionable Attention", async () => {
    const first = createFixture(rootDirectory, {
      failLeadAgentIds: ["agent-1", "agent-2"],
    });
    const firstTeam = await createTeam(first.service);
    const secondTeam = await first.service.createTeam({
      idempotencyKey: "create-team-2",
      name: "Runtime team",
      workspaceId: "workspace-sdk",
      skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
      lead: LEAD,
      members: [MEMBER],
    });
    for (const [team, key] of [
      [firstTeam, "recover-bad-team"],
      [secondTeam, "recover-good-team"],
    ] as const) {
      await expect(
        first.service.startMission({
          idempotencyKey: key,
          teamId: team.id,
          expectedTeamRevision: team.revision,
          objective: `Recover ${team.name}`,
          constraints: [],
          acceptanceCriteria: ["Other Teams remain available"],
        }),
      ).rejects.toThrow("simulated Lead creation failure");
    }

    const restarted = createFixture(rootDirectory, { failLeadAgentIds: ["agent-1"] });
    await restarted.service.reconcile();

    expect(await restarted.profiles.get(secondTeam.id)).toMatchObject({
      profile: { activeMissionId: "mission-2" },
      startIntent: null,
    });
    expect((await restarted.missions.get("mission-1"))?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "planning",
      attentionItems: [{ kind: "lead_unavailable", status: "open" }],
    });
    expect(restarted.effects).toEqual(["lead:agent-1:room_created", "lead:agent-2:room_created"]);
  });

  test("reconciliation isolates an unreadable pending Mission and resumes healthy Teams", async () => {
    const first = createFixture(rootDirectory, {
      failLeadAgentIds: ["agent-1", "agent-2"],
    });
    const firstTeam = await createTeam(first.service);
    const secondTeam = await first.service.createTeam({
      idempotencyKey: "create-team-2",
      name: "Runtime team",
      workspaceId: "workspace-sdk",
      skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
      lead: LEAD,
      members: [MEMBER],
    });
    for (const [team, key] of [
      [firstTeam, "corrupt-pending-mission"],
      [secondTeam, "healthy-pending-mission"],
    ] as const) {
      await expect(
        first.service.startMission({
          idempotencyKey: key,
          teamId: team.id,
          expectedTeamRevision: team.revision,
          objective: `Recover ${team.name}`,
          constraints: [],
          acceptanceCriteria: ["Unreadable Missions do not block healthy Teams"],
        }),
      ).rejects.toThrow("simulated Lead creation failure");
    }
    const corruptMissionPath = join(rootDirectory, "missions", "mission-1.json");
    await writeFile(corruptMissionPath, "{not-json", "utf8");

    const restarted = createFixture(rootDirectory);
    await expect(restarted.service.reconcile()).resolves.toBeUndefined();

    expect(await readFile(corruptMissionPath, "utf8")).toBe("{not-json");
    expect(await restarted.profiles.get(firstTeam.id)).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: { missionId: "mission-1", stage: "room_created" },
    });
    expect(await restarted.profiles.get(secondTeam.id)).toMatchObject({
      profile: { activeMissionId: "mission-2" },
      startIntent: null,
    });
    expect(restarted.effects).toEqual(["lead:agent-2:room_created"]);
  });

  test("replaces a failed pending-start Lead and replays only the replacement after restart", async () => {
    const liveAgents = new Set<string>();
    const first = createFixture(rootDirectory, {
      failLeadAgentIds: ["agent-1"],
      failLeadAfterCreateAgentIds: ["agent-2"],
      liveAgents,
    });
    const team = await createTeam(first.service);

    await expect(
      first.service.startMission({
        idempotencyKey: "start-pending-lead-replacement",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Replace the Lead while Mission start is pending",
        constraints: [],
        acceptanceCriteria: ["Restart provisions only the replacement Lead"],
      }),
    ).rejects.toThrow("simulated Lead creation failure");
    await first.service.reconcile();

    const pending = await first.missions.get("mission-1");
    const attention = pending?.mission.attentionItems.find(
      (item) => item.kind === "lead_unavailable" && item.status === "open",
    );
    expect(attention).toBeDefined();
    expect(await first.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: {
        intentId: "start-1",
        stage: "room_created",
        leadAgentId: "agent-1",
        rosterSnapshot: { leadMemberId: team.leadMemberId },
      },
    });

    await expect(
      first.service.resolveAttention({
        idempotencyKey: "replace-pending-start-lead",
        missionId: "mission-1",
        attentionId: attention?.attentionId ?? "missing",
        expectedRevision: pending?.mission.revision ?? -1,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Promote the available engineer.",
        },
      }),
    ).rejects.toThrow("simulated Lead creation response loss");
    expect(await first.missions.get("mission-1")).toMatchObject({
      leadReplacementIntent: {
        intentId: "replacement-1",
        missionStartIntentId: "start-1",
        replacementAgentId: "agent-2",
      },
    });
    expect(await first.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: {
        stage: "room_created",
        leadAgentId: "agent-2",
        bindingEpoch: 1,
        rosterSnapshot: {
          revision: 2,
          reason: "replan",
          leadMemberId: team.members[1]?.memberId,
        },
      },
    });

    const restarted = createFixture(rootDirectory, { liveAgents });
    await restarted.service.reconcile();

    expect(await restarted.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: "mission-1" },
      startIntent: null,
    });
    expect(await restarted.missions.get("mission-1")).toMatchObject({
      leadReplacementIntent: null,
      mission: {
        activeRosterSnapshotRevision: 2,
        participants: [
          { memberId: team.leadMemberId, agentId: "agent-1", archivedAt: NOW },
          {
            memberId: team.members[1]?.memberId,
            agentId: "agent-2",
            bindingEpoch: 1,
            archivedAt: null,
          },
        ],
      },
    });
    expect(restarted.effects.some((effect) => effect.startsWith("lead:agent-1:"))).toBe(false);
    expect(liveAgents).toEqual(new Set(["agent-2"]));
    expect(restarted.publishedMissions).toHaveLength(2);
    expect(restarted.publishedMissions.at(-1)).toMatchObject({
      id: "mission-1",
      activeRosterSnapshotRevision: 2,
    });
  });

  test("wakes the replacement when a pending start already reached lead_created", async () => {
    const fixture = createFixture(rootDirectory, {
      failLeadAgentIds: ["agent-1"],
      failLeadAfterCreateAgentIds: ["agent-2"],
    });
    const team = await createTeam(fixture.service);
    await expect(
      fixture.service.startMission({
        idempotencyKey: "start-before-lead-created-replacement",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Wake a replacement from the final start stage",
        constraints: [],
        acceptanceCriteria: ["The replacement provider is actually awakened"],
      }),
    ).rejects.toThrow("simulated Lead creation failure");
    await fixture.service.reconcile();
    const pendingProfile = await fixture.profiles.get(team.id);
    if (!pendingProfile?.startIntent) throw new Error("expected a pending Mission start");
    await fixture.profiles.advanceMissionStart({
      teamId: team.id,
      intentId: pendingProfile.startIntent.intentId,
      from: "room_created",
      to: "lead_created",
    });
    const pendingMission = await fixture.missions.get("mission-1");
    const attention = pendingMission?.mission.attentionItems.find(
      (item) => item.kind === "lead_unavailable" && item.status === "open",
    );
    fixture.effects.length = 0;

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "replace-lead-created-lead",
        missionId: "mission-1",
        attentionId: attention?.attentionId ?? "missing",
        expectedRevision: pendingMission?.mission.revision ?? -1,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Wake the replacement before activation.",
        },
      }),
    ).rejects.toThrow("simulated Lead creation response loss");
    expect(fixture.effects).toEqual(["archive:agent-1", "lead:agent-2:lead_created"]);
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: { stage: "lead_created", leadAgentId: "agent-2" },
    });
  });

  test("fences the old pending-start Lead while replacement alignment is retrying", async () => {
    const fixture = createFixture(rootDirectory, { failLeadAgentIds: ["agent-1"] });
    const team = await createTeam(fixture.service);
    await expect(
      fixture.service.startMission({
        idempotencyKey: "start-before-alignment-fence",
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Fence stale Lead recovery",
        constraints: [],
        acceptanceCriteria: ["The old Lead is not provisioned after replacement begins"],
      }),
    ).rejects.toThrow("simulated Lead creation failure");
    await fixture.service.reconcile();
    const pendingMission = await fixture.missions.get("mission-1");
    const attention = pendingMission?.mission.attentionItems.find(
      (item) => item.kind === "lead_unavailable" && item.status === "open",
    );
    const alignMissionStartLead = fixture.profiles.alignMissionStartLead.bind(fixture.profiles);
    fixture.profiles.alignMissionStartLead = async () => {
      throw new Error("simulated start intent alignment failure");
    };
    fixture.effects.length = 0;

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "replace-after-alignment-failure",
        missionId: "mission-1",
        attentionId: attention?.attentionId ?? "missing",
        expectedRevision: pendingMission?.mission.revision ?? -1,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Retry profile alignment before any provider side effect.",
        },
      }),
    ).rejects.toThrow("simulated start intent alignment failure");
    await fixture.service.reconcile();

    expect(fixture.effects).toEqual([]);
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: null },
      startIntent: { leadAgentId: "agent-1" },
    });
    expect(await fixture.missions.get("mission-1")).toMatchObject({
      leadReplacementIntent: { replacementAgentId: "agent-2", stage: "reserved" },
    });

    fixture.profiles.alignMissionStartLead = alignMissionStartLead;
    await fixture.service.reconcile();
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: "mission-1" },
      startIntent: null,
    });
  });

  test("cancel takes over a response-lost Lead replacement without provisioning after restart", async () => {
    const liveAgents = new Set<string>();
    const fixture = createFixture(rootDirectory, {
      failLeadAfterCreateAgentIds: ["agent-2"],
      liveAgents,
    });
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-before-canceling-replacement",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Cancel a response-lost replacement",
      constraints: [],
      acceptanceCriteria: ["No replacement Agent survives terminal recovery"],
    });
    const pending = await addLeadUnavailableAttention(fixture.missions, mission);
    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "replace-before-cancel",
        missionId: mission.id,
        attentionId: "attention-lead-unavailable",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Promote the available engineer.",
        },
      }),
    ).rejects.toThrow("simulated Lead creation response loss");
    expect(liveAgents).toEqual(new Set(["agent-2"]));
    fixture.effects.length = 0;
    const advanceFinish = fixture.missions.advanceFinish.bind(fixture.missions);
    let loseParticipantStageResponse = true;
    fixture.missions.advanceFinish = async (input) => {
      const advanced = await advanceFinish(input);
      if (input.to === "participants_archived" && loseParticipantStageResponse) {
        loseParticipantStageResponse = false;
        throw new Error("simulated finish participant stage response loss");
      }
      return advanced;
    };
    const replacing = await fixture.missions.get(mission.id);
    const cancelRequest = {
      idempotencyKey: "cancel-pending-replacement",
      missionId: mission.id,
      expectedRevision: replacing?.mission.revision ?? -1,
      reason: "Stop before replacement recovery resumes.",
    };

    await expect(fixture.service.cancelMission(cancelRequest)).rejects.toThrow(
      "simulated finish participant stage response loss",
    );
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      leadReplacementIntent: null,
      finishIntent: { stage: "participants_archived" },
    });
    const restarted = createFixture(rootDirectory, { liveAgents });
    await restarted.service.reconcile();

    expect(restarted.effects.some((effect) => effect.startsWith("lead:"))).toBe(false);
    expect(fixture.effects).toEqual(["archive:agent-2", "archive:agent-1"]);
    expect(liveAgents).toEqual(new Set());
    expect(await restarted.missions.get(mission.id)).toMatchObject({
      leadReplacementIntent: null,
      mission: {
        status: "canceled",
        participants: [{ archivedAt: NOW }, { archivedAt: NOW }],
      },
    });

    await restarted.service.cancelMission(cancelRequest);
    await restarted.service.reconcile();
    expect(restarted.effects.some((effect) => effect.startsWith("lead:"))).toBe(false);
    expect(liveAgents).toEqual(new Set());
  });

  test("cancel archives participants but preserves Team, Mission, and room", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-cancel",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Cancel safely",
      constraints: [],
      acceptanceCriteria: ["Participant sessions are archived"],
    });
    fixture.effects.length = 0;

    const canceled = await fixture.service.cancelMission({
      idempotencyKey: "cancel-mission",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "The user changed direction",
    });

    expect(fixture.effects).toEqual(["archive:agent-1"]);
    expect(canceled.status).toBe("canceled");
    expect(canceled.participants[0]?.archivedAt).toBe(NOW);
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      profile: { id: team.id, activeMissionId: null, lifecycle: "active" },
    });
    expect(await fixture.missions.get(mission.id)).not.toBeNull();
    expect(fixture.roomsDeleted).toEqual([]);
  });

  test("restart clears the active Mission link after the terminal Mission crash checkpoint", async () => {
    const first = createFixture(rootDirectory, {
      persistenceFaultInjector: throwOnceAt("after_mission_finalize"),
    });
    const team = await createTeam(first.service);
    const mission = await first.service.startMission({
      idempotencyKey: "start-before-terminal-checkpoint",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Finish without losing the Mission identity",
      constraints: [],
      acceptanceCriteria: ["The active Mission link is cleared after restart"],
    });

    await expect(
      first.service.cancelMission({
        idempotencyKey: "cancel-at-terminal-checkpoint",
        missionId: mission.id,
        expectedRevision: mission.revision,
        reason: "Exercise terminal persistence replay",
      }),
    ).rejects.toThrow("simulated crash at after_mission_finalize");

    expect(await first.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: mission.id },
    });
    expect(await first.missions.get(mission.id)).toMatchObject({
      mission: {
        id: mission.id,
        status: "canceled",
        participants: [expect.objectContaining({ agentId: "agent-1", memberId: "member-1" })],
      },
      finishIntent: { stage: "finalized" },
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect((await restarted.profiles.get(team.id))?.profile.activeMissionId).toBeNull();
    expect((await restarted.missions.list()).map((entry) => entry.mission.id)).toEqual([
      mission.id,
    ]);
    expect((await restarted.missions.get(mission.id))?.mission.participants).toHaveLength(1);
  });

  test("allows a late Assignment report while participant archive is in flight", async () => {
    let releaseArchive!: () => void;
    let markArchiveStarted!: () => void;
    const archiveStarted = new Promise<void>((resolve) => {
      markArchiveStarted = resolve;
    });
    const archiveGate = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const operations = new TeamOperationCoordinator();
    const fixture = createFixture(rootDirectory, {
      operations,
      beforeArchive: async () => {
        markArchiveStarted();
        await archiveGate;
      },
    });
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-late-report",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Preserve a report racing Mission finish",
      constraints: [],
      acceptanceCriteria: ["The report is durable before unresolved work is canceled"],
    });
    const assignment = {
      ...providerBlockedAssignment(mission.id),
      runtimeAgentId: "agent-1",
      bindingEpoch: 1,
      terminationReason: null,
      dispatchState: "dispatched" as const,
      semanticState: "running" as const,
      acceptedTurnId: "turn-late-report",
      workspaceBaseline: {
        baselineId: "baseline-late-report",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment-provider",
        policyRevision: 1,
        capturedAt: NOW,
        entries: [],
      },
      dispatchedAt: NOW,
      settledAt: null,
    };
    await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({ ...current, assignments: [assignment] }),
    });
    const withFact = await fixture.missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: assignment.assignmentId,
          turnId: "turn-late-report",
          runtimeAgentId: "agent-1",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const settled = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: withFact.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((candidate) =>
          candidate.assignmentId === assignment.assignmentId
            ? {
                ...candidate,
                revision: candidate.revision + 1,
                dispatchState: "settled" as const,
                semanticState: "needs_report" as const,
                settledAt: NOW,
                terminalEvidence: {
                  assignmentId: assignment.assignmentId,
                  acceptedTurn: {
                    turnId: "turn-late-report",
                    runtimeAgentId: "agent-1",
                    outcome: "completed" as const,
                    recordedAt: NOW,
                  },
                  capturedDelta: [],
                  ownershipViolations: [],
                  report: null,
                  handoffs: [],
                  capturedAt: NOW,
                },
              }
            : candidate,
        ),
      }),
    });

    const canceling = fixture.service.cancelMission({
      idempotencyKey: "cancel-after-late-report",
      missionId: mission.id,
      expectedRevision: settled.mission.revision,
      reason: "Stop after collecting evidence",
    });
    await archiveStarted;
    let markLateReportEntered!: () => void;
    const lateReportEntered = new Promise<void>((resolve) => {
      markLateReportEntered = resolve;
    });
    const lateReport = fixture.operations.serialize(team.id, async () => {
      markLateReportEntered();
      const current = await fixture.missions.get(mission.id);
      if (!current) throw new Error("Mission disappeared before the late report");
      await fixture.missions.update({
        missionId: mission.id,
        expectedRevision: current.mission.revision,
        update: (aggregate) => {
          const assignments = structuredClone(aggregate.assignments);
          const candidate = assignments[0];
          if (candidate?.assignmentId !== assignment.assignmentId) {
            throw new Error("Late report Assignment disappeared");
          }
          candidate.revision += 1;
          candidate.report = {
            status: "completed",
            verdict: null,
            summary: "Late report persisted during finish",
            artifactPaths: [],
            tests: [],
            decisions: [],
            handoffs: [],
          };
          return { ...aggregate, assignments };
        },
      });
    });

    expect(await settlesWithin(lateReportEntered, 100)).toBe(true);
    await lateReport;
    expect((await fixture.missions.get(mission.id))?.mission.assignments[0]?.report).toMatchObject({
      summary: "Late report persisted during finish",
    });
    releaseArchive();
    await canceling;
  });

  test("concurrent Attention resolution retries converge on the persisted result", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-attention",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Resolve an ownership question",
      constraints: [],
      acceptanceCriteria: ["The attention item is resolved once"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: "attention-1",
            kind: "ownership_violation",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: null,
            summary: "A path needs an owner.",
            pathEvidence: [{ path: "packages/server/index.ts", fingerprint: "sha256:1" }],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });
    const request = {
      idempotencyKey: "resolve-attention",
      missionId: mission.id,
      attentionId: "attention-1",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "external_change" as const,
        reason: "This edit belongs to the user.",
      },
    };

    const [first, replay] = await Promise.all([
      fixture.service.resolveAttention(request),
      fixture.service.resolveAttention(request),
    ]);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      status: "planning",
      attentionItems: [
        {
          status: "resolved",
          resolution: {
            kind: "external_change",
            actorId: "user-1",
            reason: "This edit belongs to the user.",
          },
        },
      ],
    });
  });

  test("rejects a resolution kind that does not match the Attention item", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-invalid-attention-resolution",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep Attention decisions typed",
      constraints: [],
      acceptanceCriteria: ["Only a valid ownership resolution closes the item"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: "attention-ownership",
            kind: "ownership_violation",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: null,
            summary: "A changed path needs an owner.",
            pathEvidence: [{ path: "packages/server/index.ts", fingerprint: "sha256:1" }],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "resolve-with-wrong-kind",
        missionId: mission.id,
        attentionId: "attention-ownership",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "resume_provider",
          reason: "This action belongs to a different Attention type.",
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_attention_resolution" });
    expect((await fixture.missions.get(mission.id))?.mission).toMatchObject({
      status: "needs_attention",
      attentionItems: [{ attentionId: "attention-ownership", status: "open" }],
    });
  });

  test("resumes a provider-blocked Assignment when its Attention is resolved", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-provider-attention",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Retry provider dispatch",
      constraints: [],
      acceptanceCriteria: ["The Assignment becomes dispatchable again"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        assignments: [providerBlockedAssignment(mission.id)],
        attentionItems: [
          {
            attentionId: "attention-provider",
            kind: "provider_unavailable",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: "assignment-provider",
            summary: "The configured provider rejected dispatch.",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });

    const resumed = await fixture.service.resolveAttention({
      idempotencyKey: "resume-provider",
      missionId: mission.id,
      attentionId: "attention-provider",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: { kind: "resume_provider", reason: "Provider configuration is fixed." },
    });

    expect(resumed).toMatchObject({
      status: "planning",
      suspendedStatus: null,
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-provider",
          revision: 2,
          semanticState: "planned",
          terminationReason: null,
        }),
      ],
      attentionItems: [
        expect.objectContaining({
          attentionId: "attention-provider",
          status: "resolved",
          resolution: expect.objectContaining({
            kind: "resume_provider",
            actorId: "user-1",
            reason: "Provider configuration is fixed.",
          }),
        }),
      ],
    });
  });

  test("attributes an ownership violation to an Assignment and records the delta handoff", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-owner-attribution",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Attribute a workspace change",
      constraints: [],
      acceptanceCriteria: ["Every changed path has one owner"],
    });
    const pathEvidence = [
      { path: "packages/server/src/index.ts", fingerprint: "sha256:server-change" },
    ];
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "active",
        assignments: [
          ownershipAssignment(mission.id, "assignment-source", "packages/app"),
          ownershipAssignment(mission.id, "assignment-owner", "packages/server"),
        ],
        attentionItems: [
          {
            attentionId: "attention-owner",
            kind: "ownership_violation",
            status: "open",
            priorMissionStatus: "active",
            assignmentId: "assignment-source",
            summary: "A changed path needs an owner.",
            pathEvidence,
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });

    const resolved = await fixture.service.resolveAttention({
      idempotencyKey: "attribute-owner",
      missionId: mission.id,
      attentionId: "attention-owner",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "attribute_owner",
        ownerAssignmentId: "assignment-owner",
        reason: "The server Assignment owns this path.",
      },
    });

    expect(resolved).toMatchObject({
      status: "active",
      suspendedStatus: null,
      attentionItems: [
        expect.objectContaining({
          attentionId: "attention-owner",
          status: "resolved",
          resolution: expect.objectContaining({
            kind: "attribute_owner",
            ownerAssignmentId: "assignment-owner",
          }),
        }),
      ],
    });
    expect((await fixture.missions.get(mission.id))?.assignmentDeltaHandoffs).toEqual([
      {
        sourceAssignmentId: "assignment-source",
        replacementAssignmentId: "assignment-owner",
        reportHoldLeaseId: null,
        capturedDelta: pathEvidence,
        createdAt: NOW,
      },
    ]);
  });

  test("rejects ownership attribution outside the selected Assignment scope", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-invalid-owner-attribution",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Reject an invalid owner",
      constraints: [],
      acceptanceCriteria: ["Ownership remains within scope"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "active",
        assignments: [
          ownershipAssignment(mission.id, "assignment-source", "packages/server"),
          ownershipAssignment(mission.id, "assignment-owner", "packages/app"),
        ],
        attentionItems: [
          {
            attentionId: "attention-invalid-owner",
            kind: "ownership_violation",
            status: "open",
            priorMissionStatus: "active",
            assignmentId: "assignment-source",
            summary: "A changed path needs an owner.",
            pathEvidence: [
              { path: "packages/server/src/index.ts", fingerprint: "sha256:server-change" },
            ],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "attribute-invalid-owner",
        missionId: mission.id,
        attentionId: "attention-invalid-owner",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "attribute_owner",
          ownerAssignmentId: "assignment-owner",
          reason: "Assign it to the App work.",
        },
      }),
    ).rejects.toMatchObject({ code: "owner_assignment_scope_mismatch" });
    expect((await fixture.missions.get(mission.id))?.assignmentDeltaHandoffs).toEqual([]);
  });

  test.each<[MissionAttentionItem["kind"], TeamMissionAttentionResolutionInput, string]>([
    [
      "missing_report",
      {
        kind: "recovery_assignment",
        recoveryAssignmentId: "assignment-recovery",
        reason: "Recover it.",
      },
      "attention_resolution_requires_recovery_assignment",
    ],
    [
      "missing_report",
      { kind: "report_received", reason: "The report arrived." },
      "attention_resolution_requires_assignment_report",
    ],
    [
      "participant_unavailable",
      { kind: "replan", reason: "Move the work." },
      "attention_resolution_requires_mission_plan",
    ],
  ])(
    "requires the real action for public %s Attention resolution",
    async (attentionKind, resolution, errorCode) => {
      const fixture = createFixture(rootDirectory);
      const team = await createTeam(fixture.service);
      const mission = await fixture.service.startMission({
        idempotencyKey: `start-unimplemented-${resolution.kind}`,
        teamId: team.id,
        expectedTeamRevision: team.revision,
        objective: "Reject fake Attention recovery",
        constraints: [],
        acceptanceCriteria: ["Resolution only closes after its side effect commits"],
      });
      const pending = await fixture.missions.update({
        missionId: mission.id,
        expectedRevision: mission.revision,
        update: (current) => ({
          ...current,
          status: "needs_attention",
          suspendedStatus: "planning",
          attentionItems: [
            {
              attentionId: "attention-unimplemented",
              kind: attentionKind,
              status: "open",
              priorMissionStatus: "planning",
              assignmentId: null,
              summary: "A real recovery side effect is required.",
              pathEvidence: [],
              createdAt: NOW,
              resolution: null,
            },
          ],
        }),
      });

      await expect(
        fixture.service.resolveAttention({
          idempotencyKey: `resolve-unimplemented-${resolution.kind}`,
          missionId: mission.id,
          attentionId: "attention-unimplemented",
          expectedRevision: pending.mission.revision,
          actorId: "user-1",
          resolution,
        }),
      ).rejects.toMatchObject({ code: errorCode });
      expect((await fixture.missions.get(mission.id))?.mission.attentionItems[0]?.status).toBe(
        "open",
      );
    },
  );

  test("replaces a lost Lead with one durable binding and leaves Mission replanning open", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-lead-replacement",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replace an unavailable Lead",
      constraints: [],
      acceptanceCriteria: ["The replacement Lead must submit a new Mission plan"],
    });
    const pending = await addLeadUnavailableAttention(fixture.missions, mission);
    fixture.effects.length = 0;

    const replaced = await fixture.service.resolveAttention({
      idempotencyKey: "replace-lost-lead",
      missionId: mission.id,
      attentionId: "attention-lead-unavailable",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead",
        replacementMemberId: team.members[1]?.memberId,
        reason: "Promote the available engineer.",
      },
    });

    expect(replaced).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "planning",
      activeRosterSnapshotRevision: 2,
      rosterSnapshots: [
        { revision: 1, reason: "initial", leadMemberId: team.leadMemberId },
        { revision: 2, reason: "replan", leadMemberId: team.members[1]?.memberId },
      ],
      participants: [
        { memberId: team.leadMemberId, agentId: "agent-1", archivedAt: NOW },
        { memberId: team.members[1]?.memberId, agentId: "agent-2", bindingEpoch: 1 },
      ],
      attentionItems: [
        {
          attentionId: "attention-lead-unavailable",
          status: "resolved",
          resolution: {
            kind: "replace_lead",
            replacementMemberId: team.members[1]?.memberId,
          },
        },
        { kind: "assignment_requires_replan", status: "open" },
      ],
    });
    expect(fixture.effects).toEqual(["archive:agent-1", "lead:agent-2:undefined"]);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      leadReplacementIntent: null,
      mission: { participants: [{ agentId: "agent-1" }, { agentId: "agent-2" }] },
    });

    const replanAttention = replaced.attentionItems.find(
      (attention) => attention.kind === "assignment_requires_replan" && attention.status === "open",
    );
    if (!replanAttention) {
      throw new Error("expected replacement Lead to require a real Mission plan");
    }
    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "cannot-resolve-replan-without-plan",
        missionId: mission.id,
        attentionId: replanAttention.attentionId,
        expectedRevision: replaced.revision,
        actorId: "agent-2",
        resolution: { kind: "replan", reason: "No Mission plan was submitted." },
      }),
    ).rejects.toMatchObject({ code: "attention_resolution_requires_mission_plan" });
    expect(
      (await fixture.missions.get(mission.id))?.mission.attentionItems.find(
        (attention) => attention.attentionId === replanAttention.attentionId,
      )?.status,
    ).toBe("open");
  });

  test("physically archives an idle replacement binding once before creating the new Lead", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-replacement-with-idle-binding",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replace a Lead without leaking an idle participant",
      constraints: [],
      acceptanceCriteria: ["Only the replacement Lead binding remains active"],
    });
    const replacementMemberId = team.members[1]?.memberId ?? "missing";
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...leadUnavailableMission(current),
        participants: [
          ...current.participants,
          {
            memberId: replacementMemberId,
            agentId: "agent-member-idle",
            bindingEpoch: 1,
            joinedAt: NOW,
            archivedAt: null,
          },
        ],
      }),
    });
    fixture.liveAgents.add("agent-member-idle");
    fixture.effects.length = 0;
    const originalAdvance = fixture.missions.advanceLeadReplacement.bind(fixture.missions);
    let loseStageResponse = true;
    fixture.missions.advanceLeadReplacement = async (input) => {
      const advanced = await originalAdvance(input);
      if (loseStageResponse) {
        loseStageResponse = false;
        throw new Error("simulated replacement archive stage response loss");
      }
      return advanced;
    };
    const request = {
      idempotencyKey: "replace-lead-with-idle-binding",
      missionId: mission.id,
      attentionId: "attention-lead-unavailable",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead" as const,
        replacementMemberId,
        reason: "Promote the idle engineer.",
      },
    };

    await expect(fixture.service.resolveAttention(request)).rejects.toThrow(
      "simulated replacement archive stage response loss",
    );
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      leadReplacementIntent: {
        stage: "superseded_archived",
        supersededParticipantAgentIds: ["agent-1", "agent-member-idle"],
      },
    });
    const replaced = await fixture.service.resolveAttention(request);

    expect(fixture.effects).toEqual([
      "archive:agent-1",
      "archive:agent-member-idle",
      "lead:agent-2:undefined",
    ]);
    expect(fixture.liveAgents).toEqual(new Set(["agent-2"]));
    expect(replaced.participants).toMatchObject([
      { agentId: "agent-1", archivedAt: NOW },
      { agentId: "agent-member-idle", archivedAt: NOW },
      { agentId: "agent-2", bindingEpoch: 2, archivedAt: null },
    ]);
    expect((await fixture.missions.get(mission.id))?.leadReplacementIntent).toBeNull();
  });

  test("adds a Mission-wide replan gate when a scoped replan Attention already exists", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-replacement-with-scoped-replan",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep replacement replanning Mission-wide",
      constraints: [],
      acceptanceCriteria: ["Old planned work remains gated"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => {
        const unavailable = leadUnavailableMission(current);
        return {
          ...unavailable,
          attentionItems: [
            ...unavailable.attentionItems,
            {
              attentionId: "assignment-existing:replan",
              kind: "assignment_requires_replan",
              status: "open",
              priorMissionStatus: "planning",
              assignmentId: "assignment-existing",
              summary: "One Assignment already requires replanning.",
              pathEvidence: [],
              createdAt: NOW,
              resolution: null,
            },
          ],
        };
      },
    });

    const replaced = await fixture.service.resolveAttention({
      idempotencyKey: "replace-lead-with-scoped-replan",
      missionId: mission.id,
      attentionId: "attention-lead-unavailable",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead",
        replacementMemberId: team.members[1]?.memberId,
        reason: "Promote the available engineer.",
      },
    });

    expect(
      replaced.attentionItems.filter(
        (attention) =>
          attention.kind === "assignment_requires_replan" && attention.status === "open",
      ),
    ).toMatchObject([
      { attentionId: "assignment-existing:replan", assignmentId: "assignment-existing" },
      { attentionId: "lead-replacement:attention-lead-unavailable:replan", assignmentId: null },
    ]);
  });

  test.each([
    ["member-missing", "replacement_lead_not_in_active_roster"],
    ["original", "replacement_lead_unchanged"],
  ])("rejects invalid replacement Lead target %s", async (target, errorCode) => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: `start-invalid-replacement-${target}`,
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Reject an invalid Lead replacement",
      constraints: [],
      acceptanceCriteria: ["Only another active roster Member can become Lead"],
    });
    const pending = await addLeadUnavailableAttention(fixture.missions, mission);

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: `replace-invalid-${target}`,
        missionId: mission.id,
        attentionId: "attention-lead-unavailable",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: target === "original" ? team.leadMemberId : target,
          reason: "Try an invalid target.",
        },
      }),
    ).rejects.toMatchObject({ code: errorCode });
  });

  test("rejects a replacement Lead whose provider is unavailable", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-unavailable-replacement",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Validate replacement runtime capability",
      constraints: [],
      acceptanceCriteria: ["An unavailable provider cannot host the replacement Lead"],
    });
    const pending = await addLeadUnavailableAttention(fixture.missions, mission);
    fixture.providerState.available = false;

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "replace-with-unavailable-provider",
        missionId: mission.id,
        attentionId: "attention-lead-unavailable",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Try the unavailable provider.",
        },
      }),
    ).rejects.toMatchObject({ code: "replacement_lead_provider_unavailable" });
  });

  test("rejects a replacement Lead with open accepted work", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-busy-lead-replacement",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Keep accepted work ownership stable",
      constraints: [],
      acceptanceCriteria: ["A busy Member cannot become Lead"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...leadUnavailableMission(current),
        assignments: [
          {
            ...providerBlockedAssignment(mission.id),
            assigneeMemberId: team.members[1]?.memberId ?? "missing",
            runtimeAgentId: "agent-member",
            bindingEpoch: 1,
            terminationReason: null,
            semanticState: "running",
            dispatchState: "dispatched",
            acceptedTurnId: "turn-accepted",
            dispatchedAt: NOW,
          },
        ],
      }),
    });

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "replace-with-busy-member",
        missionId: mission.id,
        attentionId: "attention-lead-unavailable",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Try the busy engineer.",
        },
      }),
    ).rejects.toMatchObject({ code: "replacement_lead_has_open_accepted_work" });
  });

  test("replays Lead replacement after restart without allocating another binding or agent", async () => {
    const liveAgents = new Set<string>();
    const fixture = createFixture(rootDirectory, {
      failLeadAfterCreateAgentIds: ["agent-2"],
      liveAgents,
    });
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-replayed-lead-replacement",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replay Lead replacement",
      constraints: [],
      acceptanceCriteria: ["One binding and one provider agent survive response loss"],
    });
    const pending = await addLeadUnavailableAttention(fixture.missions, mission);
    const request = {
      idempotencyKey: "replace-lead-after-provider-crash",
      missionId: mission.id,
      attentionId: "attention-lead-unavailable",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead" as const,
        replacementMemberId: team.members[1]?.memberId,
        reason: "Promote the available engineer.",
      },
    };

    await expect(fixture.service.resolveAttention(request)).rejects.toThrow(
      "simulated Lead creation response loss",
    );
    expect((await fixture.missions.get(mission.id))?.leadReplacementIntent).toMatchObject({
      replacementAgentId: "agent-2",
    });

    const restarted = createFixture(rootDirectory, { liveAgents });
    await restarted.service.reconcile();
    const replayed = await restarted.missions.get(mission.id);

    expect(
      replayed?.mission.participants.filter((participant) => participant.agentId === "agent-2"),
    ).toHaveLength(1);
    expect(liveAgents).toEqual(new Set(["agent-2"]));
    expect(replayed?.leadReplacementIntent).toBeNull();
  });

  test("converges when another replay clears the replacement intent before stage advance", async () => {
    const liveAgents = new Set<string>();
    const fixture = createFixture(rootDirectory, { liveAgents });
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-concurrent-replacement-clear",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Converge concurrent Lead replacement replay",
      constraints: [],
      acceptanceCriteria: ["A cleared intent is treated as completed"],
    });
    const pending = await addLeadUnavailableAttention(fixture.missions, mission);
    fixture.effects.length = 0;
    const originalAdvance = fixture.missions.advanceLeadReplacement.bind(fixture.missions);
    let clearBeforeAdvance = true;
    fixture.missions.advanceLeadReplacement = async (input) => {
      if (clearBeforeAdvance) {
        clearBeforeAdvance = false;
        liveAgents.add("agent-2");
        fixture.effects.push("lead:agent-2:concurrent-replay");
        await fixture.missions.completeLeadReplacement({
          missionId: input.missionId,
          intentId: input.intentId,
        });
      }
      return originalAdvance(input);
    };

    await expect(
      fixture.service.resolveAttention({
        idempotencyKey: "replace-lead-concurrent-clear",
        missionId: mission.id,
        attentionId: "attention-lead-unavailable",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: {
          kind: "replace_lead",
          replacementMemberId: team.members[1]?.memberId,
          reason: "Promote the available engineer.",
        },
      }),
    ).resolves.toMatchObject({ activeRosterSnapshotRevision: 2 });
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      leadReplacementIntent: null,
      mission: {
        participants: [
          { agentId: "agent-1", archivedAt: NOW },
          { agentId: "agent-2", archivedAt: null },
        ],
      },
    });
    expect(liveAgents).toEqual(new Set(["agent-2"]));
    expect(fixture.effects).toEqual(["archive:agent-1", "lead:agent-2:concurrent-replay"]);
  });

  test("resolves notification Attention and atomically rearms its delivery", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-restore-notification",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Restore a Team notification",
      constraints: [],
      acceptanceCriteria: ["The delivery becomes eligible again"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: "notification:delivery-restore",
            kind: "notification_unacknowledged",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: null,
            summary: "The recipient did not acknowledge the notification.",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });
    await fixture.missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: pending.storageRevision,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: [
          {
            deliveryId: "delivery-restore",
            idempotencyKey: "message-restore",
            requestFingerprint: "fingerprint-restore",
            roomMessageId: "message-restore",
            senderMemberId: team.leadMemberId,
            senderAgentId: "agent-1",
            recipientMemberId: team.leadMemberId,
            bindingEpoch: 1,
            mentionHandle: team.members[0]?.mentionHandle ?? "technical-lead",
            body: "@technical-lead restore this notification",
            roomPostedAt: NOW,
            roomCursor: 1,
            attempts: 3,
            createdAt: NOW,
            successorDeliveryId: null,
            state: "notified",
            lastAttemptAt: NOW,
            nextEligibleAt: NOW,
            acknowledgedAt: null,
            canceledAt: null,
            cancelReason: null,
          },
        ],
      }),
    });

    const resolveInput = {
      idempotencyKey: "restore-notification",
      missionId: mission.id,
      attentionId: "notification:delivery-restore",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "restore_notification" as const,
        reason: "The recipient is available again.",
      },
    };
    const originalUpdateAggregate = fixture.missions.updateAggregate.bind(fixture.missions);
    let releaseConcurrentUpdates: (() => void) | null = null;
    const concurrentUpdatesArrived = new Promise<void>((resolve) => {
      releaseConcurrentUpdates = resolve;
    });
    let updateArrivals = 0;
    fixture.missions.updateAggregate = async (input) => {
      updateArrivals += 1;
      if (updateArrivals === 2) releaseConcurrentUpdates?.();
      await concurrentUpdatesArrived;
      return originalUpdateAggregate(input);
    };

    const [restored, concurrentReplay] = await Promise.all([
      fixture.service.resolveAttention(resolveInput),
      fixture.createConcurrentService().resolveAttention(resolveInput),
    ]);

    expect(restored).toMatchObject({
      status: "planning",
      suspendedStatus: null,
      attentionItems: [
        { status: "resolved", resolution: { kind: "restore_notification", actorId: "user-1" } },
      ],
    });
    expect(concurrentReplay).toEqual(restored);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        {
          deliveryId: "delivery-restore",
          state: "canceled",
          attempts: 3,
          cancelReason: "attention_resolved",
          successorDeliveryId: "delivery-restore:recovery",
        },
        {
          deliveryId: "delivery-restore:recovery",
          state: "pending",
          attempts: 0,
          lastAttemptAt: null,
        },
      ],
    });
  });

  test("routes cancel_mission Attention resolution through the durable finish saga", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-attention-cancel",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Cancel from Attention",
      constraints: [],
      acceptanceCriteria: ["The finish saga owns terminal transition"],
    });
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: "attention-provider",
            kind: "provider_unavailable",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: null,
            summary: "The provider is unavailable.",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });
    fixture.effects.length = 0;

    const canceled = await fixture.service.resolveAttention({
      idempotencyKey: "resolve-attention-by-canceling",
      missionId: mission.id,
      attentionId: "attention-provider",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: { kind: "cancel_mission", reason: "Use another Team." },
    });

    expect(canceled).toMatchObject({
      status: "canceled",
      suspendedStatus: null,
      attentionItems: [
        {
          status: "resolved",
          resolution: { kind: "cancel_mission", actorId: "user-1" },
        },
      ],
    });
    expect(fixture.effects).toEqual(["archive:agent-1"]);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      finishIntent: { kind: "canceled", stage: "finalized" },
    });
    expect(await fixture.profiles.get(team.id)).toMatchObject({
      profile: { activeMissionId: null },
    });
  });

  test("restart resumes an Attention cancellation after participant archive crashes", async () => {
    const first = createFixture(rootDirectory, { failArchiveOnce: true });
    const team = await createTeam(first.service);
    const mission = await first.service.startMission({
      idempotencyKey: "start-attention-cancel-recovery",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Recover Attention cancellation",
      constraints: [],
      acceptanceCriteria: ["Restart completes the finish intent"],
    });
    const pending = await first.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: "attention-recovery",
            kind: "provider_unavailable",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: null,
            summary: "The provider is unavailable.",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });

    await expect(
      first.service.resolveAttention({
        idempotencyKey: "resolve-attention-cancel-recovery",
        missionId: mission.id,
        attentionId: "attention-recovery",
        expectedRevision: pending.mission.revision,
        actorId: "user-1",
        resolution: { kind: "cancel_mission", reason: "Stop this Mission." },
      }),
    ).rejects.toThrow("simulated participant archive crash");
    expect(await first.missions.get(mission.id)).toMatchObject({
      mission: { attentionItems: [{ status: "resolved" }] },
      finishIntent: { kind: "canceled", stage: "dispatch_stopped" },
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect((await restarted.missions.get(mission.id))?.mission.status).toBe("canceled");
    expect((await restarted.profiles.get(team.id))?.profile.activeMissionId).toBeNull();
    expect(restarted.effects).toEqual(["archive:agent-1"]);
  });

  test("restart resumes finish after evidence preparation crashes", async () => {
    let preparationAttempts = 0;
    const finishQuiescence: TeamMissionFinishQuiescencePort = {
      prepareEvidence: async () => {
        preparationAttempts += 1;
        if (preparationAttempts === 1) {
          throw new Error("simulated finish evidence crash");
        }
      },
    };
    const first = createFixture(rootDirectory, { finishQuiescence });
    const team = await createTeam(first.service);
    const mission = await first.service.startMission({
      idempotencyKey: "start-evidence-recovery",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replay finish evidence preparation",
      constraints: [],
      acceptanceCriteria: ["Restart resumes from the durable archive stage"],
    });

    await expect(
      first.service.cancelMission({
        idempotencyKey: "cancel-evidence-recovery",
        missionId: mission.id,
        expectedRevision: mission.revision,
        reason: "Exercise evidence replay",
      }),
    ).rejects.toThrow("simulated finish evidence crash");
    expect(await first.missions.get(mission.id)).toMatchObject({
      mission: { participants: [{ archivedAt: NOW }] },
      finishIntent: { stage: "participants_archived" },
    });

    const restarted = createFixture(rootDirectory, { finishQuiescence });
    await restarted.service.reconcile();

    expect((await restarted.missions.get(mission.id))?.mission.status).toBe("canceled");
    expect((await restarted.missions.get(mission.id))?.finishIntent?.stage).toBe("finalized");
    expect(restarted.effects).toEqual([]);
    expect(preparationAttempts).toBe(2);
  });

  test("restart delivers and acknowledges a pending Mission completion outbox", async () => {
    const first = createFixture(rootDirectory);
    const team = await createTeam(first.service);
    const mission = await first.service.startMission({
      idempotencyKey: "start-completion-delivery",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replay Mission completion delivery",
      constraints: [],
      acceptanceCriteria: ["The terminal snapshot is delivered after restart"],
    });
    await first.service.cancelMission({
      idempotencyKey: "cancel-for-completion-delivery",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "Exercise the completion outbox",
    });
    const delivered = await first.missions.get(mission.id);
    if (!delivered) throw new Error("Expected terminal Mission persistence");
    await first.missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: delivered.storageRevision,
      update: (recovery) => ({
        ...recovery,
        completionOutbox: recovery.completionOutbox.map((candidate) => ({
          ...candidate,
          state: "pending" as const,
          attempts: 0,
          lastAttemptAt: null,
          acknowledgedAt: null,
        })),
      }),
    });
    expect(await first.missions.get(mission.id)).toMatchObject({
      completionOutbox: [{ state: "pending", attempts: 0, acknowledgedAt: null }],
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect(await restarted.missions.get(mission.id)).toMatchObject({
      completionOutbox: [
        {
          state: "acknowledged",
          attempts: 1,
          lastAttemptAt: NOW,
          acknowledgedAt: NOW,
        },
      ],
    });
    expect(restarted.publishedMissions).toEqual([
      expect.objectContaining({ id: mission.id, status: "canceled" }),
    ]);
    await restarted.service.reconcile();
    expect(restarted.publishedMissions).toHaveLength(1);
  });

  test("isolates a completion Mission read failure and delivers the next Mission", async () => {
    const fixture = createFixture(rootDirectory);
    const firstTeam = await createTeam(fixture.service);
    const firstMission = await fixture.service.startMission({
      idempotencyKey: "start-completion-read-failure",
      teamId: firstTeam.id,
      expectedTeamRevision: firstTeam.revision,
      objective: "Isolate a completion read failure",
      constraints: [],
      acceptanceCriteria: ["Other completion deliveries continue"],
    });
    await fixture.service.cancelMission({
      idempotencyKey: "cancel-completion-read-failure",
      missionId: firstMission.id,
      expectedRevision: firstMission.revision,
      reason: "Prepare the first completion",
    });
    const secondTeam = await createTeam(fixture.service);
    const secondMission = await fixture.service.startMission({
      idempotencyKey: "start-completion-read-healthy",
      teamId: secondTeam.id,
      expectedTeamRevision: secondTeam.revision,
      objective: "Deliver a healthy completion",
      constraints: [],
      acceptanceCriteria: ["Delivery is acknowledged"],
    });
    await fixture.service.cancelMission({
      idempotencyKey: "cancel-completion-read-healthy",
      missionId: secondMission.id,
      expectedRevision: secondMission.revision,
      reason: "Prepare the second completion",
    });
    await new TeamPersistenceReconciler({
      profiles: fixture.profiles,
      missions: fixture.missions,
      logger: createTestLogger(),
    }).reconcile();
    await resetCompletionOutbox(fixture.missions, firstMission.id);
    await resetCompletionOutbox(fixture.missions, secondMission.id);
    const completionService = fixture.service as unknown as {
      deliverMissionCompletion(missionId: string, eventId: string): Promise<void>;
    };
    const originalDelivery = completionService.deliverMissionCompletion.bind(fixture.service);
    let failRead = true;
    completionService.deliverMissionCompletion = async (missionId, eventId) => {
      if (missionId === firstMission.id && failRead) {
        failRead = false;
        throw new Error("simulated completion Mission read failure");
      }
      return originalDelivery(missionId, eventId);
    };

    await expect(fixture.service.reconcile()).resolves.toBeUndefined();

    expect(await fixture.missions.get(firstMission.id)).toMatchObject({
      completionOutbox: [{ state: "pending" }],
      mission: { attentionItems: [] },
    });
    expect(await fixture.missions.get(secondMission.id)).toMatchObject({
      completionOutbox: [{ state: "acknowledged" }],
    });
  });

  test("isolates a completion publish failure and continues later deliveries", async () => {
    const fixture = createFixture(rootDirectory);
    const firstTeam = await createTeam(fixture.service);
    const firstMission = await fixture.service.startMission({
      idempotencyKey: "start-completion-publish-failure",
      teamId: firstTeam.id,
      expectedTeamRevision: firstTeam.revision,
      objective: "Isolate a completion publish failure",
      constraints: [],
      acceptanceCriteria: ["Other completion deliveries continue"],
    });
    await fixture.service.cancelMission({
      idempotencyKey: "cancel-completion-publish-failure",
      missionId: firstMission.id,
      expectedRevision: firstMission.revision,
      reason: "Prepare the first completion",
    });
    const secondTeam = await createTeam(fixture.service);
    const secondMission = await fixture.service.startMission({
      idempotencyKey: "start-completion-publish-healthy",
      teamId: secondTeam.id,
      expectedTeamRevision: secondTeam.revision,
      objective: "Deliver a healthy completion",
      constraints: [],
      acceptanceCriteria: ["Delivery is acknowledged"],
    });
    await fixture.service.cancelMission({
      idempotencyKey: "cancel-completion-publish-healthy",
      missionId: secondMission.id,
      expectedRevision: secondMission.revision,
      reason: "Prepare the second completion",
    });
    await resetCompletionOutbox(fixture.missions, firstMission.id);
    await resetCompletionOutbox(fixture.missions, secondMission.id);
    fixture.failMissionPublishIds.add(firstMission.id);

    await expect(fixture.service.reconcile()).resolves.toBeUndefined();

    expect(await fixture.missions.get(firstMission.id)).toMatchObject({
      completionOutbox: [{ state: "notified" }],
      mission: { attentionItems: [] },
    });
    expect(await fixture.missions.get(secondMission.id)).toMatchObject({
      completionOutbox: [{ state: "acknowledged" }],
    });
  });

  test("re-reads and idempotently acknowledges a completion after an ack CAS race", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-completion-ack-race",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Converge a completion acknowledgement race",
      constraints: [],
      acceptanceCriteria: ["The outbox reaches acknowledged"],
    });
    await fixture.service.cancelMission({
      idempotencyKey: "cancel-completion-ack-race",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "Prepare the completion race",
    });
    await resetCompletionOutbox(fixture.missions, mission.id);
    const originalUpdateRecoveryState = fixture.missions.updateRecoveryState.bind(fixture.missions);
    let updateCalls = 0;
    fixture.missions.updateRecoveryState = async (input) => {
      updateCalls += 1;
      if (updateCalls === 2) {
        const concurrent = await fixture.missions.get(input.missionId);
        if (!concurrent) throw new Error("expected concurrent Mission");
        await originalUpdateRecoveryState({
          missionId: input.missionId,
          expectedStorageRevision: concurrent.storageRevision,
          update: (recovery) => ({
            ...recovery,
            completionOutbox: recovery.completionOutbox.map((delivery) => ({
              ...delivery,
              attempts: delivery.attempts + 1,
            })),
          }),
        });
      }
      return originalUpdateRecoveryState(input);
    };

    await expect(fixture.service.reconcile()).resolves.toBeUndefined();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      completionOutbox: [{ state: "acknowledged", attempts: 2, acknowledgedAt: NOW }],
    });
  });

  test("replays a notified Mission completion after publication fails", async () => {
    const first = createFixture(rootDirectory, { failTerminalMissionPublishOnce: true });
    const team = await createTeam(first.service);
    const mission = await first.service.startMission({
      idempotencyKey: "start-notified-completion-replay",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Replay a notified completion",
      constraints: [],
      acceptanceCriteria: ["The same event is acknowledged after restart"],
    });

    await first.service.cancelMission({
      idempotencyKey: "cancel-notified-completion-replay",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "Exercise the post-notify crash window",
    });
    expect(await first.missions.get(mission.id)).toMatchObject({
      completionOutbox: [
        { state: "notified", attempts: 1, lastAttemptAt: NOW, acknowledgedAt: null },
      ],
    });

    const restarted = createFixture(rootDirectory);
    await restarted.service.reconcile();

    expect(await restarted.missions.get(mission.id)).toMatchObject({
      completionOutbox: [
        { state: "acknowledged", attempts: 2, lastAttemptAt: NOW, acknowledgedAt: NOW },
      ],
      mission: { attentionItems: [] },
    });
    expect(restarted.publishedMissions).toHaveLength(1);
    expect(restarted.publishedMissions.at(-1)).toMatchObject({
      id: mission.id,
      status: "canceled",
      attentionItems: [],
    });
  });

  test("rejects Mission completion before the verification quality gate", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-premature-completion",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Require final verification",
      constraints: [],
      acceptanceCriteria: ["A completed verification turn approves every delivery"],
    });

    await expect(
      fixture.service.completeMission({
        idempotencyKey: "complete-prematurely",
        missionId: mission.id,
        expectedRevision: mission.revision,
        acceptedTurns: [],
      }),
    ).rejects.toMatchObject({ code: "mission_completion_gate_failed" });
    expect((await fixture.missions.get(mission.id))?.finishIntent).toBeNull();
  });

  test("routes an unrecoverable Mission failure through the durable finish saga", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await createTeam(fixture.service);
    const mission = await fixture.service.startMission({
      idempotencyKey: "start-fatal-failure",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Persist fatal failure",
      constraints: [],
      acceptanceCriteria: ["Participants are archived before terminal state"],
    });
    fixture.effects.length = 0;

    const failed = await fixture.service.failMission({
      idempotencyKey: "fail-unrecoverable-mission",
      missionId: mission.id,
      expectedRevision: mission.revision,
      failureKind: "unrecoverable_system_failure",
      reason: "The persisted aggregate cannot be repaired.",
    });

    expect(failed.status).toBe("failed");
    expect(failed.participants[0]?.archivedAt).toBe(NOW);
    expect(fixture.effects).toEqual(["archive:agent-1"]);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      finishIntent: {
        kind: "failed",
        reason: "unrecoverable_system_failure: The persisted aggregate cannot be repaired.",
        stage: "finalized",
      },
    });
    expect((await fixture.profiles.get(team.id))?.profile.activeMissionId).toBeNull();
  });
});

function providerBlockedAssignment(missionId: string) {
  return {
    assignmentId: "assignment-provider",
    revision: 1,
    kind: "delivery" as const,
    subjectAssignmentIds: [],
    missionId,
    workstreamId: "workstream-provider",
    assigneeMemberId: "member-1",
    runtimeAgentId: null,
    bindingEpoch: null,
    objective: "Implement the provider-backed task",
    inputRefs: [],
    deliverables: ["Implementation"],
    acceptanceCriteria: ["Provider accepts the Assignment"],
    mutableScope: { kind: "read_only" as const },
    dependencyAssignmentIds: [],
    priority: 10,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    supersededBy: null,
    terminationReason: "provider_unavailable" as const,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "queued" as const,
    semanticState: "blocked" as const,
    attempt: 1,
    acceptedTurnId: null,
    createdAt: NOW,
    dispatchedAt: null,
    settledAt: null,
  };
}

function ownershipAssignment(missionId: string, assignmentId: string, pathPrefix: string) {
  return {
    ...providerBlockedAssignment(missionId),
    assignmentId,
    workstreamId: `workstream-${assignmentId}`,
    mutableScope: { kind: "paths" as const, pathPrefixes: [pathPrefix] },
    terminationReason: null,
    semanticState: "planned" as const,
  };
}

function leadUnavailableMission(mission: TeamMission): TeamMission {
  return {
    ...mission,
    status: "needs_attention",
    suspendedStatus: "planning",
    attentionItems: [
      {
        attentionId: "attention-lead-unavailable",
        kind: "lead_unavailable",
        status: "open",
        priorMissionStatus: "planning",
        assignmentId: null,
        summary: "The Lead participant is unavailable.",
        pathEvidence: [],
        createdAt: NOW,
        resolution: null,
      },
    ],
  };
}

function addLeadUnavailableAttention(missions: MissionStore, mission: TeamMission) {
  return missions.update({
    missionId: mission.id,
    expectedRevision: mission.revision,
    update: leadUnavailableMission,
  });
}

function createFixture(
  rootDirectory: string,
  options?: {
    failLeadOnce?: boolean;
    failLeadAgentIds?: string[];
    failLeadAfterCreateAgentIds?: string[];
    liveAgents?: Set<string>;
    failRoomOnce?: boolean;
    failArchiveOnce?: boolean;
    failArchiveAgentIds?: string[];
    beforeCapabilityResolve?: () => Promise<void>;
    beforeLeadCreate?: () => Promise<void>;
    beforeArchive?: () => Promise<void>;
    operations?: TeamOperationCoordinator;
    finishQuiescence?: TeamMissionFinishQuiescencePort;
    persistenceFaultInjector?: TeamPersistenceFaultInjector;
    failTerminalMissionPublishOnce?: boolean;
  },
) {
  const logger = createTestLogger();
  const profiles = new TeamProfileStore({
    directory: join(rootDirectory, "profiles"),
    logger,
    now: () => NOW,
  });
  const missions = new MissionStore({
    directory: join(rootDirectory, "missions"),
    logger,
    now: () => NOW,
  });
  const effects: string[] = [];
  const roomNames: string[] = [];
  const liveAgents = options?.liveAgents ?? new Set<string>();
  const roomsDeleted: string[] = [];
  const providerState = { available: true };
  let failLead = options?.failLeadOnce === true;
  const failLeadAgentIds = new Set(options?.failLeadAgentIds ?? []);
  const failLeadAfterCreateAgentIds = new Set(options?.failLeadAfterCreateAgentIds ?? []);
  let failRoom = options?.failRoomOnce === true;
  let failArchive = options?.failArchiveOnce === true;
  const failArchiveAgentIds = new Set(options?.failArchiveAgentIds ?? []);
  const publishedTeams: TeamV2[] = [];
  const publishedMissions: TeamMission[] = [];
  const failMissionPublishIds = new Set<string>();
  let failTerminalMissionPublish = options?.failTerminalMissionPublishOnce === true;

  const rooms: TeamRoomPort = {
    createMissionRoom: async (input) => {
      const stage = (await profiles.get(input.teamId))?.startIntent?.stage;
      effects.push(`room:${input.roomId}:${stage}`);
      roomNames.push(input.teamName);
      if (failRoom) {
        failRoom = false;
        throw new Error("simulated room stage crash");
      }
    },
  };
  const participants: TeamParticipantPort = {
    createLead: async (input) => {
      await options?.beforeLeadCreate?.();
      const stage = (await profiles.get(input.teamId))?.startIntent?.stage;
      effects.push(`lead:${input.agentId}:${stage}`);
      if (failLead) {
        failLead = false;
        throw new Error("simulated Lead creation crash");
      }
      if (failLeadAgentIds.has(input.agentId)) {
        throw new Error("simulated Lead creation failure");
      }
      liveAgents.add(input.agentId);
      if (failLeadAfterCreateAgentIds.has(input.agentId)) {
        throw new Error("simulated Lead creation response loss");
      }
    },
    archiveParticipant: async (input) => {
      effects.push(`archive:${input.agentId}`);
      await options?.beforeArchive?.();
      if (failArchive) {
        failArchive = false;
        throw new Error("simulated participant archive crash");
      }
      if (failArchiveAgentIds.has(input.agentId)) {
        throw new Error("simulated participant archive failure");
      }
      liveAgents.delete(input.agentId);
    },
  };
  const capabilities: ProviderCapabilityResolver = {
    resolve: async (executionProfile) => {
      await options?.beforeCapabilityResolve?.();
      return {
        providerAvailable: providerState.available && executionProfile.provider !== "missing",
        toolIds: ["team_status", "team_message"],
        capabilityIds: ["structured-tools"],
      };
    },
  };
  const events: TeamRuntimeEventPort = {
    publishTeam: async (team) => {
      publishedTeams.push(structuredClone(team));
    },
    publishMission: async (mission) => {
      if (failMissionPublishIds.delete(mission.id)) {
        throw new Error("simulated scoped Mission publication failure");
      }
      if (
        failTerminalMissionPublish &&
        (mission.status === "completed" ||
          mission.status === "failed" ||
          mission.status === "canceled")
      ) {
        failTerminalMissionPublish = false;
        throw new Error("simulated terminal Mission publication failure");
      }
      publishedMissions.push(structuredClone(mission));
    },
  };
  const idCounters = new Map<string, number>();
  const operations = options?.operations ?? new TeamOperationCoordinator();
  let serviceCount = 0;
  const createConcurrentService = () =>
    new TeamMissionService({
      profiles,
      missions,
      recovery: new TeamPersistenceReconciler({ profiles, missions, logger }),
      rooms,
      participants,
      capabilities,
      events,
      clock: { now: () => NOW },
      ids: {
        next: (kind) => {
          const next = (idCounters.get(kind) ?? 0) + 1;
          idCounters.set(kind, next);
          return `${kind}-${next}`;
        },
      },
      operations: options?.operations ?? (serviceCount === 0 ? operations : undefined),
      persistenceFaultInjector: options?.persistenceFaultInjector,
      finishQuiescence: options?.finishQuiescence ?? {
        prepareEvidence: async () => undefined,
      },
    });
  const service = createConcurrentService();
  serviceCount += 1;
  return {
    service,
    createConcurrentService,
    profiles,
    missions,
    effects,
    roomNames,
    roomsDeleted,
    liveAgents,
    providerState,
    failArchiveAgentIds,
    failLeadAfterCreateAgentIds,
    publishedTeams,
    publishedMissions,
    failMissionPublishIds,
    operations,
  };
}

async function resetCompletionOutbox(missions: MissionStore, missionId: string): Promise<void> {
  const stored = await missions.get(missionId);
  if (!stored) throw new Error(`Expected terminal Mission ${missionId}`);
  await missions.updateRecoveryState({
    missionId,
    expectedStorageRevision: stored.storageRevision,
    update: (recovery) => ({
      ...recovery,
      completionOutbox: recovery.completionOutbox.map((delivery) => ({
        ...delivery,
        state: "pending" as const,
        attempts: 0,
        lastAttemptAt: null,
        acknowledgedAt: null,
      })),
    }),
  });
}

function throwOnceAt(point: TeamPersistenceFaultPoint): TeamPersistenceFaultInjector {
  let armed = true;
  return {
    hit: async (candidate) => {
      if (armed && candidate === point) {
        armed = false;
        throw new Error(`simulated crash at ${point}`);
      }
    },
  };
}

async function createTeam(service: TeamMissionService) {
  return service.createTeam({
    idempotencyKey: "create-team",
    name: "Compiler team",
    workspaceId: "workspace-sdk",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    lead: LEAD,
    members: [MEMBER],
  });
}

async function settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
}
