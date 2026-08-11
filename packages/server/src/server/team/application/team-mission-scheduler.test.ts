import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

import type {
  MissionAssignmentContract,
  MissionMemberMatchExplanation,
  MissionMutableScope,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { MissionStore } from "../persistence/mission-store.js";
import { WorkspaceScopeLeaseStore } from "../persistence/workspace-scope-lease-store.js";
import { TeamOperationCoordinator } from "./team-operation-coordinator.js";
import {
  TeamMissionScheduler,
  type TeamAssignmentDispatchPort,
  type TeamMissionCompletionPort,
  type TeamParticipantProvisionPort,
  type TeamWorkspaceLeasePort,
  type TeamWorkspaceSnapshotPort,
} from "./team-mission-scheduler.js";

const NOW = "2026-08-08T12:00:00.000Z";
const noDurableTurnFacts = {
  read: async () => new Map(),
};
const lifecycleMustNotComplete: TeamMissionCompletionPort = {
  completeMission: async () => {
    throw new Error("This Mission must not complete");
  },
};

describe("TeamMissionScheduler", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-mission-scheduler-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("dispatches independent ready Assignments in parallel and leaves dependencies queued", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    await missions.createIfAbsent({
      mission: activeMission(),
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });

    const dispatches: string[] = [];
    const releasedLeases: string[] = [];
    let releaseDispatch: (() => void) | null = null;
    const dispatchReleased = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    let observeParallelDispatch: (() => void) | null = null;
    const parallelDispatchObserved = new Promise<void>((resolve) => {
      observeParallelDispatch = resolve;
    });
    const dispatch: TeamAssignmentDispatchPort = {
      dispatch: async (input) => {
        dispatches.push(input.assignmentId);
        if (dispatches.length === 2) observeParallelDispatch?.();
        await dispatchReleased;
        return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
      },
      requestReport: requestReportBusy,
    };
    const leases: TeamWorkspaceLeasePort = {
      acquire: async (input) => ({
        leaseId: `lease-${input.assignmentId}`,
        workspaceId: input.workspaceId,
        assignmentId: input.assignmentId,
        scope: input.scope,
        state: "execution",
        acquiredAt: NOW,
        transitionedAt: null,
        capturedDelta: [],
        recoveryAttempts: 0,
      }),
      transitionToReportHold,
      release: async (lease) => {
        releasedLeases.push(lease.leaseId);
      },
      releaseAssignment: releaseAssignmentNoop,

      releaseMission: releaseMissionNoop,
    };
    const workspace: TeamWorkspaceSnapshotPort = {
      captureBaseline: async (input) => ({
        baselineId: `baseline-${input.assignmentId}`,
        workspaceId: input.workspaceId,
        assignmentId: input.assignmentId,
        policyRevision: input.policy.revision,
        capturedAt: NOW,
        entries: [],
      }),
    };
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      leases,
      workspace,
      dispatch,
      participants: { ensureParticipant: async () => undefined },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    const reconciling = scheduler.reconcileMission("mission-1");
    await parallelDispatchObserved;
    expect(dispatches.toSorted()).toEqual(["assignment-api", "assignment-app"]);
    releaseDispatch?.();

    await expect(reconciling).resolves.toEqual({
      missionId: "mission-1",
      dispatchedAssignmentIds: ["assignment-api", "assignment-app"],
      deferredAssignmentIds: ["assignment-integration"],
      createdRecipientAttentionDeliveryIds: [],
    });
    const stored = await missions.get("mission-1");
    expect(stored?.mission.assignments).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-api",
        runtimeAgentId: "agent-lead",
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
      }),
      expect.objectContaining({
        assignmentId: "assignment-app",
        runtimeAgentId: "agent-member",
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-app",
      }),
      expect.objectContaining({
        assignmentId: "assignment-integration",
        runtimeAgentId: null,
        dispatchState: "queued",
        semanticState: "planned",
      }),
    ]);
    expect(stored?.ownershipIntervals).toEqual([
      {
        intervalId: "lease-assignment-api",
        workspaceId: "workspace-1",
        assignmentId: "assignment-api",
        scope: { kind: "paths", pathPrefixes: ["packages/server"] },
        startedAt: NOW,
        state: "open",
        endedAt: null,
        closure: null,
      },
      {
        intervalId: "lease-assignment-app",
        workspaceId: "workspace-1",
        assignmentId: "assignment-app",
        scope: { kind: "paths", pathPrefixes: ["packages/app"] },
        startedAt: NOW,
        state: "open",
        endedAt: null,
        closure: null,
      },
    ]);
    expect(releasedLeases).toEqual([]);
  });

  test("does not dispatch an old plan while Mission-wide replanning Attention is open", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.status = "needs_attention";
    mission.suspendedStatus = "active";
    mission.attentionItems = [
      {
        attentionId: "lead-replacement:attention-lead:replan",
        kind: "assignment_requires_replan",
        status: "open",
        priorMissionStatus: "active",
        assignmentId: null,
        summary: "The replacement Lead must submit a new Mission plan.",
        pathEvidence: [],
        createdAt: NOW,
        resolution: null,
      },
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-replan-gate",
      requestFingerprint: "start-replan-gate-fingerprint",
    });
    const dispatches: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => {
          throw new Error("Mission-wide replan must block lease acquisition");
        },
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("Mission-wide replan must block baseline capture");
        },
      },
      dispatch: {
        dispatch: async (input) => {
          dispatches.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    const result = await scheduler.reconcileMission(mission.id);

    expect(dispatches).toEqual([]);
    expect(result.dispatchedAssignmentIds).toEqual([]);
    expect((await missions.get(mission.id))?.mission.attentionItems).toEqual(
      mission.attentionItems,
    );
  });

  test("reuses the prepared baseline when provider acceptance races a Mission revision", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    await missions.createIfAbsent({
      mission: activeMission(),
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    let baselineCaptures = 0;
    let mutateMission = true;
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      leases: {
        acquire: async (input) => ({
          leaseId: `lease-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          scope: input.scope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        }),
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => {
          baselineCaptures += 1;
          return {
            baselineId: `baseline-${input.assignmentId}-${baselineCaptures}`,
            workspaceId: input.workspaceId,
            assignmentId: input.assignmentId,
            policyRevision: input.policy.revision,
            capturedAt: NOW,
            entries: [],
          };
        },
      },
      dispatch: {
        dispatch: async (input) => {
          if (mutateMission) {
            mutateMission = false;
            const current = await missions.get(input.missionId);
            if (!current) throw new Error("Mission disappeared");
            await missions.update({
              missionId: input.missionId,
              expectedRevision: current.mission.revision,
              update: (mission) => ({ ...mission, constraints: ["Concurrent user update"] }),
            });
          }
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      participants: { ensureParticipant: async () => undefined },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await expect(scheduler.reconcileMission("mission-1")).rejects.toMatchObject({
      name: "MissionRevisionConflictError",
    });
    await expect(scheduler.reconcileMission("mission-1")).resolves.toMatchObject({
      dispatchedAssignmentIds: ["assignment-api", "assignment-app"],
    });
    expect(baselineCaptures).toBe(2);
  });

  test("holds the Team operation lock across prepared dispatch acceptance", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.workstreams = [mission.workstreams[0]!];
    mission.assignments = [mission.assignments[0]!];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-dispatch-fence",
      requestFingerprint: "start-dispatch-fence-fingerprint",
    });
    const operations = new TeamOperationCoordinator();
    let dispatchEntered: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      dispatchEntered = resolve;
    });
    let acceptDispatch: (() => void) | null = null;
    const acceptanceGate = new Promise<void>((resolve) => {
      acceptDispatch = resolve;
    });
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      operations,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async (input) => ({
          leaseId: `lease-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          scope: input.scope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        }),
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          dispatchEntered?.();
          await acceptanceGate;
          return { kind: "accepted", turnId: "turn-assignment-api" };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    const reconciling = scheduler.reconcileMission(mission.id);
    await entered;
    let competingOperationEntered = false;
    const competing = operations.serialize(mission.teamId, async () => {
      competingOperationEntered = true;
      const current = await missions.get(mission.id);
      expect(current?.mission.assignments[0]?.semanticState).toBe("running");
    });
    await Promise.resolve();
    expect(competingOperationEntered).toBe(false);

    acceptDispatch?.();
    await reconciling;
    await competing;
    expect(competingOperationEntered).toBe(true);
  });

  test("does not cache a reconciliation before it acquires the Team operation lock", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.workstreams = [];
    mission.assignments = [];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-lock-order",
      requestFingerprint: "start-lock-order-fingerprint",
    });
    const operations = new TeamOperationCoordinator();
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      operations,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("An empty Mission must not capture a baseline");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("An empty Mission must not dispatch");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    let outerEntered: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      outerEntered = resolve;
    });
    let runNested: (() => void) | null = null;
    const nestedGate = new Promise<void>((resolve) => {
      runNested = resolve;
    });
    let nestedFinished: (() => void) | null = null;
    const nestedDone = new Promise<void>((resolve) => {
      nestedFinished = resolve;
    });
    const outer = operations.serialize(mission.teamId, async (permit) => {
      outerEntered?.();
      await nestedGate;
      await scheduler.reconcileMission(mission.id, permit);
      nestedFinished?.();
    });
    await entered;
    const queuedSweep = scheduler.reconcileMission(mission.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    runNested?.();

    await expect(
      Promise.race([
        nestedDone.then(() => "completed" as const),
        new Promise<"timed_out">((resolve) => setTimeout(() => resolve("timed_out"), 1_000)),
      ]),
    ).resolves.toBe("completed");
    await Promise.all([outer, queuedSweep]);
  });

  test("does not create dispatch side effects after a durable finish intent is requested", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-finish-fence",
      requestFingerprint: "start-finish-fence-fingerprint",
    });
    const finishing = await missions.beginFinish({
      missionId: mission.id,
      expectedRevision: 1,
      intent: {
        intentId: "finish-fence",
        idempotencyKey: "finish-fence-key",
        requestFingerprint: "finish-fence-fingerprint",
        completionEventId: "finish-fence-event",
        kind: "canceled",
        reason: "User canceled",
        stage: "requested",
        requestedAt: NOW,
        updatedAt: NOW,
      },
    });
    const sideEffects: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: {
        read: async () => {
          sideEffects.push("turn-read");
          return new Map();
        },
      },
      lifecycle: lifecycleMustNotComplete,
      participants: {
        ensureParticipant: async () => {
          sideEffects.push("participant");
        },
      },
      leases: {
        acquire: async () => {
          sideEffects.push("lease");
          return null;
        },
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          sideEffects.push("baseline");
          throw new Error("Cancellation must fence baseline capture");
        },
      },
      dispatch: {
        dispatch: async () => {
          sideEffects.push("dispatch");
          throw new Error("Cancellation must fence dispatch");
        },
        requestReport: async () => {
          sideEffects.push("report-recovery");
          throw new Error("Cancellation must fence report recovery");
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await expect(scheduler.reconcileMission(mission.id)).resolves.toEqual({
      missionId: mission.id,
      dispatchedAssignmentIds: [],
      deferredAssignmentIds: finishing.mission.assignments
        .filter((candidate) => candidate.semanticState === "planned")
        .map((candidate) => candidate.assignmentId),
      createdRecipientAttentionDeliveryIds: [],
    });
    expect(sideEffects).toEqual([]);
  });

  test("prepares exact turn and delta evidence for a fenced Mission without dispatching", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease: {
          leaseId: "lease-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          scope: api.mutableScope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        },
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-finish-evidence",
      requestFingerprint: "start-finish-evidence-fingerprint",
    });
    let finishing = await missions.beginFinish({
      missionId: mission.id,
      expectedRevision: created.mission.revision,
      intent: {
        intentId: "finish-evidence",
        idempotencyKey: "finish-evidence-key",
        requestFingerprint: "finish-evidence-fingerprint",
        completionEventId: "finish-evidence-event",
        kind: "canceled",
        reason: "User canceled",
        stage: "requested",
        requestedAt: NOW,
        updatedAt: NOW,
      },
    });
    finishing = await missions.advanceFinish({
      missionId: mission.id,
      intentId: "finish-evidence",
      from: "requested",
      to: "dispatch_stopped",
    });
    finishing = await missions.advanceFinish({
      missionId: mission.id,
      intentId: "finish-evidence",
      from: "dispatch_stopped",
      to: "participants_archived",
    });
    expect(finishing.finishIntent?.stage).toBe("participants_archived");

    const effects: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: {
        read: async () =>
          new Map([
            [
              "turn-assignment-api",
              {
                assignmentId: "assignment-api",
                turnId: "turn-assignment-api",
                runtimeAgentId: "agent-lead",
                outcome: "completed" as const,
              },
            ],
          ]),
      },
      lifecycle: lifecycleMustNotComplete,
      participants: {
        ensureParticipant: async () => {
          effects.push("participant");
        },
      },
      leases: {
        acquire: async () => {
          effects.push("lease-acquire");
          return null;
        },
        transitionToReportHold: async (input) => {
          effects.push("report-hold");
          return transitionToReportHold(input);
        },
        release: async () => {
          effects.push("lease-release");
        },
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          effects.push("baseline");
          throw new Error("Finish evidence must not capture a new baseline");
        },
        captureDelta: async () => ({
          capturedDelta: [
            { path: "packages/server/src/feature.ts", fingerprint: "sha256:feature" },
          ],
          violations: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          effects.push("dispatch");
          throw new Error("Finish evidence must not dispatch work");
        },
        requestReport: async () => {
          effects.push("report-recovery");
          throw new Error("Finish evidence must not request a report");
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await expect(
      scheduler.prepareFinishEvidence({ missionId: mission.id, intentId: "wrong-intent" }),
    ).rejects.toThrow(/wrong-intent/);
    await scheduler.prepareFinishEvidence({
      missionId: mission.id,
      intentId: "finish-evidence",
    });

    const updated = await missions.get(mission.id);
    expect(updated?.acceptedTurnFacts).toEqual([
      {
        assignmentId: "assignment-api",
        turnId: "turn-assignment-api",
        runtimeAgentId: "agent-lead",
        outcome: "completed",
        recordedAt: NOW,
      },
    ]);
    expect(updated?.mission.assignments).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-api",
        dispatchState: "settled",
        semanticState: "needs_report",
        scopeLease: expect.objectContaining({
          state: "report_hold",
          transitionedAt: NOW,
          capturedDelta: [
            { path: "packages/server/src/feature.ts", fingerprint: "sha256:feature" },
          ],
        }),
      }),
    ]);
    expect(updated?.assignmentReportRecoveryOutbox).toEqual([]);
    expect(effects).toEqual(["report-hold"]);
    await expect(
      missions.prepareFinishEvidence({
        missionId: mission.id,
        intentId: "finish-evidence",
      }),
    ).resolves.toMatchObject({ finishIntent: { stage: "evidence_prepared" } });
  });

  test("transfers report holds before releasing terminal and queued lease claims", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const source = {
      ...mission.assignments[0]!,
      runtimeAgentId: "agent-lead",
      bindingEpoch: 1,
      supersededBy: "assignment-recovery",
      terminationReason: "superseded" as const,
      workspaceBaseline: {
        baselineId: "baseline-source",
        workspaceId: mission.workspaceId,
        assignmentId: mission.assignments[0]!.assignmentId,
        policyRevision: 1,
        capturedAt: NOW,
        entries: [],
      },
      dispatchState: "settled" as const,
      semanticState: "canceled" as const,
      acceptedTurnId: "turn-source",
      dispatchedAt: NOW,
      settledAt: NOW,
    };
    const queuedCanceled = {
      ...mission.assignments[1]!,
      terminationReason: "mission_canceled" as const,
      semanticState: "canceled" as const,
      settledAt: NOW,
    };
    const replacement = {
      ...mission.assignments[0]!,
      assignmentId: "assignment-recovery",
      dependencyAssignmentIds: [source.assignmentId],
    };
    mission.assignments = [source, queuedCanceled, replacement];
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-report-handoff",
      requestFingerprint: "start-report-handoff-fingerprint",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentDeltaHandoffs: [
          {
            sourceAssignmentId: source.assignmentId,
            replacementAssignmentId: replacement.assignmentId,
            reportHoldLeaseId: "lease-source",
            capturedDelta: [
              { path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" },
            ],
            createdAt: NOW,
          },
        ],
      }),
    });
    const leaseEvents: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        transferReportHold: async (input) => {
          leaseEvents.push(`transfer:${input.sourceAssignmentId}:${input.replacementAssignmentId}`);
          return {
            leaseId: input.leaseId,
            workspaceId: input.workspaceId,
            assignmentId: input.replacementAssignmentId,
            scope: { kind: "paths", pathPrefixes: ["packages/server"] },
            state: "report_hold",
            acquiredAt: NOW,
            transitionedAt: NOW,
            capturedDelta: [],
            recoveryAttempts: 0,
          };
        },
        release: async () => undefined,
        releaseAssignment: async (input) => {
          leaseEvents.push(`release:${input.assignmentId}`);
        },
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The recovery Assignment is dependency-blocked");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The recovery Assignment is dependency-blocked");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);

    expect(leaseEvents[0]).toBe(`transfer:${source.assignmentId}:${replacement.assignmentId}`);
    expect(new Set(leaseEvents.slice(1))).toEqual(
      new Set([`release:${source.assignmentId}`, `release:${queuedCanceled.assignmentId}`]),
    );
  });

  test("backs off unaccepted provider dispatches and blocks after three failures", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.workstreams = [mission.workstreams[0]!];
    mission.assignments = [mission.assignments[0]!];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    let currentTime = NOW;
    let dispatchAttempts = 0;
    const released: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async (input) => ({
          leaseId: `lease-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          scope: input.scope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        }),
        transitionToReportHold,
        release: async (lease) => {
          released.push(lease.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: currentTime,
          entries: [],
        }),
        captureDelta: async () => {
          throw new Error("An unaccepted dispatch has no workspace delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          dispatchAttempts += 1;
          return { kind: "provider_unavailable", reason: "Model is not installed" };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => currentTime },
    });

    await scheduler.reconcileMission(mission.id);
    expect((await missions.get(mission.id))?.assignmentDispatchIntents).toEqual([
      expect.objectContaining({ attempts: 1, nextEligibleAt: "2026-08-08T12:00:05.000Z" }),
    ]);
    currentTime = "2026-08-08T12:00:05.000Z";
    await scheduler.reconcileMission(mission.id);
    expect((await missions.get(mission.id))?.assignmentDispatchIntents).toEqual([
      expect.objectContaining({ attempts: 2, nextEligibleAt: "2026-08-08T12:00:15.000Z" }),
    ]);
    currentTime = "2026-08-08T12:00:15.000Z";
    await scheduler.reconcileMission(mission.id);
    await scheduler.reconcileMission(mission.id);
    const blocked = await missions.get(mission.id);

    expect(dispatchAttempts).toBe(3);
    expect(released).toEqual(["lease-assignment-api"]);
    expect(blocked?.assignmentDispatchIntents).toEqual([]);
    expect(blocked?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-api",
          semanticState: "blocked",
          terminationReason: "provider_unavailable",
          dispatchState: "queued",
          acceptedTurnId: null,
        }),
      ],
      attentionItems: [
        expect.objectContaining({
          attentionId: "mission-1:assignment-api:provider-unavailable",
          kind: "provider_unavailable",
          status: "open",
          assignmentId: "assignment-api",
        }),
      ],
    });
  });

  test("fences an acceptance-unknown dispatch across Teams until Mission release", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.workstreams = [mission.workstreams[0]!];
    mission.assignments = [mission.assignments[0]!];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-acceptance-unknown",
      requestFingerprint: "start-acceptance-unknown-fingerprint",
    });
    let leaseSequence = 0;
    const leases = new WorkspaceScopeLeaseStore({
      filePath: join(rootDirectory, "scope-leases.json"),
      resolveWorkspaceIdentity: async () => "checkout-1",
      clock: { now: () => NOW },
      ids: { next: () => `lease-${++leaseSequence}` },
    });
    let dispatches = 0;
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases,
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          dispatches += 1;
          return {
            kind: "acceptance_unknown",
            reason: "Provider may have accepted the turn",
          };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    await scheduler.reconcileMission(mission.id);
    const fenced = await missions.get(mission.id);

    expect(dispatches).toBe(1);
    await expect(
      leases.acquire({
        teamId: "team-competing",
        missionId: "mission-competing",
        workspaceId: "workspace-competing",
        assignmentId: "assignment-competing",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 100,
        createdAt: NOW,
      }),
    ).resolves.toBeNull();
    expect(fenced?.assignmentDispatchIntents).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-api",
        scopeLease: expect.objectContaining({ leaseId: "lease-1" }),
      }),
    ]);
    expect(fenced?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-api",
          semanticState: "blocked",
          terminationReason: "dispatch_acceptance_unknown",
          dispatchState: "queued",
          acceptedTurnId: null,
          scopeLease: null,
        }),
      ],
      attentionItems: [
        expect.objectContaining({
          attentionId: "mission-1:assignment-api:dispatch-acceptance-unknown",
          kind: "dispatch_acceptance_unknown",
          status: "open",
          assignmentId: "assignment-api",
        }),
      ],
    });

    if (!fenced) throw new Error("Acceptance-unknown Mission disappeared");
    await missions.beginFinish({
      missionId: mission.id,
      expectedRevision: fenced.mission.revision,
      intent: {
        intentId: "finish-acceptance-unknown",
        idempotencyKey: "finish-acceptance-unknown-key",
        requestFingerprint: "finish-acceptance-unknown-fingerprint",
        completionEventId: "finish-acceptance-unknown-event",
        kind: "canceled",
        reason: "User canceled after unknown acceptance",
        stage: "requested",
        requestedAt: NOW,
        updatedAt: NOW,
      },
    });
    await missions.advanceFinish({
      missionId: mission.id,
      intentId: "finish-acceptance-unknown",
      from: "requested",
      to: "dispatch_stopped",
    });
    await missions.advanceFinish({
      missionId: mission.id,
      intentId: "finish-acceptance-unknown",
      from: "dispatch_stopped",
      to: "participants_archived",
    });
    await scheduler.prepareFinishEvidence({
      missionId: mission.id,
      intentId: "finish-acceptance-unknown",
    });
    await expect(
      leases.acquire({
        teamId: "team-competing",
        missionId: "mission-competing",
        workspaceId: "workspace-competing",
        assignmentId: "assignment-competing",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 100,
        createdAt: NOW,
      }),
    ).resolves.toBeNull();

    await missions.prepareFinishEvidence({
      missionId: mission.id,
      intentId: "finish-acceptance-unknown",
    });
    await missions.finalize({
      missionId: mission.id,
      intentId: "finish-acceptance-unknown",
    });
    await leases.releaseMission({ missionId: mission.id });
    await expect(
      leases.acquire({
        teamId: "team-competing",
        missionId: "mission-competing",
        workspaceId: "workspace-competing",
        assignmentId: "assignment-competing",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 100,
        createdAt: NOW,
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-competing" });
  });

  test("releases a provider-exhausted prepared lease after restart without redispatch", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "blocked" }];
    mission.assignments = [
      {
        ...mission.assignments[0]!,
        semanticState: "blocked",
        terminationReason: "provider_unavailable",
      },
    ];
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-provider-cleanup",
      requestFingerprint: "start-provider-cleanup-fingerprint",
    });
    const preparedAssignment = mission.assignments[0]!;
    const lease = {
      leaseId: "lease-assignment-api",
      workspaceId: mission.workspaceId,
      assignmentId: preparedAssignment.assignmentId,
      scope: preparedAssignment.mutableScope,
      state: "execution" as const,
      acquiredAt: NOW,
      transitionedAt: null,
      capturedDelta: [],
      recoveryAttempts: 0,
    };
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (recovery) => ({
        ...recovery,
        assignmentDispatchIntents: [
          {
            assignmentId: preparedAssignment.assignmentId,
            runtimeAgentId: "agent-lead",
            bindingEpoch: 1,
            scopeLease: lease,
            workspaceBaseline: {
              baselineId: "baseline-assignment-api",
              workspaceId: mission.workspaceId,
              assignmentId: preparedAssignment.assignmentId,
              policyRevision: mission.workspaceAuditPolicy.revision,
              capturedAt: NOW,
              entries: [],
            },
            messageId: "team-mission:mission-1:assignment:assignment-api:dispatch",
            preparedAt: NOW,
            attempts: 3,
            nextEligibleAt: NOW,
            lastFailureKind: "provider_unavailable",
            lastFailureReason: "Provider is offline",
          },
        ],
      }),
    });
    const released: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => {
          throw new Error("A blocked Assignment must not reacquire a lease");
        },
        transitionToReportHold,
        release: async (candidate) => {
          released.push(candidate.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("A blocked Assignment must not capture another baseline");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("A provider-exhausted Assignment must not be replayed");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);

    expect(released).toEqual([lease.leaseId]);
    expect((await missions.get(mission.id))?.assignmentDispatchIntents).toEqual([]);
  });

  test("releases every Assignment lease when a terminal Mission is reconciled", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.status = "canceled";
    mission.completedAt = NOW;
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-terminal-cleanup",
      requestFingerprint: "start-terminal-cleanup-fingerprint",
    });
    const releasedMissions: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: {
        read: async () => {
          throw new Error("A terminal Mission must not inspect durable turns");
        },
      },
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => {
          throw new Error("A terminal Mission must not acquire a lease");
        },
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: async ({ missionId }) => {
          releasedMissions.push(missionId);
        },
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("A terminal Mission must not capture a baseline");
        },
        captureDelta: async () => {
          throw new Error("A terminal Mission must not capture a delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("A terminal Mission must not dispatch work");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    const result = await scheduler.reconcileMission(mission.id);

    expect(result).toEqual({
      missionId: mission.id,
      dispatchedAssignmentIds: [],
      deferredAssignmentIds: [],
      createdRecipientAttentionDeliveryIds: [],
    });
    expect(releasedMissions).toEqual([mission.id]);
  });

  test("provisions a missing Member only when its Assignment becomes ready", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.participants = mission.participants.filter(
      (participant) => participant.memberId === "member-lead",
    );
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    const provisioned: Array<Parameters<TeamParticipantProvisionPort["ensureParticipant"]>[0]> = [];
    const dispatched: Array<Parameters<TeamAssignmentDispatchPort["dispatch"]>[0]> = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: {
        ensureParticipant: async (input) => {
          provisioned.push(structuredClone(input));
        },
      },
      leases: {
        acquire: async (input) => ({
          leaseId: `lease-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          scope: input.scope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        }),
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
      },
      dispatch: {
        dispatch: async (input) => {
          dispatched.push(structuredClone(input));
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission("mission-1");
    const stored = await missions.get("mission-1");
    const memberParticipant = stored?.mission.participants.find(
      (participant) => participant.memberId === "member-app",
    );

    expect(provisioned).toHaveLength(1);
    expect(provisioned[0]).toMatchObject({
      teamId: "team-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      memberId: "member-app",
      bindingEpoch: 1,
      role: "App engineer",
    });
    const provisionedAgentId = z.guid().parse(provisioned[0]?.agentId);
    expect(provisionedAgentId).toBe("56eccb3f-eda2-8016-a0c4-664f827a6617");
    expect(memberParticipant).toEqual({
      memberId: "member-app",
      agentId: provisioned[0]?.agentId,
      bindingEpoch: 1,
      joinedAt: NOW,
      archivedAt: null,
    });
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        assignmentId: "assignment-app",
        agentId: memberParticipant?.agentId,
        bindingEpoch: 1,
      }),
    );
  });

  test("opens reviewer Attention instead of rebinding a participant lost while offline", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const delivery = {
      ...mission.assignments[1]!,
      runtimeAgentId: "agent-member",
      bindingEpoch: 1,
      workspaceBaseline: {
        baselineId: "baseline-assignment-app",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment-app",
        policyRevision: mission.workspaceAuditPolicy.revision,
        capturedAt: NOW,
        entries: [],
      },
      report: completedReport(),
      dispatchState: "settled" as const,
      semanticState: "completed" as const,
      acceptedTurnId: "turn-assignment-app",
      dispatchedAt: NOW,
      settledAt: NOW,
    };
    const reviewId = `assignment:${mission.id}:${mission.planRevision}:workstream-app:review`;
    const review = {
      ...mission.assignments[1]!,
      assignmentId: reviewId,
      kind: "review" as const,
      subjectAssignmentIds: [delivery.assignmentId],
      dependencyAssignmentIds: [delivery.assignmentId],
      mutableScope: { kind: "read_only" as const },
    };
    mission.assignments = [delivery, review];
    mission.workstreams = [
      {
        ...mission.workstreams[1]!,
        status: "review",
        reviewPolicy: "required",
        reviewerMemberId: "member-app",
      },
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-reviewer-loss",
      requestFingerprint: "start-reviewer-loss-fingerprint",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: delivery.assignmentId,
          turnId: delivery.acceptedTurnId,
          runtimeAgentId: delivery.runtimeAgentId,
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const provisioned: string[] = [];
    const dispatched: string[] = [];
    const participants: TeamParticipantProvisionPort & {
      states: Map<string, "active" | "archived">;
    } = {
      states: new Map([
        ["agent-lead", "active"],
        ["agent-member", "archived"],
      ]),
      async inspectParticipant(input) {
        return this.states.get(input.agentId) ?? "active";
      },
      ensureParticipant: async (input) => {
        provisioned.push(input.agentId);
      },
    };
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants,
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
      },
      dispatch: {
        dispatch: async (input) => {
          dispatched.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const stored = await missions.get(mission.id);

    expect(provisioned).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(stored?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      participants: [
        expect.objectContaining({ agentId: "agent-lead", archivedAt: null }),
        expect.objectContaining({ agentId: "agent-member", archivedAt: NOW }),
      ],
      attentionItems: [
        expect.objectContaining({
          attentionId: `${mission.id}:${reviewId}:reviewer-unavailable`,
          kind: "reviewer_unavailable",
          status: "open",
          assignmentId: reviewId,
        }),
      ],
      assignments: [
        expect.objectContaining({
          assignmentId: delivery.assignmentId,
          semanticState: "completed",
        }),
        expect.objectContaining({
          assignmentId: reviewId,
          kind: "review",
          semanticState: "canceled",
          dispatchState: "queued",
          terminationReason: "participant_unavailable",
          acceptedTurnId: null,
          settledAt: NOW,
        }),
      ],
    });
    expect(stored?.mission.assignments).toHaveLength(2);
  });

  test("cancels an unavailable participant's prepared Assignment and releases its intent lease", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const app = mission.assignments[1]!;
    mission.assignments = [app];
    mission.workstreams = [mission.workstreams[1]!];
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-prepared-participant-loss",
      requestFingerprint: "start-prepared-participant-loss-fingerprint",
    });
    const lease = {
      leaseId: "lease-assignment-app",
      workspaceId: mission.workspaceId,
      assignmentId: app.assignmentId,
      scope: app.mutableScope,
      state: "execution" as const,
      acquiredAt: NOW,
      transitionedAt: null,
      capturedDelta: [],
      recoveryAttempts: 0,
    };
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (recovery) => ({
        ...recovery,
        assignmentDispatchIntents: [
          {
            assignmentId: app.assignmentId,
            runtimeAgentId: "agent-member",
            bindingEpoch: 1,
            scopeLease: lease,
            workspaceBaseline: {
              baselineId: "baseline-assignment-app",
              workspaceId: mission.workspaceId,
              assignmentId: app.assignmentId,
              policyRevision: mission.workspaceAuditPolicy.revision,
              capturedAt: NOW,
              entries: [],
            },
            messageId: "team-mission:mission-1:assignment:assignment-app:dispatch",
            preparedAt: NOW,
            attempts: 0,
            nextEligibleAt: NOW,
            lastFailureKind: null,
            lastFailureReason: null,
          },
        ],
      }),
    });
    const released: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: {
        inspectParticipant: async (input) =>
          input.agentId === "agent-member" ? "archived" : "active",
        ensureParticipant: async () => undefined,
      },
      leases: {
        acquire: async () => {
          throw new Error("An unavailable participant must not reacquire a lease");
        },
        transitionToReportHold,
        release: async (releasedLease) => {
          released.push(releasedLease.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("An unavailable participant must not capture another baseline");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("An unavailable participant must not be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const stored = await missions.get(mission.id);

    expect(released).toEqual(["lease-assignment-app"]);
    expect(stored?.assignmentDispatchIntents).toEqual([]);
    expect(stored?.mission.assignments).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-app",
        semanticState: "canceled",
        dispatchState: "queued",
        terminationReason: "participant_unavailable",
        acceptedTurnId: null,
        scopeLease: null,
        workspaceBaseline: null,
        settledAt: NOW,
      }),
    ]);
  });

  test("records an online participant archive through the event-driven scheduler entrypoint", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.assignments = [mission.assignments[1]!];
    mission.workstreams = [mission.workstreams[1]!];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-participant-archive",
      requestFingerprint: "start-participant-archive-fingerprint",
    });
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("An unavailable participant must not reach dispatch preparation");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("An unavailable participant must not be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.handleParticipantUnavailable("agent-member");
    const stored = await missions.get(mission.id);

    expect(stored?.mission).toMatchObject({
      status: "needs_attention",
      participants: expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-member", archivedAt: NOW }),
      ]),
      attentionItems: [
        expect.objectContaining({
          kind: "participant_unavailable",
          assignmentId: "assignment-app",
        }),
      ],
    });
  });

  test("queues a participant archive behind provider acceptance for the same Team", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    mission.assignments = [mission.assignments[1]!];
    mission.workstreams = [mission.workstreams[1]!];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-participant-acceptance-race",
      requestFingerprint: "start-participant-acceptance-race-fingerprint",
    });
    let dispatchEntered: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      dispatchEntered = resolve;
    });
    let acceptDispatch: (() => void) | null = null;
    const acceptanceGate = new Promise<void>((resolve) => {
      acceptDispatch = resolve;
    });
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async (input) => ({
          leaseId: `lease-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          scope: input.scope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        }),
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          dispatchEntered?.();
          await acceptanceGate;
          return { kind: "accepted", turnId: "turn-assignment-app" };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    const reconciling = scheduler.reconcileMission(mission.id);
    await entered;
    let archiveCompleted = false;
    const markArchiveCompleted = () => {
      archiveCompleted = true;
      return undefined;
    };
    const archiving = scheduler
      .handleParticipantUnavailable("agent-member")
      .then(markArchiveCompleted);
    await Promise.resolve();
    expect(archiveCompleted).toBe(false);

    acceptDispatch?.();
    await expect(Promise.all([reconciling, archiving])).resolves.toBeDefined();
    const stored = await missions.get(mission.id);
    expect(stored?.assignmentDispatchIntents).toEqual([]);
    expect(stored?.mission).toMatchObject({
      status: "needs_attention",
      participants: expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-member", archivedAt: NOW }),
      ]),
      assignments: [
        expect.objectContaining({
          assignmentId: "assignment-app",
          semanticState: "running",
          acceptedTurnId: "turn-assignment-app",
          scopeLease: expect.objectContaining({ leaseId: "lease-assignment-app" }),
        }),
      ],
      attentionItems: [
        expect.objectContaining({
          kind: "participant_unavailable",
          assignmentId: "assignment-app",
        }),
      ],
    });
  });

  test("settles a reported Assignment only after its accepted turn completes", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0];
    if (!api) throw new Error("API Assignment is missing");
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease: {
          leaseId: "lease-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          scope: api.mutableScope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        },
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    mission.workstreams = [mission.workstreams[0]!];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const beforeInterval = await missions.get(mission.id);
    if (!beforeInterval) throw new Error("Mission disappeared");
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: beforeInterval.storageRevision,
      update: (state) => ({
        ...state,
        ownershipIntervals: [
          {
            intervalId: "lease-assignment-api",
            workspaceId: mission.workspaceId,
            assignmentId: api.assignmentId,
            scope: api.mutableScope,
            startedAt: NOW,
            state: "open",
            endedAt: null,
            closure: null,
          },
        ],
      }),
    });
    const released: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async (lease) => {
          released.push(lease.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("No Assignment should be dispatched");
        },
        captureDelta: async () => ({
          capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
          violations: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("No Assignment should be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const settled = await missions.get(mission.id);

    expect(settled?.mission.assignments[0]).toMatchObject({
      assignmentId: api.assignmentId,
      dispatchState: "settled",
      semanticState: "completed",
      scopeLease: null,
      settledAt: NOW,
    });
    expect(settled?.ownershipIntervals).toEqual([
      expect.objectContaining({
        assignmentId: api.assignmentId,
        state: "closed",
        endedAt: NOW,
        closure: "report",
      }),
    ]);
    expect(released).toEqual(["lease-assignment-api"]);
  });

  test("opens ownership attention and retains the workspace gate for an out-of-scope delta", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    const scopeLease = {
      leaseId: "lease-assignment-api",
      workspaceId: mission.workspaceId,
      assignmentId: api.assignmentId,
      scope: api.mutableScope,
      state: "execution" as const,
      acquiredAt: NOW,
      transitionedAt: null,
      capturedDelta: [],
      recoveryAttempts: 0,
    };
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease,
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const beforeInterval = await missions.get(mission.id);
    if (!beforeInterval) throw new Error("Mission disappeared");
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: beforeInterval.storageRevision,
      update: (state) => ({
        ...state,
        ownershipIntervals: [
          {
            intervalId: scopeLease.leaseId,
            workspaceId: mission.workspaceId,
            assignmentId: api.assignmentId,
            scope: api.mutableScope,
            startedAt: NOW,
            state: "open",
            endedAt: null,
            closure: null,
          },
        ],
      }),
    });
    const released: string[] = [];
    const releasedAssignments: Array<{ workspaceId: string; assignmentId: string }> = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async (lease) => {
          released.push(lease.leaseId);
        },
        releaseAssignment: async (input) => {
          releasedAssignments.push(input);
        },
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("No Assignment should be dispatched");
        },
        captureDelta: async () => ({
          capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
          violations: [{ path: "packages/app/src/unsafe.ts", fingerprint: "sha256:unsafe" }],
        }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("No Assignment should be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(updated?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      attentionItems: [
        {
          attentionId: "mission-1:assignment-api:ownership-violation",
          kind: "ownership_violation",
          status: "open",
          priorMissionStatus: "active",
          assignmentId: "assignment-api",
          pathEvidence: [{ path: "packages/app/src/unsafe.ts", fingerprint: "sha256:unsafe" }],
          createdAt: NOW,
          resolution: null,
        },
      ],
    });
    expect(updated?.ownershipIntervals).toEqual([
      expect.objectContaining({ assignmentId: "assignment-api", state: "open" }),
    ]);
    expect(released).toEqual([]);
    expect(releasedAssignments).toEqual([]);

    if (!updated) throw new Error("Mission disappeared after ownership attention");
    await missions.update({
      missionId: mission.id,
      expectedRevision: updated.mission.revision,
      update: (current) => ({
        ...current,
        status: "active",
        suspendedStatus: null,
        attentionItems: current.attentionItems.map((item) => ({
          ...item,
          status: "resolved" as const,
          resolution: {
            kind: "external_change" as const,
            actorId: "user-1",
            reason: "Confirmed as a concurrent human edit",
            resolvedAt: NOW,
            ownerAssignmentId: null,
            recoveryAssignmentId: null,
          },
        })),
      }),
    });

    await scheduler.reconcileMission(mission.id);
    const resolved = await missions.get(mission.id);

    expect(releasedAssignments).toEqual([
      { workspaceId: "workspace-1", assignmentId: "assignment-api" },
    ]);
    expect(resolved?.ownershipIntervals).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-api",
        state: "closed",
        endedAt: NOW,
        closure: "external",
      }),
    ]);
  });

  test("blocks the Workstream and releases its lease when an accepted turn fails", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    const scopeLease = {
      leaseId: "lease-assignment-api",
      workspaceId: mission.workspaceId,
      assignmentId: api.assignmentId,
      scope: api.mutableScope,
      state: "execution" as const,
      acquiredAt: NOW,
      transitionedAt: null,
      capturedDelta: [],
      recoveryAttempts: 0,
    };
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease,
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "failed",
          recordedAt: NOW,
        },
      ],
    });
    const released: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async (lease) => {
          released.push(lease.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("A failed Assignment must not be dispatched again");
        },
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("A failed Assignment must not be dispatched again");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const settled = await missions.get(mission.id);

    expect(settled?.mission.assignments[0]).toMatchObject({
      dispatchState: "settled",
      semanticState: "failed",
      terminationReason: "turn_failed",
      scopeLease: null,
      settledAt: NOW,
    });
    expect(settled?.mission.workstreams[0]?.status).toBe("blocked");
    expect(released).toEqual(["lease-assignment-api"]);
  });

  test("settles a durable unknown turn after restart and releases its lease", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    const scopeLease = {
      leaseId: "lease-assignment-api",
      workspaceId: mission.workspaceId,
      assignmentId: api.assignmentId,
      scope: api.mutableScope,
      state: "execution" as const,
      acquiredAt: NOW,
      transitionedAt: null,
      capturedDelta: [],
      recoveryAttempts: 0,
    };
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease,
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    const released: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: {
        read: async () =>
          new Map([
            [
              "turn-assignment-api",
              {
                assignmentId: "assignment-api",
                turnId: "turn-assignment-api",
                runtimeAgentId: "agent-lead",
                outcome: "unknown" as const,
              },
            ],
          ]),
      },
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async (lease) => {
          released.push(lease.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("An unknown Assignment must not be dispatched again");
        },
        captureDelta: async () => ({
          capturedDelta: [
            { path: "packages/server/src/deleted.ts", fingerprint: "deleted:sha256:before" },
          ],
          violations: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("An unknown Assignment must not be dispatched again");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const settled = await missions.get(mission.id);

    expect(settled?.mission.assignments[0]).toMatchObject({
      dispatchState: "settled",
      semanticState: "failed",
      terminationReason: "turn_unknown",
      scopeLease: null,
      settledAt: NOW,
      terminalEvidence: {
        assignmentId: "assignment-api",
        acceptedTurn: {
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "unknown",
          recordedAt: NOW,
        },
        capturedDelta: [
          { path: "packages/server/src/deleted.ts", fingerprint: "deleted:sha256:before" },
        ],
        ownershipViolations: [],
        report: null,
        handoffs: [],
        capturedAt: NOW,
      },
    });
    expect(settled?.mission.workstreams[0]?.status).toBe("blocked");
    expect(released).toEqual(["lease-assignment-api"]);
    expect(settled?.acceptedTurnFacts).toEqual([
      {
        assignmentId: "assignment-api",
        turnId: "turn-assignment-api",
        runtimeAgentId: "agent-lead",
        outcome: "unknown",
        recordedAt: NOW,
      },
    ]);
  });

  test("materializes and dispatches a required read-only review after delivery settles", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const apiWorkstream = {
      ...mission.workstreams[0]!,
      reviewPolicy: "required" as const,
      reviewerRequirements: {
        requiredSkillIds: ["typescript"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 3,
      },
      reviewerMemberId: "member-app",
      reviewerMatchExplanation: matchExplanation("member-app"),
    };
    const api = mission.assignments[0]!;
    mission.workstreams = [{ ...apiWorkstream, status: "active" }];
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease: {
          leaseId: "lease-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          scope: api.mutableScope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        },
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const reviewDispatches: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async (input) => {
          reviewDispatches.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);
    const review = updated?.mission.assignments.find((candidate) => candidate.kind === "review");

    expect(reviewDispatches).toEqual(["assignment:mission-1:1:workstream-api:review"]);
    expect(review).toMatchObject({
      assignmentId: "assignment:mission-1:1:workstream-api:review",
      kind: "review",
      subjectAssignmentIds: ["assignment-api"],
      dependencyAssignmentIds: ["assignment-api"],
      assigneeMemberId: "member-app",
      mutableScope: { kind: "read_only" },
      semanticState: "running",
      acceptedTurnId: "turn-assignment:mission-1:1:workstream-api:review",
    });
  });

  test("materializes final verification after every delivery path is accepted", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const apiWorkstream = { ...mission.workstreams[0]!, status: "accepted" as const };
    const verificationWorkstream: MissionWorkstream = {
      ...workstream({
        workstreamId: "workstream-final-verification",
        ownerMemberId: "member-app",
        dependencyWorkstreamIds: [apiWorkstream.workstreamId],
        mutableScope: { kind: "read_only" },
      }),
      kind: "verification",
      ownerMatchExplanation: matchExplanation("member-app"),
      status: "planned",
    };
    const api = mission.assignments[0]!;
    mission.workstreams = [apiWorkstream, verificationWorkstream];
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "settled",
        semanticState: "completed",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
        settledAt: NOW,
      },
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const verificationDispatches: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
        captureDelta: async () => {
          throw new Error("A settled delivery must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async (input) => {
          verificationDispatches.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);
    const verification = updated?.mission.assignments.find(
      (candidate) => candidate.kind === "verification",
    );

    expect(verificationDispatches).toEqual([
      "assignment:mission-1:1:workstream-final-verification:verification",
    ]);
    expect(updated?.mission.status).toBe("verifying");
    expect(verification).toMatchObject({
      kind: "verification",
      subjectAssignmentIds: ["assignment-api"],
      dependencyAssignmentIds: ["assignment-api"],
      assigneeMemberId: "member-app",
      mutableScope: { kind: "read_only" },
      semanticState: "running",
    });
  });

  test("reuses a completed delivery from the prior plan when dispatching current verification", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const priorApiWorkstream = structuredClone(mission.workstreams[0]!);
    const priorVerificationWorkstream: MissionWorkstream = {
      ...workstream({
        workstreamId: "workstream-final-verification",
        ownerMemberId: "member-app",
        dependencyWorkstreamIds: [priorApiWorkstream.workstreamId],
        mutableScope: { kind: "read_only" },
      }),
      kind: "verification",
      ownerMatchExplanation: matchExplanation("member-app"),
      status: "planned",
    };
    const currentApiWorkstream: MissionWorkstream = {
      ...priorApiWorkstream,
      planRevision: 2,
      status: "planned",
    };
    const currentVerificationWorkstream: MissionWorkstream = {
      ...priorVerificationWorkstream,
      planRevision: 2,
    };
    const priorApiAssignment = mission.assignments[0]!;
    mission.planRevision = 2;
    mission.workstreams = [currentApiWorkstream, currentVerificationWorkstream];
    mission.workstreamPlanSnapshots = [
      {
        planRevision: 1,
        workstreams: [priorApiWorkstream, priorVerificationWorkstream],
        createdAt: NOW,
      },
    ];
    mission.assignments = [
      {
        ...priorApiAssignment,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: priorApiAssignment.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "settled",
        semanticState: "completed",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
        settledAt: NOW,
      },
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-replan-reuse",
      requestFingerprint: "start-replan-reuse-fingerprint",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: priorApiAssignment.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const verificationDispatches: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
        captureDelta: async () => {
          throw new Error("A completed historical delivery must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async (input) => {
          verificationDispatches.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);
    const currentApi = updated?.mission.workstreams.find(
      (candidate) => candidate.workstreamId === currentApiWorkstream.workstreamId,
    );
    const verification = updated?.mission.assignments.find(
      (candidate) =>
        candidate.kind === "verification" && candidate.planRevision === mission.planRevision,
    );

    expect(currentApi?.status).toBe("accepted");
    expect(verificationDispatches).toEqual([
      "assignment:mission-1:2:workstream-final-verification:verification",
    ]);
    expect(updated?.mission.status).toBe("verifying");
    expect(verification).toMatchObject({
      assignmentId: "assignment:mission-1:2:workstream-final-verification:verification",
      planRevision: 2,
      kind: "verification",
      subjectAssignmentIds: ["assignment-api"],
      dependencyAssignmentIds: ["assignment-api"],
      assigneeMemberId: "member-app",
      mutableScope: { kind: "read_only" },
      semanticState: "running",
      acceptedTurnId: "turn-assignment:mission-1:2:workstream-final-verification:verification",
    });
  });

  test("dispatches the canonical final verification when subjects are stored in reverse order", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = { ...mission.workstreams[0]!, status: "accepted" as const };
    const app = { ...mission.workstreams[1]!, status: "accepted" as const };
    const verificationWorkstream: MissionWorkstream = {
      ...workstream({
        workstreamId: "workstream-final-verification",
        ownerMemberId: "member-lead",
        dependencyWorkstreamIds: [api.workstreamId, app.workstreamId],
        mutableScope: { kind: "read_only" },
      }),
      kind: "verification",
      ownerMatchExplanation: matchExplanation("member-lead"),
      ownerOverrideReason: "No independent eligible verifier is available in this roster.",
      status: "planned",
    };
    const completedAssignments: MissionAssignmentContract[] = [];
    for (const [index, candidate] of mission.assignments.slice(0, 2).entries()) {
      completedAssignments.push({
        ...candidate,
        runtimeAgentId: index === 0 ? "agent-lead" : "agent-member",
        bindingEpoch: 1,
        workspaceBaseline: {
          baselineId: `baseline-${candidate.assignmentId}`,
          workspaceId: mission.workspaceId,
          assignmentId: candidate.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "settled",
        semanticState: "completed",
        acceptedTurnId: `turn-${candidate.assignmentId}`,
        dispatchedAt: NOW,
        settledAt: NOW,
      });
    }
    const verificationId = "assignment-final-verification";
    const verification: MissionAssignmentContract = {
      ...assignment(verificationId, verificationWorkstream, "member-lead", [
        "assignment-app",
        "assignment-api",
      ]),
      kind: "verification",
      subjectAssignmentIds: ["assignment-app", "assignment-api"],
      mutableScope: { kind: "read_only" },
    };
    mission.workstreams = [api, app, verificationWorkstream];
    mission.assignments = [...completedAssignments, verification];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-reverse-verification",
      requestFingerprint: "start-reverse-verification-fingerprint",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: completedAssignments.map((candidate) => ({
        assignmentId: candidate.assignmentId,
        turnId: candidate.acceptedTurnId!,
        runtimeAgentId: candidate.runtimeAgentId!,
        outcome: "completed" as const,
        recordedAt: NOW,
      })),
    });
    const dispatches: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async (input) => {
          dispatches.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);

    expect(dispatches).toEqual([verificationId]);
    expect((await missions.get(mission.id))?.mission).toMatchObject({
      status: "verifying",
      assignments: [
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          assignmentId: verificationId,
          semanticState: "running",
          acceptedTurnId: `turn-${verificationId}`,
        }),
      ],
    });
  });

  test("completes after replanning a failed final verification with a replacement", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const priorApiWorkstream = structuredClone(mission.workstreams[0]!);
    const priorVerificationWorkstream: MissionWorkstream = {
      ...workstream({
        workstreamId: "workstream-final-verification",
        ownerMemberId: "member-app",
        dependencyWorkstreamIds: [priorApiWorkstream.workstreamId],
        mutableScope: { kind: "read_only" },
      }),
      kind: "verification",
      ownerMatchExplanation: matchExplanation("member-app"),
      status: "blocked",
    };
    const currentApiWorkstream: MissionWorkstream = {
      ...priorApiWorkstream,
      planRevision: 2,
      status: "planned",
    };
    const currentVerificationWorkstream: MissionWorkstream = {
      ...priorVerificationWorkstream,
      planRevision: 2,
      status: "planned",
    };
    const priorApiAssignment = mission.assignments[0]!;
    const replacementVerificationId = "assignment-verification-replacement";
    const canceledVerification: MissionAssignmentContract = {
      ...assignment("assignment-verification-failed", priorVerificationWorkstream, "member-app", [
        priorApiAssignment.assignmentId,
      ]),
      kind: "verification",
      subjectAssignmentIds: [priorApiAssignment.assignmentId],
      mutableScope: { kind: "read_only" },
      semanticState: "canceled",
      supersededBy: replacementVerificationId,
      terminationReason: "superseded",
      settledAt: NOW,
    };
    const replacementVerification: MissionAssignmentContract = {
      ...assignment(replacementVerificationId, currentVerificationWorkstream, "member-app", [
        priorApiAssignment.assignmentId,
      ]),
      kind: "verification",
      subjectAssignmentIds: [priorApiAssignment.assignmentId],
      mutableScope: { kind: "read_only" },
      planRevision: 2,
    };
    mission.planRevision = 2;
    mission.workstreams = [currentApiWorkstream, currentVerificationWorkstream];
    mission.workstreamPlanSnapshots = [
      {
        planRevision: 1,
        workstreams: [priorApiWorkstream, priorVerificationWorkstream],
        createdAt: NOW,
      },
    ];
    mission.assignments = [
      {
        ...priorApiAssignment,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: priorApiAssignment.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        report: completedReport(),
        dispatchState: "settled",
        semanticState: "completed",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
        settledAt: NOW,
      },
      canceledVerification,
      replacementVerification,
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-verification-replan",
      requestFingerprint: "start-verification-replan-fingerprint",
    });
    const withApiFact = await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: priorApiAssignment.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    await missions.update({
      missionId: mission.id,
      expectedRevision: withApiFact.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((candidate) =>
          candidate.assignmentId === priorApiAssignment.assignmentId
            ? {
                ...candidate,
                revision: candidate.revision + 1,
                terminalEvidence: {
                  assignmentId: priorApiAssignment.assignmentId,
                  acceptedTurn: {
                    turnId: "turn-assignment-api",
                    runtimeAgentId: "agent-lead",
                    outcome: "completed" as const,
                    recordedAt: NOW,
                  },
                  capturedDelta: [],
                  ownershipViolations: [],
                  report: completedReport(),
                  handoffs: [],
                  capturedAt: NOW,
                },
              }
            : candidate,
        ),
      }),
    });
    let completionCalls = 0;
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: {
        completeMission: async (input) => {
          completionCalls += 1;
          const intentId = "finish-verification-replan";
          await missions.beginFinish({
            missionId: input.missionId,
            expectedRevision: input.expectedRevision,
            intent: {
              intentId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: "finish-verification-replan-fingerprint",
              completionEventId: "completion-verification-replan",
              kind: "completed",
              reason: "Replacement verification passed",
              stage: "requested",
              requestedAt: NOW,
              updatedAt: NOW,
            },
          });
          await missions.advanceFinish({
            missionId: input.missionId,
            intentId,
            from: "requested",
            to: "dispatch_stopped",
          });
          await missions.advanceFinish({
            missionId: input.missionId,
            intentId,
            from: "dispatch_stopped",
            to: "participants_archived",
          });
          await missions.prepareFinishEvidence({ missionId: input.missionId, intentId });
          return (await missions.finalize({ missionId: input.missionId, intentId })).mission;
        },
      },
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async (input) => ({
          kind: "accepted",
          turnId: `turn-${input.assignmentId}`,
        }),
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const running = await missions.get(mission.id);

    expect(running?.mission).toMatchObject({
      status: "verifying",
      workstreams: [
        expect.objectContaining({ workstreamId: "workstream-api", status: "accepted" }),
        expect.objectContaining({
          workstreamId: "workstream-final-verification",
          status: "active",
        }),
      ],
    });
    expect(
      running?.mission.assignments.find(
        (candidate) => candidate.assignmentId === replacementVerificationId,
      ),
    ).toMatchObject({
      semanticState: "running",
      acceptedTurnId: `turn-${replacementVerificationId}`,
    });

    const withReport = await missions.update({
      missionId: mission.id,
      expectedRevision: running!.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((candidate) =>
          candidate.assignmentId === replacementVerificationId
            ? {
                ...candidate,
                report: {
                  ...completedReport(),
                  verdict: "approved" as const,
                  summary: "Replacement verification approved",
                },
              }
            : candidate,
        ),
      }),
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: replacementVerificationId,
          turnId: `turn-${replacementVerificationId}`,
          runtimeAgentId: "agent-member",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    expect(withReport.mission.status).toBe("verifying");

    await scheduler.reconcileMission(mission.id);

    expect(completionCalls).toBe(1);
    expect((await missions.get(mission.id))?.mission).toMatchObject({
      status: "completed",
      completedAt: NOW,
      workstreams: [
        expect.objectContaining({ workstreamId: "workstream-api", status: "accepted" }),
        expect.objectContaining({
          workstreamId: "workstream-final-verification",
          status: "accepted",
        }),
      ],
    });
  });

  test("completes the Mission only after final verification has both success facts", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const apiWorkstream = { ...mission.workstreams[0]!, status: "accepted" as const };
    const verificationWorkstream: MissionWorkstream = {
      ...workstream({
        workstreamId: "workstream-final-verification",
        ownerMemberId: "member-app",
        dependencyWorkstreamIds: [apiWorkstream.workstreamId],
        mutableScope: { kind: "read_only" },
      }),
      kind: "verification",
      ownerMatchExplanation: matchExplanation("member-app"),
      status: "active",
    };
    const api = {
      ...mission.assignments[0]!,
      runtimeAgentId: "agent-lead",
      bindingEpoch: 1,
      workspaceBaseline: {
        baselineId: "baseline-assignment-api",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment-api",
        policyRevision: mission.workspaceAuditPolicy.revision,
        capturedAt: NOW,
        entries: [],
      },
      report: completedReport(),
      dispatchState: "settled" as const,
      semanticState: "completed" as const,
      acceptedTurnId: "turn-assignment-api",
      dispatchedAt: NOW,
      settledAt: NOW,
    };
    const verification: MissionAssignmentContract = {
      ...assignment(
        "assignment:mission-1:1:workstream-final-verification:verification",
        verificationWorkstream,
        "member-app",
        [api.assignmentId],
      ),
      kind: "verification",
      subjectAssignmentIds: [api.assignmentId],
      mutableScope: { kind: "read_only" },
      runtimeAgentId: "agent-member",
      bindingEpoch: 1,
      workspaceBaseline: {
        baselineId: "baseline-final-verification",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment:mission-1:1:workstream-final-verification:verification",
        policyRevision: mission.workspaceAuditPolicy.revision,
        capturedAt: NOW,
        entries: [],
      },
      report: { ...completedReport(), verdict: "approved", summary: "Quality gate passed" },
      dispatchState: "dispatched",
      semanticState: "running",
      acceptedTurnId: "turn-final-verification",
      dispatchedAt: NOW,
    };
    mission.status = "verifying";
    mission.workstreams = [apiWorkstream, verificationWorkstream];
    mission.assignments = [api, verification];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    const withFacts = await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
        {
          assignmentId: verification.assignmentId,
          turnId: "turn-final-verification",
          runtimeAgentId: "agent-member",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    await missions.update({
      missionId: mission.id,
      expectedRevision: withFacts.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((candidate) =>
          candidate.assignmentId === api.assignmentId
            ? {
                ...candidate,
                revision: candidate.revision + 1,
                terminalEvidence: {
                  assignmentId: api.assignmentId,
                  acceptedTurn: {
                    turnId: "turn-assignment-api",
                    runtimeAgentId: "agent-lead",
                    outcome: "completed" as const,
                    recordedAt: NOW,
                  },
                  capturedDelta: [],
                  ownershipViolations: [],
                  report: completedReport(),
                  handoffs: [],
                  capturedAt: NOW,
                },
              }
            : candidate,
        ),
      }),
    });
    const operations = new TeamOperationCoordinator();
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: {
        completeMission: (input) =>
          operations.serialize(mission.teamId, async () => {
            let finishing = await missions.beginFinish({
              missionId: input.missionId,
              expectedRevision: input.expectedRevision,
              intent: {
                intentId: "finish-mission-1",
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: "scheduler-completion-test",
                completionEventId: "event-mission-1-completed",
                kind: "completed",
                reason: "Final verification quality gate passed",
                stage: "requested",
                requestedAt: NOW,
                updatedAt: NOW,
              },
            });
            finishing = await missions.advanceFinish({
              missionId: input.missionId,
              intentId: "finish-mission-1",
              from: "requested",
              to: "dispatch_stopped",
            });
            finishing = await missions.advanceFinish({
              missionId: input.missionId,
              intentId: "finish-mission-1",
              from: "dispatch_stopped",
              to: "participants_archived",
            });
            finishing = await missions.prepareFinishEvidence({
              missionId: input.missionId,
              intentId: "finish-mission-1",
            });
            finishing = await missions.finalize({
              missionId: input.missionId,
              intentId: "finish-mission-1",
            });
            return finishing.mission;
          }),
      },
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("No new Assignment should be dispatched");
        },
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("No new Assignment should be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
      operations,
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(updated?.mission).toMatchObject({
      status: "completed",
      completedAt: NOW,
      workstreams: [
        expect.objectContaining({ workstreamId: "workstream-api", status: "accepted" }),
        expect.objectContaining({
          workstreamId: "workstream-final-verification",
          status: "accepted",
        }),
      ],
    });
  });

  test("suspends the Mission once when final verification requests changes", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const apiWorkstream = { ...mission.workstreams[0]!, status: "accepted" as const };
    const verificationWorkstream: MissionWorkstream = {
      ...workstream({
        workstreamId: "workstream-final-verification",
        ownerMemberId: "member-app",
        dependencyWorkstreamIds: [apiWorkstream.workstreamId],
        mutableScope: { kind: "read_only" },
      }),
      kind: "verification",
      ownerMatchExplanation: matchExplanation("member-app"),
      status: "active",
    };
    const apiReport = completedReport();
    const api = {
      ...mission.assignments[0]!,
      runtimeAgentId: "agent-lead",
      bindingEpoch: 1,
      workspaceBaseline: {
        baselineId: "baseline-assignment-api",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment-api",
        policyRevision: mission.workspaceAuditPolicy.revision,
        capturedAt: NOW,
        entries: [],
      },
      report: apiReport,
      dispatchState: "settled" as const,
      semanticState: "completed" as const,
      acceptedTurnId: "turn-assignment-api",
      dispatchedAt: NOW,
      settledAt: NOW,
    };
    const verification: MissionAssignmentContract = {
      ...assignment(
        "assignment:mission-1:1:workstream-final-verification:verification",
        verificationWorkstream,
        "member-app",
        [api.assignmentId],
      ),
      kind: "verification",
      subjectAssignmentIds: [api.assignmentId],
      mutableScope: { kind: "read_only" },
      runtimeAgentId: "agent-member",
      bindingEpoch: 1,
      scopeLease: {
        leaseId: "lease-final-verification",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment:mission-1:1:workstream-final-verification:verification",
        scope: { kind: "read_only" },
        state: "execution",
        acquiredAt: NOW,
        transitionedAt: null,
        capturedDelta: [],
        recoveryAttempts: 0,
      },
      workspaceBaseline: {
        baselineId: "baseline-final-verification",
        workspaceId: mission.workspaceId,
        assignmentId: "assignment:mission-1:1:workstream-final-verification:verification",
        policyRevision: mission.workspaceAuditPolicy.revision,
        capturedAt: NOW,
        entries: [],
      },
      report: {
        status: "completed",
        verdict: "changes_requested",
        summary: "Integration contract still needs an error-path test",
        artifactPaths: [],
        tests: [{ command: "npm test", passed: false }],
        decisions: [],
        handoffs: [],
      },
      dispatchState: "dispatched",
      semanticState: "running",
      acceptedTurnId: "turn-final-verification",
      dispatchedAt: NOW,
    };
    mission.status = "verifying";
    mission.workstreams = [apiWorkstream, verificationWorkstream];
    mission.assignments = [api, verification];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-verification-changes-requested",
      requestFingerprint: "start-verification-changes-requested-fingerprint",
    });
    const withFacts = await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
        {
          assignmentId: verification.assignmentId,
          turnId: "turn-final-verification",
          runtimeAgentId: "agent-member",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    await missions.update({
      missionId: mission.id,
      expectedRevision: withFacts.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((candidate) =>
          candidate.assignmentId === api.assignmentId
            ? {
                ...candidate,
                revision: candidate.revision + 1,
                terminalEvidence: {
                  assignmentId: api.assignmentId,
                  acceptedTurn: {
                    turnId: "turn-assignment-api",
                    runtimeAgentId: "agent-lead",
                    outcome: "completed" as const,
                    recordedAt: NOW,
                  },
                  capturedDelta: [],
                  ownershipViolations: [],
                  report: apiReport,
                  handoffs: [],
                  capturedAt: NOW,
                },
              }
            : candidate,
        ),
      }),
    });
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("No new Assignment should be dispatched");
        },
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("No new Assignment should be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    const firstReconcile = await scheduler.reconcileMission(mission.id);
    const secondReconcile = await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(firstReconcile.createdRecipientAttentionDeliveryIds).toEqual([
      `${mission.id}:${verification.assignmentId}:requires-replan:lead`,
    ]);
    expect(secondReconcile.createdRecipientAttentionDeliveryIds).toEqual([]);
    expect(updated?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "verifying",
      workstreams: [
        expect.objectContaining({ workstreamId: "workstream-api", status: "accepted" }),
        expect.objectContaining({
          workstreamId: "workstream-final-verification",
          status: "blocked",
        }),
      ],
      attentionItems: [
        expect.objectContaining({
          attentionId: `${mission.id}:${verification.assignmentId}:requires-replan`,
          kind: "assignment_requires_replan",
          status: "open",
          assignmentId: verification.assignmentId,
          summary: `Verification Assignment ${verification.assignmentId} requested changes: Integration contract still needs an error-path test`,
        }),
      ],
    });
    expect(
      updated?.mission.assignments.find(
        (candidate) => candidate.assignmentId === verification.assignmentId,
      ),
    ).toMatchObject({
      semanticState: "failed",
      report: { status: "completed", verdict: "changes_requested" },
    });
    expect(updated?.recipientAttentionOutbox).toEqual([
      expect.objectContaining({
        deliveryId: `${mission.id}:${verification.assignmentId}:requires-replan:lead`,
        idempotencyKey: `${mission.id}:${verification.assignmentId}:requires-replan`,
        recipientMemberId: "member-lead",
        state: "pending",
      }),
    ]);
  });

  test("holds a completed Assignment scope until its missing report arrives", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease: {
          leaseId: "lease-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          scope: api.mutableScope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        },
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
    ];
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const beforeInterval = await missions.get(mission.id);
    if (!beforeInterval) throw new Error("Mission disappeared");
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: beforeInterval.storageRevision,
      update: (state) => ({
        ...state,
        ownershipIntervals: [
          {
            intervalId: "lease-assignment-api",
            workspaceId: mission.workspaceId,
            assignmentId: api.assignmentId,
            scope: api.mutableScope,
            startedAt: NOW,
            state: "open",
            endedAt: null,
            closure: null,
          },
        ],
      }),
    });
    const released: string[] = [];
    const reportHolds: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold: async (input) => {
          reportHolds.push(input.lease.leaseId);
          return {
            ...input.lease,
            state: "report_hold",
            transitionedAt: input.transitionedAt,
            capturedDelta: input.capturedDelta,
          };
        },
        release: async (lease) => {
          released.push(lease.leaseId);
        },
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("No Assignment should be dispatched");
        },
        captureDelta: async () => ({
          capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
          violations: [],
        }),
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("No Assignment should be dispatched");
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const held = await missions.get(mission.id);

    expect(held?.mission.assignments[0]).toMatchObject({
      assignmentId: api.assignmentId,
      dispatchState: "settled",
      semanticState: "needs_report",
      scopeLease: {
        leaseId: "lease-assignment-api",
        state: "report_hold",
        transitionedAt: NOW,
        capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
        recoveryAttempts: 0,
      },
      settledAt: NOW,
    });
    expect(held?.mission.workstreams[0]?.status).toBe("active");
    expect(held?.ownershipIntervals).toEqual([
      expect.objectContaining({ assignmentId: api.assignmentId, state: "open" }),
    ]);
    expect(held?.assignmentReportRecoveryOutbox).toEqual([
      {
        deliveryId: "mission-1:assignment-api:report-recovery:1",
        assignmentId: "assignment-api",
        agentId: "agent-lead",
        bindingEpoch: 1,
        attempt: 1,
        messageId: "team-mission:mission-1:assignment:assignment-api:report-recovery:1",
        dispatchAttempts: 1,
        lastFailureKind: "busy",
        lastFailureReason: "Agent is busy",
        state: "pending",
        turnId: null,
        createdAt: NOW,
        nextEligibleAt: "2026-08-08T12:00:05.000Z",
        dispatchedAt: null,
        settledAt: null,
      },
    ]);
    expect(reportHolds).toEqual(["lease-assignment-api"]);
    expect(released).toEqual([]);
  });

  test("frees the Member slot while a completed Assignment waits for its report", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    const app = mission.assignments[1]!;
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease: {
          leaseId: "lease-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          scope: api.mutableScope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        },
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
      },
      { ...app, assigneeMemberId: "member-lead" },
    ];
    mission.workstreams = [
      { ...mission.workstreams[0]!, status: "active" },
      {
        ...mission.workstreams[1]!,
        ownerMemberId: "member-lead",
        ownerMatchExplanation: matchExplanation("member-lead"),
      },
    ];
    await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: api.assignmentId,
          turnId: "turn-assignment-api",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const dispatched: string[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async (input) => ({
          leaseId: `lease-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          scope: input.scope,
          state: "execution",
          acquiredAt: NOW,
          transitionedAt: null,
          capturedDelta: [],
          recoveryAttempts: 0,
        }),
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async (input) => ({
          baselineId: `baseline-${input.assignmentId}`,
          workspaceId: input.workspaceId,
          assignmentId: input.assignmentId,
          policyRevision: input.policy.revision,
          capturedAt: NOW,
          entries: [],
        }),
        captureDelta: async () => ({ capturedDelta: [], violations: [] }),
      },
      dispatch: {
        dispatch: async (input) => {
          dispatched.push(input.assignmentId);
          return { kind: "accepted", turnId: `turn-${input.assignmentId}` };
        },
        requestReport: requestReportBusy,
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(dispatched).toEqual(["assignment-app"]);
    expect(updated?.mission.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-api",
          semanticState: "needs_report",
        }),
        expect.objectContaining({
          assignmentId: "assignment-app",
          semanticState: "running",
        }),
      ]),
    );
  });

  test("dispatches a durable report recovery without replaying the original Assignment", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = activeMission();
    const api = mission.assignments[0]!;
    mission.assignments = [
      {
        ...api,
        runtimeAgentId: "agent-lead",
        bindingEpoch: 1,
        scopeLease: {
          leaseId: "lease-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          scope: api.mutableScope,
          state: "report_hold",
          acquiredAt: NOW,
          transitionedAt: NOW,
          capturedDelta: [],
          recoveryAttempts: 0,
        },
        workspaceBaseline: {
          baselineId: "baseline-assignment-api",
          workspaceId: mission.workspaceId,
          assignmentId: api.assignmentId,
          policyRevision: mission.workspaceAuditPolicy.revision,
          capturedAt: NOW,
          entries: [],
        },
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-assignment-api",
        dispatchedAt: NOW,
        settledAt: NOW,
      },
    ];
    mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [
          {
            deliveryId: "mission-1:assignment-api:report-recovery:1",
            assignmentId: "assignment-api",
            agentId: "agent-lead",
            bindingEpoch: 1,
            attempt: 1,
            messageId: "team-mission:mission-1:assignment:assignment-api:report-recovery:1",
            dispatchAttempts: 0,
            lastFailureKind: null,
            lastFailureReason: null,
            state: "pending",
            turnId: null,
            createdAt: NOW,
            nextEligibleAt: NOW,
            dispatchedAt: null,
            settledAt: null,
          },
        ],
      }),
    });
    const recoveryRequests: Array<{ assignmentId: string; messageId: string; attempt: number }> =
      [];
    const synchronizedAttempts: number[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold: async (input) => {
          synchronizedAttempts.push(input.lease.recoveryAttempts);
          return transitionToReportHold(input);
        },
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture a second delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async (input) => {
          recoveryRequests.push(input);
          return { kind: "accepted", turnId: "turn-report-recovery-1" };
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(recoveryRequests).toEqual([
      {
        teamId: "team-1",
        missionId: "mission-1",
        assignmentId: "assignment-api",
        agentId: "agent-lead",
        bindingEpoch: 1,
        attempt: 1,
        messageId: "team-mission:mission-1:assignment:assignment-api:report-recovery:1",
      },
    ]);
    expect(updated?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-api",
        attempt: 1,
        state: "dispatched",
        turnId: "turn-report-recovery-1",
        dispatchedAt: NOW,
      }),
    ]);
    expect(updated?.mission.assignments[0]?.scopeLease?.recoveryAttempts).toBe(1);
    expect(synchronizedAttempts).toEqual([0, 1]);
  });

  test("bounds unavailable provider retries for each report recovery turn", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(0);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-report-provider-retry",
      requestFingerprint: "start-report-provider-retry-fingerprint",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [pendingReportRecovery(1)],
      }),
    });
    let currentTime = NOW;
    let requests = 0;
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async () => {
          requests += 1;
          return { kind: "provider_unavailable", reason: "Provider is offline" };
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => currentTime },
    });

    await scheduler.reconcileMission(mission.id);
    expect((await missions.get(mission.id))?.assignmentReportRecoveryOutbox[0]).toMatchObject({
      state: "pending",
      dispatchAttempts: 1,
      nextEligibleAt: "2026-08-08T12:00:05.000Z",
      lastFailureKind: "provider_unavailable",
    });
    currentTime = "2026-08-08T12:00:05.000Z";
    await scheduler.reconcileMission(mission.id);
    currentTime = "2026-08-08T12:00:15.000Z";
    await scheduler.reconcileMission(mission.id);

    expect(requests).toBe(3);
    expect((await missions.get(mission.id))?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({ attempt: 1, state: "failed", settledAt: currentTime }),
      expect.objectContaining({ attempt: 2, state: "pending", dispatchAttempts: 0 }),
    ]);

    await scheduler.reconcileMission(mission.id);
    currentTime = "2026-08-08T12:00:20.000Z";
    await scheduler.reconcileMission(mission.id);
    currentTime = "2026-08-08T12:00:30.000Z";
    await scheduler.reconcileMission(mission.id);
    const exhausted = await missions.get(mission.id);

    expect(requests).toBe(6);
    expect(exhausted?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({ attempt: 1, state: "failed" }),
      expect.objectContaining({ attempt: 2, state: "failed", dispatchAttempts: 3 }),
    ]);
    expect(exhausted?.mission).toMatchObject({
      status: "needs_attention",
      attentionItems: [
        expect.objectContaining({
          kind: "missing_report",
          assignmentId: "assignment-api",
          status: "open",
        }),
      ],
    });
  });

  test("defers a busy report recovery without consuming an accepted recovery turn", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(0);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-busy-report-recovery",
      requestFingerprint: "start-busy-report-recovery-fingerprint",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [pendingReportRecovery(1)],
      }),
    });
    let currentTime = NOW;
    let requests = 0;
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async () => {
          requests += 1;
          return { kind: "busy" };
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => currentTime },
    });

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await scheduler.reconcileMission(mission.id);
      currentTime = new Date(Date.parse(currentTime) + 10 * 60_000).toISOString();
    }
    const deferred = await missions.get(mission.id);

    expect(requests).toBe(7);
    expect(deferred?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({
        attempt: 1,
        state: "pending",
        lastFailureKind: "busy",
      }),
    ]);
    expect(deferred?.mission.assignments[0]?.scopeLease?.recoveryAttempts).toBe(0);
    expect(deferred?.mission.attentionItems).toEqual([]);
  });

  test("consumes each report recovery whose provider acceptance is unknown exactly once", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(0);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-report-acceptance-unknown",
      requestFingerprint: "start-report-acceptance-unknown-fingerprint",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [pendingReportRecovery(1)],
      }),
    });
    const requestedAttempts: number[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async (input) => {
          requestedAttempts.push(input.attempt);
          return {
            kind: "acceptance_unknown",
            reason: `Recovery ${input.attempt} may have been accepted`,
          };
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    await scheduler.reconcileMission(mission.id);
    await scheduler.reconcileMission(mission.id);
    const exhausted = await missions.get(mission.id);

    expect(requestedAttempts).toEqual([1, 2]);
    expect(exhausted?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({
        attempt: 1,
        state: "failed",
        dispatchAttempts: 1,
        lastFailureKind: "acceptance_unknown",
      }),
      expect.objectContaining({
        attempt: 2,
        state: "failed",
        dispatchAttempts: 1,
        lastFailureKind: "acceptance_unknown",
      }),
    ]);
    expect(exhausted?.mission.assignments[0]?.scopeLease?.recoveryAttempts).toBe(0);
    expect(exhausted?.mission).toMatchObject({
      status: "needs_attention",
      attentionItems: [
        expect.objectContaining({
          kind: "missing_report",
          assignmentId: "assignment-api",
          status: "open",
        }),
      ],
    });
  });

  test("starts the second recovery turn after the first settles without a report", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(1);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [dispatchedReportRecovery(1, "turn-report-recovery-1")],
      }),
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: "assignment-api",
          turnId: "turn-report-recovery-1",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const recoveryAttempts: number[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture a second delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async (input) => {
          recoveryAttempts.push(input.attempt);
          return { kind: "accepted", turnId: "turn-report-recovery-2" };
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(recoveryAttempts).toEqual([2]);
    expect(updated?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({ attempt: 1, state: "settled", settledAt: NOW }),
      expect.objectContaining({
        attempt: 2,
        state: "dispatched",
        turnId: "turn-report-recovery-2",
        dispatchedAt: NOW,
      }),
    ]);
    expect(updated?.mission.assignments[0]?.scopeLease?.recoveryAttempts).toBe(2);
  });

  test("recovers a report-recovery turn that settled before its outbox mapping was durable", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(1);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-fast-report-recovery",
      requestFingerprint: "start-fast-report-recovery-fingerprint",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [dispatchedReportRecovery(1, "turn-fast-report-recovery")],
      }),
    });
    const readTurnIds: string[][] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: {
        read: async (turns) => {
          readTurnIds.push(turns.map((turn) => turn.turnId));
          return turns.some((turn) => turn.turnId === "turn-fast-report-recovery")
            ? new Map([
                [
                  "turn-fast-report-recovery",
                  {
                    assignmentId: "assignment-api",
                    turnId: "turn-fast-report-recovery",
                    runtimeAgentId: "agent-lead",
                    outcome: "completed" as const,
                  },
                ],
              ])
            : new Map();
        },
      },
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture a second delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async (input) => ({
          kind: "accepted",
          turnId: `turn-report-recovery-${input.attempt}`,
        }),
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(readTurnIds.flat()).toContain("turn-fast-report-recovery");
    expect(updated?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({ attempt: 1, state: "settled", settledAt: NOW }),
      expect.objectContaining({ attempt: 2, state: "dispatched" }),
    ]);
  });

  test("advances a report recovery whose accepted turn is unknown after restart", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(1);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-unknown-report-recovery",
      requestFingerprint: "start-unknown-report-recovery-fingerprint",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [
          dispatchedReportRecovery(1, "turn-unknown-report-recovery"),
        ],
      }),
    });
    const recoveryRequests: number[] = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: {
        read: async (turns) =>
          new Map(
            turns.map((turn) => [
              turn.turnId,
              {
                assignmentId: turn.assignmentId,
                turnId: turn.turnId,
                runtimeAgentId: turn.runtimeAgentId,
                outcome:
                  turn.turnId === "turn-unknown-report-recovery"
                    ? ("unknown" as const)
                    : ("running" as const),
              },
            ]),
          ),
      },
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async (input) => {
          recoveryRequests.push(input.attempt);
          return { kind: "accepted", turnId: "turn-report-recovery-2" };
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(recoveryRequests).toEqual([2]);
    expect(updated?.acceptedTurnFacts).toEqual([
      {
        assignmentId: "assignment-api",
        turnId: "turn-unknown-report-recovery",
        runtimeAgentId: "agent-lead",
        outcome: "unknown",
        recordedAt: NOW,
      },
    ]);
    expect(updated?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({
        attempt: 1,
        state: "settled",
        turnId: "turn-unknown-report-recovery",
        settledAt: NOW,
      }),
      expect.objectContaining({
        attempt: 2,
        state: "dispatched",
        turnId: "turn-report-recovery-2",
      }),
    ]);
  });

  test("opens durable attention after two recovery turns finish without a report", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(2);
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [
          settledReportRecovery(1, "turn-report-recovery-1"),
          dispatchedReportRecovery(2, "turn-report-recovery-2"),
        ],
      }),
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: "assignment-api",
          turnId: "turn-report-recovery-2",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        captureDelta: async () => {
          throw new Error("A settled Assignment must not capture a second delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("The original Assignment must not be replayed");
        },
        requestReport: async () => {
          throw new Error("A third report recovery must not be dispatched");
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(updated?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      attentionItems: [
        {
          attentionId: "mission-1:assignment-api:missing-report",
          kind: "missing_report",
          status: "open",
          priorMissionStatus: "active",
          assignmentId: "assignment-api",
          pathEvidence: [],
          createdAt: NOW,
          resolution: null,
        },
      ],
    });
    expect(updated?.assignmentReportRecoveryOutbox).toHaveLength(2);
    expect(updated?.assignmentReportRecoveryOutbox[1]).toMatchObject({
      attempt: 2,
      state: "settled",
      settledAt: NOW,
    });
  });

  test("releases a report hold after a late report survives a daemon restart", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(0);
    mission.assignments = mission.assignments.map((candidate) => ({
      ...candidate,
      report: completedReport(),
      semanticState: "completed" as const,
      scopeLease: null,
    }));
    mission.workstreams = mission.workstreams.map((stream) => ({
      ...stream,
      status: "accepted" as const,
    }));
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [pendingReportRecovery(1)],
      }),
    });
    const releasedAssignments: Array<{ workspaceId: string; assignmentId: string }> = [];
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: async (input) => {
          releasedAssignments.push(input);
        },
        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("A completed Assignment must not be dispatched");
        },
        captureDelta: async () => {
          throw new Error("A completed Assignment must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("A completed Assignment must not be dispatched");
        },
        requestReport: async () => {
          throw new Error("A recorded report must cancel pending recovery");
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(releasedAssignments).toEqual([
      { workspaceId: "workspace-1", assignmentId: "assignment-api" },
    ]);
    expect(updated?.assignmentReportRecoveryOutbox).toEqual([]);
  });

  test("settles an in-flight report recovery without a successor after a late report", async () => {
    const missions = new MissionStore({
      directory: join(rootDirectory, "missions"),
      logger: createTestLogger(),
      now: () => NOW,
    });
    const mission = missionWaitingForReport(1);
    mission.assignments = mission.assignments.map((candidate) => ({
      ...candidate,
      report: completedReport(),
      semanticState: "completed" as const,
      scopeLease: null,
    }));
    mission.workstreams = mission.workstreams.map((stream) => ({
      ...stream,
      status: "accepted" as const,
    }));
    const created = await missions.createIfAbsent({
      mission,
      idempotencyKey: "start-1",
      requestFingerprint: "start-fingerprint-1",
    });
    await missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: created.storageRevision,
      update: (state) => ({
        ...state,
        assignmentReportRecoveryOutbox: [dispatchedReportRecovery(1, "turn-report-recovery-1")],
      }),
    });
    await missions.recordAcceptedTurnFacts({
      missionId: mission.id,
      facts: [
        {
          assignmentId: "assignment-api",
          turnId: "turn-report-recovery-1",
          runtimeAgentId: "agent-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    const scheduler = new TeamMissionScheduler({
      missions,
      turnFacts: noDurableTurnFacts,
      lifecycle: lifecycleMustNotComplete,
      participants: { ensureParticipant: async () => undefined },
      leases: {
        acquire: async () => null,
        transitionToReportHold,
        release: async () => undefined,
        releaseAssignment: releaseAssignmentNoop,

        releaseMission: releaseMissionNoop,
      },
      workspace: {
        captureBaseline: async () => {
          throw new Error("A completed Assignment must not be dispatched");
        },
        captureDelta: async () => {
          throw new Error("A completed Assignment must not capture another delta");
        },
      },
      dispatch: {
        dispatch: async () => {
          throw new Error("A completed Assignment must not be dispatched");
        },
        requestReport: async () => {
          throw new Error("A late report must stop report recovery");
        },
      },
      events: { publishMission: async () => undefined },
      clock: { now: () => NOW },
    });

    await scheduler.reconcileMission(mission.id);
    const updated = await missions.get(mission.id);

    expect(updated?.assignmentReportRecoveryOutbox).toEqual([
      expect.objectContaining({ attempt: 1, state: "settled", settledAt: NOW }),
    ]);
    expect(updated?.mission.attentionItems).toEqual([]);
  });
});

