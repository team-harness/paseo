import { createHash } from "node:crypto";

import type {
  FrozenPromptSection,
  MissionAttentionItem,
  MissionAssignmentContract,
  MissionWorkstream,
  MissionScopeLease,
  MissionWorkspaceAuditPolicy,
  MissionWorkspaceBaseline,
  TeamMission,
  TeamExecutionProfile,
} from "@getpaseo/protocol/team/v2-types";

import {
  MissionFinishStageConflictError,
  MissionRevisionConflictError,
  MissionStorageRevisionConflictError,
  type MissionStore,
} from "../persistence/mission-store.js";
import type {
  MissionAcceptedTurnFact,
  MissionAssignmentDispatchIntent,
} from "../persistence/schemas.js";
import type {
  AcceptedTurnFact,
  AcceptedTurnOutcome,
} from "../domain/assignment-contract-validation.js";
import {
  applyMissionAttentionTransition,
  selectAttentionBlockedWorkstreamIds,
} from "../domain/mission-attention-transition.js";
import {
  isMissionReviewGateSettledByEvidence,
  resolveMissionAssignmentCoverage,
  resolveMissionSettledReviewGateWorkstreamIds,
} from "../domain/mission-validation.js";
import { missionReviewReportFingerprint } from "../domain/mission-review-gate.js";
import {
  assignmentReplanAttentionId,
  assignmentReplanSummary,
  assignmentRequiresReplan,
  buildLeadReplanDeliveries,
} from "./assignment-replan.js";
import { planMissionQualityGates, sameAssignmentIdSet } from "./quality-gate-assignments.js";
import {
  TeamOperationCoordinator,
  type TeamOperationPermit,
} from "./team-operation-coordinator.js";
import type { TeamAcceptedTurnFactsPort, TeamClockPort, TeamRuntimeEventPort } from "./ports.js";

const PROVIDER_DISPATCH_MAX_ATTEMPTS = 3;
const DISPATCH_RETRY_BASE_DELAY_MS = 5_000;
type SettledTurnOutcome = Exclude<AcceptedTurnOutcome, "running">;
type SettledAcceptedTurnFact = Omit<AcceptedTurnFact, "outcome"> & {
  outcome: SettledTurnOutcome;
};

export interface TeamWorkspaceLeasePort {
  acquire(input: {
    teamId: string;
    missionId: string;
    workspaceId: string;
    assignmentId: string;
    scope: MissionAssignmentContract["mutableScope"];
    priority: number;
    createdAt: string;
  }): Promise<MissionScopeLease | null>;
  transitionToReportHold(input: {
    lease: MissionScopeLease;
    transitionedAt: string;
    capturedDelta: MissionScopeLease["capturedDelta"];
  }): Promise<MissionScopeLease>;
  transferReportHold?(input: {
    leaseId: string;
    teamId: string;
    missionId: string;
    workspaceId: string;
    sourceAssignmentId: string;
    replacementAssignmentId: string;
  }): Promise<MissionScopeLease>;
  release(lease: MissionScopeLease): Promise<void>;
  releaseAssignment(input: { workspaceId: string; assignmentId: string }): Promise<void>;
  releaseMission(input: { missionId: string }): Promise<void>;
}

export interface TeamWorkspaceSnapshotPort {
  captureBaseline(input: {
    workspaceId: string;
    assignmentId: string;
    scope: MissionAssignmentContract["mutableScope"];
    policy: MissionWorkspaceAuditPolicy;
  }): Promise<MissionWorkspaceBaseline>;
  captureDelta(input: {
    workspaceId: string;
    assignmentId: string;
    scope: MissionAssignmentContract["mutableScope"];
    baseline: MissionWorkspaceBaseline;
    policy: MissionWorkspaceAuditPolicy;
  }): Promise<{
    capturedDelta: Array<{ path: string; fingerprint: string }>;
    violations: Array<{ path: string; fingerprint: string }>;
  }>;
}

export type TeamAssignmentDispatchResult =
  | { kind: "accepted"; turnId: string }
  | { kind: "busy" }
  | { kind: "acceptance_unknown"; reason: string }
  | { kind: "provider_unavailable"; reason: string };

export interface TeamAssignmentDispatchPort {
  dispatch(input: {
    teamId: string;
    missionId: string;
    assignmentId: string;
    agentId: string;
    bindingEpoch: number;
    messageId: string;
    methodologyPromptSections: FrozenPromptSection[];
  }): Promise<TeamAssignmentDispatchResult>;
  requestReport(input: {
    teamId: string;
    missionId: string;
    assignmentId: string;
    agentId: string;
    bindingEpoch: number;
    attempt: number;
    messageId: string;
    methodologyPromptSections: FrozenPromptSection[];
  }): Promise<TeamAssignmentDispatchResult>;
}

export interface TeamParticipantProvisionPort {
  inspectParticipant?(input: {
    teamId: string;
    missionId: string;
    memberId: string;
    agentId: string;
    bindingEpoch: number;
  }): Promise<"active" | "archived" | "missing">;
  ensureParticipant(input: {
    teamId: string;
    missionId: string;
    workspaceId: string;
    memberId: string;
    agentId: string;
    bindingEpoch: number;
    role: string;
    mentionHandle: string;
    executionProfile: TeamExecutionProfile;
  }): Promise<void>;
}

export interface TeamMissionCompletionPort {
  completeMission(input: {
    idempotencyKey: string;
    missionId: string;
    expectedRevision: number;
    acceptedTurns: Array<{
      assignmentId: string;
      turnId: string;
      runtimeAgentId: string;
      outcome: "completed" | "failed" | "canceled" | "unknown";
      recordedAt: string;
    }>;
  }): Promise<TeamMission>;
}

interface TeamMissionSchedulerCoreResult {
  missionId: string;
  dispatchedAssignmentIds: string[];
  deferredAssignmentIds: string[];
}

export interface TeamMissionSchedulerResult extends TeamMissionSchedulerCoreResult {
  createdRecipientAttentionDeliveryIds: string[];
}

interface TeamMissionSchedulerOptions {
  missions: MissionStore;
  leases: TeamWorkspaceLeasePort;
  workspace: TeamWorkspaceSnapshotPort;
  dispatch: TeamAssignmentDispatchPort;
  participants: TeamParticipantProvisionPort;
  lifecycle: TeamMissionCompletionPort;
  turnFacts: Pick<TeamAcceptedTurnFactsPort, "read">;
  events: Pick<TeamRuntimeEventPort, "publishMission">;
  clock: TeamClockPort;
  operations?: TeamOperationCoordinator;
}

interface PreparedDispatch {
  assignment: MissionAssignmentContract;
  agentId: string;
  bindingEpoch: number;
  lease: MissionScopeLease | null;
  baseline: MissionWorkspaceBaseline;
  messageId: string;
  preparedAt: string;
  dispatchAttempts: number;
}

interface AcceptedDispatch extends PreparedDispatch {
  turnId: string;
}

interface DispatchRetry {
  attempts: number;
  nextEligibleAt: string;
  failureKind: "busy" | "provider_unavailable";
  failureReason: string;
}

interface DispatchOutcome {
  candidate: PreparedDispatch;
  result: TeamAssignmentDispatchResult;
}

interface DispatchAcceptanceUnknown {
  candidate: PreparedDispatch;
  reason: string;
}

export class TeamMissionScheduler {
  private readonly reconciliations = new Map<string, Promise<TeamMissionSchedulerResult>>();
  private readonly operations: TeamOperationCoordinator;

  constructor(private readonly options: TeamMissionSchedulerOptions) {
    this.operations = options.operations ?? new TeamOperationCoordinator();
  }

  async reconcileMission(
    missionId: string,
    permit?: TeamOperationPermit,
  ): Promise<TeamMissionSchedulerResult> {
    const stored = await this.options.missions.get(missionId);
    if (!stored) throw new Error(`Mission ${missionId} does not exist`);
    const result = await this.operations.serialize(
      stored.mission.teamId,
      () => this.reconcileMissionWithLock(missionId),
      permit,
    );
    // A supplied permit means the caller still owns the Team lock. Planning and
    // assignment mutation cannot make a Mission complete, so the next terminal
    // event or runtime sweep performs the completion pass without that permit.
    if (!permit) await this.completeReadyMission(missionId);
    return result;
  }

  async prepareFinishEvidence(input: { missionId: string; intentId: string }): Promise<void> {
    const stored = await this.options.missions.get(input.missionId);
    if (!stored) throw new Error(`Mission ${input.missionId} does not exist`);
    await this.operations.serialize(stored.mission.teamId, () =>
      this.prepareFinishEvidenceWithLock(input),
    );
  }

