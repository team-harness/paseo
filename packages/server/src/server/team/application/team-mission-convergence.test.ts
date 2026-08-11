import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TeamProfileMemberInput } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type {
  MissionAssignmentContract,
  MissionScopeLease,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AcceptedTurnFact } from "../domain/assignment-contract-validation.js";
import { MissionStore } from "../persistence/mission-store.js";
import { TeamProfileStore } from "../persistence/profile-store.js";
import { TeamPersistenceReconciler } from "../persistence/reconciliation.js";
import { WorkspaceScopeLeaseStore } from "../persistence/workspace-scope-lease-store.js";
import type {
  ProviderCapabilityResolver,
  TeamAcceptedTurnFactsPort,
  TeamMemberHistoryPort,
  TeamMessagePort,
  TeamParticipantPort,
  TeamRecipientAttentionPort,
  TeamRoomPort,
  TeamTerminalTurnFact,
} from "./ports.js";
import { TeamCollaborationService } from "./team-collaboration-service.js";
import {
  TeamMissionScheduler,
  type TeamAssignmentDispatchPort,
  type TeamWorkspaceLeasePort,
  type TeamWorkspaceSnapshotPort,
} from "./team-mission-scheduler.js";
import { TeamMissionService } from "./team-mission-service.js";
import {
  TeamOperationCoordinator,
  type TeamOperationPermit,
} from "./team-operation-coordinator.js";

const START_TIME = "2026-08-08T12:00:00.000Z";