function activeMission(): TeamMission {
  const api = workstream({
    workstreamId: "workstream-api",
    ownerMemberId: "member-lead",
    mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
  });
  const app = workstream({
    workstreamId: "workstream-app",
    ownerMemberId: "member-app",
    mutableScope: { kind: "paths", pathPrefixes: ["packages/app"] },
  });
  const integration = workstream({
    workstreamId: "workstream-integration",
    ownerMemberId: "member-lead",
    dependencyWorkstreamIds: [api.workstreamId, app.workstreamId],
    mutableScope: { kind: "read_only" },
  });
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Ship the feature",
    constraints: [],
    acceptanceCriteria: ["All checks pass"],
    status: "active",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        teamRevision: 1,
        leadMemberId: "member-lead",
        reason: "initial",
        skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
        members: [
          rosterMember("member-lead", "Lead", "lead"),
          rosterMember("member-app", "App engineer", "app"),
        ],
        createdAt: NOW,
      },
    ],
    planRevision: 1,
    revision: 0,
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    },
    chatRoomId: "room-1",
    participants: [
      {
        memberId: "member-lead",
        agentId: "agent-lead",
        bindingEpoch: 1,
        joinedAt: NOW,
        archivedAt: null,
      },
      {
        memberId: "member-app",
        agentId: "agent-member",
        bindingEpoch: 1,
        joinedAt: NOW,
        archivedAt: null,
      },
    ],
    workstreams: [api, app, integration],
    workstreamPlanSnapshots: [],
    assignments: [
      assignment("assignment-api", api, "member-lead", []),
      assignment("assignment-app", app, "member-app", []),
      assignment("assignment-integration", integration, "member-lead", [
        "assignment-api",
        "assignment-app",
      ]),
    ],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function rosterMember(memberId: string, role: string, mentionHandle: string) {
  return {
    memberId,
    role,
    level: 5 as const,
    skillIds: ["typescript"],
    executionProfile: {
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      modeId: "auto",
      thinkingOptionId: "high",
      featureValues: {},
    },
    mentionHandle,
    runtimeSnapshot: {
      providerAvailable: true,
      toolIds: ["mission_status", "assignment_report"],
      capabilityIds: ["structured-tools"],
    },
  };
}