  private async prepareFinishEvidenceWithLock(input: {
    missionId: string;
    intentId: string;
  }): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let stored = await this.options.missions.get(input.missionId);
      if (!stored) throw new Error(`Mission ${input.missionId} does not exist`);
      const finishIntent = stored.finishIntent;
      if (!finishIntent || finishIntent.intentId !== input.intentId) {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          finishIntent?.stage ?? null,
          "evidence_prepared",
        );
      }
      if (finishIntent.stage === "evidence_prepared" || finishIntent.stage === "finalized") return;
      if (finishIntent.stage !== "participants_archived") {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          finishIntent.stage,
          "evidence_prepared",
        );
      }

      try {
        const durableTurns = await this.reconcileDurableTurnFacts(stored);
        stored = durableTurns.stored;
        stored = await this.settleTerminalAssignments(stored, durableTurns.observed, false);
        stored = await this.settleReportRecoveryTurns(stored, durableTurns.observed, false);
        await this.synchronizeReportHolds(stored.mission);
        await this.reconcileReleasedAssignments(stored);
        return;
      } catch (error) {
        const retryableConflict =
          error instanceof MissionRevisionConflictError ||
          error instanceof MissionStorageRevisionConflictError;
        if (!retryableConflict || attempt === 2) throw error;
      }
    }
  }

  private async reconcileMissionWithLock(missionId: string): Promise<TeamMissionSchedulerResult> {
    const previous = this.reconciliations.get(missionId);
    if (previous) return previous;
    const current = (async () => {
      const before = await this.options.missions.get(missionId);
      if (!before) throw new Error(`Mission ${missionId} does not exist`);
      const existingDeliveryIds = new Set(
        before.recipientAttentionOutbox.map((delivery) => delivery.deliveryId),
      );
      const result = await this.reconcileMissionNow(missionId);
      const after = await this.options.missions.get(missionId);
      return {
        ...result,
        createdRecipientAttentionDeliveryIds:
          after?.recipientAttentionOutbox
            .filter((delivery) => !existingDeliveryIds.has(delivery.deliveryId))
            .map((delivery) => delivery.deliveryId) ?? [],
      };
    })().finally(() => {
      if (this.reconciliations.get(missionId) === current) {
        this.reconciliations.delete(missionId);
      }
    });
    this.reconciliations.set(missionId, current);
    return current;
  }

  async handleParticipantUnavailable(agentId: string): Promise<void> {
    for (const stored of await this.options.missions.list()) {
      if (
        stored.finishIntent ||
        isTerminalMissionStatus(stored.mission.status) ||
        !stored.mission.participants.some(
          (participant) => participant.agentId === agentId && participant.archivedAt === null,
        )
      ) {
        continue;
      }
      await this.operations.serialize(stored.mission.teamId, async () => {
        const current = await this.options.missions.get(stored.mission.id);
        if (
          !current ||
          current.finishIntent ||
          isTerminalMissionStatus(current.mission.status) ||
          !current.mission.participants.some(
            (participant) => participant.agentId === agentId && participant.archivedAt === null,
          )
        ) {
          return;
        }
        await this.reconcileParticipantAvailability(current, new Set([agentId]));
        await this.reconcileMissionWithLock(current.mission.id);
      });
    }
  }

  private async reconcileMissionNow(missionId: string): Promise<TeamMissionSchedulerCoreResult> {
    let stored = await this.options.missions.get(missionId);
    if (!stored) throw new Error(`Mission ${missionId} does not exist`);
    const stopped = await this.reconcileStoppedMission(stored);
    if (stopped) return stopped;
    stored = await this.reconcileFinishedDispatchIntents(stored);
    const durableTurns = await this.reconcileDurableTurnFacts(stored);
    stored = durableTurns.stored;
    const observedTurnFacts = durableTurns.observed;
    stored = await this.settleTerminalAssignments(stored, observedTurnFacts);
    stored = await this.reconcileParticipantAvailability(stored);
    stored = await this.reconcileFinishedDispatchIntents(stored);
    stored = await this.reconcileReleasedAssignments(stored);
    stored = await this.reconcileReviewGateOutcomes(stored);
    stored = await this.reconcileSettledWorkstreamStatuses(stored);
    stored = await this.synchronizeReviewGateAttentions(stored);
    await this.synchronizeReportHolds(stored.mission);
    stored = await this.reconcileReportRecoveries(stored, observedTurnFacts);
    stored = await this.materializeQualityGates(stored);
    if (isTerminalMissionStatus(stored.mission.status)) {
      return this.reconcileTerminalMission(stored);
    }
    stored = await this.reconcileParticipantAvailability(stored);
    stored = await this.reconcileFinishedDispatchIntents(stored);
    const initialReady = selectReadyAssignments(
      stored.mission,
      stored.assignmentReportRecoveryOutbox,
    );
    const newParticipants = await this.provisionMissingParticipants(stored.mission, initialReady);
    if (newParticipants.length > 0) {
      stored = await this.options.missions.update({
        missionId,
        expectedRevision: stored.mission.revision,
        update: (mission) => ({
          ...mission,
          participants: [...mission.participants, ...newParticipants],
        }),
      });
      await this.options.events.publishMission(stored.mission);
    }
    const ready = selectReadyAssignments(stored.mission, stored.assignmentReportRecoveryOutbox);
    const prepared: PreparedDispatch[] = [];
    const newIntents: MissionAssignmentDispatchIntent[] = [];
    for (const assignment of ready) {
      const participant = activeParticipant(stored.mission, assignment.assigneeMemberId);
      if (!participant) continue;
      const existingIntent = stored.assignmentDispatchIntents.find(
        (intent) => intent.assignmentId === assignment.assignmentId,
      );
      if (existingIntent) {
        assertIntentBinding(existingIntent, participant.agentId, participant.bindingEpoch);
        if (existingIntent.nextEligibleAt > this.options.clock.now()) continue;
        prepared.push({
          assignment,
          agentId: existingIntent.runtimeAgentId,
          bindingEpoch: existingIntent.bindingEpoch,
          lease: existingIntent.scopeLease,
          baseline: existingIntent.workspaceBaseline,
          messageId: existingIntent.messageId,
          preparedAt: existingIntent.preparedAt,
          dispatchAttempts: existingIntent.attempts,
        });
        continue;
      }
      const lease = await this.acquireLease(stored.mission, assignment);
      if (assignment.mutableScope.kind !== "read_only" && !lease) continue;
      try {
        const baseline = await this.options.workspace.captureBaseline({
          workspaceId: stored.mission.workspaceId,
          assignmentId: assignment.assignmentId,
          scope: assignment.mutableScope,
          policy: stored.mission.workspaceAuditPolicy,
        });
        const candidate: PreparedDispatch = {
          assignment,
          agentId: participant.agentId,
          bindingEpoch: participant.bindingEpoch,
          lease,
          baseline,
          messageId: dispatchMessageId(missionId, assignment.assignmentId),
          preparedAt: this.options.clock.now(),
          dispatchAttempts: 0,
        };
        prepared.push(candidate);
        newIntents.push(toDispatchIntent(candidate));
      } catch (error) {
        if (lease) await this.options.leases.release(lease);
        throw error;
      }
    }

    if (newIntents.length > 0) {
      try {
        await this.options.missions.updateAggregate({
          missionId,
          expectedRevision: stored.mission.revision,
          update: ({ mission, recovery }) => ({
            mission,
            recovery: {
              ...recovery,
              assignmentDispatchIntents: [
                ...recovery.assignmentDispatchIntents,
                ...newIntents.filter(
                  (intent) =>
                    !recovery.assignmentDispatchIntents.some(
                      (current) => current.assignmentId === intent.assignmentId,
                    ),
                ),
              ],
            },
          }),
        });
      } catch (error) {
        await Promise.all(
          prepared
            .filter((candidate) =>
              newIntents.some(
                (intent) => intent.assignmentId === candidate.assignment.assignmentId,
              ),
            )
            .flatMap((candidate) =>
              candidate.lease ? [this.options.leases.release(candidate.lease)] : [],
            ),
        );
        throw error;
      }
    }

    const outcomes = await Promise.all(
      prepared.map(async (candidate) => ({
        candidate,
        result: await this.options.dispatch.dispatch({
          teamId: stored.mission.teamId,
          missionId,
          assignmentId: candidate.assignment.assignmentId,
          agentId: candidate.agentId,
          bindingEpoch: candidate.bindingEpoch,
          messageId: candidate.messageId,
          methodologyPromptSections: methodologySectionsForAssignment(
            stored.mission,
            candidate.assignment,
          ),
        }),
      })),
    );
    const {
      accepted,
      retryByAssignmentId,
      exhaustedProviderFailures,
      acceptanceUnknownByAssignmentId,
    } = classifyDispatchOutcomes(outcomes, this.options.clock.now());

    const dispatchUpdateCount =
      accepted.length +
      retryByAssignmentId.size +
      exhaustedProviderFailures.size +
      acceptanceUnknownByAssignmentId.size;
    if (dispatchUpdateCount > 0) {
      const acceptedById = new Map(
        accepted.map((candidate) => [candidate.assignment.assignmentId, candidate]),
      );
      const updated = await this.options.missions.updateAggregate({
        missionId,
        expectedRevision: stored.mission.revision,
        update: ({ mission, recovery }) => {
          const priorMissionStatus =
            mission.status === "needs_attention" ? mission.suspendedStatus : mission.status;
          const canSuspend =
            priorMissionStatus === "planning" ||
            priorMissionStatus === "active" ||
            priorMissionStatus === "verifying";
          const providerAttentionItems = [...exhaustedProviderFailures].flatMap(
            ([assignmentId, failure]) => {
              const attentionId = providerUnavailableAttentionId(mission.id, assignmentId);
              if (mission.attentionItems.some((item) => item.attentionId === attentionId))
                return [];
              return [
                {
                  attentionId,
                  kind: "provider_unavailable" as const,
                  scope: { kind: "mission" as const },
                  status: "open" as const,
                  priorMissionStatus: canSuspend ? priorMissionStatus : ("active" as const),
                  assignmentId,
                  summary: `Provider rejected Assignment ${assignmentId}: ${failure.reason}`,
                  pathEvidence: [],
                  createdAt: this.options.clock.now(),
                  resolution: null,
                },
              ];
            },
          );
          const acceptanceUnknownAttentionItems = [...acceptanceUnknownByAssignmentId].flatMap(
            ([assignmentId, failure]) => {
              const attentionId = dispatchAcceptanceUnknownAttentionId(mission.id, assignmentId);
              if (mission.attentionItems.some((item) => item.attentionId === attentionId)) {
                return [];
              }
              return [
                {
                  attentionId,
                  kind: "dispatch_acceptance_unknown" as const,
                  scope: { kind: "mission" as const },
                  status: "open" as const,
                  priorMissionStatus: canSuspend ? priorMissionStatus : ("active" as const),
                  assignmentId,
                  summary: `Provider acceptance for Assignment ${assignmentId} is unknown: ${failure.reason}. Lead replan is required`,
                  pathEvidence: [],
                  createdAt: this.options.clock.now(),
                  resolution: null,
                },
              ];
            },
          );
          const newAttentionItems = [...providerAttentionItems, ...acceptanceUnknownAttentionItems];
          return {
            mission: raiseAttentionItems(
              {
                ...mission,
                assignments: mission.assignments.map((assignment) => {
                  const dispatch = acceptedById.get(assignment.assignmentId);
                  if (dispatch && assignment.semanticState === "planned") {
                    return {
                      ...assignment,
                      revision: assignment.revision + 1,
                      runtimeAgentId: dispatch.agentId,
                      bindingEpoch: dispatch.bindingEpoch,
                      scopeLease: dispatch.lease,
                      workspaceBaseline: dispatch.baseline,
                      dispatchState: "dispatched" as const,
                      semanticState: "running" as const,
                      acceptedTurnId: dispatch.turnId,
                      dispatchedAt: this.options.clock.now(),
                    };
                  }
                  if (
                    (exhaustedProviderFailures.has(assignment.assignmentId) ||
                      acceptanceUnknownByAssignmentId.has(assignment.assignmentId)) &&
                    assignment.semanticState === "planned"
                  ) {
                    return {
                      ...assignment,
                      revision: assignment.revision + 1,
                      semanticState: "blocked" as const,
                      terminationReason: acceptanceUnknownByAssignmentId.has(
                        assignment.assignmentId,
                      )
                        ? ("dispatch_acceptance_unknown" as const)
                        : ("provider_unavailable" as const),
                    };
                  }
                  return assignment;
                }),
                workstreams: mission.workstreams.map((workstream) => {
                  if (
                    accepted.some(
                      (candidate) => candidate.assignment.workstreamId === workstream.workstreamId,
                    )
                  ) {
                    const acceptedAssignment = accepted.find(
                      (candidate) => candidate.assignment.workstreamId === workstream.workstreamId,
                    )!.assignment;
                    return {
                      ...workstream,
                      status: acceptedAssignment.kind === "review" ? "review" : "active",
                    };
                  }
                  return [
                    ...exhaustedProviderFailures.values(),
                    ...acceptanceUnknownByAssignmentId.values(),
                  ].some(
                    (failure) =>
                      failure.candidate.assignment.workstreamId === workstream.workstreamId,
                  )
                    ? { ...workstream, status: "blocked" as const }
                    : workstream;
                }),
              },
              newAttentionItems,
            ),
            recovery: {
              ...recovery,
              ownershipIntervals: [
                ...recovery.ownershipIntervals,
                ...accepted.flatMap((candidate) => {
                  if (
                    !candidate.lease ||
                    recovery.ownershipIntervals.some(
                      (interval) => interval.assignmentId === candidate.assignment.assignmentId,
                    )
                  ) {
                    return [];
                  }
                  return [
                    {
                      intervalId: candidate.lease.leaseId,
                      workspaceId: candidate.lease.workspaceId,
                      assignmentId: candidate.assignment.assignmentId,
                      scope: candidate.lease.scope,
                      startedAt: candidate.lease.acquiredAt,
                      state: "open" as const,
                      endedAt: null,
                      closure: null,
                    },
                  ];
                }),
              ],
              assignmentDispatchIntents: recovery.assignmentDispatchIntents.flatMap((intent) => {
                if (acceptedById.has(intent.assignmentId)) return [];
                if (acceptanceUnknownByAssignmentId.has(intent.assignmentId)) return [intent];
                const exhausted = exhaustedProviderFailures.get(intent.assignmentId);
                if (exhausted) {
                  return [
                    {
                      ...intent,
                      attempts: PROVIDER_DISPATCH_MAX_ATTEMPTS,
                      nextEligibleAt: this.options.clock.now(),
                      lastFailureKind: "provider_unavailable" as const,
                      lastFailureReason: exhausted.reason,
                    },
                  ];
                }
                const retry = retryByAssignmentId.get(intent.assignmentId);
                return retry
                  ? [
                      {
                        ...intent,
                        attempts: retry.attempts,
                        nextEligibleAt: retry.nextEligibleAt,
                        lastFailureKind: retry.failureKind,
                        lastFailureReason: retry.failureReason,
                      },
                    ]
                  : [intent];
              }),
            },
          };
        },
      });
      await this.reconcileFinishedDispatchIntents(updated);
      const publishableDispatchCount =
        accepted.length + exhaustedProviderFailures.size + acceptanceUnknownByAssignmentId.size;
      if (publishableDispatchCount > 0) {
        await this.options.events.publishMission(updated.mission);
      }
    }

    const dispatchedAssignmentIds = accepted.map((candidate) => candidate.assignment.assignmentId);
    const dispatched = new Set(dispatchedAssignmentIds);
    return {
      missionId,
      dispatchedAssignmentIds,
      deferredAssignmentIds: stored.mission.assignments
        .filter(
          (assignment) =>
            assignment.semanticState === "planned" && !dispatched.has(assignment.assignmentId),
        )
        .map((assignment) => assignment.assignmentId),
    };
  }

  private async reconcileDurableTurnFacts(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<{
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>;
    observed: ReadonlyMap<string, AcceptedTurnFact>;
  }> {
    const assignmentTurns = stored.mission.assignments.flatMap((assignment) =>
      assignment.acceptedTurnId && assignment.runtimeAgentId
        ? [
            {
              assignmentId: assignment.assignmentId,
              turnId: assignment.acceptedTurnId,
              runtimeAgentId: assignment.runtimeAgentId,
              semanticState: assignment.semanticState,
            },
          ]
        : [],
    );
    const recoveryTurns = stored.assignmentReportRecoveryOutbox.flatMap((delivery) =>
      delivery.state === "dispatched"
        ? [
            {
              assignmentId: delivery.assignmentId,
              turnId: delivery.turnId,
              runtimeAgentId: delivery.agentId,
              semanticState: "needs_report" as const,
            },
          ]
        : [],
    );
    const turns = deduplicateTurnReferences([...assignmentTurns, ...recoveryTurns]);
    const observed = await this.options.turnFacts.read(turns);
    const factsToRecord = turns.flatMap((turn) => {
      const fact = observed.get(turn.turnId);
      if (
        !fact ||
        fact.assignmentId !== turn.assignmentId ||
        !isPersistableTurnOutcome(fact.outcome)
      ) {
        return [];
      }
      return [
        {
          assignmentId: fact.assignmentId,
          turnId: fact.turnId,
          runtimeAgentId: fact.runtimeAgentId,
          outcome: fact.outcome,
          recordedAt: this.options.clock.now(),
        },
      ];
    });
    if (factsToRecord.length > 0) {
      stored = await this.options.missions.recordAcceptedTurnFacts({
        missionId: stored.mission.id,
        facts: factsToRecord,
      });
    }
    return { stored, observed };
  }

  private async reconcileTerminalMission(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<TeamMissionSchedulerCoreResult> {
    await this.options.leases.releaseMission({ missionId: stored.mission.id });
    return {
      missionId: stored.mission.id,
      dispatchedAssignmentIds: [],
      deferredAssignmentIds: [],
    };
  }

  private async completeReadyMission(missionId: string): Promise<void> {
    const stored = await this.options.missions.get(missionId);
    if (
      !stored ||
      stored.finishIntent ||
      isTerminalMissionStatus(stored.mission.status) ||
      !isMissionReadyToComplete(stored)
    ) {
      return;
    }
    try {
      const completed = await this.options.lifecycle.completeMission({
        idempotencyKey: `scheduler:${stored.mission.id}:${stored.mission.planRevision}:complete`,
        missionId: stored.mission.id,
        expectedRevision: stored.mission.revision,
        acceptedTurns: structuredClone(stored.acceptedTurnFacts),
      });
      if (isTerminalMissionStatus(completed.status)) {
        await this.options.leases.releaseMission({ missionId: completed.id });
      }
    } catch (error) {
      if (error instanceof MissionRevisionConflictError) return;
      throw error;
    }
  }

  private async reconcileStoppedMission(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<TeamMissionSchedulerCoreResult | null> {
    if (isTerminalMissionStatus(stored.mission.status)) {
      return this.reconcileTerminalMission(stored);
    }
    if (!stored.finishIntent) return null;
    return {
      missionId: stored.mission.id,
      dispatchedAssignmentIds: [],
      deferredAssignmentIds: stored.mission.assignments
        .filter((assignment) => assignment.semanticState === "planned")
        .map((assignment) => assignment.assignmentId),
    };
  }

  private async acquireLease(
    mission: TeamMission,
    assignment: MissionAssignmentContract,
  ): Promise<MissionScopeLease | null> {
    if (assignment.mutableScope.kind === "read_only") return null;
    return this.options.leases.acquire({
      teamId: mission.teamId,
      missionId: mission.id,
      workspaceId: mission.workspaceId,
      assignmentId: assignment.assignmentId,
      scope: assignment.mutableScope,
      priority: assignment.priority,
      createdAt: assignment.createdAt,
    });
  }

  private async reconcileFinishedDispatchIntents(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const assignmentsById = new Map(
      stored.mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    );
    const finished = stored.assignmentDispatchIntents.filter((intent) => {
      const assignment = assignmentsById.get(intent.assignmentId);
      if (assignment?.terminationReason === "dispatch_acceptance_unknown") {
        // The provider may still be writing. Keep the physical lease until the
        // Mission is explicitly canceled and terminal cleanup releases it.
        return false;
      }
      return assignment?.semanticState !== "planned";
    });
    if (finished.length === 0) return stored;
    await Promise.all(
      finished.flatMap((intent) =>
        intent.scopeLease ? [this.options.leases.release(intent.scopeLease)] : [],
      ),
    );
    const finishedIds = new Set(finished.map((intent) => intent.assignmentId));
    return this.options.missions.updateRecoveryState({
      missionId: stored.mission.id,
      expectedStorageRevision: stored.storageRevision,
      update: (recovery) => ({
        ...recovery,
        assignmentDispatchIntents: recovery.assignmentDispatchIntents.filter(
          (intent) => !finishedIds.has(intent.assignmentId),
        ),
      }),
    });
  }

  private async reconcileSettledWorkstreamStatuses(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const factsByTurnId = new Map(stored.acceptedTurnFacts.map((fact) => [fact.turnId, fact]));
    const desiredStatuses = new Map<string, TeamMission["workstreams"][number]["status"]>();
    const attentionBlockedWorkstreamIds = selectAttentionBlockedWorkstreamIds(stored.mission);
    const coverage = resolveMissionAssignmentCoverage(stored.mission, {
      acceptedTurnsById: factsByTurnId,
    });
    const validationContext = { acceptedTurnsById: factsByTurnId };
    for (const workstream of stored.mission.workstreams) {
      if (attentionBlockedWorkstreamIds.has(workstream.workstreamId)) continue;
      if (workstream.kind === "verification") continue;
      const deliveryAssignmentId = coverage.assignmentIdsByWorkstreamId.get(
        workstream.workstreamId,
      );
      if (
        !deliveryAssignmentId ||
        !coverage.completedDeliveryAssignmentIds.has(deliveryAssignmentId)
      ) {
        continue;
      }
      desiredStatuses.set(
        workstream.workstreamId,
        !isMissionReviewGateSettledByEvidence(
          stored.mission,
          workstream.workstreamId,
          validationContext,
        )
          ? "review"
          : "accepted",
      );
    }
    for (const workstream of stored.mission.workstreams) {
      if (attentionBlockedWorkstreamIds.has(workstream.workstreamId)) continue;
      const assignment = stored.mission.assignments
        .filter(
          (candidate) =>
            candidate.workstreamId === workstream.workstreamId &&
            candidate.planRevision === stored.mission.planRevision &&
            candidate.dispatchState === "settled" &&
            candidate.report !== null &&
            candidate.acceptedTurnId !== null,
        )
        .toSorted((left, right) => assignmentPhase(right.kind) - assignmentPhase(left.kind))[0];
      if (!assignment?.acceptedTurnId) continue;
      const fact = factsByTurnId.get(assignment.acceptedTurnId);
      if (
        !fact ||
        fact.assignmentId !== assignment.assignmentId ||
        fact.runtimeAgentId !== assignment.runtimeAgentId
      ) {
        continue;
      }
      desiredStatuses.set(
        workstream.workstreamId,
        settledWorkstreamStatus(
          assignment,
          fact.outcome,
          isMissionReviewGateSettledByEvidence(
            stored.mission,
            workstream.workstreamId,
            validationContext,
          ),
        ),
      );
    }
    if (
      stored.mission.workstreams.every(
        (workstream) =>
          desiredStatuses.get(workstream.workstreamId) === undefined ||
          desiredStatuses.get(workstream.workstreamId) === workstream.status,
      )
    ) {
      return stored;
    }
    const updated = await this.options.missions.update({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: (mission) => ({
        ...mission,
        workstreams: mission.workstreams.map((workstream) => ({
          ...workstream,
          status: desiredStatuses.get(workstream.workstreamId) ?? workstream.status,
        })),
      }),
    });
    await this.options.events.publishMission(updated.mission);
    return updated;
  }

  private async synchronizeReviewGateAttentions(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    let projected = stored.mission;
    for (const workstream of stored.mission.workstreams) {
      const gate = workstream.reviewGate;
      if (
        workstream.status !== "review" ||
        gate.kind !== "required" ||
        gate.outcome.kind !== "pending" ||
        gate.selection.kind === "assigned"
      ) {
        continue;
      }
      const kind =
        gate.selection.kind === "awaiting_reviewer"
          ? "review_gate_reviewer_unavailable"
          : "review_gate_capability_unknown";
      const attentionId = reviewGateAttentionId(stored.mission.id, gate.gateKeyFingerprint, kind);
      if (projected.attentionItems.some((item) => item.attentionId === attentionId)) continue;
      projected = applyMissionAttentionTransition(projected, {
        kind: "raise",
        item: {
          attentionId,
          kind,
          scope: {
            kind: "workstream",
            workstreamId: workstream.workstreamId,
            blockDependents: true,
          },
          reviewGateDetails: {
            gateKey: gate.gateKey,
            gateKeyFingerprint: gate.gateKeyFingerprint,
            subjectFingerprint: gate.subjectFingerprint,
          },
          status: "open",
          priorMissionStatus: null,
          assignmentId: null,
          summary:
            kind === "review_gate_reviewer_unavailable"
              ? `No structurally eligible reviewer is available for Workstream ${workstream.workstreamId}`
              : `Reviewer capabilities are unknown for Workstream ${workstream.workstreamId}`,
          pathEvidence: [],
          createdAt: this.options.clock.now(),
          resolution: null,
        },
      });
    }
    if (projected === stored.mission) return stored;
    const updated = await this.options.missions.update({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: () => projected,
    });
    await this.options.events.publishMission(updated.mission);
    return updated;
  }

  private async reconcileReviewGateOutcomes(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const factsByTurnId = new Map(stored.acceptedTurnFacts.map((fact) => [fact.turnId, fact]));
    const approvedCandidatesByWorkstreamId = new Map<
      string,
      Array<{ assignment: MissionAssignmentContract; outcome: MissionWorkstream["reviewGate"] }>
    >();
    const decidedAt = this.options.clock.now();
    for (const assignment of stored.mission.assignments) {
      const workstream = stored.mission.workstreams.find(
        (candidate) => candidate.workstreamId === assignment.workstreamId,
      );
      if (
        !workstream ||
        workstream.reviewGate.kind !== "required" ||
        workstream.reviewGate.outcome.kind !== "pending" ||
        assignment.report?.status !== "completed"
      ) {
        continue;
      }
      const reviewGate = {
        ...workstream.reviewGate,
        outcome: {
          kind: "approved" as const,
          gateKeyFingerprint: workstream.reviewGate.gateKeyFingerprint,
          subjectFingerprint: workstream.reviewGate.subjectFingerprint,
          reviewAssignmentId: assignment.assignmentId,
          reportFingerprint: missionReviewReportFingerprint(assignment.report),
          inheritedFromGateFingerprint: null,
          decidedAt,
        },
      };
      const tentativeMission: TeamMission = {
        ...stored.mission,
        workstreams: stored.mission.workstreams.map((candidate) =>
          candidate.workstreamId === workstream.workstreamId
            ? { ...candidate, reviewGate }
            : candidate,
        ),
      };
      if (
        !isMissionReviewGateSettledByEvidence(tentativeMission, workstream.workstreamId, {
          acceptedTurnsById: factsByTurnId,
        })
      ) {
        continue;
      }
      const candidates = approvedCandidatesByWorkstreamId.get(workstream.workstreamId) ?? [];
      candidates.push({ assignment, outcome: reviewGate });
      approvedCandidatesByWorkstreamId.set(workstream.workstreamId, candidates);
    }
    const approvedByWorkstreamId = new Map(
      [...approvedCandidatesByWorkstreamId].flatMap(([workstreamId, candidates]) =>
        candidates.length === 1 ? [[workstreamId, candidates[0]!] as const] : [],
      ),
    );
    if (approvedByWorkstreamId.size === 0) return stored;
    const updated = await this.options.missions.update({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: (mission) => ({
        ...mission,
        workstreams: mission.workstreams.map((workstream) => {
          const approved = approvedByWorkstreamId.get(workstream.workstreamId);
          if (!approved || approved.outcome.kind !== "required") return workstream;
          return {
            ...workstream,
            reviewGate: approved.outcome,
          };
        }),
      }),
    });
    await this.options.events.publishMission(updated.mission);
    return updated;
  }

  private async reconcileParticipantAvailability(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
    forcedUnavailableAgentIds: ReadonlySet<string> = new Set(),
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    if (stored.finishIntent || isTerminalMissionStatus(stored.mission.status)) return stored;
    const unavailableAgentIds = await this.inspectUnavailableAgentIds(
      stored.mission,
      forcedUnavailableAgentIds,
    );
    const projection = projectParticipantAvailability(
      stored.mission,
      unavailableAgentIds,
      this.options.clock.now(),
    );
    if (!projection.changed) return stored;
    const updated = await this.options.missions.update({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: () => projection.mission,
    });
    await this.options.events.publishMission(updated.mission);
    return updated;
  }

  private async inspectUnavailableAgentIds(
    mission: TeamMission,
    forcedUnavailableAgentIds: ReadonlySet<string>,
  ): Promise<Set<string>> {
    const unavailableAgentIds = new Set(forcedUnavailableAgentIds);
    const inspect = this.options.participants.inspectParticipant;
    if (!inspect) return unavailableAgentIds;
    const inspected = await Promise.all(
      mission.participants
        .filter((participant) => participant.archivedAt === null)
        .map(async (participant) => ({
          participant,
          state: await this.options.participants.inspectParticipant!({
            teamId: mission.teamId,
            missionId: mission.id,
            memberId: participant.memberId,
            agentId: participant.agentId,
            bindingEpoch: participant.bindingEpoch,
          }),
        })),
    );
    for (const { participant, state } of inspected) {
      if (state !== "active") unavailableAgentIds.add(participant.agentId);
    }
    return unavailableAgentIds;
  }

  private async provisionMissingParticipants(
    mission: TeamMission,
    readyAssignments: MissionAssignmentContract[],
  ): Promise<TeamMission["participants"]> {
    const missingMemberIds = new Set(
      readyAssignments
        .filter((assignment) => !activeParticipant(mission, assignment.assigneeMemberId))
        .map((assignment) => assignment.assigneeMemberId),
    );
    const roster = mission.rosterSnapshots.find(
      (snapshot) => snapshot.revision === mission.activeRosterSnapshotRevision,
    );
    if (!roster) throw new Error(`Mission ${mission.id} active roster snapshot is missing`);
    return Promise.all(
      [...missingMemberIds].map(async (memberId) => {
        const member = roster.members.find((candidate) => candidate.memberId === memberId);
        if (!member) throw new Error(`Mission ${mission.id} Member ${memberId} is missing`);
        const bindingEpoch = nextBindingEpoch(mission, memberId);
        const agentId = participantAgentId(mission.id, memberId, bindingEpoch);
        await this.options.participants.ensureParticipant({
          teamId: mission.teamId,
          missionId: mission.id,
          workspaceId: mission.workspaceId,
          memberId,
          agentId,
          bindingEpoch,
          role: member.role,
          mentionHandle: member.mentionHandle,
          executionProfile: member.executionProfile,
        });
        return {
          memberId,
          agentId,
          bindingEpoch,
          joinedAt: this.options.clock.now(),
          archivedAt: null,
        };
      }),
    );
  }

  private async materializeQualityGates(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const mission = stored.mission;
    if (isTerminalMissionStatus(mission.status)) return stored;

    if (isMissionReadyToComplete(stored)) return stored;

    const acceptedTurnsById = new Map(stored.acceptedTurnFacts.map((fact) => [fact.turnId, fact]));
    const coverage = resolveMissionAssignmentCoverage(mission, { acceptedTurnsById });
    const settledReviewGateWorkstreamIds = resolveMissionSettledReviewGateWorkstreamIds(mission, {
      acceptedTurnsById,
    });
    const qualityGates = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds,
      acceptedTurnsById,
      createdAt: this.options.clock.now(),
    });
    const hasOpenMissionAttention = mission.attentionItems.some(
      (item) => item.status === "open" && item.scope.kind === "mission",
    );
    const attentionBlockedWorkstreamIds = selectAttentionBlockedWorkstreamIds(mission);
    const additions = hasOpenMissionAttention
      ? []
      : qualityGates.additions.filter(
          (assignment) => !attentionBlockedWorkstreamIds.has(assignment.workstreamId),
        );
    const replacementReviewIdByWorkstreamId = new Map(
      qualityGates.selectedAssignments.flatMap((assignment) =>
        assignment.kind === "review" &&
        additions.some((candidate) => candidate.assignmentId === assignment.assignmentId)
          ? [[assignment.workstreamId, assignment.assignmentId] as const]
          : [],
      ),
    );
    const obsoleteReviewIds = new Set(
      qualityGates.obsoleteReviewAssignments.flatMap((assignment) =>
        replacementReviewIdByWorkstreamId.has(assignment.workstreamId)
          ? [assignment.assignmentId]
          : [],
      ),
    );
    const acceptedReviewTurnIds = new Set(
      qualityGates.obsoleteReviewAssignments.flatMap((assignment) => {
        if (assignment.acceptedTurnId === null || assignment.runtimeAgentId === null) return [];
        const fact = acceptedTurnsById.get(assignment.acceptedTurnId);
        return fact?.assignmentId === assignment.assignmentId &&
          fact.runtimeAgentId === assignment.runtimeAgentId
          ? [assignment.acceptedTurnId]
          : [];
      }),
    );
    const selectedVerification = qualityGates.currentVerificationAssignments[0];
    const selectedVerificationIsMaterialized =
      selectedVerification !== undefined &&
      (mission.assignments.some(
        (assignment) => assignment.assignmentId === selectedVerification.assignmentId,
      ) ||
        additions.some(
          (assignment) => assignment.assignmentId === selectedVerification.assignmentId,
        ));
    const obsoleteVerificationIds = new Set(
      selectedVerificationIsMaterialized
        ? qualityGates.obsoleteVerificationAssignments.map((assignment) => assignment.assignmentId)
        : [],
    );
    const allDeliveryPathsAccepted = mission.workstreams
      .filter((workstream) => workstream.kind !== "verification")
      .every((workstream) => workstream.status === "accepted");
    const currentVerification =
      qualityGates.currentVerificationAssignments.length === 1
        ? qualityGates.currentVerificationAssignments[0]
        : undefined;
    const canAdvanceExistingVerification =
      currentVerification !== undefined &&
      sameAssignmentIdSet(
        currentVerification.subjectAssignmentIds,
        qualityGates.expectedVerificationSubjectIds,
      ) &&
      sameAssignmentIdSet(
        currentVerification.dependencyAssignmentIds,
        qualityGates.expectedVerificationSubjectIds,
      );
    const canEnterVerification =
      !hasOpenMissionAttention &&
      allDeliveryPathsAccepted &&
      qualityGates.expectedVerificationSubjectIds.length > 0;

    const advancesExistingVerification =
      canEnterVerification && canAdvanceExistingVerification && mission.status !== "verifying";
    if (
      additions.length === 0 &&
      obsoleteReviewIds.size === 0 &&
      obsoleteVerificationIds.size === 0 &&
      !advancesExistingVerification
    ) {
      return stored;
    }
    const updated = await this.options.missions.updateAggregate({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: ({ mission: current, recovery }) => ({
        mission: {
          ...current,
          status: advancesExistingVerification ? "verifying" : current.status,
          workstreams: current.workstreams.map((workstream) =>
            replacementReviewIdByWorkstreamId.has(workstream.workstreamId)
              ? { ...workstream, status: "review" as const }
              : workstream,
          ),
          assignments: [
            ...current.assignments.map((assignment) =>
              obsoleteVerificationIds.has(assignment.assignmentId) ||
              obsoleteReviewIds.has(assignment.assignmentId)
                ? supersedeQualityGateAssignment({
                    assignment,
                    replacementAssignmentId:
                      assignment.kind === "review"
                        ? (replacementReviewIdByWorkstreamId.get(assignment.workstreamId) ?? null)
                        : (selectedVerification?.assignmentId ?? null),
                    hasAcceptedTurn:
                      assignment.kind !== "review" ||
                      (assignment.acceptedTurnId !== null &&
                        acceptedReviewTurnIds.has(assignment.acceptedTurnId)),
                    settledAt: this.options.clock.now(),
                  })
                : assignment,
            ),
            ...additions,
          ],
        },
        recovery: {
          ...recovery,
          assignmentReportRecoveryOutbox: recovery.assignmentReportRecoveryOutbox.filter(
            (delivery) => !obsoleteReviewIds.has(delivery.assignmentId),
          ),
        },
      }),
    });
    await Promise.all(
      [...obsoleteReviewIds, ...obsoleteVerificationIds].map((assignmentId) =>
        this.options.leases.releaseAssignment({
          workspaceId: mission.workspaceId,
          assignmentId,
        }),
      ),
    );
    await this.options.events.publishMission(updated.mission);
    return updated;
  }

  private async settleTerminalAssignments(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
    observedTurnFacts: ReadonlyMap<string, AcceptedTurnFact>,
    enqueueMissingReportRecovery = true,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const factsByTurnId = new Map<string, AcceptedTurnFact>(observedTurnFacts);
    for (const fact of stored.acceptedTurnFacts) {
      factsByTurnId.set(fact.turnId, fact);
    }
    const terminal = stored.mission.assignments.filter((assignment) => {
      if (assignment.semanticState !== "running" || assignment.acceptedTurnId === null) {
        return false;
      }
      const fact = factsByTurnId.get(assignment.acceptedTurnId);
      return fact?.assignmentId === assignment.assignmentId && isSettledAcceptedTurnFact(fact);
    });
    if (terminal.length === 0) return stored;

    const transitions = await Promise.all(
      terminal.map(async (assignment) => {
        if (!assignment.workspaceBaseline) {
          throw new Error(`Assignment ${assignment.assignmentId} has no workspace baseline`);
        }
        const turnId = assignment.acceptedTurnId;
        if (turnId === null) {
          throw new Error(`Assignment ${assignment.assignmentId} has no accepted turn`);
        }
        const fact = factsByTurnId.get(turnId);
        if (!fact)
          throw new Error(`Assignment ${assignment.assignmentId} terminal fact is missing`);
        if (!isSettledAcceptedTurnFact(fact)) {
          throw new Error(`Assignment ${assignment.assignmentId} turn is still running`);
        }
        const durableFact = stored.acceptedTurnFacts.find(
          (candidate) =>
            candidate.turnId === turnId && candidate.assignmentId === assignment.assignmentId,
        );
        if (!durableFact) {
          throw new Error(`Assignment ${assignment.assignmentId} durable terminal fact is missing`);
        }
        const delta = await this.options.workspace.captureDelta({
          workspaceId: stored.mission.workspaceId,
          assignmentId: assignment.assignmentId,
          scope: assignment.mutableScope,
          baseline: assignment.workspaceBaseline,
          policy: stored.mission.workspaceAuditPolicy,
        });
        return { assignment, fact: durableFact, delta };
      }),
    );
    const now = this.options.clock.now();
    const transitionById = new Map(
      transitions.map((transition) => [transition.assignment.assignmentId, transition]),
    );
    const updated = await this.options.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: ({ mission, recovery }) => {
        const ownershipViolations = transitions.filter(
          (transition) => transition.delta.violations.length > 0,
        );
        const assignmentsRequiringReplan = transitions.filter((transition) =>
          assignmentRequiresReplan(transition.assignment, transition.fact),
        );
        const priorMissionStatus =
          mission.status === "needs_attention" ? mission.suspendedStatus : mission.status;
        const canSuspend =
          priorMissionStatus === "planning" ||
          priorMissionStatus === "active" ||
          priorMissionStatus === "verifying";
        const newAttentionItems = [
          ...ownershipViolations.flatMap((transition) => {
            const attentionId = ownershipViolationAttentionId(
              mission.id,
              transition.assignment.assignmentId,
            );
            if (mission.attentionItems.some((item) => item.attentionId === attentionId)) return [];
            return [
              {
                attentionId,
                kind: "ownership_violation" as const,
                scope: { kind: "mission" as const },
                status: "open" as const,
                priorMissionStatus: canSuspend ? priorMissionStatus : ("active" as const),
                assignmentId: transition.assignment.assignmentId,
                summary: `Assignment ${transition.assignment.assignmentId} changed paths outside its ownership scope`,
                pathEvidence: structuredClone(transition.delta.violations),
                createdAt: now,
                resolution: null,
              },
            ];
          }),
          ...assignmentsRequiringReplan.flatMap((transition) => {
            const attentionId = assignmentReplanAttentionId(
              mission.id,
              transition.assignment.assignmentId,
            );
            if (mission.attentionItems.some((item) => item.attentionId === attentionId)) return [];
            return [
              {
                attentionId,
                kind: "assignment_requires_replan" as const,
                scope: { kind: "mission" as const },
                status: "open" as const,
                priorMissionStatus: canSuspend ? priorMissionStatus : ("active" as const),
                assignmentId: transition.assignment.assignmentId,
                summary: assignmentReplanSummary(transition.assignment, transition.fact),
                pathEvidence: structuredClone(transition.delta.capturedDelta),
                createdAt: now,
                resolution: null,
              },
            ];
          }),
        ];
        const leadReplanDeliveries = buildLeadReplanDeliveries({
          mission,
          existing: recovery.recipientAttentionOutbox,
          transitions: assignmentsRequiringReplan,
          now,
        });
        return {
          mission: raiseAttentionItems(
            {
              ...mission,
              assignments: mission.assignments.map((assignment) => {
                const transition = transitionById.get(assignment.assignmentId);
                if (!transition || assignment.semanticState !== "running") return assignment;
                return settleAssignment(assignment, transition.fact, transition.delta, now);
              }),
              workstreams: mission.workstreams.map((workstream) => {
                const transition = transitions.find(
                  (candidate) => candidate.assignment.workstreamId === workstream.workstreamId,
                );
                return transition
                  ? {
                      ...workstream,
                      status: settledWorkstreamStatus(
                        transition.assignment,
                        transition.fact.outcome,
                        isMissionReviewGateSettledByEvidence(mission, workstream.workstreamId, {
                          acceptedTurnsById: factsByTurnId,
                        }),
                      ),
                    }
                  : workstream;
              }),
            },
            newAttentionItems,
          ),
          recovery: {
            ...recovery,
            recipientAttentionOutbox: [
              ...recovery.recipientAttentionOutbox,
              ...leadReplanDeliveries,
            ],
            ownershipIntervals: recovery.ownershipIntervals.map((interval) => {
              const transition = transitionById.get(interval.assignmentId);
              if (!transition || interval.state === "closed") return interval;
              if (
                (transition.fact.outcome === "completed" && !transition.assignment.report) ||
                transition.delta.violations.length > 0
              ) {
                return interval;
              }
              return {
                ...interval,
                state: "closed" as const,
                endedAt: now,
                closure: transition.assignment.report ? ("report" as const) : ("external" as const),
              };
            }),
            assignmentReportRecoveryOutbox: [
              ...recovery.assignmentReportRecoveryOutbox,
              ...transitions.flatMap((transition) => {
                const assignment = transition.assignment;
                if (
                  !enqueueMissingReportRecovery ||
                  transition.fact.outcome !== "completed" ||
                  assignment.report !== null ||
                  recovery.assignmentReportRecoveryOutbox.some(
                    (delivery) => delivery.assignmentId === assignment.assignmentId,
                  )
                ) {
                  return [];
                }
                if (assignment.runtimeAgentId === null || assignment.bindingEpoch === null) {
                  throw new Error(
                    `Assignment ${assignment.assignmentId} has no participant binding for report recovery`,
                  );
                }
                return [
                  pendingReportRecoveryDelivery({
                    missionId: mission.id,
                    assignmentId: assignment.assignmentId,
                    agentId: assignment.runtimeAgentId,
                    bindingEpoch: assignment.bindingEpoch,
                    attempt: 1,
                    now,
                  }),
                ];
              }),
            ],
          },
        };
      },
    });
    await Promise.all(
      transitions.flatMap((transition) => {
        const keepsReportHold =
          transition.fact.outcome === "completed" && transition.assignment.report === null;
        const keepsOwnershipGate = transition.delta.violations.length > 0;
        return transition.assignment.scopeLease && !keepsReportHold && !keepsOwnershipGate
          ? [this.options.leases.release(transition.assignment.scopeLease)]
          : [];
      }),
    );
    await this.options.events.publishMission(updated.mission);
    return updated;
  }

  private async reconcileReleasedAssignments(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const reportHoldHandoffs = stored.assignmentDeltaHandoffs.filter(
      (handoff) => handoff.reportHoldLeaseId !== null,
    );
    if (reportHoldHandoffs.length > 0 && !this.options.leases.transferReportHold) {
      throw new Error("Workspace lease adapter does not support report-hold handoff");
    }
    for (const handoff of reportHoldHandoffs) {
      const leaseId = handoff.reportHoldLeaseId;
      if (!leaseId) continue;
      await this.options.leases.transferReportHold?.({
        leaseId,
        teamId: stored.mission.teamId,
        missionId: stored.mission.id,
        workspaceId: stored.mission.workspaceId,
        sourceAssignmentId: handoff.sourceAssignmentId,
        replacementAssignmentId: handoff.replacementAssignmentId,
      });
    }
    const unresolvedOwnershipAssignments = new Set(
      stored.mission.attentionItems
        .filter((item) => item.kind === "ownership_violation" && item.status === "open")
        .flatMap((item) => (item.assignmentId ? [item.assignmentId] : [])),
    );
    const acceptanceUnknownDispatchAssignments = new Set(
      stored.assignmentDispatchIntents.flatMap((intent) => {
        const assignment = stored.mission.assignments.find(
          (candidate) => candidate.assignmentId === intent.assignmentId,
        );
        return assignment?.terminationReason === "dispatch_acceptance_unknown"
          ? [intent.assignmentId]
          : [];
      }),
    );
    const releasable = stored.mission.assignments.filter(
      (assignment) =>
        assignment.scopeLease === null &&
        !acceptanceUnknownDispatchAssignments.has(assignment.assignmentId) &&
        !unresolvedOwnershipAssignments.has(assignment.assignmentId) &&
        ["blocked", "completed", "failed", "canceled"].includes(assignment.semanticState),
    );
    await Promise.all(
      releasable.map((assignment) =>
        this.options.leases.releaseAssignment({
          workspaceId: stored.mission.workspaceId,
          assignmentId: assignment.assignmentId,
        }),
      ),
    );
    const reportedAssignmentIds = new Set(
      releasable
        .filter((assignment) => assignment.report !== null)
        .map((assignment) => assignment.assignmentId),
    );
    const removesPendingRecovery = stored.assignmentReportRecoveryOutbox.some(
      (delivery) =>
        delivery.state === "pending" && reportedAssignmentIds.has(delivery.assignmentId),
    );
    const resolvedOwnershipClosures = new Map<string, "handoff" | "external">();
    for (const item of stored.mission.attentionItems) {
      if (
        item.kind !== "ownership_violation" ||
        item.status !== "resolved" ||
        !item.assignmentId ||
        !item.resolution
      ) {
        continue;
      }
      if (item.resolution.kind === "attribute_owner") {
        resolvedOwnershipClosures.set(item.assignmentId, "handoff");
      }
      if (item.resolution.kind === "external_change") {
        resolvedOwnershipClosures.set(item.assignmentId, "external");
      }
    }
    const closesOwnershipIntervals = stored.ownershipIntervals.some(
      (interval) =>
        interval.state === "open" && resolvedOwnershipClosures.has(interval.assignmentId),
    );
    if (!removesPendingRecovery && !closesOwnershipIntervals) return stored;
    const now = this.options.clock.now();
    return this.options.missions.updateRecoveryState({
      missionId: stored.mission.id,
      expectedStorageRevision: stored.storageRevision,
      update: (recovery) => ({
        ...recovery,
        ownershipIntervals: recovery.ownershipIntervals.map((interval) => {
          const closure = resolvedOwnershipClosures.get(interval.assignmentId);
          return interval.state === "open" && closure
            ? { ...interval, state: "closed" as const, endedAt: now, closure }
            : interval;
        }),
        assignmentReportRecoveryOutbox: recovery.assignmentReportRecoveryOutbox.filter(
          (delivery) =>
            delivery.state !== "pending" || !reportedAssignmentIds.has(delivery.assignmentId),
        ),
      }),
    });
  }

  private async synchronizeReportHolds(mission: TeamMission): Promise<void> {
    await Promise.all(
      mission.assignments.flatMap((assignment) => {
        const lease = assignment.scopeLease;
        if (assignment.semanticState !== "needs_report" || lease?.state !== "report_hold") {
          return [];
        }
        if (lease.transitionedAt === null) {
          throw new Error(
            `Assignment ${assignment.assignmentId} report hold has no transition time`,
          );
        }
        return [
          this.options.leases.transitionToReportHold({
            lease,
            transitionedAt: lease.transitionedAt,
            capturedDelta: lease.capturedDelta,
          }),
        ];
      }),
    );
  }

  private async reconcileReportRecoveries(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
    observedTurnFacts: ReadonlyMap<string, AcceptedTurnFact>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    stored = await this.settleReportRecoveryTurns(stored, observedTurnFacts);
    const now = this.options.clock.now();
    const assignmentsById = new Map(
      stored.mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    );
    const pending = stored.assignmentReportRecoveryOutbox.filter((delivery) => {
      if (delivery.state !== "pending" || delivery.nextEligibleAt > now) return false;
      const assignment = assignmentsById.get(delivery.assignmentId);
      return assignment?.semanticState === "needs_report";
    });
    const outcomes = await Promise.all(
      pending.map(async (delivery) => ({
        delivery,
        result: await this.options.dispatch.requestReport({
          teamId: stored.mission.teamId,
          missionId: stored.mission.id,
          assignmentId: delivery.assignmentId,
          agentId: delivery.agentId,
          bindingEpoch: delivery.bindingEpoch,
          attempt: delivery.attempt,
          messageId: delivery.messageId,
          methodologyPromptSections: methodologySectionsForAssignment(
            stored.mission,
            assignmentsById.get(delivery.assignmentId)!,
          ),
        }),
      })),
    );
    const accepted = outcomes.filter(
      (outcome): outcome is typeof outcome & { result: { kind: "accepted"; turnId: string } } =>
        outcome.result.kind === "accepted",
    );
    const failures = outcomes.filter(
      (
        outcome,
      ): outcome is typeof outcome & {
        result: Exclude<TeamAssignmentDispatchResult, { kind: "accepted" }>;
      } => outcome.result.kind !== "accepted",
    );
    if (accepted.length === 0 && failures.length === 0) return stored;

    const acceptedByDeliveryId = new Map(
      accepted.map((outcome) => [outcome.delivery.deliveryId, outcome]),
    );
    const failureByDeliveryId = new Map(
      failures.map((outcome) => [outcome.delivery.deliveryId, outcome]),
    );
    const updated = await this.options.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: ({ mission, recovery }) => ({
        mission: {
          ...mission,
          assignments: mission.assignments.map((assignment) => {
            const outcome = accepted.find(
              (candidate) => candidate.delivery.assignmentId === assignment.assignmentId,
            );
            if (!outcome || assignment.semanticState !== "needs_report") return assignment;
            const lease = assignment.scopeLease;
            return {
              ...assignment,
              revision: assignment.revision + 1,
              scopeLease:
                lease?.state === "report_hold"
                  ? { ...lease, recoveryAttempts: outcome.delivery.attempt }
                  : lease,
            };
          }),
        },
        recovery: {
          ...recovery,
          assignmentReportRecoveryOutbox: recovery.assignmentReportRecoveryOutbox.map(
            (delivery) => {
              const outcome = acceptedByDeliveryId.get(delivery.deliveryId);
              if (outcome && delivery.state === "pending") {
                return {
                  ...delivery,
                  state: "dispatched" as const,
                  turnId: outcome.result.turnId,
                  nextEligibleAt: null,
                  dispatchedAt: now,
                  settledAt: null,
                };
              }
              const failure = failureByDeliveryId.get(delivery.deliveryId);
              if (!failure || delivery.state !== "pending") return delivery;
              const dispatchAttempts = delivery.dispatchAttempts + 1;
              const lastFailureReason =
                failure.result.kind === "busy" ? "Agent is busy" : failure.result.reason;
              if (
                failure.result.kind === "acceptance_unknown" ||
                (failure.result.kind === "provider_unavailable" &&
                  dispatchAttempts >= PROVIDER_DISPATCH_MAX_ATTEMPTS)
              ) {
                return {
                  ...delivery,
                  state: "failed" as const,
                  turnId: null,
                  dispatchAttempts,
                  lastFailureKind: failure.result.kind,
                  lastFailureReason,
                  nextEligibleAt: null,
                  dispatchedAt: null,
                  settledAt: now,
                };
              }
              return {
                ...delivery,
                dispatchAttempts,
                lastFailureKind: failure.result.kind,
                lastFailureReason,
                nextEligibleAt: dispatchRetryAt(now, dispatchAttempts),
              };
            },
          ),
        },
      }),
    });
    const advanced = await this.advanceFailedReportRecoveries(updated);
    if (accepted.length > 0) await this.synchronizeReportHolds(advanced.mission);
    if (accepted.length > 0 || advanced.mission.revision !== updated.mission.revision) {
      await this.options.events.publishMission(advanced.mission);
    }
    return advanced;
  }

  private async advanceFailedReportRecoveries(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const failed = stored.assignmentReportRecoveryOutbox.filter((delivery) => {
      if (delivery.state !== "failed") return false;
      const assignment = stored.mission.assignments.find(
        (candidate) => candidate.assignmentId === delivery.assignmentId,
      );
      return assignment?.semanticState === "needs_report" && assignment.report === null;
    });
    if (failed.length === 0) return stored;

    const now = this.options.clock.now();
    const exhausted = failed.filter((delivery) => delivery.attempt === 2);
    const priorMissionStatus =
      stored.mission.status === "needs_attention"
        ? stored.mission.suspendedStatus
        : stored.mission.status;
    const canOpenAttention =
      priorMissionStatus === "planning" ||
      priorMissionStatus === "active" ||
      priorMissionStatus === "verifying";
    const newAttentionItems = canOpenAttention
      ? exhausted.flatMap((delivery) => {
          const attentionId = missingReportAttentionId(stored.mission.id, delivery.assignmentId);
          if (stored.mission.attentionItems.some((item) => item.attentionId === attentionId)) {
            return [];
          }
          const assignment = stored.mission.assignments.find(
            (candidate) => candidate.assignmentId === delivery.assignmentId,
          );
          return [
            {
              attentionId,
              kind: "missing_report" as const,
              scope: { kind: "mission" as const },
              status: "open" as const,
              priorMissionStatus,
              assignmentId: delivery.assignmentId,
              summary: `Assignment ${delivery.assignmentId} could not be reached for its report after bounded recovery`,
              pathEvidence:
                assignment?.scopeLease?.capturedDelta ??
                assignment?.terminalEvidence?.capturedDelta ??
                [],
              createdAt: now,
              resolution: null,
            },
          ];
        })
      : [];
    const additions = failed.flatMap((delivery) => {
      if (
        delivery.attempt !== 1 ||
        stored.assignmentReportRecoveryOutbox.some(
          (candidate) =>
            candidate.assignmentId === delivery.assignmentId && candidate.attempt === 2,
        )
      ) {
        return [];
      }
      return [
        pendingReportRecoveryDelivery({
          missionId: stored.mission.id,
          assignmentId: delivery.assignmentId,
          agentId: delivery.agentId,
          bindingEpoch: delivery.bindingEpoch,
          attempt: 2,
          now,
        }),
      ];
    });
    if (newAttentionItems.length === 0 && additions.length === 0) return stored;
    return this.options.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: ({ mission, recovery }) => ({
        mission: raiseAttentionItems(mission, newAttentionItems),
        recovery: {
          ...recovery,
          assignmentReportRecoveryOutbox: [
            ...recovery.assignmentReportRecoveryOutbox,
            ...additions,
          ],
        },
      }),
    });
  }

  private async settleReportRecoveryTurns(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
    observedTurnFacts: ReadonlyMap<string, AcceptedTurnFact>,
    enqueueNextAttempt = true,
  ): Promise<NonNullable<Awaited<ReturnType<MissionStore["get"]>>>> {
    const durableFactsByTurnId = new Map(
      stored.acceptedTurnFacts.map((fact) => [fact.turnId, fact]),
    );
    const settled = stored.assignmentReportRecoveryOutbox.filter((delivery) => {
      if (delivery.state !== "dispatched") return false;
      const durableFact = durableFactsByTurnId.get(delivery.turnId);
      if (
        durableFact?.assignmentId === delivery.assignmentId &&
        durableFact.runtimeAgentId === delivery.agentId
      ) {
        return true;
      }
      const observedFact = observedTurnFacts.get(delivery.turnId);
      return (
        observedFact?.assignmentId === delivery.assignmentId &&
        observedFact.runtimeAgentId === delivery.agentId &&
        observedFact.outcome !== "running"
      );
    });
    if (settled.length === 0) return stored;

    const now = this.options.clock.now();
    const settledDeliveryIds = new Set(settled.map((delivery) => delivery.deliveryId));
    return this.options.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: ({ mission, recovery }) => {
        const stillMissingReport = settled.filter((delivery) => {
          const assignment = mission.assignments.find(
            (candidate) => candidate.assignmentId === delivery.assignmentId,
          );
          return assignment?.semanticState === "needs_report" && assignment.report === null;
        });
        const exhausted = enqueueNextAttempt
          ? stillMissingReport.filter((delivery) => delivery.attempt === 2)
          : [];
        const priorMissionStatus =
          mission.status === "needs_attention" ? mission.suspendedStatus : mission.status;
        const canOpenAttention =
          priorMissionStatus === "planning" ||
          priorMissionStatus === "active" ||
          priorMissionStatus === "verifying";
        const newAttentionItems = canOpenAttention
          ? exhausted.flatMap((delivery) => {
              const attentionId = missingReportAttentionId(mission.id, delivery.assignmentId);
              if (mission.attentionItems.some((item) => item.attentionId === attentionId)) {
                return [];
              }
              const assignment = mission.assignments.find(
                (candidate) => candidate.assignmentId === delivery.assignmentId,
              );
              return [
                {
                  attentionId,
                  kind: "missing_report" as const,
                  scope: { kind: "mission" as const },
                  status: "open" as const,
                  priorMissionStatus,
                  assignmentId: delivery.assignmentId,
                  summary: `Assignment ${delivery.assignmentId} did not submit a report after two recovery turns`,
                  pathEvidence:
                    assignment?.scopeLease?.capturedDelta ??
                    assignment?.terminalEvidence?.capturedDelta ??
                    [],
                  createdAt: now,
                  resolution: null,
                },
              ];
            })
          : [];
        return {
          mission: raiseAttentionItems(mission, newAttentionItems),
          recovery: {
            ...recovery,
            assignmentReportRecoveryOutbox: [
              ...recovery.assignmentReportRecoveryOutbox.map((delivery) =>
                settledDeliveryIds.has(delivery.deliveryId) && delivery.state === "dispatched"
                  ? { ...delivery, state: "settled" as const, settledAt: now }
                  : delivery,
              ),
              ...stillMissingReport.flatMap((delivery) => {
                if (
                  !enqueueNextAttempt ||
                  delivery.attempt !== 1 ||
                  recovery.assignmentReportRecoveryOutbox.some(
                    (candidate) =>
                      candidate.assignmentId === delivery.assignmentId && candidate.attempt === 2,
                  )
                ) {
                  return [];
                }
                return [
                  pendingReportRecoveryDelivery({
                    missionId: mission.id,
                    assignmentId: delivery.assignmentId,
                    agentId: delivery.agentId,
                    bindingEpoch: delivery.bindingEpoch,
                    attempt: 2,
                    now,
                  }),
                ];
              }),
            ],
          },
        };
      },
    });
  }
}