describe("Team Mission seeded convergence", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-mission-convergence-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("converges across provider retry, report/turn ordering, and scheduler restarts", async () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      await runConvergenceSeed(rootDirectory, seed);
    }
  }, 15_000);

  test("converges two Teams sharing a workspace after lease contention and store reconstruction", async () => {
    const directory = join(rootDirectory, "shared-workspace");
    const first = createConvergenceFixture(directory, 101);
    const second = createConvergenceFixture(directory, 202);
    const firstMission = await createSeedMission(first, 101, "workspace-shared");
    const secondMission = await createSeedMission(second, 202, "workspace-shared");
    first.setProviderFailures(0);
    second.setProviderFailures(0);

    await reconcileUntilAssignmentAccepted(first, firstMission.id);
    await second.reconcile(secondMission.id);

    expect(first.acceptedSideEffects.size).toBe(1);
    expect(second.acceptedSideEffects.size).toBe(0);

    first.restartScheduler();
    expect((await first.missions.get(firstMission.id))?.mission.status).toBe("active");
    expect(first.activeLeaseCount).toBe(1);

    await second.reconcile(secondMission.id);
    expect(second.acceptedSideEffects.size).toBe(0);

    second.restartScheduler();
    await driveSeedToTerminal(first, firstMission, 1);
    expect((await first.missions.get(firstMission.id))?.mission.status).toBe("completed");

    await reconcileUntilAssignmentAccepted(second, secondMission.id);
    expect(second.acceptedSideEffects.size).toBe(1);
    await driveSeedToTerminal(second, secondMission, 2);

    await assertSeedConverged(first, firstMission.id, 1);
    await assertSeedConverged(second, secondMission.id, 2);
    expect(first.acceptedSideEffects.size + second.acceptedSideEffects.size).toBe(4);
  });

  test("returns an accepted blocked Assignment to Lead replanning without dispatching dependencies", async () => {
    const fixture = createConvergenceFixture(join(rootDirectory, "blocked-report"), 303);
    const mission = await createSeedMission(fixture, 303);
    fixture.setProviderFailures(0);

    await reconcileUntilAssignmentAccepted(fixture, mission.id);
    const running = (await fixture.missions.get(mission.id))?.mission.assignments.find(
      (assignment) => assignment.semanticState === "running",
    );
    if (!running) throw new Error("The delivery Assignment was not dispatched");

    await fixture.reportBlocked(mission.id, running.assignmentId);
    await fixture.settleTurn(mission.id, running.assignmentId);

    await vi.waitFor(async () => {
      expect((await fixture.missions.get(mission.id))?.mission.status).toBe("needs_attention");
      expect(fixture.recipientAttentionAttempts).toHaveLength(1);
    });
    await fixture.reconcile(mission.id);
    await fixture.collaboration.reconcilePendingMessages();

    const blocked = await fixture.missions.get(mission.id);
    expect(blocked?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      workstreams: [
        expect.objectContaining({ workstreamId: "parser", status: "blocked" }),
        expect.objectContaining({ workstreamId: "final-verification", status: "planned" }),
      ],
      assignments: [
        expect.objectContaining({
          assignmentId: running.assignmentId,
          dispatchState: "settled",
          semanticState: "blocked",
        }),
      ],
      attentionItems: [
        expect.objectContaining({
          kind: "assignment_requires_replan",
          status: "open",
          assignmentId: running.assignmentId,
        }),
      ],
    });
    expect(blocked?.recipientAttentionOutbox).toEqual([
      expect.objectContaining({
        deliveryId: `${mission.id}:plan:1:assignment-coverage:lead`,
        state: "canceled",
        cancelReason: "attention_resolved",
      }),
      expect.objectContaining({
        state: "notified",
        recipientMemberId: blocked.mission.rosterSnapshots[0]?.leadMemberId,
      }),
    ]);
    expect(fixture.recipientAttentionAttempts).toEqual([
      expect.objectContaining({ missionId: mission.id, attempt: 1 }),
    ]);
    expect(fixture.acceptedSideEffects.size).toBe(1);

    if (!blocked) throw new Error("The blocked Mission disappeared");
    await fixture.collaboration.planMission({
      callerAgentId: blocked.mission.participants[0]!.agentId,
      missionId: mission.id,
      expectedRevision: blocked.mission.revision,
      expectedPlanRevision: blocked.mission.planRevision,
      workstreams: missionPlan(false),
      replacementAssignments: [parserAssignmentDraft("parser-recovery", running.assignmentId)],
    });
    const replanned = await fixture.missions.get(mission.id);
    expect(replanned?.mission).toMatchObject({
      status: "active",
      suspendedStatus: null,
      attentionItems: [
        expect.objectContaining({
          kind: "assignment_requires_replan",
          status: "resolved",
          resolution: expect.objectContaining({ kind: "replan" }),
        }),
      ],
    });
    expect(replanned?.recipientAttentionOutbox).toEqual([
      expect.objectContaining({
        deliveryId: `${mission.id}:plan:1:assignment-coverage:lead`,
        state: "canceled",
        cancelReason: "attention_resolved",
      }),
      expect.objectContaining({
        deliveryId: `${mission.id}:${running.assignmentId}:requires-replan:lead`,
        state: "canceled",
        cancelReason: "attention_resolved",
      }),
    ]);
    expect(fixture.acceptedSideEffects.size).toBe(2);
  });

  test("replans a rejected final verification with delivery-only input and completes regenerated quality gates", async () => {
    const fixture = createConvergenceFixture(join(rootDirectory, "verification-replan"), 404);
    fixture.setProviderFailures(0);
    const mission = await createSeedMission(fixture, 404, "workspace-verification-replan", true);

    const originalDelivery = await reconcileUntilRunningAssignment(
      fixture,
      mission.id,
      (assignment) => assignment.planRevision === 1 && assignment.kind === "delivery",
    );
    await completeRunningAssignment(fixture, mission.id, originalDelivery);

    const originalReview = await reconcileUntilRunningAssignment(
      fixture,
      mission.id,
      (assignment) => assignment.planRevision === 1 && assignment.kind === "review",
    );
    expect(originalReview.assigneeMemberId).not.toBe(originalDelivery.assigneeMemberId);
    await completeRunningAssignment(fixture, mission.id, originalReview);

    const originalVerification = await reconcileUntilRunningAssignment(
      fixture,
      mission.id,
      (assignment) => assignment.planRevision === 1 && assignment.kind === "verification",
    );
    await fixture.reportChangesRequested(mission.id, originalVerification.assignmentId);
    await fixture.settleTurn(mission.id, originalVerification.assignmentId);
    await fixture.reconcile(mission.id);

    const blocked = await fixture.missions.get(mission.id);
    expect(blocked?.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "verifying",
      attentionItems: [
        expect.objectContaining({
          kind: "assignment_requires_replan",
          status: "open",
          assignmentId: originalVerification.assignmentId,
        }),
      ],
    });
    if (!blocked) throw new Error("The rejected verification Mission disappeared");
    expect(
      blocked.mission.assignments.find(
        (assignment) => assignment.assignmentId === originalVerification.assignmentId,
      ),
    ).toMatchObject({
      semanticState: "failed",
      report: { status: "completed", verdict: "changes_requested" },
    });

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: mission.participants[0]!.agentId,
      missionId: mission.id,
      expectedRevision: blocked.mission.revision,
      expectedPlanRevision: blocked.mission.planRevision,
      workstreams: missionPlan(true),
      assignments: [parserAssignmentDraft("parser-revision-2")],
    });
    const revisionTwoAssignments = replanned.assignments.filter(
      (assignment) => assignment.planRevision === 2,
    );
    const replacementDelivery = revisionTwoAssignments.find(
      (assignment) => assignment.kind === "delivery",
    );
    const replacementReview = revisionTwoAssignments.find(
      (assignment) => assignment.kind === "review",
    );
    const replacementVerification = revisionTwoAssignments.find(
      (assignment) => assignment.kind === "verification",
    );
    if (!replacementDelivery || !replacementReview || !replacementVerification) {
      throw new Error("The daemon did not generate the complete revision 2 quality-gate graph");
    }

    expect(replanned).toMatchObject({
      status: "active",
      suspendedStatus: null,
      planRevision: 2,
      attentionItems: [
        expect.objectContaining({
          kind: "assignment_requires_replan",
          status: "resolved",
          resolution: expect.objectContaining({ kind: "replan" }),
        }),
      ],
    });
    expect(
      replanned.assignments.find(
        (assignment) => assignment.assignmentId === originalVerification.assignmentId,
      ),
    ).toMatchObject({
      semanticState: "canceled",
      terminationReason: "superseded",
      supersededBy: replacementVerification.assignmentId,
    });
    expect(replacementReview).toMatchObject({
      semanticState: "planned",
      subjectAssignmentIds: [replacementDelivery.assignmentId],
      dependencyAssignmentIds: [replacementDelivery.assignmentId],
    });
    expect(replacementVerification).toMatchObject({
      semanticState: "planned",
      subjectAssignmentIds: [
        replacementDelivery.assignmentId,
        replacementReview.assignmentId,
      ].toSorted(),
      dependencyAssignmentIds: [
        replacementDelivery.assignmentId,
        replacementReview.assignmentId,
      ].toSorted(),
    });

    await driveSeedToTerminal(fixture, mission, 404);
    const completed = await fixture.missions.get(mission.id);
    if (!completed) throw new Error("The replanned Mission disappeared after completion");
    expect(completed.mission).toMatchObject({
      status: "completed",
      planRevision: 2,
      participants: [
        expect.objectContaining({ archivedAt: expect.any(String) }),
        expect.objectContaining({ archivedAt: expect.any(String) }),
      ],
    });
    expect(completed.mission.attentionItems.filter((item) => item.status === "open")).toEqual([]);
    expect(completed.assignmentDispatchIntents).toEqual([]);
    expect(completed.assignmentReportRecoveryOutbox).toEqual([]);
    expect(completed.completionOutbox).toEqual([
      expect.objectContaining({ state: "acknowledged", missionStatus: "completed" }),
    ]);
    expect(
      completed.recipientAttentionOutbox.filter(
        (delivery) => delivery.state !== "acknowledged" && delivery.state !== "canceled",
      ),
    ).toEqual([]);
    expect(completed.ownershipIntervals.filter((interval) => interval.state === "open")).toEqual(
      [],
    );
    expect(fixture.activeLeaseCount).toBe(0);
    const acceptedAssignmentIds = completed.mission.assignments
      .filter((assignment) => assignment.acceptedTurnId !== null)
      .map((assignment) => assignment.assignmentId)
      .toSorted();
    expect([...fixture.acceptedSideEffects.keys()].toSorted()).toEqual(acceptedAssignmentIds);
    expect(
      [...fixture.dispatchAttempts].toSorted(([left], [right]) => left.localeCompare(right)),
    ).toEqual(acceptedAssignmentIds.map((assignmentId) => [assignmentId, 1]));
  });
});