function workstream(input: {
  workstreamId: string;
  ownerMemberId: string;
  mutableScope: MissionMutableScope;
  dependencyWorkstreamIds?: string[];
}): MissionWorkstream {
  return {
    workstreamId: input.workstreamId,
    kind: "delivery",
    title: input.workstreamId,
    objective: input.workstreamId,
    deliverables: [`${input.workstreamId} deliverable`],
    acceptanceCriteria: [`${input.workstreamId} passes`],
    requiredSkillIds: ["typescript"],
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: ["structured-tools"],
    minimumLevel: 3,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    dependencyWorkstreamIds: input.dependencyWorkstreamIds ?? [],
    mutableScope: input.mutableScope,
    ownerMemberId: input.ownerMemberId,
    ownerMatchExplanation: matchExplanation(input.ownerMemberId),
    ownerOverrideReason: null,
    reviewPolicy: "none",
    reviewerRequirements: null,
    reviewerMemberId: null,
    reviewerMatchExplanation: null,
    reviewerOverrideReason: null,
    status: "ready",
  };
}

function assignment(
  assignmentId: string,
  stream: MissionWorkstream,
  assigneeMemberId: string,
  dependencyAssignmentIds: string[],
): MissionAssignmentContract {
  return {
    assignmentId,
    revision: 1,
    kind: "delivery",
    subjectAssignmentIds: [],
    missionId: "mission-1",
    workstreamId: stream.workstreamId,
    assigneeMemberId,
    runtimeAgentId: null,
    bindingEpoch: null,
    objective: stream.objective,
    inputRefs: [],
    deliverables: stream.deliverables,
    acceptanceCriteria: stream.acceptanceCriteria,
    mutableScope: stream.mutableScope,
    dependencyAssignmentIds,
    priority: 10,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "queued",
    semanticState: "planned",
    attempt: 1,
    acceptedTurnId: null,
    createdAt: NOW,
    dispatchedAt: null,
    settledAt: null,
  };
}