function methodologySectionsForAssignment(
  mission: TeamMission,
  assignment: MissionAssignmentContract,
): FrozenPromptSection[] {
  return mission.methodologySnapshot.promptSections.filter(
    (section) => section.audience === assignment.kind,
  );
}

function settleAssignment(
  assignment: MissionAssignmentContract,
  fact: MissionAcceptedTurnFact,
  delta: Awaited<ReturnType<TeamWorkspaceSnapshotPort["captureDelta"]>>,
  now: string,
): MissionAssignmentContract {
  const outcome = fact.outcome;
  const terminalEvidence = {
    assignmentId: assignment.assignmentId,
    acceptedTurn: {
      turnId: fact.turnId,
      runtimeAgentId: fact.runtimeAgentId,
      outcome: fact.outcome,
      recordedAt: fact.recordedAt,
    },
    capturedDelta: structuredClone(delta.capturedDelta),
    ownershipViolations: structuredClone(delta.violations),
    report: structuredClone(assignment.report),
    handoffs: structuredClone(assignment.report?.handoffs ?? []),
    capturedAt: now,
  };
  if (outcome === "completed" && assignment.report === null) {
    return {
      ...assignment,
      revision: assignment.revision + 1,
      dispatchState: "settled",
      semanticState: "needs_report",
      scopeLease: assignment.scopeLease
        ? {
            ...assignment.scopeLease,
            state: "report_hold",
            transitionedAt: now,
            capturedDelta: delta.capturedDelta,
          }
        : null,
      settledAt: now,
      terminalEvidence,
    };
  }
  const semanticState =
    outcome === "completed" ? reportSemanticState(assignment) : ("failed" as const);
  let terminationReason = assignment.terminationReason;
  if (outcome === "failed") terminationReason = "turn_failed";
  if (outcome === "canceled") terminationReason = "turn_canceled";
  if (outcome === "unknown") terminationReason = "turn_unknown";
  return {
    ...assignment,
    revision: assignment.revision + 1,
    dispatchState: "settled",
    semanticState,
    terminationReason,
    scopeLease: null,
    settledAt: now,
    terminalEvidence,
  };
}