type ConvergenceFixture = ReturnType<typeof createConvergenceFixture>;
type StoredMission = NonNullable<Awaited<ReturnType<MissionStore["get"]>>>;

async function reconcileUntilAssignmentAccepted(
  fixture: ConvergenceFixture,
  missionId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await fixture.missions.get(missionId);
    if (!stored) throw new Error(`Mission ${missionId} disappeared before dispatch`);
    if (stored.mission.assignments.some((assignment) => assignment.acceptedTurnId !== null)) return;
    fixture.advanceToNextDispatch(stored.assignmentDispatchIntents);
    await fixture.reconcile(missionId);
  }
  throw new Error(`Mission ${missionId} did not accept an Assignment`);
}

async function reconcileUntilRunningAssignment(
  fixture: ConvergenceFixture,
  missionId: string,
  matches: (assignment: MissionAssignmentContract) => boolean,
): Promise<MissionAssignmentContract> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stored = await fixture.missions.get(missionId);
    if (!stored) throw new Error(`Mission ${missionId} disappeared before Assignment dispatch`);
    const running = stored.mission.assignments.find(
      (assignment) => assignment.semanticState === "running" && matches(assignment),
    );
    if (running) return running;
    fixture.advanceToNextDispatch(stored.assignmentDispatchIntents);
    await fixture.reconcile(missionId);
  }
  const stored = await fixture.missions.get(missionId);
  throw new Error(
    `Mission ${missionId} did not dispatch the expected Assignment: ${JSON.stringify(convergenceState(stored))}`,
  );
}