function matchExplanation(memberId: string): MissionMemberMatchExplanation {
  return {
    recommendedMemberId: memberId,
    requiredSkillIds: ["typescript"],
    preferredSkillIds: [],
    matchedPreferredSkillIds: [],
    requiredRuntimeCapabilityIds: ["structured-tools"],
    minimumLevel: 3,
    selectedLevel: 5,
    eligibleMemberIds: [memberId],
    excludedMemberIds: [],
    previousMemberId: null,
    candidateOpenAssignments: [{ memberId, openAssignments: 0 }],
    continuedPreviousMember: false,
    openAssignments: 0,
    rosterIndex: memberId === "member-lead" ? 0 : 1,
  };
}

function completedReport() {
  return {
    status: "completed" as const,
    verdict: null,
    summary: "Implemented the API",
    artifactPaths: ["packages/server/src/parser.ts"],
    tests: [{ command: "npm test parser", passed: true }],
    decisions: [],
    handoffs: [],
  };
}

function missionWaitingForReport(recoveryAttempts: number): TeamMission {
  const mission = activeMission();
  const api = mission.assignments[0]!;
  mission.assignments = [
    {
      ...api,
      runtimeAgentId: "agent-lead",
      bindingEpoch: 1,
      scopeLease: {
        leaseId: "lease-assignment-api",
        workspaceId: mission.workspaceId,
        assignmentId: api.assignmentId,
        scope: api.mutableScope,
        state: "report_hold",
        acquiredAt: NOW,
        transitionedAt: NOW,
        capturedDelta: [],
        recoveryAttempts,
      },
      workspaceBaseline: {
        baselineId: "baseline-assignment-api",
        workspaceId: mission.workspaceId,
        assignmentId: api.assignmentId,
        policyRevision: mission.workspaceAuditPolicy.revision,
        capturedAt: NOW,
        entries: [],
      },
      dispatchState: "settled",
      semanticState: "needs_report",
      acceptedTurnId: "turn-assignment-api",
      dispatchedAt: NOW,
      settledAt: NOW,
    },
  ];
  mission.workstreams = [{ ...mission.workstreams[0]!, status: "active" }];
  return mission;
}