function reportSemanticState(
  assignment: MissionAssignmentContract,
): "completed" | "blocked" | "failed" {
  if (assignment.report?.status === "completed") {
    return assignment.kind !== "delivery" && assignment.report.verdict === "changes_requested"
      ? "failed"
      : "completed";
  }
  if (assignment.report?.status === "blocked") return "blocked";
  return "failed";
}

function supersedeQualityGateAssignment(input: {
  assignment: MissionAssignmentContract;
  replacementAssignmentId: string | null;
  hasAcceptedTurn: boolean;
  settledAt: string;
}): MissionAssignmentContract {
  const canceled = {
    ...input.assignment,
    revision: input.assignment.revision + 1,
    semanticState: "canceled" as const,
    supersededBy: input.replacementAssignmentId,
    terminationReason: "superseded" as const,
    scopeLease: null,
    settledAt: input.assignment.settledAt ?? input.settledAt,
  };
  if (input.hasAcceptedTurn) return canceled;
  return {
    ...canceled,
    runtimeAgentId: null,
    bindingEpoch: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "queued",
    acceptedTurnId: null,
    dispatchedAt: null,
  };
}

function settledWorkstreamStatus(
  assignment: MissionAssignmentContract,
  outcome: SettledTurnOutcome,
  reviewGateSettled: boolean,
): TeamMission["workstreams"][number]["status"] {
  if (outcome !== "completed") return "blocked";
  if (assignment.report === null) return "active";
  if (assignment.report?.status === "blocked" || assignment.report?.status === "failed") {
    return "blocked";
  }
  if (
    (assignment.kind === "review" || assignment.kind === "verification") &&
    assignment.report?.verdict === "changes_requested"
  ) {
    return "blocked";
  }
  if (!reviewGateSettled) return "review";
  return "accepted";
}