async function completeRunningAssignment(
  fixture: ConvergenceFixture,
  missionId: string,
  assignment: MissionAssignmentContract,
): Promise<void> {
  await fixture.report(missionId, assignment.assignmentId);
  await fixture.settleTurn(missionId, assignment.assignmentId);
  await fixture.reconcile(missionId);
}

async function runConvergenceSeed(rootDirectory: string, seed: number): Promise<void> {
  const fixture = createConvergenceFixture(join(rootDirectory, `seed-${seed}`), seed);
  const mission = await createSeedMission(fixture, seed);
  await driveSeedToTerminal(fixture, mission, seed);
  await assertSeedConverged(fixture, mission.id, seed);
}

async function createSeedMission(
  fixture: ConvergenceFixture,
  seed: number,
  workspaceId = `workspace-${seed}`,
  requireReview = seed === 8,
): Promise<TeamMission> {
  const team = await fixture.lifecycle.createTeam({
    idempotencyKey: `create-team-${seed}`,
    name: `Seeded Team ${seed}`,
    workspaceId,
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    lead: member("codex", 5),
    members: [member("claude", 4)],
  });
  const mission = await fixture.lifecycle.startMission({
    idempotencyKey: `start-mission-${seed}`,
    teamId: team.id,
    expectedTeamRevision: team.revision,
    objective: "Ship a deterministic parser",
    constraints: ["Keep the public grammar stable"],
    acceptanceCriteria: ["Parser and verification reports pass"],
  });
  const leadAgentId = mission.participants[0]!.agentId;
  const planned = await fixture.collaboration.planMission({
    callerAgentId: leadAgentId,
    missionId: mission.id,
    expectedRevision: mission.revision,
    expectedPlanRevision: 0,
    workstreams: missionPlan(requireReview),
  });
  await fixture.collaboration.assignTasks({
    callerAgentId: leadAgentId,
    missionId: mission.id,
    expectedRevision: planned.revision,
    expectedPlanRevision: planned.planRevision,
    assignments: [parserAssignmentDraft("parser-delivery")],
  });
  return mission;
}

async function driveSeedToTerminal(
  fixture: ConvergenceFixture,
  mission: TeamMission,
  seed: number,
): Promise<void> {
  for (let step = 0; step < 16; step += 1) {
    const stored = await fixture.missions.get(mission.id);
    if (!stored) throw new Error(`Seed ${seed}: Mission disappeared`);
    if (isTerminalStatus(stored.mission.status)) {
      await fixture.reconcileLifecycleRecovery(mission.id);
      return;
    }
    if (await replanProviderFailure(fixture, mission, stored, seed)) continue;
    const running = stored.mission.assignments.find(
      (candidate) => candidate.semanticState === "running",
    );
    if (!running) {
      fixture.advanceToNextDispatch(stored.assignmentDispatchIntents);
      if (fixture.randomBoolean()) fixture.restartScheduler();
      await fixture.reconcile(mission.id);
      continue;
    }
    if (await hardDeleteReviewerAndResolveMission(fixture, mission.id, running, seed)) continue;
    await settleRunningAssignment(fixture, mission.id, running);
  }
}

async function replanProviderFailure(
  fixture: ConvergenceFixture,
  mission: TeamMission,
  stored: StoredMission,
  seed: number,
): Promise<boolean> {
  if (seed !== 7) return false;
  const attention = stored.mission.attentionItems.find(
    (item) => item.kind === "provider_unavailable" && item.status === "open",
  );
  if (!attention?.assignmentId) return false;
  const blocked = stored.mission.assignments.find(
    (candidate) => candidate.assignmentId === attention.assignmentId,
  );
  if (!blocked) throw new Error("Provider Attention lost its Assignment");
  fixture.setProviderFailures(0);
  await fixture.collaboration.planMission({
    callerAgentId: mission.participants[0]!.agentId,
    missionId: mission.id,
    expectedRevision: stored.mission.revision,
    expectedPlanRevision: stored.mission.planRevision,
    workstreams: missionPlan(false),
    replacementAssignments: [parserAssignmentDraft("parser-recovery", blocked.assignmentId)],
  });
  return true;
}