function dispatchedReportRecovery(attempt: 1 | 2, turnId: string) {
  return {
    deliveryId: `mission-1:assignment-api:report-recovery:${attempt}`,
    assignmentId: "assignment-api",
    agentId: "agent-lead",
    bindingEpoch: 1,
    attempt,
    messageId: `team-mission:mission-1:assignment:assignment-api:report-recovery:${attempt}`,
    dispatchAttempts: 0,
    lastFailureKind: null,
    lastFailureReason: null,
    state: "dispatched" as const,
    turnId,
    createdAt: NOW,
    nextEligibleAt: null,
    dispatchedAt: NOW,
    settledAt: null,
  };
}

function pendingReportRecovery(attempt: 1 | 2) {
  return {
    ...dispatchedReportRecovery(attempt, `unused-report-recovery-${attempt}`),
    state: "pending" as const,
    turnId: null,
    nextEligibleAt: NOW,
    dispatchedAt: null,
    settledAt: null,
  };
}

function settledReportRecovery(attempt: 1 | 2, turnId: string) {
  return {
    ...dispatchedReportRecovery(attempt, turnId),
    state: "settled" as const,
    settledAt: NOW,
  };
}

const transitionToReportHold: TeamWorkspaceLeasePort["transitionToReportHold"] = async (input) => ({
  ...input.lease,
  state: "report_hold",
  transitionedAt: input.transitionedAt,
  capturedDelta: input.capturedDelta,
});

const requestReportBusy: TeamAssignmentDispatchPort["requestReport"] = async () => ({
  kind: "busy",
});

const releaseAssignmentNoop: TeamWorkspaceLeasePort["releaseAssignment"] = async () => undefined;
const releaseMissionNoop: TeamWorkspaceLeasePort["releaseMission"] = async () => undefined;