function isPersistableTurnOutcome(
  outcome: AcceptedTurnOutcome,
): outcome is "completed" | "failed" | "canceled" | "unknown" {
  return (
    outcome === "completed" ||
    outcome === "failed" ||
    outcome === "canceled" ||
    outcome === "unknown"
  );
}

function isSettledAcceptedTurnFact(fact: AcceptedTurnFact): fact is SettledAcceptedTurnFact {
  return fact.outcome !== "running";
}

function assignmentPhase(kind: MissionAssignmentContract["kind"]): number {
  if (kind === "verification") return 3;
  if (kind === "review") return 2;
  return 1;
}

function classifyDispatchOutcomes(outcomes: DispatchOutcome[], now: string) {
  const accepted: AcceptedDispatch[] = [];
  const retryByAssignmentId = new Map<string, DispatchRetry>();
  const exhaustedProviderFailures = new Map<
    string,
    { candidate: PreparedDispatch; reason: string }
  >();
  const acceptanceUnknownByAssignmentId = new Map<string, DispatchAcceptanceUnknown>();
  for (const outcome of outcomes) {
    if (outcome.result.kind === "accepted") {
      accepted.push({ ...outcome.candidate, turnId: outcome.result.turnId });
      continue;
    }
    if (outcome.result.kind === "acceptance_unknown") {
      acceptanceUnknownByAssignmentId.set(outcome.candidate.assignment.assignmentId, {
        candidate: outcome.candidate,
        reason: outcome.result.reason,
      });
      continue;
    }
    const attempts = outcome.candidate.dispatchAttempts + 1;
    const assignmentId = outcome.candidate.assignment.assignmentId;
    if (
      outcome.result.kind === "provider_unavailable" &&
      attempts >= PROVIDER_DISPATCH_MAX_ATTEMPTS
    ) {
      exhaustedProviderFailures.set(assignmentId, {
        candidate: outcome.candidate,
        reason: outcome.result.reason,
      });
      continue;
    }
    retryByAssignmentId.set(assignmentId, {
      attempts,
      nextEligibleAt: dispatchRetryAt(now, attempts),
      failureKind: outcome.result.kind,
      failureReason:
        outcome.result.kind === "provider_unavailable" ? outcome.result.reason : "Agent is busy",
    });
  }
  return {
    accepted,
    retryByAssignmentId,
    exhaustedProviderFailures,
    acceptanceUnknownByAssignmentId,
  };
}