async function hardDeleteReviewerAndResolveMission(
  fixture: ConvergenceFixture,
  missionId: string,
  running: MissionAssignmentContract,
  seed: number,
): Promise<boolean> {
  if (seed !== 8 || running.kind !== "review" || !running.runtimeAgentId) return false;
  await fixture.participantUnavailable(running.runtimeAgentId);
  await fixture.settleTurn(missionId, running.assignmentId, "failed");
  await flushDeferredTerminalWork(fixture, missionId);
  const attention = await fixture.missions.get(missionId);
  if (!attention) throw new Error("Reviewer loss removed the Mission");
  await fixture.lifecycle.cancelMission({
    idempotencyKey: "cancel-after-reviewer-loss",
    missionId,
    expectedRevision: attention.mission.revision,
    reason: "The user canceled after the accepted reviewer became unavailable",
  });
  return true;
}

async function flushDeferredTerminalWork(
  fixture: ConvergenceFixture,
  missionId: string,
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await fixture.reconcile(missionId);
  await fixture.collaboration.reconcilePendingMessages();
}

async function settleRunningAssignment(
  fixture: ConvergenceFixture,
  missionId: string,
  running: MissionAssignmentContract,
): Promise<void> {
  if (fixture.randomBoolean()) {
    await fixture.report(missionId, running.assignmentId);
    if (fixture.randomBoolean()) fixture.restartScheduler();
    await fixture.settleTurn(missionId, running.assignmentId);
  } else {
    await fixture.settleTurn(missionId, running.assignmentId);
    await fixture.reconcile(missionId);
    if (fixture.randomBoolean()) fixture.restartScheduler();
    await fixture.report(missionId, running.assignmentId);
  }
  if (fixture.randomBoolean()) fixture.restartScheduler();
  await fixture.reconcile(missionId);
}

async function assertSeedConverged(
  fixture: ConvergenceFixture,
  missionId: string,
  seed: number,
): Promise<void> {
  const stored = await fixture.missions.get(missionId);
  const expectedStatus = seed === 8 ? "canceled" : "completed";
  if (stored?.mission.status !== expectedStatus) {
    throw new Error(`seed ${seed} did not converge: ${JSON.stringify(convergenceState(stored))}`);
  }
  expect(
    stored.mission.attentionItems.filter((item) => item.status === "open"),
    `seed ${seed}`,
  ).toEqual([]);
  expect(fixture.maxConcurrentLeases, `seed ${seed}`).toBeLessThanOrEqual(1);
  expect(fixture.acceptedSideEffects.size, `seed ${seed}`).toBe(
    stored.mission.assignments.filter((candidate) => candidate.acceptedTurnId !== null).length,
  );
  expect(
    [...fixture.baselineCaptures.values()].every((captures) => captures === 1),
    `seed ${seed}`,
  ).toBe(true);
  expect(new Set(stored.ownershipIntervals.map((item) => item.intervalId)).size).toBe(
    stored.ownershipIntervals.length,
  );
}

function convergenceState(stored: StoredMission | null) {
  if (!stored) return null;
  return {
    status: stored.mission.status,
    assignments: stored.mission.assignments.map((candidate) => ({
      kind: candidate.kind,
      semanticState: candidate.semanticState,
      dispatchState: candidate.dispatchState,
      hasReport: candidate.report !== null,
      acceptedTurnId: candidate.acceptedTurnId,
    })),
    workstreams: stored.mission.workstreams.map((stream) => ({
      kind: stream.kind,
      status: stream.status,
    })),
    recoveries: stored.assignmentReportRecoveryOutbox.map((item) => item.state),
    openOwnership: stored.ownershipIntervals.filter((item) => item.state === "open").length,
  };
}

function isTerminalStatus(status: TeamMission["status"]): boolean {
  return status === "completed" || status === "canceled";
}

function parserAssignmentDraft(clientKey: string, supersedesAssignmentId?: string) {
  return {
    clientKey,
    ...(supersedesAssignmentId ? { supersedesAssignmentId } : {}),
    kind: "delivery" as const,
    workstreamId: "parser",
    subjectKeys: [],
    dependencyKeys: [],
    objective: "Implement the parser",
    inputRefs: [],
    deliverables: ["Parser implementation"],
    acceptanceCriteria: ["Parser tests pass"],
    mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
    priority: 10,
  };
}

