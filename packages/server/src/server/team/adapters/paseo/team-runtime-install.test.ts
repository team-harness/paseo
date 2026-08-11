import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { AgentManager } from "../../../agent/agent-manager.js";
import { AgentStorage } from "../../../agent/agent-storage.js";
import { TeamCollaborationService } from "../../application/team-collaboration-service.js";
import { TeamMissionScheduler } from "../../application/team-mission-scheduler.js";
import { TeamMissionService } from "../../application/team-mission-service.js";
import { MissionStore } from "../../persistence/mission-store.js";
import { WorkspaceScopeLeaseStore } from "../../persistence/workspace-scope-lease-store.js";
import {
  createTeamRuntime,
  installPaseoTeamRuntime,
  type TeamRuntime,
  type TeamRuntimeService,
} from "../../team-runtime.js";
import { installPaseoTeamRuntimeAdapter } from "./team-runtime-install.js";

describe("installPaseoTeamRuntime", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-runtime-install-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("keeps production-style disabled installs inert", async () => {
    const fixture = await createFixture(rootDirectory);
    const runtime = await installPaseoTeamRuntime({
      ...fixture,
      runtime: { enabled: false },
    });

    await runtime.start();

    expect(runtime.serverFeatures()).toEqual({});
    await expect(access(join(rootDirectory, "team-missions"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("exposes the capability only after v2 reconciliation", async () => {
    const fixture = await createFixture(rootDirectory);
    const runtime = await installPaseoTeamRuntime({
      ...fixture,
      runtime: { enabled: true },
      providerRegistryOptions: { isDev: true },
    });

    expect(runtime.serverFeatures()).toEqual({});
    await runtime.start();

    expect(runtime.serverFeatures()).toEqual({ teamMissions: true });
    await expect(access(join(rootDirectory, "team-missions", "profiles"))).resolves.toBeUndefined();
    await expect(access(join(rootDirectory, "team-missions", "missions"))).resolves.toBeUndefined();
  });

  test("installs the caller-scoped collaboration catalog with the enabled capsule", async () => {
    const fixture = await createFixture(rootDirectory);
    const runtime = await installPaseoTeamRuntime({
      ...fixture,
      runtime: { enabled: true },
      providerRegistryOptions: { isDev: true },
    });
    await runtime.start();
    const names: string[] = [];

    runtime.registerAgentTools("agent-caller", (name) => {
      names.push(name);
    });

    expect(names.toSorted()).toEqual([
      "assign_task",
      "assignment_report",
      "chat_post",
      "chat_read",
      "mission_plan",
      "mission_status",
      "team_member_history",
      "team_message",
      "team_status",
    ]);
  });

  test("delegates human Mission room posts to the durable collaboration service", async () => {
    const fixture = await createFixture(rootDirectory);
    const posted = {
      missionId: "mission-room",
      message: {
        id: "message-human",
        missionId: "mission-room",
        roomId: "room-1",
        authorAgentId: "user-1",
        author: { kind: "human" as const, id: "user-1" },
        body: "@lead status?",
        replyToMessageId: null,
        mentionAgentIds: ["agent-lead"],
        createdAt: "2026-08-11T03:00:00.000Z",
      },
      cursor: 1,
    };
    const postHumanMessage = vi
      .spyOn(TeamCollaborationService.prototype, "postHumanRoomMessage")
      .mockResolvedValue(posted);
    let installedService: TeamRuntimeService | undefined;
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        (options) => {
          installedService = options.service;
          return createTeamRuntime(options);
        },
      );
      const input = {
        missionId: "mission-room",
        actorId: "user-1",
        idempotencyKey: "post-human-room-message",
        body: "@lead status?",
      };

      await expect(installedService?.postMissionMessage(input)).resolves.toBe(posted);
      expect(postHumanMessage).toHaveBeenCalledExactlyOnceWith(input);
    } finally {
      runtime?.stop();
      postHumanMessage.mockRestore();
    }
  });

  test("reconciles terminal lease cleanup immediately after Mission cancellation", async () => {
    const fixture = await createFixture(rootDirectory);
    const canceledMission = { id: "mission-canceled", status: "canceled" } as never;
    const cancelMission = vi
      .spyOn(TeamMissionService.prototype, "cancelMission")
      .mockResolvedValue(canceledMission);
    const reconcileMission = vi
      .spyOn(TeamMissionScheduler.prototype, "reconcileMission")
      .mockResolvedValue({
        missionId: "mission-canceled",
        dispatchedAssignmentIds: [],
        deferredAssignmentIds: [],
      });
    let installedService: TeamRuntimeService | undefined;
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        (options) => {
          installedService = options.service;
          return createTeamRuntime(options);
        },
      );

      const result = await installedService?.cancelMission({
        idempotencyKey: "cancel-mission",
        missionId: "mission-canceled",
        expectedRevision: 4,
        reason: "User canceled",
      });

      expect(result).toBe(canceledMission);
      expect(reconcileMission).toHaveBeenCalledExactlyOnceWith("mission-canceled");
    } finally {
      runtime?.stop();
      reconcileMission.mockRestore();
      cancelMission.mockRestore();
    }
  });

  test("releases terminal leases immediately when Attention cancels a Mission", async () => {
    const fixture = await createFixture(rootDirectory);
    const leaseStore = createLeaseStore(rootDirectory);
    const ownerLease = await leaseStore.acquire({
      teamId: "team-owner",
      missionId: "mission-attention",
      workspaceId: "workspace-shared",
      assignmentId: "assignment-owner",
      scope: { kind: "workspace" },
      priority: 1,
      createdAt: "2026-08-09T01:00:00.000Z",
    });
    expect(ownerLease).not.toBeNull();
    await expect(
      leaseStore.acquire({
        teamId: "team-contender",
        missionId: "mission-contender",
        workspaceId: "workspace-shared",
        assignmentId: "assignment-contender",
        scope: { kind: "workspace" },
        priority: 1,
        createdAt: "2026-08-09T01:01:00.000Z",
      }),
    ).resolves.toBeNull();

    const canceledMission = { id: "mission-attention", status: "canceled" } as never;
    const resolveAttention = vi
      .spyOn(TeamMissionService.prototype, "resolveAttention")
      .mockResolvedValue(canceledMission);
    let installedService: TeamRuntimeService | undefined;
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        (options) => {
          installedService = options.service;
          return createTeamRuntime(options);
        },
      );

      await installedService?.resolveAttention({
        idempotencyKey: "cancel-from-attention",
        missionId: "mission-attention",
        attentionId: "attention-1",
        expectedRevision: 4,
        actorId: "user-1",
        resolution: { kind: "cancel_mission", reason: "Stop this Mission." },
      });

      await expect(
        leaseStore.acquire({
          teamId: "team-contender",
          missionId: "mission-contender",
          workspaceId: "workspace-shared",
          assignmentId: "assignment-contender",
          scope: { kind: "workspace" },
          priority: 1,
          createdAt: "2026-08-09T01:01:00.000Z",
        }),
      ).resolves.toMatchObject({ assignmentId: "assignment-contender" });
    } finally {
      runtime?.stop();
      resolveAttention.mockRestore();
    }
  });

  test("releases active Mission leases immediately after Team archive finishes", async () => {
    const fixture = await createFixture(rootDirectory);
    const leaseStore = createLeaseStore(rootDirectory);
    const ownerLease = await leaseStore.acquire({
      teamId: "team-owner",
      missionId: "mission-archived-team",
      workspaceId: "workspace-shared",
      assignmentId: "assignment-owner",
      scope: { kind: "workspace" },
      priority: 1,
      createdAt: "2026-08-09T01:00:00.000Z",
    });
    expect(ownerLease).not.toBeNull();
    await expect(
      leaseStore.acquire({
        teamId: "team-contender",
        missionId: "mission-contender",
        workspaceId: "workspace-shared",
        assignmentId: "assignment-contender",
        scope: { kind: "workspace" },
        priority: 1,
        createdAt: "2026-08-09T01:01:00.000Z",
      }),
    ).resolves.toBeNull();

    const archiveTeam = vi.spyOn(TeamMissionService.prototype, "archiveTeam").mockResolvedValue({
      id: "team-owner",
      lifecycle: "archived",
      activeMissionId: null,
    } as never);
    const listMissions = vi
      .spyOn(TeamMissionService.prototype, "listMissions")
      .mockResolvedValue([{ id: "mission-archived-team", status: "canceled" }] as never);
    let installedService: TeamRuntimeService | undefined;
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        (options) => {
          installedService = options.service;
          return createTeamRuntime(options);
        },
      );

      await installedService?.archiveTeam({
        idempotencyKey: "archive-team",
        teamId: "team-owner",
        expectedRevision: 4,
      });

      await expect(
        leaseStore.acquire({
          teamId: "team-contender",
          missionId: "mission-contender",
          workspaceId: "workspace-shared",
          assignmentId: "assignment-contender",
          scope: { kind: "workspace" },
          priority: 1,
          createdAt: "2026-08-09T01:01:00.000Z",
        }),
      ).resolves.toMatchObject({ assignmentId: "assignment-contender" });
    } finally {
      runtime?.stop();
      listMissions.mockRestore();
      archiveTeam.mockRestore();
    }
  });

  test("routes lifecycle finish evidence through the installed scheduler", async () => {
    const fixture = await createFixture(rootDirectory);
    const canceledMission = { id: "mission-finish-evidence", status: "canceled" } as never;
    const prepareFinishEvidence = vi
      .spyOn(TeamMissionScheduler.prototype, "prepareFinishEvidence")
      .mockResolvedValue(undefined);
    const reconcileMission = vi
      .spyOn(TeamMissionScheduler.prototype, "reconcileMission")
      .mockResolvedValue({
        missionId: "mission-finish-evidence",
        dispatchedAssignmentIds: [],
        deferredAssignmentIds: [],
      });
    const cancelMission = vi
      .spyOn(TeamMissionService.prototype, "cancelMission")
      .mockImplementation(async function () {
        const finishQuiescence = (
          this as unknown as {
            finishQuiescence: {
              prepareEvidence(input: { missionId: string; intentId: string }): Promise<void>;
            };
          }
        ).finishQuiescence;
        await finishQuiescence.prepareEvidence({
          missionId: "mission-finish-evidence",
          intentId: "finish-intent",
        });
        return canceledMission;
      });
    let installedService: TeamRuntimeService | undefined;
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        (options) => {
          installedService = options.service;
          return createTeamRuntime(options);
        },
      );

      await installedService?.cancelMission({
        idempotencyKey: "cancel-mission",
        missionId: "mission-finish-evidence",
        expectedRevision: 4,
        reason: "User canceled",
      });

      expect(prepareFinishEvidence).toHaveBeenCalledExactlyOnceWith({
        missionId: "mission-finish-evidence",
        intentId: "finish-intent",
      });
    } finally {
      runtime?.stop();
      cancelMission.mockRestore();
      reconcileMission.mockRestore();
      prepareFinishEvidence.mockRestore();
    }
  });

  test("unsubscribes every Agent record listener when the runtime stops", async () => {
    const fixture = await createFixture(rootDirectory);
    const subscribe = fixture.agentManager.onAgentRecordChange.bind(fixture.agentManager);
    let activeListeners = 0;
    const onAgentRecordChange = vi
      .spyOn(fixture.agentManager, "onAgentRecordChange")
      .mockImplementation((listener) => {
        activeListeners += 1;
        const unsubscribe = subscribe(listener);
        return () => {
          activeListeners -= 1;
          unsubscribe();
        };
      });
    const runtime = await installPaseoTeamRuntimeAdapter(
      { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
      createTeamRuntime,
    );

    expect(activeListeners).toBe(3);
    runtime.stop();

    expect(activeListeners).toBe(0);
    runtime.stop();
    expect(activeListeners).toBe(0);
    onAgentRecordChange.mockRestore();
  });

  test("fences a participant callback already captured when the runtime stops", async () => {
    const fixture = await createFixture(rootDirectory);
    const capturedListeners: Array<Parameters<AgentManager["onAgentRecordChange"]>[0]> = [];
    const onAgentRecordChange = vi
      .spyOn(fixture.agentManager, "onAgentRecordChange")
      .mockImplementation((listener) => {
        capturedListeners.push(listener);
        return () => undefined;
      });
    const unavailable = vi
      .spyOn(TeamMissionScheduler.prototype, "handleParticipantUnavailable")
      .mockResolvedValue(undefined);
    const runtime = await installPaseoTeamRuntimeAdapter(
      { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
      createTeamRuntime,
    );
    const listenerSnapshot = [...capturedListeners];

    runtime.stop();
    for (const listener of listenerSnapshot) {
      await listener({
        kind: "archived",
        agentId: "agent-participant",
        record: { id: "agent-participant" } as never,
      });
    }

    expect(unavailable).not.toHaveBeenCalled();
    unavailable.mockRestore();
    onAgentRecordChange.mockRestore();
  });

  test("rejects startup when lifecycle reconciliation fails", async () => {
    const fixture = await createFixture(rootDirectory);
    const reconcileLifecycle = vi
      .spyOn(TeamMissionService.prototype, "reconcile")
      .mockRejectedValue(new Error("lifecycle recovery failed"));
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        createTeamRuntime,
      );

      await expect(runtime.start()).rejects.toThrow("lifecycle recovery failed");
      expect(runtime.isReady()).toBe(false);
      expect(runtime.serverFeatures()).toEqual({});
    } finally {
      runtime?.stop();
      reconcileLifecycle.mockRestore();
    }
  });

  test("keeps the runtime ready when one Mission pending message recovery fails", async () => {
    const fixture = await createFixture(rootDirectory);
    const reconcileLifecycle = vi
      .spyOn(TeamMissionService.prototype, "reconcile")
      .mockResolvedValue(undefined);
    const reconcilePendingMessages = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessages")
      .mockResolvedValue({
        failures: [
          {
            missionId: "mission-pending",
            deliveryId: "delivery-pending",
            error: "recipient unavailable",
          },
        ],
      });
    const recordRecoveryAttention = vi
      .spyOn(TeamMissionService.prototype, "recordRecoveryAttention")
      .mockResolvedValue(undefined);
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        createTeamRuntime,
      );

      await expect(runtime.start()).resolves.toBeUndefined();
      expect(recordRecoveryAttention).toHaveBeenCalledExactlyOnceWith({
        missionId: "mission-pending",
        attentionId: "notification:delivery-pending",
        kind: "notification_unacknowledged",
        summary: "Pending message recovery failed: recipient unavailable",
      });
      expect(runtime.isReady()).toBe(true);
      expect(runtime.serverFeatures()).toEqual({ teamMissions: true });
    } finally {
      runtime?.stop();
      recordRecoveryAttention.mockRestore();
      reconcilePendingMessages.mockRestore();
      reconcileLifecycle.mockRestore();
    }
  });

  test("isolates one pending-message Attention write and still schedules later Missions", async () => {
    const fixture = await createFixture(rootDirectory);
    const reconcileLifecycle = vi
      .spyOn(TeamMissionService.prototype, "reconcile")
      .mockResolvedValue(undefined);
    const reconcilePendingMessages = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessages")
      .mockResolvedValue({
        failures: [
          {
            missionId: "mission-broken",
            deliveryId: "delivery-broken",
            error: "broken recipient",
          },
          {
            missionId: "mission-recoverable",
            deliveryId: "delivery-recoverable",
            error: "recoverable recipient",
          },
        ],
      });
    const recordRecoveryAttention = vi
      .spyOn(TeamMissionService.prototype, "recordRecoveryAttention")
      .mockRejectedValueOnce(new Error("simulated Attention write failure"))
      .mockResolvedValue(undefined);
    const listMissions = vi.spyOn(MissionStore.prototype, "list").mockResolvedValue([
      {
        mission: { id: "mission-healthy", teamId: "team-healthy", status: "active" },
        recipientAttentionOutbox: [],
      },
    ] as never);
    const reconcileMission = vi
      .spyOn(TeamMissionScheduler.prototype, "reconcileMission")
      .mockResolvedValue({
        missionId: "mission-healthy",
        dispatchedAssignmentIds: [],
        deferredAssignmentIds: [],
        createdRecipientAttentionDeliveryIds: [],
      });
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        createTeamRuntime,
      );

      await expect(runtime.start()).resolves.toBeUndefined();
      expect(recordRecoveryAttention).toHaveBeenCalledTimes(2);
      expect(reconcileMission).toHaveBeenCalledExactlyOnceWith("mission-healthy");
      expect(runtime.isReady()).toBe(true);
    } finally {
      runtime?.stop();
      reconcileMission.mockRestore();
      listMissions.mockRestore();
      recordRecoveryAttention.mockRestore();
      reconcilePendingMessages.mockRestore();
      reconcileLifecycle.mockRestore();
    }
  });

  test("keeps the runtime ready when scheduler-created message recovery fails", async () => {
    const fixture = await createFixture(rootDirectory);
    const reconcileLifecycle = vi
      .spyOn(TeamMissionService.prototype, "reconcile")
      .mockResolvedValue(undefined);
    const reconcilePendingMessages = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessages")
      .mockResolvedValue({ failures: [] });
    const reconcilePendingMessageDeliveries = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessageDeliveries")
      .mockResolvedValue({
        failures: [
          {
            missionId: "mission-active",
            deliveryId: "mission-active:assignment-blocked:requires-replan:lead",
            error: "lead notification failed",
          },
        ],
      });
    const recordRecoveryAttention = vi
      .spyOn(TeamMissionService.prototype, "recordRecoveryAttention")
      .mockRejectedValueOnce(new Error("simulated scheduler Attention write failure"))
      .mockResolvedValue(undefined);
    const listMissions = vi.spyOn(MissionStore.prototype, "list").mockResolvedValue([
      {
        mission: { id: "mission-active", teamId: "team-1", status: "active" },
        recipientAttentionOutbox: [],
      },
    ] as never);
    const reconcileMission = vi
      .spyOn(TeamMissionScheduler.prototype, "reconcileMission")
      .mockResolvedValue({
        missionId: "mission-active",
        dispatchedAssignmentIds: [],
        deferredAssignmentIds: [],
        createdRecipientAttentionDeliveryIds: [
          "mission-active:assignment-blocked:requires-replan:lead",
        ],
      });
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        createTeamRuntime,
      );

      await expect(runtime.start()).resolves.toBeUndefined();
      expect(reconcileMission).toHaveBeenCalledExactlyOnceWith("mission-active");
      expect(reconcilePendingMessages).toHaveBeenCalledOnce();
      expect(reconcilePendingMessageDeliveries).toHaveBeenCalledExactlyOnceWith({
        missionId: "mission-active",
        deliveryIds: ["mission-active:assignment-blocked:requires-replan:lead"],
      });
      expect(recordRecoveryAttention).toHaveBeenCalledExactlyOnceWith({
        missionId: "mission-active",
        attentionId: "notification:mission-active:assignment-blocked:requires-replan:lead",
        kind: "notification_unacknowledged",
        summary: "Pending message recovery failed: lead notification failed",
      });
      expect(runtime.isReady()).toBe(true);
      expect(runtime.serverFeatures()).toEqual({ teamMissions: true });
    } finally {
      runtime?.stop();
      recordRecoveryAttention.mockRestore();
      reconcileMission.mockRestore();
      listMissions.mockRestore();
      reconcilePendingMessageDeliveries.mockRestore();
      reconcilePendingMessages.mockRestore();
      reconcileLifecycle.mockRestore();
    }
  });

  test("isolates scheduler recovery failure to one Mission and continues healthy Teams", async () => {
    const fixture = await createFixture(rootDirectory);
    const reconcileLifecycle = vi
      .spyOn(TeamMissionService.prototype, "reconcile")
      .mockResolvedValue(undefined);
    const reconcilePendingMessages = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessages")
      .mockResolvedValue({ failures: [] });
    const recordRecoveryAttention = vi
      .spyOn(TeamMissionService.prototype, "recordRecoveryAttention")
      .mockRejectedValueOnce(new Error("simulated scheduler Attention write failure"))
      .mockResolvedValue(undefined);
    const listMissions = vi.spyOn(MissionStore.prototype, "list").mockResolvedValue([
      {
        mission: { id: "mission-broken", teamId: "team-1", status: "active" },
        recipientAttentionOutbox: [],
      },
      {
        mission: { id: "mission-healthy", teamId: "team-2", status: "active" },
        recipientAttentionOutbox: [],
      },
    ] as never);
    const reconcileMission = vi
      .spyOn(TeamMissionScheduler.prototype, "reconcileMission")
      .mockImplementation(async (missionId) => {
        if (missionId === "mission-broken") throw new Error("workspace unavailable");
        return {
          missionId,
          dispatchedAssignmentIds: [],
          deferredAssignmentIds: [],
          createdRecipientAttentionDeliveryIds: [],
        };
      });
    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        createTeamRuntime,
      );

      await expect(runtime.start()).resolves.toBeUndefined();
      expect(reconcileMission).toHaveBeenCalledTimes(2);
      expect(reconcileMission).toHaveBeenNthCalledWith(1, "mission-broken");
      expect(reconcileMission).toHaveBeenNthCalledWith(2, "mission-healthy");
      expect(recordRecoveryAttention).toHaveBeenCalledExactlyOnceWith({
        missionId: "mission-broken",
        attentionId: "runtime-scheduler:mission-broken",
        kind: "lead_unavailable",
        summary: "Scheduler recovery failed: workspace unavailable",
      });
      expect(runtime.isReady()).toBe(true);
      expect(runtime.serverFeatures()).toEqual({ teamMissions: true });
    } finally {
      runtime?.stop();
      recordRecoveryAttention.mockRestore();
      reconcileMission.mockRestore();
      listMissions.mockRestore();
      reconcilePendingMessages.mockRestore();
      reconcileLifecycle.mockRestore();
    }
  });

  test("runs full pending message recovery once before scheduler reconciliation", async () => {
    const fixture = await createFixture(rootDirectory);
    const reconciliationOrder: string[] = [];
    const reconcileLifecycle = vi
      .spyOn(TeamMissionService.prototype, "reconcile")
      .mockImplementation(async () => {
        reconciliationOrder.push("lifecycle");
      });
    const listMissions = vi.spyOn(MissionStore.prototype, "list").mockResolvedValue([
      {
        mission: { id: "mission-active", status: "active" },
        recipientAttentionOutbox: [],
      },
      {
        mission: { id: "mission-terminal", status: "canceled" },
        recipientAttentionOutbox: [],
      },
    ] as never);
    const recoveredFacts = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessages")
      .mockImplementation(async () => {
        reconciliationOrder.push("pending-messages-prepass");
        return { failures: [] };
      });
    const reconcileNewMessages = vi
      .spyOn(TeamCollaborationService.prototype, "reconcilePendingMessageDeliveries")
      .mockImplementation(async () => {
        reconciliationOrder.push("pending-messages-targeted");
        return { failures: [] };
      });
    const reconciledMissions: string[] = [];
    const reconcileMission = vi
      .spyOn(TeamMissionScheduler.prototype, "reconcileMission")
      .mockImplementation(async (missionId) => {
        reconciledMissions.push(missionId);
        reconciliationOrder.push(missionId);
        return {
          missionId,
          dispatchedAssignmentIds: [],
          deferredAssignmentIds: [],
          createdRecipientAttentionDeliveryIds:
            missionId === "mission-active" ? ["delivery-new"] : [],
        };
      });

    let runtime: TeamRuntime | null = null;
    try {
      runtime = await installPaseoTeamRuntimeAdapter(
        { ...fixture, runtime: { enabled: true }, providerRegistryOptions: { isDev: true } },
        createTeamRuntime,
      );

      await runtime.start();

      expect(runtime.isReady()).toBe(true);
      expect(reconcileLifecycle).toHaveBeenCalledOnce();
      expect(recoveredFacts).toHaveBeenCalledOnce();
      expect(reconciledMissions).toEqual(["mission-active", "mission-terminal"]);
      expect(reconciliationOrder).toEqual([
        "lifecycle",
        "pending-messages-prepass",
        "mission-active",
        "pending-messages-targeted",
        "mission-terminal",
      ]);
      expect(reconcileNewMessages).toHaveBeenCalledExactlyOnceWith({
        missionId: "mission-active",
        deliveryIds: ["delivery-new"],
      });
    } finally {
      runtime?.stop();
      reconcileMission.mockRestore();
      reconcileNewMessages.mockRestore();
      recoveredFacts.mockRestore();
      listMissions.mockRestore();
      reconcileLifecycle.mockRestore();
    }
  });
});

async function createFixture(paseoHome: string) {
  const logger = createTestLogger();
  const agentStorage = new AgentStorage(join(paseoHome, "agents"), logger);
  await agentStorage.initialize();
  const agentManager = new AgentManager({ registry: agentStorage, logger });
  return {
    paseoHome,
    agentManager,
    agentStorage,
    resolveWorkspaceCwd: async () => "/workspace/project",
    publishTeamProfile: () => undefined,
    publishMission: () => undefined,
    logger,
  };
}

function createLeaseStore(paseoHome: string): WorkspaceScopeLeaseStore {
  let leaseId = 0;
  return new WorkspaceScopeLeaseStore({
    filePath: join(paseoHome, "team-missions", "workspace-scope-leases.json"),
    resolveWorkspaceIdentity: async () => "/workspace/project",
    clock: { now: () => "2026-08-09T02:00:00.000Z" },
    ids: { next: () => `lease-${++leaseId}` },
  });
}