function toDispatchIntent(candidate: PreparedDispatch): MissionAssignmentDispatchIntent {
  return {
    assignmentId: candidate.assignment.assignmentId,
    runtimeAgentId: candidate.agentId,
    bindingEpoch: candidate.bindingEpoch,
    scopeLease: candidate.lease,
    workspaceBaseline: candidate.baseline,
    messageId: candidate.messageId,
    preparedAt: candidate.preparedAt,
    attempts: candidate.dispatchAttempts,
    nextEligibleAt: candidate.preparedAt,
    lastFailureKind: null,
    lastFailureReason: null,
  };
}

function pendingReportRecoveryDelivery(input: {
  missionId: string;
  assignmentId: string;
  agentId: string;
  bindingEpoch: number;
  attempt: 1 | 2;
  now: string;
}) {
  return {
    deliveryId: `${input.missionId}:${input.assignmentId}:report-recovery:${input.attempt}`,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    bindingEpoch: input.bindingEpoch,
    attempt: input.attempt,
    messageId: `team-mission:${input.missionId}:assignment:${input.assignmentId}:report-recovery:${input.attempt}`,
    state: "pending" as const,
    turnId: null,
    createdAt: input.now,
    dispatchAttempts: 0,
    lastFailureKind: null,
    lastFailureReason: null,
    nextEligibleAt: input.now,
    dispatchedAt: null,
    settledAt: null,
  };
}