function createConvergenceFixture(directory: string, seed: number) {
  const logger = createTestLogger();
  const clock = { current: START_TIME };
  const now = () => clock.current;
  const profiles = new TeamProfileStore({ directory: join(directory, "profiles"), logger, now });
  const createMissionStore = () =>
    new MissionStore({ directory: join(directory, "missions"), logger, now });
  let missions = createMissionStore();
  const ids = new Map<string, number>();
  const nextId = (kind: string) => {
    const next = (ids.get(kind) ?? 0) + 1;
    ids.set(kind, next);
    return `${kind}-${seed}-${next}`;
  };
  const participants: TeamParticipantPort = {
    createLead: async () => undefined,
    archiveParticipant: async () => undefined,
  };
  const operations = new TeamOperationCoordinator();
  let scheduler: TeamMissionScheduler | null = null;
  const capabilities: ProviderCapabilityResolver = {
    resolve: async () => ({
      providerAvailable: true,
      toolIds: ["mission_status", "mission_plan", "assign_task", "assignment_report"],
      capabilityIds: ["structured-tools"],
    }),
  };
  const lifecycle = new TeamMissionService({
    profiles,
    missions,
    recovery: new TeamPersistenceReconciler({ profiles, missions, logger }),
    rooms: { createMissionRoom: async () => undefined } satisfies TeamRoomPort,
    participants,
    capabilities,
    events: { publishTeam: async () => undefined, publishMission: async () => undefined },
    clock: { now },
    ids: { next: nextId },
    operations,
    finishQuiescence: {
      prepareEvidence: async (input) => {
        if (!scheduler) throw new Error("Team Mission scheduler is not initialized");
        await scheduler.prepareFinishEvidence(input);
      },
    },
  });
  const terminalFacts = new Map<string, AcceptedTurnFact>();
  let terminalFactListener: ((fact: TeamTerminalTurnFact) => Promise<void>) | null = null;
  const turnFacts: TeamAcceptedTurnFactsPort = {
    read: async (turns) =>
      new Map(
        turns.map((turn) => {
          const terminal = terminalFacts.get(turn.turnId);
          return [
            turn.turnId,
            terminal ?? {
              assignmentId: turn.assignmentId,
              turnId: turn.turnId,
              runtimeAgentId: turn.runtimeAgentId,
              outcome: "running" as const,
            },
          ] as const;
        }),
      ),
    onTerminalFact: (listener) => {
      terminalFactListener = listener;
    },
  };
  const createLeaseStore = () =>
    new WorkspaceScopeLeaseStore({
      filePath: join(directory, "workspace-scope-leases.json"),
      resolveWorkspaceIdentity: async (workspaceId) => `/workspace/${workspaceId}`,
      clock: { now },
      ids: { next: nextId },
    });
  let leaseStore = createLeaseStore();
  let activeLeases = new Map<string, MissionScopeLease>();
  let maxConcurrentLeases = 0;
  const createLeases = (): TeamWorkspaceLeasePort => ({
    acquire: async (input) => {
      const lease = await leaseStore.acquire(input);
      if (!lease) return null;
      activeLeases.set(lease.assignmentId, lease);
      maxConcurrentLeases = Math.max(maxConcurrentLeases, activeLeases.size);
      return lease;
    },
    transitionToReportHold: async (input) => {
      const lease = await leaseStore.transitionToReportHold(input);
      activeLeases.set(lease.assignmentId, lease);
      return lease;
    },
    transferReportHold: async (input) => {
      const lease = await leaseStore.transferReportHold(input);
      activeLeases.delete(input.sourceAssignmentId);
      activeLeases.set(input.replacementAssignmentId, lease);
      return lease;
    },
    release: async (lease) => {
      await leaseStore.release(lease);
      activeLeases.delete(lease.assignmentId);
    },
    releaseAssignment: async (input) => {
      await leaseStore.releaseAssignment(input);
      activeLeases.delete(input.assignmentId);
    },
    releaseMission: async (input) => {
      await leaseStore.releaseMission(input);
      activeLeases = new Map();
    },
  });
  let leases = createLeases();
  const baselineCaptures = new Map<string, number>();
  const workspace: TeamWorkspaceSnapshotPort = {
    captureBaseline: async (input) => {
      baselineCaptures.set(input.assignmentId, (baselineCaptures.get(input.assignmentId) ?? 0) + 1);
      return {
        baselineId: `baseline-${input.assignmentId}`,
        workspaceId: input.workspaceId,
        assignmentId: input.assignmentId,
        policyRevision: input.policy.revision,
        capturedAt: now(),
        entries: [],
      };
    },
    captureDelta: async () => ({ capturedDelta: [], violations: [] }),
  };
  const dispatchAttempts = new Map<string, number>();
  const acceptedSideEffects = new Map<string, string>();
  let providerFailuresRemaining = seed === 7 ? 3 : seed % 3;
  const dispatch: TeamAssignmentDispatchPort = {
    dispatch: async (input) => {
      dispatchAttempts.set(input.assignmentId, (dispatchAttempts.get(input.assignmentId) ?? 0) + 1);
      if (providerFailuresRemaining > 0) {
        providerFailuresRemaining -= 1;
        return { kind: "provider_unavailable", reason: "seeded transient provider failure" };
      }
      const existing = acceptedSideEffects.get(input.assignmentId);
      if (existing) {
        throw new Error(`duplicate provider side effect for Assignment ${input.assignmentId}`);
      }
      const turnId = `turn-${input.assignmentId}`;
      acceptedSideEffects.set(input.assignmentId, turnId);
      return { kind: "accepted", turnId };
    },
    requestReport: async () => ({ kind: "busy" }),
  };
  const makeScheduler = () =>
    new TeamMissionScheduler({
      missions,
      turnFacts,
      leases,
      workspace,
      dispatch,
      participants: { ensureParticipant: async () => undefined },
      lifecycle,
      events: { publishMission: async () => undefined },
      clock: { now },
      operations,
    });
  scheduler = makeScheduler();
  const schedulerPort = {
    reconcileMission: (missionId: string, permit?: TeamOperationPermit) => {
      if (!scheduler) throw new Error("Team Mission scheduler is not initialized");
      return scheduler.reconcileMission(missionId, permit);
    },
  };
  const messages: TeamMessagePort = {
    post: async (input) => ({ messageId: input.messageId, cursor: 1 }),
    read: async () => ({ messages: [], cursor: 0, hasMore: false }),
  };
  const recipientAttentionAttempts: Array<Parameters<TeamRecipientAttentionPort["attempt"]>[0]> =
    [];
  const recipientAttention: TeamRecipientAttentionPort = {
    attempt: async (input) => {
      recipientAttentionAttempts.push(structuredClone(input));
      return "notified";
    },
    onEligibilityChange: () => undefined,
  };
  const memberHistory: TeamMemberHistoryPort = {
    read: async (input) => ({
      agentId: input.agentId,
      updateCount: 0,
      totalActivities: 0,
      shownActivities: 0,
      currentModeId: null,
      content: "",
    }),
  };
  const collaboration = new TeamCollaborationService({
    profiles,
    missions,
    memberHistory,
    messages,
    turnFacts,
    recipientAttention,
    events: { publishTeam: async () => undefined, publishMission: async () => undefined },
    clock: { now },
    ids: { next: nextId },
    scheduler: schedulerPort,
    operations,
  });
  const random = mulberry32(seed);

  return {
    lifecycle,
    collaboration,
    get missions() {
      return missions;
    },
    acceptedSideEffects,
    dispatchAttempts,
    recipientAttentionAttempts,
    baselineCaptures,
    get maxConcurrentLeases() {
      return maxConcurrentLeases;
    },
    get activeLeaseCount() {
      return activeLeases.size;
    },
    randomBoolean: () => random() < 0.5,
    restartScheduler: () => {
      missions = createMissionStore();
      leaseStore = createLeaseStore();
      leases = createLeases();
      scheduler = makeScheduler();
    },
    setProviderFailures: (failures: number) => {
      providerFailuresRemaining = failures;
    },
    participantUnavailable: (agentId: string) => {
      if (!scheduler) throw new Error("Team Mission scheduler is not initialized");
      return scheduler.handleParticipantUnavailable(agentId);
    },
    reconcileLifecycleRecovery: async (missionId: string) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await lifecycle.reconcile();
        const current = await missions.get(missionId);
        const completionSettled = current?.completionOutbox.every(
          (delivery) => delivery.state === "acknowledged",
        );
        if (completionSettled) return;
      }
      const current = await missions.get(missionId);
      throw new Error(
        `Mission ${missionId} completion recovery did not settle: ${JSON.stringify({
          storageRevision: current?.storageRevision,
          missionRevision: current?.mission.revision,
          completionOutbox: current?.completionOutbox,
        })}`,
      );
    },
    reconcile: (missionId: string) => {
      if (!scheduler) throw new Error("Team Mission scheduler is not initialized");
      return scheduler.reconcileMission(missionId);
    },
    advanceToNextDispatch: (intents: Array<{ nextEligibleAt: string }>) => {
      const next = intents.map((intent) => intent.nextEligibleAt).toSorted()[0];
      if (next && next > clock.current) clock.current = next;
    },
    report: async (missionId: string, assignmentId: string) => {
      const stored = await missions.get(missionId);
      const assignment = stored?.mission.assignments.find(
        (candidate) => candidate.assignmentId === assignmentId,
      );
      if (!stored || !assignment || !assignment.runtimeAgentId) {
        throw new Error(`Assignment ${assignmentId} is not reportable`);
      }
      await collaboration.reportAssignment({
        callerAgentId: assignment.runtimeAgentId,
        missionId,
        assignmentId,
        expectedRevision: stored.mission.revision,
        expectedAssignmentRevision: assignment.revision,
        report: {
          status: "completed",
          verdict: assignment.kind === "delivery" ? null : "approved",
          summary: `${assignment.kind} completed for seed ${seed}`,
          artifactPaths: assignment.kind === "delivery" ? ["packages/server/src/parser.ts"] : [],
          tests: [{ command: `seed-${seed}-check`, passed: true }],
          decisions: [],
          handoffs: [],
        },
      });
    },
    reportBlocked: async (missionId: string, assignmentId: string) => {
      const stored = await missions.get(missionId);
      const assignment = stored?.mission.assignments.find(
        (candidate) => candidate.assignmentId === assignmentId,
      );
      if (!stored || !assignment || !assignment.runtimeAgentId) {
        throw new Error(`Assignment ${assignmentId} is not reportable`);
      }
      await collaboration.reportAssignment({
        callerAgentId: assignment.runtimeAgentId,
        missionId,
        assignmentId,
        expectedRevision: stored.mission.revision,
        expectedAssignmentRevision: assignment.revision,
        report: {
          status: "blocked",
          summary: "The frozen contract conflicts with the Mission acceptance criteria",
          blockers: ["The contract forbids the normalization required by acceptance"],
          artifactPaths: [],
          tests: [{ command: "seed-303-contract-check", passed: false }],
          decisions: [],
          handoffs: [],
        },
      });
    },
    reportChangesRequested: async (missionId: string, assignmentId: string) => {
      const stored = await missions.get(missionId);
      const assignment = stored?.mission.assignments.find(
        (candidate) => candidate.assignmentId === assignmentId,
      );
      if (!stored || !assignment || !assignment.runtimeAgentId) {
        throw new Error(`Assignment ${assignmentId} is not reportable`);
      }
      await collaboration.reportAssignment({
        callerAgentId: assignment.runtimeAgentId,
        missionId,
        assignmentId,
        expectedRevision: stored.mission.revision,
        expectedAssignmentRevision: assignment.revision,
        report: {
          status: "completed",
          verdict: "changes_requested",
          summary: "Final verification requires another implementation pass",
          artifactPaths: [],
          tests: [{ command: "seed-404-final-check", passed: false }],
          decisions: [],
          handoffs: [],
        },
      });
    },
    settleTurn: async (
      missionId: string,
      assignmentId: string,
      outcome: "completed" | "failed" | "canceled" = "completed",
    ) => {
      const stored = await missions.get(missionId);
      const assignment = stored?.mission.assignments.find(
        (candidate) => candidate.assignmentId === assignmentId,
      );
      if (!assignment?.acceptedTurnId || !assignment.runtimeAgentId || !terminalFactListener) {
        throw new Error(`Assignment ${assignmentId} has no accepted turn`);
      }
      const fact: TeamTerminalTurnFact = {
        missionId,
        turnId: assignment.acceptedTurnId,
        runtimeAgentId: assignment.runtimeAgentId,
        outcome,
      };
      terminalFacts.set(fact.turnId, {
        assignmentId,
        turnId: fact.turnId,
        runtimeAgentId: fact.runtimeAgentId,
        outcome: fact.outcome,
      });
      await terminalFactListener(fact);
    },
  };
}