function missingReportAttentionId(missionId: string, assignmentId: string): string {
  return `${missionId}:${assignmentId}:missing-report`;
}

function ownershipViolationAttentionId(missionId: string, assignmentId: string): string {
  return `${missionId}:${assignmentId}:ownership-violation`;
}

function providerUnavailableAttentionId(missionId: string, assignmentId: string): string {
  return `${missionId}:${assignmentId}:provider-unavailable`;
}

function dispatchAcceptanceUnknownAttentionId(missionId: string, assignmentId: string): string {
  return `${missionId}:${assignmentId}:dispatch-acceptance-unknown`;
}

function dispatchRetryAt(now: string, attempts: number): string {
  const exponent = Math.min(Math.max(attempts - 1, 0), 6);
  return new Date(Date.parse(now) + DISPATCH_RETRY_BASE_DELAY_MS * 2 ** exponent).toISOString();
}

function raiseAttentionItems(
  mission: TeamMission,
  items: ReadonlyArray<MissionAttentionItem>,
): TeamMission {
  return items.reduce(
    (projected, item) => applyMissionAttentionTransition(projected, { kind: "raise", item }),
    mission,
  );
}

function assertIntentBinding(
  intent: MissionAssignmentDispatchIntent,
  agentId: string,
  bindingEpoch: number,
): void {
  if (intent.runtimeAgentId !== agentId || intent.bindingEpoch !== bindingEpoch) {
    throw new Error(`Assignment ${intent.assignmentId} dispatch binding changed after preparation`);
  }
}

interface ParticipantAvailabilityProjection {
  mission: TeamMission;
  changed: boolean;
}

function projectParticipantAvailability(
  mission: TeamMission,
  unavailableAgentIds: ReadonlySet<string>,
  now: string,
): ParticipantAvailabilityProjection {
  const participants = mission.participants.map((participant) =>
    participant.archivedAt === null && unavailableAgentIds.has(participant.agentId)
      ? Object.assign({}, participant, { archivedAt: now })
      : participant,
  );
  const activeMemberIds = new Set(
    participants
      .filter((participant) => participant.archivedAt === null)
      .map((participant) => participant.memberId),
  );
  const historicalMemberIds = new Set(participants.map((participant) => participant.memberId));
  const assignments = mission.assignments.map((assignment) =>
    assignment.semanticState === "planned" &&
    assignment.dispatchState === "queued" &&
    assignment.acceptedTurnId === null &&
    historicalMemberIds.has(assignment.assigneeMemberId) &&
    !activeMemberIds.has(assignment.assigneeMemberId)
      ? {
          ...assignment,
          revision: assignment.revision + 1,
          semanticState: "canceled" as const,
          terminationReason: "participant_unavailable" as const,
          settledAt: now,
        }
      : assignment,
  );
  const leadMemberId = mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === mission.activeRosterSnapshotRevision,
  )?.leadMemberId;
  const leadUnavailable = Boolean(
    leadMemberId && historicalMemberIds.has(leadMemberId) && !activeMemberIds.has(leadMemberId),
  );
  const priorMissionStatus = suspendableMissionStatus(mission);
  const projectedMission = projectUnavailableAttention({
    mission: { ...mission, participants, assignments },
    sourceAssignments: mission.assignments,
    activeMemberIds,
    historicalMemberIds,
    leadMemberId,
    leadUnavailable,
    priorMissionStatus,
    now,
  });
  const hasNewParticipantArchive = participants.some(
    (participant, index) => participant.archivedAt !== mission.participants[index]?.archivedAt,
  );
  const hasNewAssignmentCancellation = assignments.some(
    (assignment, index) => assignment !== mission.assignments[index],
  );
  const hasNewAttention = projectedMission.attentionItems.length !== mission.attentionItems.length;
  return {
    mission: projectedMission,
    changed: hasNewParticipantArchive || hasNewAssignmentCancellation || hasNewAttention,
  };
}

function projectUnavailableAttention(input: {
  mission: TeamMission;
  sourceAssignments: TeamMission["assignments"];
  activeMemberIds: ReadonlySet<string>;
  historicalMemberIds: ReadonlySet<string>;
  leadMemberId: string | undefined;
  leadUnavailable: boolean;
  priorMissionStatus: "planning" | "active" | "verifying" | null;
  now: string;
}): TeamMission {
  if (!input.priorMissionStatus) return input.mission;
  if (input.leadUnavailable && input.leadMemberId) {
    return applyMissionAttentionTransition(input.mission, {
      kind: "raise",
      item: {
        attentionId: `${input.mission.id}:${input.leadMemberId}:lead-unavailable`,
        kind: "lead_unavailable",
        scope: { kind: "mission" },
        status: "open",
        priorMissionStatus: input.priorMissionStatus,
        assignmentId: null,
        summary: `Lead ${input.leadMemberId} is unavailable`,
        pathEvidence: [],
        createdAt: input.now,
        resolution: null,
      },
    });
  }
  let projected = input.mission;
  for (const assignment of input.sourceAssignments) {
    if (!isUnavailableOpenAssignment(assignment, input)) continue;
    const kind =
      assignment.kind === "review" || assignment.kind === "verification"
        ? ("reviewer_unavailable" as const)
        : ("participant_unavailable" as const);
    const attentionId = `${input.mission.id}:${assignment.assignmentId}:${kind.replace("_", "-")}`;
    projected = applyMissionAttentionTransition(projected, {
      kind: "raise",
      item: {
        attentionId,
        kind,
        scope: { kind: "mission" },
        status: "open",
        priorMissionStatus: input.priorMissionStatus,
        assignmentId: assignment.assignmentId,
        summary: `Participant for Assignment ${assignment.assignmentId} is unavailable`,
        pathEvidence: [],
        createdAt: input.now,
        resolution: null,
      },
    });
  }
  return projected;
}

function isUnavailableOpenAssignment(
  assignment: MissionAssignmentContract,
  input: {
    activeMemberIds: ReadonlySet<string>;
    historicalMemberIds: ReadonlySet<string>;
  },
): boolean {
  return (
    ["planned", "running", "needs_report"].includes(assignment.semanticState) &&
    input.historicalMemberIds.has(assignment.assigneeMemberId) &&
    !input.activeMemberIds.has(assignment.assigneeMemberId)
  );
}

function suspendableMissionStatus(
  mission: TeamMission,
): "planning" | "active" | "verifying" | null {
  const status = mission.status === "needs_attention" ? mission.suspendedStatus : mission.status;
  return status === "planning" || status === "active" || status === "verifying" ? status : null;
}

function reviewGateAttentionId(
  missionId: string,
  gateKeyFingerprint: string,
  kind: "review_gate_reviewer_unavailable" | "review_gate_capability_unknown",
): string {
  return `review-gate:${createHash("sha256")
    .update(`${missionId}\0${gateKeyFingerprint}\0${kind}`)
    .digest("hex")}`;
}

function selectReadyAssignments(
  mission: TeamMission,
  reportRecoveries: ReadonlyArray<{ assignmentId: string; state: string }> = [],
): MissionAssignmentContract[] {
  if (
    mission.attentionItems.some((item) => item.status === "open" && item.scope.kind === "mission")
  ) {
    return [];
  }
  const attentionBlockedAssignmentIds = new Set(
    mission.attentionItems
      .filter((item) => item.status === "open" && item.assignmentId !== null)
      .map((item) => item.assignmentId),
  );
  const attentionBlockedWorkstreamIds = selectAttentionBlockedWorkstreamIds(mission);
  const assignmentsById = new Map(
    mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  const occupiedMembers = new Set(
    mission.assignments
      .filter((assignment) => assignment.semanticState === "running")
      .map((assignment) => assignment.assigneeMemberId),
  );
  for (const recovery of reportRecoveries) {
    if (recovery.state !== "dispatched") continue;
    const assignment = assignmentsById.get(recovery.assignmentId);
    if (assignment) occupiedMembers.add(assignment.assigneeMemberId);
  }
  const selectedMembers = new Set<string>();
  const candidates = mission.assignments
    .filter(
      (assignment) =>
        assignment.semanticState === "planned" &&
        (assignment.kind !== "verification" || mission.status === "verifying") &&
        !attentionBlockedAssignmentIds.has(assignment.assignmentId) &&
        !attentionBlockedWorkstreamIds.has(assignment.workstreamId),
    )
    .toSorted(compareAssignmentPriority);
  const ready: MissionAssignmentContract[] = [];
  for (const assignment of candidates) {
    const dependenciesComplete = assignment.dependencyAssignmentIds.every(
      (dependencyId) => assignmentsById.get(dependencyId)?.semanticState === "completed",
    );
    if (!dependenciesComplete) continue;
    const workstream = mission.workstreams.find(
      (candidate) => candidate.workstreamId === assignment.workstreamId,
    );
    const workstreamDependenciesSettled = workstream?.dependencyWorkstreamIds.every(
      (dependencyWorkstreamId) => {
        const dependency = mission.workstreams.find(
          (candidate) => candidate.workstreamId === dependencyWorkstreamId,
        );
        return dependency?.status === "accepted";
      },
    );
    if (workstreamDependenciesSettled === false) continue;
    if (
      occupiedMembers.has(assignment.assigneeMemberId) ||
      selectedMembers.has(assignment.assigneeMemberId)
    ) {
      continue;
    }
    selectedMembers.add(assignment.assigneeMemberId);
    ready.push(assignment);
  }
  return ready;
}

function compareAssignmentPriority(
  left: MissionAssignmentContract,
  right: MissionAssignmentContract,
): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  if (createdAt !== 0) return createdAt;
  return left.assignmentId.localeCompare(right.assignmentId);
}

function deduplicateTurnReferences<T extends { turnId: string }>(turns: T[]): T[] {
  return [...new Map(turns.map((turn) => [turn.turnId, turn])).values()];
}

function activeParticipant(mission: TeamMission, memberId: string) {
  return mission.participants
    .filter((participant) => participant.memberId === memberId && participant.archivedAt === null)
    .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0];
}

function isTerminalMissionStatus(status: TeamMission["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function isMissionReadyToComplete(
  stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
): boolean {
  const mission = stored.mission;
  if (mission.status !== "verifying") return false;
  if (mission.attentionItems.some((item) => item.status === "open")) return false;
  if (mission.workstreams.some((workstream) => workstream.status !== "accepted")) return false;
  if (stored.ownershipIntervals.some((interval) => interval.state !== "closed")) return false;
  if (
    stored.assignmentReportRecoveryOutbox.some(
      (delivery) => delivery.state === "pending" || delivery.state === "dispatched",
    )
  ) {
    return false;
  }
  const factsByTurnId = new Map(stored.acceptedTurnFacts.map((fact) => [fact.turnId, fact]));
  const coverage = resolveMissionAssignmentCoverage(mission, { acceptedTurnsById: factsByTurnId });
  const settledReviewGateWorkstreamIds = resolveMissionSettledReviewGateWorkstreamIds(mission, {
    acceptedTurnsById: factsByTurnId,
  });
  const qualityGates = planMissionQualityGates({
    mission,
    coverage,
    settledReviewGateWorkstreamIds,
    acceptedTurnsById: factsByTurnId,
    createdAt: mission.updatedAt,
  });
  if (
    qualityGates.additions.length > 0 ||
    qualityGates.obsoleteReviewAssignments.length > 0 ||
    qualityGates.obsoleteVerificationAssignments.length > 0 ||
    qualityGates.currentVerificationAssignments.length !== 1 ||
    hasUnsettledCurrentPlanAssignments(mission)
  ) {
    return false;
  }
  const assignment = qualityGates.currentVerificationAssignments[0]!;
  if (
    !hasExpectedVerificationLineage(assignment, qualityGates.expectedVerificationSubjectIds) ||
    !isApprovedCompletedVerification(assignment) ||
    assignment.acceptedTurnId === null ||
    assignment.runtimeAgentId === null
  ) {
    return false;
  }
  const fact = factsByTurnId.get(assignment.acceptedTurnId);
  return (
    fact?.assignmentId === assignment.assignmentId &&
    fact.runtimeAgentId === assignment.runtimeAgentId &&
    fact.outcome === "completed"
  );
}

function hasUnsettledCurrentPlanAssignments(mission: TeamMission): boolean {
  return mission.assignments.some(
    (assignment) =>
      assignment.planRevision === mission.planRevision &&
      assignment.semanticState !== "completed" &&
      assignment.semanticState !== "canceled",
  );
}

function hasExpectedVerificationLineage(
  assignment: MissionAssignmentContract,
  expectedAssignmentIds: ReadonlyArray<string>,
): boolean {
  return (
    sameAssignmentIdSet(assignment.subjectAssignmentIds, expectedAssignmentIds) &&
    sameAssignmentIdSet(assignment.dependencyAssignmentIds, expectedAssignmentIds)
  );
}

function isApprovedCompletedVerification(assignment: MissionAssignmentContract): boolean {
  return (
    assignment.semanticState === "completed" &&
    assignment.dispatchState === "settled" &&
    assignment.report?.status === "completed" &&
    assignment.report.verdict === "approved"
  );
}

function dispatchMessageId(missionId: string, assignmentId: string): string {
  return `team-mission:${missionId}:assignment:${assignmentId}:dispatch`;
}

function nextBindingEpoch(mission: TeamMission, memberId: string): number {
  const epochs = mission.participants
    .filter((participant) => participant.memberId === memberId)
    .map((participant) => participant.bindingEpoch);
  return Math.max(0, ...epochs) + 1;
}

function participantAgentId(missionId: string, memberId: string, bindingEpoch: number): string {
  const digest = createHash("sha256")
    .update(`${missionId}\0${memberId}\0${bindingEpoch}`)
    .digest("hex");
  const id = digest.slice(0, 32);
  // Version 8 reserves the UUID layout for this custom SHA-256 derivation.
  return [
    id.slice(0, 8),
    id.slice(8, 12),
    `8${id.slice(13, 16)}`,
    `a${id.slice(17, 20)}`,
    id.slice(20),
  ].join("-");
}