function member(provider: "codex" | "claude", level: 4 | 5): TeamProfileMemberInput {
  return {
    role: level === 5 ? "Technical lead" : "Software engineer",
    level,
    skillIds: ["typescript"],
    executionProfile: {
      provider,
      model: null,
      modeId: null,
      thinkingOptionId: null,
      featureValues: {},
    },
  };
}

function missionPlan(requireReview = false) {
  return [
    {
      workstreamId: "parser",
      kind: "delivery" as const,
      title: "Parser delivery",
      objective: "Implement the parser",
      deliverables: ["Parser implementation"],
      acceptanceCriteria: ["Parser tests pass"],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4 as const,
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
      reviewPolicy: requireReview ? ("required" as const) : ("none" as const),
      reviewerRequirements: requireReview
        ? {
            requiredSkillIds: ["typescript"],
            preferredSkillIds: [],
            requiredRuntimeCapabilityIds: ["structured-tools"],
            minimumLevel: 4 as const,
          }
        : null,
    },
    {
      workstreamId: "final-verification",
      kind: "verification" as const,
      title: "Final verification",
      objective: "Verify the Mission",
      deliverables: ["Verification report"],
      acceptanceCriteria: ["All Mission criteria pass"],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4 as const,
      dependencyWorkstreamIds: ["parser"],
      mutableScope: { kind: "read_only" as const },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    },
  ];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
