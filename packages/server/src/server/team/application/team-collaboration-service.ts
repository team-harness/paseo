import { isDeepStrictEqual } from "node:util";

import type {
  MissionAssignmentContract,
  MissionAssignmentReport,
  MissionMemberMatchExplanation,
  MissionMemberRequirements,
  MissionMutableScope,
  MissionParticipant,
  MissionRosterMemberSnapshot,
  MissionWorkstream,
  TeamMission,
  TeamMemberLevel,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";
import { MissionAssignmentReportSchema } from "@getpaseo/protocol/team/v2-types";
import { TEAM_MENTION_TOKEN_SOURCE } from "@getpaseo/protocol/team/mention-handles";

import {
  type AcceptedTurnFact,
  validateAssignmentContract,
} from "../domain/assignment-contract-validation.js";
import {
  matchWorkstreamOwner,
  matchWorkstreamReviewer,
  type WorkstreamMatchCandidate,
  type WorkstreamOwnerMatch,
} from "../domain/member-matching.js";
import {
  type MissionAssignmentCoverage,
  resolveMissionAssignmentCoverage,
  validateMissionAttentionResolution,
  validateTeamMission,
} from "../domain/mission-validation.js";
import {
  MissionRevisionConflictError,
  MissionStore,
  type MissionRecoveryState,
} from "../persistence/mission-store.js";
import { TeamProfileStore } from "../persistence/profile-store.js";
import type {
  MissionAcceptedTurnFact,
  MissionAssignmentDeltaHandoff,
  MissionRecipientAttentionDelivery,
  StoredMission,
} from "../persistence/schemas.js";
import type {
  TeamAcceptedTurnFactsPort,
  TeamClockPort,
  TeamIdentityPort,
  TeamMemberHistory,
  TeamMemberHistoryPort,
  TeamMessagePort,
  TeamMissionReconcilePort,
  TeamRecipientAttentionAttempt,
  TeamRecipientAttentionPort,
  TeamRuntimeEventPort,
  TeamTerminalTurnFact,
} from "./ports.js";
import {
  assignmentReplanAttentionId,
  assignmentReplanSummary,
  assignmentReportRequiresReplan,
  buildLeadReplanDeliveries,
} from "./assignment-replan.js";
import { planMissionQualityGates } from "./quality-gate-assignments.js";
import { TeamApplicationError } from "./team-mission-service.js";
import {
  TeamOperationCoordinator,
  type TeamOperationPermit,
} from "./team-operation-coordinator.js";

const OPEN_ASSIGNMENT_STATES = new Set<MissionAssignmentContract["semanticState"]>([
  "planned",
  "running",
  "needs_report",
  "blocked",
]);
const RECIPIENT_ATTENTION_RETRY_DELAY_MS = 60_000;
const REPLAN_ATTENTION_KINDS = new Set<TeamMission["attentionItems"][number]["kind"]>([
  "missing_report",
  "assignment_requires_replan",
  "provider_unavailable",
  "participant_unavailable",
  "reviewer_unavailable",
]);

export interface TeamMemberLoad {
  openAssignments: number;
  plannedAssignments: number;
  runningAssignments: number;
  needsReportAssignments: number;
  blockedAssignments: number;
}

export interface TeamStatusMember {
  profile: MissionRosterMemberSnapshot;
  participant: MissionParticipant | null;
  load: TeamMemberLoad;
}

export interface TeamStatusResult {
  team: TeamV2;
  missionId: string;
  missionStatus: TeamMission["status"];
  callerMemberId: string;
  leadMemberId: string;
  members: TeamStatusMember[];
}

export interface MissionStatusBlocker {
  kind: "attention" | "assignment";
  id: string;
  state: string;
  summary: string;
}

export interface MissionStatusArtifact {
  assignmentId: string;
  workstreamId: string;
  paths: string[];
}

export interface MissionStatusResult {
  mission: TeamMission;
  callerMemberId: string;
  blockers: MissionStatusBlocker[];
  artifacts: MissionStatusArtifact[];
  handoffs: Array<Omit<MissionAssignmentDeltaHandoff, "reportHoldLeaseId">>;
}

export interface TeamMemberHistoryResult extends TeamMemberHistory {
  missionId: string;
  member: MissionRosterMemberSnapshot;
  participant: MissionParticipant;
}

export interface MissionWorkstreamDraft {
  workstreamId: string;
  kind: MissionWorkstream["kind"];
  title: string;
  objective: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  requiredSkillIds: string[];
  preferredSkillIds: string[];
  requiredRuntimeCapabilityIds: string[];
  minimumLevel: TeamMemberLevel;
  dependencyWorkstreamIds: string[];
  mutableScope: MissionMutableScope;
  reviewPolicy: MissionWorkstream["reviewPolicy"];
  reviewerRequirements: MissionMemberRequirements | null;
  ownerMemberId?: string;
  ownerOverrideReason?: string;
  reviewerMemberId?: string;
  reviewerOverrideReason?: string;
}

export interface PlanMissionInput {
  callerAgentId: string;
  missionId: string;
  expectedRevision: number;
  expectedPlanRevision: number;
  workstreams: MissionWorkstreamDraft[];
  replacementAssignments?: ReplacementAssignmentDraft[];
  assignments?: AssignmentDraft[];
}

export interface AssignmentDraft {
  clientKey: string;
  kind: MissionAssignmentContract["kind"];
  workstreamId: string;
  subjectKeys: string[];
  dependencyKeys: string[];
  objective: string;
  inputRefs: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  mutableScope: MissionMutableScope;
  priority: number;
}

export interface ReplacementAssignmentDraft extends AssignmentDraft {
  supersedesAssignmentId: string;
}

export interface AssignTasksInput {
  callerAgentId: string;
  missionId: string;
  expectedRevision: number;
  expectedPlanRevision: number;
  assignments: AssignmentDraft[];
}

export interface AssignTasksResult {
  mission: TeamMission;
  assignments: MissionAssignmentContract[];
  assignmentIdsByClientKey: Record<string, string>;
}

export interface SendTeamMessageInput {
  callerAgentId: string;
  missionId: string;
  idempotencyKey: string;
  recipient: string;
  body: string;
}

export interface SendTeamMessageResult {
  deliveryId: string;
  messageId: string;
  roomId: string;
  senderMemberId: string;
  recipientMemberId: string;
  mentionHandle: string;
}

export interface ReportAssignmentInput {
  callerAgentId: string;
  missionId: string;
  assignmentId: string;
  expectedRevision: number;
  expectedAssignmentRevision: number;
  report: MissionAssignmentReport;
}

export interface ReportAssignmentResult {
  mission: TeamMission;
  assignment: MissionAssignmentContract;
}

export interface PendingMessageRecoveryResult {
  failures: Array<{ missionId: string; deliveryId: string; error: string }>;
}

export interface TeamCollaborationServiceOptions {
  profiles: TeamProfileStore;
  missions: MissionStore;
  memberHistory: TeamMemberHistoryPort;
  messages: TeamMessagePort;
  turnFacts: TeamAcceptedTurnFactsPort;
  recipientAttention: TeamRecipientAttentionPort;
  events: TeamRuntimeEventPort;
  clock: TeamClockPort;
  ids: TeamIdentityPort;
  scheduler: TeamMissionReconcilePort;
  operations?: TeamOperationCoordinator;
  onBackgroundError?: (error: unknown, context: { operation: string; missionId: string }) => void;
}

interface AuthorizedMissionContext {
  storedMission: StoredMission;
  team: TeamV2;
  mission: TeamMission;
  callerParticipant: MissionParticipant;
  callerMember: MissionRosterMemberSnapshot;
  roster: MissionRosterMemberSnapshot[];
}

interface PersistAssignmentReportInput {
  missionId: string;
  expectedMissionRevision: number;
  expectedAssignmentRevision: number;
  assignmentId: string;
  callerAgentId: string;
  reportedAt: string;
  nextAssignment: MissionAssignmentContract;
  lateReport: boolean;
  lateReportRequiresReplan: boolean;
  terminalAcceptedTurn:
    | (AcceptedTurnFact & { outcome: "completed" | "failed" | "canceled" | "unknown" })
    | null;
  pathEvidence: Array<{ path: string; fingerprint: string }>;
}

interface NewAssignmentReportRequest {
  kind: "new";
  assignment: MissionAssignmentContract;
  report: MissionAssignmentReport;
  dispatchStopped: boolean;
  lateReport: boolean;
}

interface ReplayedAssignmentReportRequest {
  kind: "replay";
  result: ReportAssignmentResult;
}

type ValidatedAssignmentReportRequest =
  | NewAssignmentReportRequest
  | ReplayedAssignmentReportRequest;

export class TeamCollaborationService {
  private readonly messageMutations = new Map<string, Promise<unknown>>();
  private readonly pendingMissionIdsByRecipientAgentId = new Map<string, Set<string>>();
  private readonly indexedRecipientAgentIdsByMissionId = new Map<string, Set<string>>();
  private readonly operations: TeamOperationCoordinator;

  constructor(private readonly options: TeamCollaborationServiceOptions) {
    this.operations = options.operations ?? new TeamOperationCoordinator();
    options.recipientAttention.onEligibilityChange(async (agentId) => {
      await this.reconcileRecipientAttention(agentId);
    });
    options.turnFacts.onTerminalFact(async (fact) => {
      await this.recordTerminalTurnFact(fact);
    });
  }

  async teamStatus(input: { callerAgentId: string; missionId: string }): Promise<TeamStatusResult> {
    const context = await this.requireParticipant(input);
    const currentParticipants = new Map(
      context.mission.participants
        .filter((participant) => participant.archivedAt === null)
        .map((participant) => [participant.memberId, participant]),
    );
    return {
      team: structuredClone(context.team),
      missionId: context.mission.id,
      missionStatus: context.mission.status,
      callerMemberId: context.callerMember.memberId,
      leadMemberId: this.activeRoster(context.mission).leadMemberId,
      members: context.roster.map((profile) => ({
        profile: structuredClone(profile),
        participant: structuredClone(currentParticipants.get(profile.memberId) ?? null),
        load: memberLoad(context.mission.assignments, profile.memberId),
      })),
    };
  }

  async missionStatus(input: {
    callerAgentId: string;
    missionId: string;
  }): Promise<MissionStatusResult> {
    const context = await this.requireParticipant(input);
    return {
      mission: structuredClone(context.mission),
      callerMemberId: context.callerMember.memberId,
      blockers: collectMissionBlockers(context.mission),
      artifacts: collectMissionArtifacts(context.mission),
      handoffs: context.storedMission.assignmentDeltaHandoffs.map((handoff) => ({
        sourceAssignmentId: handoff.sourceAssignmentId,
        replacementAssignmentId: handoff.replacementAssignmentId,
        capturedDelta: structuredClone(handoff.capturedDelta),
        createdAt: handoff.createdAt,
      })),
    };
  }

  async teamMemberHistory(input: {
    callerAgentId: string;
    missionId: string;
    memberId: string;
    limit: number;
  }): Promise<TeamMemberHistoryResult> {
    const context = await this.requireParticipant(input);
    const member = context.roster.find((candidate) => candidate.memberId === input.memberId);
    if (!member) {
      throw new TeamApplicationError(
        "mission_member_not_found",
        `Member ${input.memberId} is not in Mission ${input.missionId}`,
      );
    }
    const participant = latestParticipantForMember(context.mission, input.memberId);
    if (!participant) {
      throw new TeamApplicationError(
        "mission_member_not_provisioned",
        `Member ${input.memberId} has no participant in Mission ${input.missionId}`,
      );
    }
    const history = await this.options.memberHistory.read({
      agentId: participant.agentId,
      limit: input.limit,
    });
    return {
      ...history,
      missionId: context.mission.id,
      member: structuredClone(member),
      participant: structuredClone(participant),
    };
  }

  async planMission(input: PlanMissionInput): Promise<TeamMission> {
    const initial = await this.requireLeadMutation(input);
    return this.operations.serialize(initial.team.id, (permit) =>
      this.planMissionLocked(input, permit),
    );
  }

  private async planMissionLocked(
    input: PlanMissionInput,
    permit: TeamOperationPermit,
  ): Promise<TeamMission> {
    const context = await this.requireLeadMutation(input);
    if (context.mission.planRevision !== input.expectedPlanRevision) {
      throw new TeamApplicationError(
        "plan_revision_conflict",
        `Mission ${input.missionId} plan revision ${context.mission.planRevision} does not match ${input.expectedPlanRevision}`,
      );
    }
    if (context.mission.assignments.some((assignment) => assignment.semanticState === "running")) {
      throw new TeamApplicationError(
        "mission_replan_has_unsettled_assignments",
        `Mission ${input.missionId} has a running Assignment that must settle before replanning`,
      );
    }
    const replaceableAssignments = context.mission.assignments.filter((assignment) =>
      ["planned", "needs_report", "blocked", "failed"].includes(assignment.semanticState),
    );
    const replaceableDeliveryAssignments = replaceableAssignments.filter(
      (assignment) => assignment.kind === "delivery",
    );
    const replaceableQualityGateAssignments = replaceableAssignments.filter(
      (assignment) => assignment.kind !== "delivery",
    );
    const replacementDrafts = input.replacementAssignments ?? [];
    const additionalDrafts = input.assignments ?? [];
    assertDaemonOwnedQualityGateDrafts([...replacementDrafts, ...additionalDrafts]);
    assertAssignmentDraftClientKeysUnique([...replacementDrafts, ...additionalDrafts]);
    assertReplacementCoverage(replaceableDeliveryAssignments, replacementDrafts);
    assertReportHoldReplacementScopes(replaceableDeliveryAssignments, replacementDrafts);
    const unsettledRecoveryAssignmentIds = new Set(
      context.storedMission.assignmentReportRecoveryOutbox
        .filter((delivery) => delivery.state === "dispatched")
        .map((delivery) => delivery.assignmentId),
    );
    const unsettledQualityGate = replaceableQualityGateAssignments.find((assignment) =>
      unsettledRecoveryAssignmentIds.has(assignment.assignmentId),
    );
    if (unsettledQualityGate) {
      throw new TeamApplicationError(
        "mission_replan_has_unsettled_assignments",
        `Mission ${input.missionId} has a report-recovery turn for Assignment ${unsettledQualityGate.assignmentId} that must settle before replanning`,
      );
    }
    const nextPlanRevision = context.mission.planRevision + 1;
    const now = this.options.clock.now();
    const attentionItems = resolveReplanAttentionItems(context.mission, input.callerAgentId, now);
    const resolvedAttentionDeliveryIds = new Set(
      context.mission.attentionItems
        .filter((item) => item.status === "open")
        .flatMap((item) => {
          if (item.kind === "participant_unavailable") {
            return [participantAttentionDeliveryId(item.attentionId)];
          }
          if (item.kind === "assignment_requires_replan") {
            return [`${item.attentionId}:lead`];
          }
          return [];
        }),
    );
    const workstreams = buildMissionWorkstreams({
      mission: context.mission,
      roster: this.activeRoster(context.mission).members,
      drafts: input.workstreams,
      planRevision: nextPlanRevision,
    });
    const previousPlanSnapshot =
      context.mission.planRevision > 0 && context.mission.workstreams.length > 0
        ? {
            planRevision: context.mission.planRevision,
            workstreams: structuredClone(context.mission.workstreams),
            createdAt: now,
          }
        : null;
    const workstreamPlanSnapshots = previousPlanSnapshot
      ? [...context.mission.workstreamPlanSnapshots, previousPlanSnapshot]
      : context.mission.workstreamPlanSnapshots;
    const assignmentIdsByClientKey = Object.fromEntries(
      [...replacementDrafts, ...additionalDrafts].map((draft) => [
        draft.clientKey,
        this.options.ids.next("assignment"),
      ]),
    );
    const handoffSourceIds = new Set(
      replaceableDeliveryAssignments
        .filter(
          (assignment) =>
            assignment.scopeLease?.state === "report_hold" ||
            assignmentHandoffCapturedDelta(assignment).length > 0,
        )
        .map((assignment) => assignment.assignmentId),
    );
    const planProjection: TeamMission = {
      ...context.mission,
      status: "active",
      suspendedStatus: null,
      planRevision: nextPlanRevision,
      workstreams,
      workstreamPlanSnapshots,
      attentionItems,
    };
    const replacements = replacementDrafts.map((draft) => {
      const handoffRef = assignmentHandoffRef(draft.supersedesAssignmentId);
      const inputRefs =
        handoffSourceIds.has(draft.supersedesAssignmentId) && !draft.inputRefs.includes(handoffRef)
          ? [...draft.inputRefs, handoffRef]
          : draft.inputRefs;
      return buildAssignment({
        draft: { ...draft, inputRefs },
        mission: planProjection,
        assignmentId: requireRecordValue(assignmentIdsByClientKey, draft.clientKey),
        assignmentIdsByClientKey,
        now,
      });
    });
    const additions = additionalDrafts.map((draft) =>
      buildAssignment({
        draft,
        mission: planProjection,
        assignmentId: requireRecordValue(assignmentIdsByClientKey, draft.clientKey),
        assignmentIdsByClientKey,
        now,
      }),
    );
    const { assignments, assignmentDeltaHandoffs, replacementBySupersededId } =
      buildReplannedAssignmentState({
        existingAssignments: context.mission.assignments,
        replaceableAssignments: replaceableDeliveryAssignments,
        replacementDrafts,
        replacements,
        additions,
        now,
      });
    const provisionalCandidate = { ...planProjection, assignments };
    const acceptedTurnsById = await this.readAcceptedTurnFacts(provisionalCandidate);
    const coverage = resolveMissionAssignmentCoverage(provisionalCandidate, {
      acceptedTurnsById,
    });
    const missingAssignmentWorkstreamIds = coverage.missingWorkstreamIds;
    assertMissionPlanAssignmentCoverage({
      coverage,
      previousPlanRevision: context.mission.planRevision,
      hasAdditionalAssignments: additionalDrafts.length > 0,
    });
    const newAssignmentIds = new Set(
      [...replacements, ...additions].map((assignment) => assignment.assignmentId),
    );
    const normalizedDeliveryAssignments =
      coverage.missingWorkstreamIds.length === 0 && coverage.ambiguousWorkstreamIds.length === 0
        ? assignments.map((assignment) =>
            newAssignmentIds.has(assignment.assignmentId)
              ? canonicalizeAssignmentDependencies(provisionalCandidate, assignment, coverage)
              : assignment,
          )
        : assignments;
    const normalizedProjection = {
      ...planProjection,
      assignments: normalizedDeliveryAssignments,
    };
    const qualityGates =
      replaceableQualityGateAssignments.length > 0
        ? planMissionQualityGates({
            mission: normalizedProjection,
            coverage,
            createdAt: now,
            materializePending: true,
          })
        : null;
    const normalizedAssignments = qualityGates
      ? supersedeDaemonQualityGates({
          assignments: [...normalizedDeliveryAssignments, ...qualityGates.additions],
          replaceableQualityGates: replaceableQualityGateAssignments,
          currentQualityGates: qualityGates.selectedAssignments,
          workstreams,
          now,
        })
      : normalizedDeliveryAssignments;
    const planStatus = missingAssignmentWorkstreamIds.length > 0 ? "planning" : "active";
    const candidate = {
      ...planProjection,
      status: planStatus as TeamMission["status"],
      assignments: normalizedAssignments,
    };
    assertValidPlanProjection(candidate, acceptedTurnsById);
    const assignmentCoverageDelivery =
      missingAssignmentWorkstreamIds.length > 0
        ? buildAssignmentCoverageDelivery({
            mission: candidate,
            existing: context.storedMission.recipientAttentionOutbox,
            missingWorkstreamIds: missingAssignmentWorkstreamIds,
            now,
          })
        : null;
    const supersededIds = new Set([
      ...replacementBySupersededId.keys(),
      ...replaceableQualityGateAssignments.map((assignment) => assignment.assignmentId),
    ]);
    const stored = await this.options.missions.updateAggregate({
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      update: ({ mission, recovery }) => {
        if (mission.planRevision !== input.expectedPlanRevision) {
          throw new TeamApplicationError(
            "plan_revision_conflict",
            `Mission ${input.missionId} plan changed while it was being updated`,
          );
        }
        return {
          mission: {
            ...mission,
            status: planStatus,
            suspendedStatus: null,
            planRevision: nextPlanRevision,
            workstreams,
            workstreamPlanSnapshots,
            assignments: normalizedAssignments,
            attentionItems,
          },
          recovery: {
            ...recovery,
            assignmentDeltaHandoffs: [
              ...recovery.assignmentDeltaHandoffs,
              ...assignmentDeltaHandoffs,
            ],
            assignmentDispatchIntents: recovery.assignmentDispatchIntents.filter(
              (intent) => !supersededIds.has(intent.assignmentId),
            ),
            assignmentReportRecoveryOutbox: recovery.assignmentReportRecoveryOutbox.filter(
              (delivery) => !supersededIds.has(delivery.assignmentId),
            ),
            ownershipIntervals: recovery.ownershipIntervals.map((interval) =>
              supersededIds.has(interval.assignmentId) && interval.state === "open"
                ? {
                    ...interval,
                    state: "closed" as const,
                    endedAt: now,
                    closure: "handoff" as const,
                  }
                : interval,
            ),
            recipientAttentionOutbox: recovery.recipientAttentionOutbox
              .map((delivery) =>
                belongsToResolvedAttentionDelivery(
                  delivery.deliveryId,
                  resolvedAttentionDeliveryIds,
                ) &&
                delivery.state !== "acknowledged" &&
                delivery.state !== "canceled"
                  ? {
                      ...delivery,
                      state: "canceled" as const,
                      successorDeliveryId: null,
                      nextEligibleAt: null,
                      acknowledgedAt: null,
                      canceledAt: now,
                      cancelReason: "attention_resolved" as const,
                    }
                  : delivery,
              )
              .concat(assignmentCoverageDelivery ? [assignmentCoverageDelivery] : []),
          },
        };
      },
    });
    await this.options.events.publishMission(stored.mission);
    this.indexPendingRecipientMission(stored);
    if (stored.mission.status === "active") {
      await this.options.scheduler.reconcileMission(input.missionId, permit);
    }
    return stored.mission;
  }

  async assignTasks(input: AssignTasksInput): Promise<AssignTasksResult> {
    const initial = await this.requireLeadMutation(input);
    return this.operations.serialize(initial.team.id, (permit) =>
      this.assignTasksLocked(input, permit),
    );
  }

  private async assignTasksLocked(
    input: AssignTasksInput,
    permit: TeamOperationPermit,
  ): Promise<AssignTasksResult> {
    const context = await this.requireLeadMutation(input);
    if (context.mission.status !== "planning") {
      throw new TeamApplicationError(
        "mission_assignment_activation_closed",
        `Mission ${input.missionId} is ${context.mission.status}; Assignment activation is only available while planning`,
      );
    }
    if (context.mission.planRevision !== input.expectedPlanRevision) {
      throw new TeamApplicationError(
        "plan_revision_conflict",
        `Mission ${input.missionId} plan revision ${context.mission.planRevision} does not match ${input.expectedPlanRevision}`,
      );
    }
    if (input.assignments.length === 0) {
      throw new TeamApplicationError("empty_assignment_batch", "Assignment batch cannot be empty");
    }
    assertDaemonOwnedQualityGateDrafts(input.assignments);
    const clientKeys = input.assignments.map((assignment) => assignment.clientKey);
    if (new Set(clientKeys).size !== clientKeys.length) {
      throw new TeamApplicationError(
        "duplicate_assignment_client_key",
        "Assignment client keys must be unique within a batch",
      );
    }
    const assignmentIdsByClientKey = Object.fromEntries(
      clientKeys.map((clientKey) => [clientKey, this.options.ids.next("assignment")]),
    );
    const now = this.options.clock.now();
    const provisionalCreated = input.assignments.map((draft) =>
      buildAssignment({
        draft,
        mission: context.mission,
        assignmentId: requireRecordValue(assignmentIdsByClientKey, draft.clientKey),
        assignmentIdsByClientKey,
        now,
      }),
    );
    const provisionalCandidate = {
      ...context.mission,
      assignments: [...context.mission.assignments, ...provisionalCreated],
    };
    const acceptedTurnsById = await this.readAcceptedTurnFacts(provisionalCandidate);
    const coverage = resolveMissionAssignmentCoverage(provisionalCandidate, {
      acceptedTurnsById,
    });
    const missingAssignmentWorkstreamIds = coverage.missingWorkstreamIds;
    if (missingAssignmentWorkstreamIds.length > 0) {
      throw new TeamApplicationError(
        "assignment_batch_missing_contracts",
        `Assignment batch must cover Workstreams: ${missingAssignmentWorkstreamIds.join(", ")}`,
      );
    }
    if (coverage.ambiguousWorkstreamIds.length > 0) {
      throw new TeamApplicationError(
        "assignment_batch_ambiguous_contracts",
        `Assignment batch has multiple contracts for Workstreams: ${coverage.ambiguousWorkstreamIds.join(", ")}`,
      );
    }
    const created = provisionalCreated.map((assignment) =>
      canonicalizeAssignmentDependencies(provisionalCandidate, assignment, coverage),
    );
    for (const assignment of created) {
      const validation = validateAssignmentContract({
        assignment,
        acceptedTurn: null,
        expectedWorkspaceId: context.mission.workspaceId,
      });
      if (!validation.ok) {
        throw new TeamApplicationError(
          "invalid_assignment_contract",
          `Assignment ${assignment.assignmentId} is invalid: ${validation.issues
            .flatMap((issue) => issue.violations)
            .join(", ")}`,
        );
      }
    }
    const candidate = {
      ...context.mission,
      status: "active" as const,
      assignments: [...context.mission.assignments, ...created],
    };
    const aggregateValidation = validateTeamMission(candidate, { acceptedTurnsById });
    if (!aggregateValidation.ok) {
      throw new TeamApplicationError(
        "invalid_assignment_batch",
        `Assignment batch violates Mission contracts: ${aggregateValidation.issues
          .map((issue) => issue.kind)
          .join(", ")}`,
      );
    }
    const coverageDeliveryId = assignmentCoverageDeliveryId(
      context.mission.id,
      context.mission.planRevision,
    );
    const coverageDeliveryIds = new Set([coverageDeliveryId]);
    const stored = await this.options.missions.updateAggregate({
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      update: ({ mission, recovery }) => {
        if (mission.planRevision !== input.expectedPlanRevision) {
          throw new TeamApplicationError(
            "plan_revision_conflict",
            `Mission ${input.missionId} plan changed while assignments were being created`,
          );
        }
        return {
          mission: {
            ...mission,
            status: "active",
            suspendedStatus: null,
            assignments: [...mission.assignments, ...created],
          },
          recovery: {
            ...recovery,
            recipientAttentionOutbox: recovery.recipientAttentionOutbox.map((delivery) =>
              belongsToResolvedAttentionDelivery(delivery.deliveryId, coverageDeliveryIds) &&
              delivery.state !== "acknowledged" &&
              delivery.state !== "canceled"
                ? {
                    ...delivery,
                    state: "canceled" as const,
                    nextEligibleAt: null,
                    acknowledgedAt: null,
                    canceledAt: now,
                    cancelReason: "attention_resolved" as const,
                  }
                : delivery,
            ),
          },
        };
      },
    });
    await this.options.events.publishMission(stored.mission);
    await this.options.scheduler.reconcileMission(input.missionId, permit);
    return {
      mission: stored.mission,
      assignments: created,
      assignmentIdsByClientKey,
    };
  }

  async sendTeamMessage(input: SendTeamMessageInput): Promise<SendTeamMessageResult> {
    const initial = await this.requireParticipant(input);
    return this.operations.serialize(initial.team.id, () =>
      this.serializeMessageMutation(input.missionId, async () => {
        const context = await this.requireParticipant(input);
        assertMissionDispatchOpen(context.storedMission);
        if (isTerminalMission(context.mission)) {
          throw new TeamApplicationError(
            "mission_terminal",
            `Mission ${context.mission.id} is ${context.mission.status}`,
          );
        }
        const targetMember = resolveMessageRecipient(context.roster, input.recipient);
        const targetParticipant = context.mission.participants.find(
          (participant) =>
            participant.memberId === targetMember.memberId && participant.archivedAt === null,
        );
        if (!targetParticipant) {
          throw new TeamApplicationError(
            "mission_member_not_provisioned",
            `Member ${targetMember.memberId} has no active participant in Mission ${input.missionId}`,
          );
        }
        const body = input.body.trim();
        if (!body) {
          throw new TeamApplicationError("empty_team_message", "Team message body is required");
        }
        if (parseTeamMentionTokens(body).length > 0) {
          throw new TeamApplicationError(
            "additional_mentions_not_allowed",
            "team_message addresses exactly one Member; remove additional mentions from body",
          );
        }
        const roomBody = `@${targetMember.mentionHandle} ${body}`;
        const requestFingerprint = JSON.stringify({
          missionId: context.mission.id,
          senderMemberId: context.callerMember.memberId,
          recipientMemberId: targetMember.memberId,
          body,
        });
        const deliveryId = this.options.ids.next("delivery");
        const roomMessageId = this.options.ids.next("message");
        let createdDelivery = false;
        const stored = await this.options.missions.updateAggregate({
          missionId: input.missionId,
          expectedRevision: context.mission.revision,
          update: ({ mission, recovery }) => {
            const currentTarget = assertCurrentMessageBindings({
              mission,
              callerAgentId: input.callerAgentId,
              callerMemberId: context.callerMember.memberId,
              callerBindingEpoch: context.callerParticipant.bindingEpoch,
              recipientMemberId: targetMember.memberId,
              recipientAgentId: targetParticipant.agentId,
              recipientBindingEpoch: targetParticipant.bindingEpoch,
            });
            const existing = recovery.recipientAttentionOutbox.find(
              (candidate) => candidate.idempotencyKey === input.idempotencyKey,
            );
            if (existing && existing.requestFingerprint !== requestFingerprint) {
              throw new TeamApplicationError(
                "team_message_idempotency_conflict",
                `Message key ${input.idempotencyKey} already belongs to a different request`,
              );
            }
            if (existing) return { mission, recovery };
            createdDelivery = true;
            return {
              mission,
              recovery: {
                ...recovery,
                recipientAttentionOutbox: [
                  ...recovery.recipientAttentionOutbox,
                  {
                    deliveryId,
                    idempotencyKey: input.idempotencyKey,
                    requestFingerprint,
                    roomMessageId,
                    senderMemberId: context.callerMember.memberId,
                    senderAgentId: context.callerParticipant.agentId,
                    recipientMemberId: targetMember.memberId,
                    bindingEpoch: currentTarget.bindingEpoch,
                    mentionHandle: targetMember.mentionHandle,
                    body: roomBody,
                    roomPostedAt: null,
                    roomCursor: null,
                    attempts: 0,
                    createdAt: this.options.clock.now(),
                    successorDeliveryId: null,
                    state: "pending",
                    lastAttemptAt: null,
                    nextEligibleAt: this.options.clock.now(),
                    acknowledgedAt: null,
                    canceledAt: null,
                    cancelReason: null,
                  },
                ],
              },
            };
          },
        });
        const delivery = stored.recipientAttentionOutbox.find(
          (candidate) => candidate.idempotencyKey === input.idempotencyKey,
        );
        this.indexPendingRecipientMission(stored);
        let shouldAttemptAttention = createdDelivery;
        if (!delivery) throw new Error("Persisted Team message delivery is missing");
        if (delivery.roomPostedAt === null && delivery.state !== "canceled") {
          await this.postAndMarkMessage(input.missionId, context.mission.chatRoomId, delivery);
          shouldAttemptAttention = true;
        }
        if (shouldAttemptAttention) {
          await this.processRecipientAttention(input.missionId, delivery.deliveryId);
        }
        await this.refreshPendingRecipientMission(input.missionId);
        return {
          deliveryId: delivery.deliveryId,
          messageId: delivery.roomMessageId,
          roomId: context.mission.chatRoomId,
          senderMemberId: delivery.senderMemberId,
          recipientMemberId: delivery.recipientMemberId,
          mentionHandle: delivery.mentionHandle,
        };
      }),
    );
  }

  async reportAssignment(input: ReportAssignmentInput): Promise<ReportAssignmentResult> {
    const initial = await this.requireParticipant(input);
    return this.operations.serialize(initial.team.id, async (permit) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await this.reportAssignmentOnce(input, permit);
        } catch (error) {
          if (!(error instanceof MissionRevisionConflictError)) throw error;
          if (attempt === 2) {
            throw new TeamApplicationError("mission_revision_conflict", error.message);
          }
        }
      }
      throw new Error("Assignment report retry loop exited unexpectedly");
    });
  }

  private async reportAssignmentOnce(
    input: ReportAssignmentInput,
    permit: TeamOperationPermit,
  ): Promise<ReportAssignmentResult> {
    const context = await this.requireParticipant(input);
    const request = validateAssignmentReportRequest(context, input);
    if (request.kind === "replay") return request.result;
    const { assignment, dispatchStopped, lateReport } = request;
    const nextAssignment: MissionAssignmentContract = {
      ...assignment,
      revision: assignment.revision + 1,
      report: request.report,
      semanticState: lateReport ? reportSemanticState(assignment.kind, request.report) : "running",
      scopeLease: lateReport ? null : assignment.scopeLease,
    };
    const reportedAt = this.options.clock.now();
    const acceptedTurnsById = await this.readAcceptedTurnFacts(
      { ...context.mission, assignments: [nextAssignment] },
      [nextAssignment],
    );
    const acceptedTurn = assignment.acceptedTurnId
      ? (acceptedTurnsById.get(assignment.acceptedTurnId) ?? null)
      : null;
    const assignmentValidation = validateAssignmentContract({
      assignment: nextAssignment,
      acceptedTurn,
      expectedWorkspaceId: context.mission.workspaceId,
    });
    if (!assignmentValidation.ok) {
      throw new TeamApplicationError(
        "invalid_assignment_report",
        `Assignment ${input.assignmentId} report violates: ${assignmentValidation.issues
          .flatMap((issue) => issue.violations)
          .join(", ")}`,
      );
    }
    const lateReportRequiresReplan = lateReport && assignmentReportRequiresReplan(nextAssignment);
    const terminalAcceptedTurn =
      acceptedTurn && isTerminalAcceptedTurnFact(acceptedTurn) ? acceptedTurn : null;
    if (lateReportRequiresReplan && !terminalAcceptedTurn) {
      throw new TeamApplicationError(
        "invalid_assignment_report",
        `Assignment ${input.assignmentId} requires replanning without a terminal accepted turn`,
      );
    }
    const stored = await this.persistAssignmentReport({
      missionId: input.missionId,
      expectedMissionRevision: context.mission.revision,
      expectedAssignmentRevision: input.expectedAssignmentRevision,
      assignmentId: input.assignmentId,
      callerAgentId: input.callerAgentId,
      reportedAt,
      nextAssignment,
      lateReport,
      lateReportRequiresReplan,
      terminalAcceptedTurn,
      pathEvidence: structuredClone(
        assignment.scopeLease?.capturedDelta ?? assignment.terminalEvidence?.capturedDelta ?? [],
      ),
    });
    const persistedAssignment = requireMapValue(
      new Map(stored.mission.assignments.map((candidate) => [candidate.assignmentId, candidate])),
      input.assignmentId,
      "reported Assignment",
    );
    await this.options.events.publishMission(stored.mission);
    this.indexPendingRecipientMission(stored);
    if (lateReport && !dispatchStopped) {
      await this.options.scheduler.reconcileMission(input.missionId, permit);
      if (lateReportRequiresReplan) {
        const recovery = await this.reconcilePendingMessagesForMission(input.missionId, permit);
        if (recovery.failures.length > 0) {
          throw new Error(
            `Team Mission pending message reconciliation failed: ${recovery.failures
              .map((failure) => `${failure.missionId}/${failure.deliveryId}: ${failure.error}`)
              .join("; ")}`,
          );
        }
      }
    }
    return { mission: stored.mission, assignment: persistedAssignment };
  }

  private persistAssignmentReport(input: PersistAssignmentReportInput): Promise<StoredMission> {
    return this.options.missions.updateAggregate({
      missionId: input.missionId,
      expectedRevision: input.expectedMissionRevision,
      update: ({ mission, recovery }) => {
        const current = mission.assignments.find(
          (candidate) => candidate.assignmentId === input.assignmentId,
        );
        if (!current || current.revision !== input.expectedAssignmentRevision) {
          throw new TeamApplicationError(
            "assignment_revision_conflict",
            `Assignment ${input.assignmentId} changed while its report was being recorded`,
          );
        }
        const missionWithReport = {
          ...mission,
          assignments: mission.assignments.map((candidate) =>
            candidate.assignmentId === input.assignmentId ? input.nextAssignment : candidate,
          ),
        };
        let nextMission = input.lateReport
          ? resolveMissingReportAttention(
              missionWithReport,
              input.assignmentId,
              input.callerAgentId,
              input.reportedAt,
            )
          : missionWithReport;
        let nextRecovery: MissionRecoveryState = input.lateReport
          ? {
              ...recovery,
              ownershipIntervals: recovery.ownershipIntervals.map((interval) =>
                interval.assignmentId === input.assignmentId && interval.state === "open"
                  ? {
                      ...interval,
                      state: "closed" as const,
                      endedAt: input.reportedAt,
                      closure: "report" as const,
                    }
                  : interval,
              ),
            }
          : recovery;
        if (input.lateReportRequiresReplan && input.terminalAcceptedTurn) {
          const projection = projectAssignmentReplanAttention({
            mission: nextMission,
            recovery: nextRecovery,
            assignment: input.nextAssignment,
            acceptedTurn: input.terminalAcceptedTurn,
            pathEvidence: input.pathEvidence,
            createdAt: input.reportedAt,
          });
          nextMission = projection.mission;
          nextRecovery = projection.recovery;
        }
        return { mission: nextMission, recovery: nextRecovery };
      },
    });
  }

  async readTeamChat(input: {
    callerAgentId: string;
    missionId: string;
    afterCursor?: number;
    limit?: number;
  }) {
    const context = await this.requireParticipant(input);
    const page = await this.options.messages.read({
      missionId: input.missionId,
      roomId: context.mission.chatRoomId,
      ...(input.afterCursor !== undefined ? { afterCursor: input.afterCursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    const current = await this.options.missions.get(input.missionId);
    if (!current) {
      throw new TeamApplicationError(
        "mission_not_found",
        `Mission ${input.missionId} does not exist`,
      );
    }
    const now = this.options.clock.now();
    const updated = await this.options.missions.updateRecoveryState({
      missionId: input.missionId,
      expectedStorageRevision: current.storageRevision,
      update: (state) => {
        const existingCursor = state.recipientChatCursors.find(
          (cursor) => cursor.memberId === context.callerMember.memberId,
        );
        const nextCursor = Math.max(existingCursor?.cursor ?? 0, page.cursor);
        return {
          ...state,
          recipientChatCursors: [
            ...state.recipientChatCursors.filter(
              (cursor) => cursor.memberId !== context.callerMember.memberId,
            ),
            {
              memberId: context.callerMember.memberId,
              cursor: nextCursor,
              updatedAt: now,
            },
          ],
          recipientAttentionOutbox: state.recipientAttentionOutbox.map((delivery) =>
            delivery.recipientMemberId === context.callerMember.memberId &&
            delivery.roomCursor !== null &&
            delivery.roomCursor <= nextCursor &&
            (delivery.state === "pending" || delivery.state === "notified")
              ? {
                  ...delivery,
                  state: "acknowledged" as const,
                  lastAttemptAt: delivery.lastAttemptAt ?? now,
                  nextEligibleAt: null,
                  acknowledgedAt: now,
                  canceledAt: null,
                  cancelReason: null,
                }
              : delivery,
          ),
        };
      },
    });
    this.indexPendingRecipientMission(updated);
    return page;
  }

  async reconcilePendingMessages(): Promise<PendingMessageRecoveryResult> {
    const failures: PendingMessageRecoveryResult["failures"] = [];
    this.pendingMissionIdsByRecipientAgentId.clear();
    this.indexedRecipientAgentIdsByMissionId.clear();
    for (const stored of await this.options.missions.list()) {
      await this.reconcileStoredPendingMessages(stored, failures);
    }
    return { failures };
  }

  async reconcilePendingMessageDeliveries(input: {
    missionId: string;
    deliveryIds: readonly string[];
  }): Promise<PendingMessageRecoveryResult> {
    if (input.deliveryIds.length === 0) return { failures: [] };
    return this.reconcilePendingMessagesForMission(
      input.missionId,
      undefined,
      new Set(input.deliveryIds),
    );
  }

  private async reconcilePendingMessagesForMission(
    missionId: string,
    permit?: TeamOperationPermit,
    deliveryIds?: ReadonlySet<string>,
  ): Promise<PendingMessageRecoveryResult> {
    const failures: PendingMessageRecoveryResult["failures"] = [];
    const stored = await this.options.missions.get(missionId);
    if (stored) {
      await this.reconcileStoredPendingMessages(stored, failures, permit, deliveryIds);
    } else {
      this.removePendingRecipientMission(missionId);
    }
    return { failures };
  }

  private async reconcileStoredPendingMessages(
    stored: NonNullable<Awaited<ReturnType<MissionStore["get"]>>>,
    failures: PendingMessageRecoveryResult["failures"],
    permit?: TeamOperationPermit,
    deliveryIds?: ReadonlySet<string>,
  ): Promise<void> {
    this.indexPendingRecipientMission(stored);
    if (isTerminalMission(stored.mission) || hasMissionDispatchStopped(stored)) return;
    try {
      await this.operations.serialize(
        stored.mission.teamId,
        () =>
          this.serializeMessageMutation(stored.mission.id, async () => {
            await this.readAcceptedTurnFacts(stored.mission);
            const current = await this.options.missions.get(stored.mission.id);
            if (
              !current ||
              isTerminalMission(current.mission) ||
              hasMissionDispatchStopped(current)
            ) {
              return;
            }
            for (const delivery of current.recipientAttentionOutbox) {
              if (deliveryIds && !deliveryIds.has(delivery.deliveryId)) continue;
              if (delivery.state === "canceled" || delivery.state === "acknowledged") continue;
              try {
                if (delivery.roomPostedAt === null) {
                  await this.postAndMarkMessage(
                    current.mission.id,
                    current.mission.chatRoomId,
                    delivery,
                  );
                }
                await this.processRecipientAttention(current.mission.id, delivery.deliveryId);
              } catch (error) {
                failures.push({
                  missionId: current.mission.id,
                  deliveryId: delivery.deliveryId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }),
        permit,
      );
    } finally {
      await this.refreshPendingRecipientMission(stored.mission.id);
    }
  }

  private async reconcileRecipientAttention(recipientAgentId: string): Promise<void> {
    const missionIds = [...(this.pendingMissionIdsByRecipientAgentId.get(recipientAgentId) ?? [])];
    for (const missionId of missionIds) {
      const stored = await this.options.missions.get(missionId);
      if (!stored) {
        this.removePendingRecipientMission(missionId);
        continue;
      }
      if (isTerminalMission(stored.mission) || hasMissionDispatchStopped(stored)) {
        this.indexPendingRecipientMission(stored);
        continue;
      }
      const deliveryIds = stored.recipientAttentionOutbox
        .filter(
          (delivery) =>
            delivery.state !== "acknowledged" &&
            delivery.state !== "canceled" &&
            stored.mission.participants.some(
              (participant) =>
                participant.memberId === delivery.recipientMemberId &&
                participant.agentId === recipientAgentId &&
                participant.archivedAt === null,
            ),
        )
        .map((delivery) => delivery.deliveryId);
      if (deliveryIds.length === 0) {
        this.indexPendingRecipientMission(stored);
        continue;
      }
      try {
        await this.operations.serialize(stored.mission.teamId, () =>
          this.serializeMessageMutation(stored.mission.id, async () => {
            for (const deliveryId of deliveryIds) {
              await this.processRecipientAttention(stored.mission.id, deliveryId, recipientAgentId);
            }
          }),
        );
      } finally {
        await this.refreshPendingRecipientMission(stored.mission.id);
      }
    }
  }

  private async refreshPendingRecipientMission(missionId: string): Promise<void> {
    const stored = await this.options.missions.get(missionId);
    if (stored) {
      this.indexPendingRecipientMission(stored);
    } else {
      this.removePendingRecipientMission(missionId);
    }
  }

  private indexPendingRecipientMission(stored: StoredMission): void {
    const missionId = stored.mission.id;
    this.removePendingRecipientMission(missionId);
    if (isTerminalMission(stored.mission) || hasMissionDispatchStopped(stored)) return;

    const recipientAgentIds = new Set<string>();
    for (const delivery of stored.recipientAttentionOutbox) {
      if (delivery.state === "acknowledged" || delivery.state === "canceled") continue;
      const participant = latestActiveParticipant(stored.mission, delivery.recipientMemberId);
      if (participant) recipientAgentIds.add(participant.agentId);
    }
    if (recipientAgentIds.size === 0) return;

    this.indexedRecipientAgentIdsByMissionId.set(missionId, recipientAgentIds);
    for (const recipientAgentId of recipientAgentIds) {
      const missionIds =
        this.pendingMissionIdsByRecipientAgentId.get(recipientAgentId) ?? new Set();
      missionIds.add(missionId);
      this.pendingMissionIdsByRecipientAgentId.set(recipientAgentId, missionIds);
    }
  }

  private removePendingRecipientMission(missionId: string): void {
    const recipientAgentIds = this.indexedRecipientAgentIdsByMissionId.get(missionId);
    if (!recipientAgentIds) return;
    this.indexedRecipientAgentIdsByMissionId.delete(missionId);
    for (const recipientAgentId of recipientAgentIds) {
      const missionIds = this.pendingMissionIdsByRecipientAgentId.get(recipientAgentId);
      if (!missionIds) continue;
      missionIds.delete(missionId);
      if (missionIds.size === 0) {
        this.pendingMissionIdsByRecipientAgentId.delete(recipientAgentId);
      }
    }
  }

  private async processRecipientAttention(
    missionId: string,
    deliveryId: string,
    recipientAgentId?: string,
  ): Promise<void> {
    let stored = await this.options.missions.get(missionId);
    if (!stored) return;
    if (hasMissionDispatchStopped(stored)) return;
    let delivery = stored.recipientAttentionOutbox.find(
      (candidate) => candidate.deliveryId === deliveryId,
    );
    if (!delivery || delivery.state === "acknowledged" || delivery.state === "canceled") return;
    if (isTerminalMission(stored.mission)) {
      await this.cancelRecipientDelivery(stored, delivery.deliveryId, "mission_terminal");
      return;
    }
    const participant = latestActiveParticipant(stored.mission, delivery.recipientMemberId);
    if (!participant) {
      await this.cancelRecipientDelivery(stored, delivery.deliveryId, "recipient_left");
      return;
    }
    if (participant.bindingEpoch !== delivery.bindingEpoch) {
      const successorDeliveryId = recipientBindingSuccessorId(
        delivery.deliveryId,
        participant.bindingEpoch,
      );
      stored = await this.replaceRecipientDeliveryBinding(stored, delivery, participant);
      delivery = stored.recipientAttentionOutbox.find(
        (candidate) => candidate.deliveryId === successorDeliveryId,
      );
      if (!delivery) throw new Error(`Recipient delivery ${deliveryId} lost its binding successor`);
    }
    if (recipientAgentId && participant.agentId !== recipientAgentId) return;
    if (delivery.state === "acknowledged" || delivery.state === "canceled") return;
    if (delivery.roomPostedAt === null || delivery.roomCursor === null) return;
    if (Date.parse(this.options.clock.now()) < Date.parse(delivery.nextEligibleAt)) return;
    if (delivery.attempts >= 3) {
      await this.raiseNotificationAttention(stored, delivery);
      return;
    }
    const nextAttempt = delivery.attempts + 1;
    const outcome = await this.options.recipientAttention.attempt({
      deliveryId: delivery.deliveryId,
      missionId,
      recipientAgentId: participant.agentId,
      bindingEpoch: participant.bindingEpoch,
      attempt: nextAttempt,
    });
    await this.handleRecipientAttentionOutcome({
      missionId,
      stored,
      delivery,
      participant,
      nextAttempt,
      outcome,
    });
  }

  private async readAcceptedTurnFacts(
    mission: TeamMission,
    assignments: ReadonlyArray<MissionAssignmentContract> = mission.assignments,
  ): Promise<ReadonlyMap<string, AcceptedTurnFact>> {
    let stored = await this.options.missions.get(mission.id);
    if (!stored) {
      throw new TeamApplicationError(
        "mission_not_found",
        `Mission ${mission.id} does not exist while reading accepted turns`,
      );
    }
    const observed = await this.options.turnFacts.read(
      assignments.flatMap((assignment) =>
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
      ),
    );
    const factsToRecord: MissionAcceptedTurnFact[] = [];
    for (const assignment of assignments) {
      if (!assignment.acceptedTurnId || !assignment.runtimeAgentId) continue;
      const fact = observed.get(assignment.acceptedTurnId);
      if (
        !fact ||
        fact.assignmentId !== assignment.assignmentId ||
        !isTerminalAcceptedTurnFact(fact)
      ) {
        continue;
      }
      factsToRecord.push({
        assignmentId: fact.assignmentId,
        turnId: fact.turnId,
        runtimeAgentId: fact.runtimeAgentId,
        outcome: fact.outcome,
        recordedAt: this.options.clock.now(),
      });
    }
    if (factsToRecord.length > 0) {
      stored = await this.options.missions.recordAcceptedTurnFacts({
        missionId: mission.id,
        facts: factsToRecord,
      });
    }
    const acceptedTurnsById = new Map(observed);
    const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
    for (const fact of stored.acceptedTurnFacts) {
      if (!assignmentIds.has(fact.assignmentId)) continue;
      acceptedTurnsById.set(fact.turnId, {
        assignmentId: fact.assignmentId,
        turnId: fact.turnId,
        runtimeAgentId: fact.runtimeAgentId,
        outcome: fact.outcome,
      });
    }
    return acceptedTurnsById;
  }

  private async recordTerminalTurnFact(fact: TeamTerminalTurnFact): Promise<void> {
    if (!isTerminalAcceptedTurnFact(fact)) return;
    const stored = await this.options.missions.get(fact.missionId);
    if (!stored) return;
    let assignment = stored.mission.assignments.find(
      (candidate) =>
        candidate.acceptedTurnId === fact.turnId &&
        candidate.runtimeAgentId === fact.runtimeAgentId,
    );
    if (!assignment) {
      const recovery = stored.assignmentReportRecoveryOutbox.find(
        (delivery) =>
          delivery.state === "dispatched" &&
          delivery.turnId === fact.turnId &&
          delivery.agentId === fact.runtimeAgentId,
      );
      assignment = recovery
        ? stored.mission.assignments.find(
            (candidate) => candidate.assignmentId === recovery.assignmentId,
          )
        : undefined;
    }
    if (!assignment) return;
    await this.operations.serialize(stored.mission.teamId, () =>
      this.options.missions.recordAcceptedTurnFacts({
        missionId: stored.mission.id,
        facts: [
          {
            assignmentId: assignment.assignmentId,
            turnId: fact.turnId,
            runtimeAgentId: fact.runtimeAgentId,
            outcome: fact.outcome,
            recordedAt: this.options.clock.now(),
          },
        ],
      }),
    );
    const current = await this.options.missions.get(stored.mission.id);
    if (current && !hasMissionDispatchStopped(current)) {
      this.deferTerminalReconciliation(stored.mission.id);
    }
  }

  private deferTerminalReconciliation(missionId: string): void {
    setTimeout(() => {
      void (async () => {
        await this.options.scheduler.reconcileMission(missionId);
        const recovery = await this.reconcilePendingMessagesForMission(missionId);
        if (recovery.failures.length > 0) {
          throw new Error(
            `Team Mission pending message reconciliation failed: ${recovery.failures
              .map((failure) => `${failure.missionId}/${failure.deliveryId}: ${failure.error}`)
              .join("; ")}`,
          );
        }
      })().catch((error: unknown) => {
        this.options.onBackgroundError?.(error, {
          operation: "terminal_fact_reconciliation",
          missionId,
        });
      });
    }, 0);
  }

  private async handleRecipientAttentionOutcome(input: {
    missionId: string;
    stored: Awaited<ReturnType<MissionStore["get"]>> & {};
    delivery: MissionRecipientAttentionDelivery;
    participant: MissionParticipant;
    nextAttempt: number;
    outcome: TeamRecipientAttentionAttempt;
  }): Promise<void> {
    if (input.outcome === "unavailable") {
      await this.raiseParticipantUnavailableAttention(
        input.stored,
        input.delivery,
        input.participant,
      );
      return;
    }
    if (input.outcome !== "notified") return;
    const updated = await this.recordRecipientNotificationAttempt(
      input.missionId,
      input.delivery,
      input.nextAttempt,
    );
    if (!updated) return;
    const notified = updated.recipientAttentionOutbox.find(
      (candidate) => candidate.deliveryId === input.delivery.deliveryId,
    );
    if (notified?.state === "notified" && notified.attempts >= 3) {
      await this.raiseNotificationAttention(updated, notified);
    }
  }

  private async recordRecipientNotificationAttempt(
    missionId: string,
    delivery: MissionRecipientAttentionDelivery,
    nextAttempt: number,
  ): Promise<Awaited<ReturnType<MissionStore["get"]>>> {
    const beforeUpdate = await this.options.missions.get(missionId);
    if (!beforeUpdate) return null;
    return this.options.missions.updateRecoveryState({
      missionId,
      expectedStorageRevision: beforeUpdate.storageRevision,
      update: (state) => {
        const attemptedAt = this.options.clock.now();
        return {
          ...state,
          recipientAttentionOutbox: state.recipientAttentionOutbox.map((candidate) =>
            candidate.deliveryId === delivery.deliveryId &&
            candidate.state !== "acknowledged" &&
            candidate.state !== "canceled" &&
            candidate.attempts === delivery.attempts
              ? {
                  ...candidate,
                  state: "notified" as const,
                  attempts: nextAttempt,
                  lastAttemptAt: attemptedAt,
                  nextEligibleAt: addMilliseconds(attemptedAt, RECIPIENT_ATTENTION_RETRY_DELAY_MS),
                  acknowledgedAt: null,
                  canceledAt: null,
                  cancelReason: null,
                }
              : candidate,
          ),
        };
      },
    });
  }

  private async cancelRecipientDelivery(
    stored: Awaited<ReturnType<MissionStore["get"]>> & {},
    deliveryId: string,
    cancelReason: "mission_terminal" | "recipient_left",
  ): Promise<void> {
    await this.options.missions.updateRecoveryState({
      missionId: stored.mission.id,
      expectedStorageRevision: stored.storageRevision,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: state.recipientAttentionOutbox.map((delivery) =>
          delivery.deliveryId === deliveryId &&
          delivery.state !== "acknowledged" &&
          delivery.state !== "canceled"
            ? {
                ...delivery,
                state: "canceled" as const,
                nextEligibleAt: null,
                acknowledgedAt: null,
                canceledAt: this.options.clock.now(),
                cancelReason,
              }
            : delivery,
        ),
      }),
    });
  }

  private async replaceRecipientDeliveryBinding(
    stored: Awaited<ReturnType<MissionStore["get"]>> & {},
    delivery: MissionRecipientAttentionDelivery,
    participant: MissionParticipant,
  ) {
    const successorDeliveryId = recipientBindingSuccessorId(
      delivery.deliveryId,
      participant.bindingEpoch,
    );
    return await this.options.missions.updateRecoveryState({
      missionId: stored.mission.id,
      expectedStorageRevision: stored.storageRevision,
      update: (state) => {
        const hasSuccessor = state.recipientAttentionOutbox.some(
          (candidate) => candidate.deliveryId === successorDeliveryId,
        );
        return {
          ...state,
          recipientAttentionOutbox: [
            ...state.recipientAttentionOutbox.map((candidate) =>
              candidate.deliveryId === delivery.deliveryId &&
              candidate.state !== "acknowledged" &&
              candidate.state !== "canceled"
                ? {
                    ...candidate,
                    state: "canceled" as const,
                    successorDeliveryId,
                    nextEligibleAt: null,
                    acknowledgedAt: null,
                    canceledAt: this.options.clock.now(),
                    cancelReason: "binding_replaced" as const,
                  }
                : candidate,
            ),
            ...(hasSuccessor
              ? []
              : [
                  {
                    ...delivery,
                    deliveryId: successorDeliveryId,
                    idempotencyKey: `${delivery.idempotencyKey}:binding:${participant.bindingEpoch}`,
                    bindingEpoch: participant.bindingEpoch,
                    attempts: 0,
                    successorDeliveryId: null,
                    state: "pending" as const,
                    lastAttemptAt: null,
                    nextEligibleAt: this.options.clock.now(),
                    acknowledgedAt: null,
                    canceledAt: null,
                    cancelReason: null,
                  },
                ]),
          ],
        };
      },
    });
  }

  private async raiseNotificationAttention(
    stored: Awaited<ReturnType<MissionStore["get"]>> & {},
    delivery: MissionRecipientAttentionDelivery,
  ): Promise<void> {
    const attentionId = `notification:${delivery.deliveryId}`;
    if (
      stored.mission.attentionItems.some(
        (attention) => attention.attentionId === attentionId && attention.status === "open",
      )
    ) {
      return;
    }
    const priorMissionStatus =
      stored.mission.status === "needs_attention"
        ? stored.mission.suspendedStatus
        : stored.mission.status;
    if (
      priorMissionStatus !== "planning" &&
      priorMissionStatus !== "active" &&
      priorMissionStatus !== "verifying"
    ) {
      return;
    }
    const updated = await this.options.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: ({ mission, recovery }) => ({
        mission: {
          ...mission,
          status: "needs_attention",
          suspendedStatus: priorMissionStatus,
          attentionItems: [
            ...mission.attentionItems,
            {
              attentionId,
              kind: "notification_unacknowledged",
              status: "open",
              priorMissionStatus,
              assignmentId: null,
              summary: `Team message ${delivery.roomMessageId} was not acknowledged after three notifications`,
              pathEvidence: [],
              createdAt: this.options.clock.now(),
              resolution: null,
            },
          ],
        },
        recovery,
      }),
    });
    await this.options.events.publishMission(updated.mission);
  }

  private async raiseParticipantUnavailableAttention(
    stored: Awaited<ReturnType<MissionStore["get"]>> & {},
    delivery: MissionRecipientAttentionDelivery,
    participant: MissionParticipant,
  ): Promise<void> {
    const attentionId = `participant:${delivery.deliveryId}`;
    if (
      stored.mission.attentionItems.some(
        (attention) => attention.attentionId === attentionId && attention.status === "open",
      )
    ) {
      return;
    }
    const priorMissionStatus =
      stored.mission.status === "needs_attention"
        ? stored.mission.suspendedStatus
        : stored.mission.status;
    if (
      priorMissionStatus !== "planning" &&
      priorMissionStatus !== "active" &&
      priorMissionStatus !== "verifying"
    ) {
      return;
    }
    const updated = await this.options.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: ({ mission, recovery }) => ({
        mission: {
          ...mission,
          status: "needs_attention",
          suspendedStatus: priorMissionStatus,
          attentionItems: [
            ...mission.attentionItems,
            {
              attentionId,
              kind: "participant_unavailable",
              status: "open",
              priorMissionStatus,
              assignmentId: null,
              summary: `Recipient ${participant.agentId} is unavailable for Team message ${delivery.roomMessageId}`,
              pathEvidence: [],
              createdAt: this.options.clock.now(),
              resolution: null,
            },
          ],
        },
        recovery,
      }),
    });
    await this.options.events.publishMission(updated.mission);
  }

  private async postAndMarkMessage(
    missionId: string,
    roomId: string,
    delivery: MissionRecipientAttentionDelivery,
  ): Promise<void> {
    const beforePost = await this.options.missions.get(missionId);
    const currentDelivery = beforePost?.recipientAttentionOutbox.find(
      (candidate) => candidate.deliveryId === delivery.deliveryId,
    );
    if (
      !beforePost ||
      isTerminalMission(beforePost.mission) ||
      hasMissionDispatchStopped(beforePost) ||
      !currentDelivery ||
      currentDelivery.state === "canceled" ||
      currentDelivery.state === "acknowledged"
    ) {
      return;
    }
    const posted = await this.options.messages.post({
      messageId: delivery.roomMessageId,
      missionId,
      roomId,
      senderAgentId: delivery.senderAgentId,
      body: delivery.body,
    });
    const current = await this.options.missions.get(missionId);
    if (!current) return;
    await this.options.missions.updateRecoveryState({
      missionId,
      expectedStorageRevision: current.storageRevision,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: state.recipientAttentionOutbox.map((candidate) =>
          candidate.deliveryId === delivery.deliveryId &&
          candidate.state !== "canceled" &&
          candidate.roomPostedAt === null
            ? {
                ...candidate,
                roomPostedAt: this.options.clock.now(),
                roomCursor: posted.cursor,
              }
            : candidate,
        ),
      }),
    });
  }

  private async serializeMessageMutation<T>(missionId: string, operation: () => Promise<T>) {
    const previous = this.messageMutations.get(missionId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.messageMutations.set(missionId, current);
    try {
      return await current;
    } finally {
      if (this.messageMutations.get(missionId) === current) {
        this.messageMutations.delete(missionId);
      }
    }
  }

  private async requireLeadMutation(input: {
    callerAgentId: string;
    missionId: string;
  }): Promise<AuthorizedMissionContext> {
    const context = await this.requireParticipant(input);
    assertMissionDispatchOpen(context.storedMission);
    if (isTerminalMission(context.mission)) {
      throw new TeamApplicationError(
        "mission_terminal",
        `Mission ${context.mission.id} is ${context.mission.status}`,
      );
    }
    if (context.callerMember.memberId !== this.activeRoster(context.mission).leadMemberId) {
      throw new TeamApplicationError(
        "lead_required",
        `Only the Lead can mutate Mission ${context.mission.id}`,
      );
    }
    return context;
  }

  private async requireParticipant(input: {
    callerAgentId: string;
    missionId: string;
  }): Promise<AuthorizedMissionContext> {
    const storedMission = await this.options.missions.get(input.missionId);
    if (!storedMission) {
      throw new TeamApplicationError(
        "mission_not_found",
        `Mission ${input.missionId} does not exist`,
      );
    }
    const mission = storedMission.mission;
    if (isTerminalMission(mission)) {
      throw new TeamApplicationError(
        "mission_terminal",
        `Mission ${mission.id} is ${mission.status}`,
      );
    }
    const storedTeam = await this.options.profiles.get(mission.teamId);
    if (!storedTeam) {
      throw new TeamApplicationError("team_not_found", `Team ${mission.teamId} does not exist`);
    }
    const missionIsLinked =
      storedTeam.profile.activeMissionId === mission.id ||
      storedTeam.startIntent?.missionId === mission.id;
    if (storedTeam.profile.workspaceId !== mission.workspaceId || !missionIsLinked) {
      throw new TeamApplicationError(
        "mission_team_mismatch",
        `Mission ${mission.id} does not belong to Team ${storedTeam.profile.id}`,
      );
    }
    const callerParticipant = mission.participants.find(
      (participant) =>
        participant.agentId === input.callerAgentId && participant.archivedAt === null,
    );
    if (!callerParticipant) {
      throw new TeamApplicationError(
        "not_mission_participant",
        `Agent ${input.callerAgentId} is not an active participant in Mission ${mission.id}`,
      );
    }
    const snapshot = this.activeRoster(mission);
    const callerMember = snapshot.members.find(
      (member) => member.memberId === callerParticipant.memberId,
    );
    if (!callerMember) {
      throw new TeamApplicationError(
        "participant_not_in_roster",
        `Participant ${callerParticipant.agentId} is not in the active Mission roster`,
      );
    }
    return {
      storedMission,
      team: storedTeam.profile,
      mission,
      callerParticipant,
      callerMember,
      roster: snapshot.members,
    };
  }

  private activeRoster(mission: TeamMission) {
    const snapshot = mission.rosterSnapshots.find(
      (candidate) => candidate.revision === mission.activeRosterSnapshotRevision,
    );
    if (!snapshot) {
      throw new TeamApplicationError(
        "active_roster_not_found",
        `Mission ${mission.id} has no active roster snapshot`,
      );
    }
    return snapshot;
  }
}

function hasMissionDispatchStopped(stored: StoredMission): boolean {
  return stored.finishIntent !== null && stored.finishIntent.stage !== "requested";
}

function assertMissionDispatchOpen(stored: StoredMission): void {
  if (hasMissionDispatchStopped(stored)) throw missionDispatchStoppedError(stored);
}

function assertReportAllowedDuringFinish(
  stored: StoredMission,
  assignment: MissionAssignmentContract,
): boolean {
  const dispatchStopped = hasMissionDispatchStopped(stored);
  const reportableDuringFinish =
    assignment.semanticState === "running" || assignment.semanticState === "needs_report";
  if (dispatchStopped && !reportableDuringFinish) {
    throw missionDispatchStoppedError(stored);
  }
  return dispatchStopped;
}

function missionDispatchStoppedError(stored: StoredMission): TeamApplicationError {
  return new TeamApplicationError(
    "mission_dispatch_stopped",
    `Mission ${stored.mission.id} has stopped dispatch for ${stored.finishIntent?.kind ?? "finish"} intent ${stored.finishIntent?.intentId ?? "unknown"}`,
  );
}

function assignmentHandoffRef(sourceAssignmentId: string): string {
  return `mission-handoff:${sourceAssignmentId}`;
}

function assignmentHandoffCapturedDelta(
  assignment: MissionAssignmentContract,
): NonNullable<MissionAssignmentContract["terminalEvidence"]>["capturedDelta"] {
  if (assignment.scopeLease?.state === "report_hold") {
    return assignment.scopeLease.capturedDelta;
  }
  return assignment.terminalEvidence?.capturedDelta ?? assignment.scopeLease?.capturedDelta ?? [];
}

function participantAttentionDeliveryId(attentionId: string): string {
  const prefix = "participant:";
  if (!attentionId.startsWith(prefix) || attentionId.length === prefix.length) {
    throw new TeamApplicationError(
      "participant_delivery_not_found",
      `Attention ${attentionId} has no participant delivery`,
    );
  }
  return attentionId.slice(prefix.length);
}

function latestActiveParticipant(
  mission: TeamMission,
  memberId: string,
): MissionParticipant | null {
  return (
    mission.participants
      .filter((participant) => participant.memberId === memberId && participant.archivedAt === null)
      .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0] ?? null
  );
}

function recipientBindingSuccessorId(deliveryId: string, bindingEpoch: number): string {
  return `${deliveryId}:binding:${bindingEpoch}`;
}

function belongsToResolvedAttentionDelivery(
  deliveryId: string,
  resolvedDeliveryIds: ReadonlySet<string>,
): boolean {
  for (const resolvedDeliveryId of resolvedDeliveryIds) {
    if (
      deliveryId === resolvedDeliveryId ||
      deliveryId.startsWith(`${resolvedDeliveryId}:binding:`)
    ) {
      return true;
    }
  }
  return false;
}

interface BuildMissionWorkstreamsInput {
  mission: TeamMission;
  roster: MissionRosterMemberSnapshot[];
  drafts: MissionWorkstreamDraft[];
  planRevision: number;
}

function buildMissionWorkstreams(input: BuildMissionWorkstreamsInput): MissionWorkstream[] {
  if (input.drafts.length === 0) {
    throw new TeamApplicationError("empty_mission_plan", "Mission plan cannot be empty");
  }
  const currentById = new Map(
    input.mission.workstreams.map((workstream) => [workstream.workstreamId, workstream]),
  );
  const openAssignmentsByMember = collectOpenAssignmentLoads(input);
  const draftsInMatchOrder = input.drafts.toSorted(
    (left, right) => Number(left.kind === "verification") - Number(right.kind === "verification"),
  );
  const workstreamsById = new Map<string, MissionWorkstream>();
  const writableOwnerMemberIds = new Set<string>();
  for (const draft of draftsInMatchOrder) {
    const candidates = matchingCandidates(input.roster, openAssignmentsByMember);
    const previous = currentById.get(draft.workstreamId);
    const ownerSelection = selectWorkstreamOwner({
      draft,
      previous,
      candidates,
      writableOwnerMemberIds,
    });
    incrementLoad(openAssignmentsByMember, ownerSelection.memberId);
    const reviewerSelection = selectWorkstreamReviewer({
      draft,
      previous,
      candidates: matchingCandidates(input.roster, openAssignmentsByMember),
      ownerSelection,
    });
    if (reviewerSelection) incrementLoad(openAssignmentsByMember, reviewerSelection.memberId);
    const workstream = createPlannedWorkstream({
      draft,
      ownerSelection,
      reviewerSelection,
      planRevision: input.planRevision,
      rosterSnapshotRevision: input.mission.activeRosterSnapshotRevision,
    });
    workstreamsById.set(draft.workstreamId, workstream);
    if (draft.kind !== "verification" && draft.mutableScope.kind !== "read_only") {
      writableOwnerMemberIds.add(ownerSelection.memberId);
    }
  }
  return input.drafts.map((draft) =>
    requireMapValue(workstreamsById, draft.workstreamId, "planned Workstream"),
  );
}

function collectOpenAssignmentLoads(input: BuildMissionWorkstreamsInput): Map<string, number> {
  const loadByMember = new Map(input.roster.map((member) => [member.memberId, 0]));
  for (const assignment of input.mission.assignments) {
    if (!OPEN_ASSIGNMENT_STATES.has(assignment.semanticState)) continue;
    incrementLoad(loadByMember, assignment.assigneeMemberId);
  }
  return loadByMember;
}

function selectWorkstreamOwner(input: {
  draft: MissionWorkstreamDraft;
  previous: MissionWorkstream | undefined;
  candidates: WorkstreamMatchCandidate[];
  writableOwnerMemberIds: ReadonlySet<string>;
}): SelectedMatch {
  const matchOwner = (candidates: WorkstreamMatchCandidate[]) =>
    matchWorkstreamOwner({
      candidates,
      requiredSkillIds: input.draft.requiredSkillIds,
      preferredSkillIds: input.draft.preferredSkillIds,
      requiredRuntimeCapabilityIds: input.draft.requiredRuntimeCapabilityIds,
      minimumLevel: input.draft.minimumLevel,
      previousOwnerMemberId: input.previous?.ownerMemberId ?? null,
    });
  const selectionInput = {
    requestedMemberId: input.draft.ownerMemberId,
    requestedReason: input.draft.ownerOverrideReason,
    workstreamId: input.draft.workstreamId,
    selectionKind: "owner" as const,
  };
  const matched = selectMatchedMember({
    match: matchOwner(input.candidates),
    ...selectionInput,
  });
  if (input.draft.kind !== "verification" || !input.writableOwnerMemberIds.has(matched.memberId)) {
    return matched;
  }
  const independentCandidates = input.candidates.filter(
    (candidate) => !input.writableOwnerMemberIds.has(candidate.profile.memberId),
  );
  const independentMatch = matchOwner(independentCandidates);
  if (independentMatch.kind === "matched") {
    const independent = selectMatchedMember({
      match: independentMatch,
      ...selectionInput,
    });
    return {
      memberId: independent.memberId,
      explanation: matched.explanation,
      overrideReason:
        independent.overrideReason ??
        matched.overrideReason ??
        "System-selected the highest-ranked independent final verifier",
    };
  }
  return matched.overrideReason === null
    ? {
        ...matched,
        overrideReason: "No independent final verifier satisfies the hard requirements",
      }
    : matched;
}

function selectWorkstreamReviewer(input: {
  draft: MissionWorkstreamDraft;
  previous: MissionWorkstream | undefined;
  candidates: WorkstreamMatchCandidate[];
  ownerSelection: SelectedMatch;
}): SelectedMatch | null {
  if (input.draft.reviewPolicy !== "required") {
    if (
      input.draft.reviewerRequirements ||
      input.draft.reviewerMemberId ||
      input.draft.reviewerOverrideReason
    ) {
      throw new TeamApplicationError(
        "unexpected_reviewer_configuration",
        `Workstream ${input.draft.workstreamId} does not require review`,
      );
    }
    return null;
  }
  if (!input.draft.reviewerRequirements) {
    throw new TeamApplicationError(
      "reviewer_requirements_required",
      `Workstream ${input.draft.workstreamId} requires reviewer requirements`,
    );
  }
  const matched = selectMatchedMember({
    match: matchWorkstreamReviewer({
      candidates: input.candidates,
      ...input.draft.reviewerRequirements,
      previousReviewerMemberId: input.previous?.reviewerMemberId ?? null,
      ownerMemberId: input.ownerSelection.memberId,
      ownerMutableScope: input.draft.mutableScope,
    }),
    requestedMemberId: input.draft.reviewerMemberId,
    requestedReason: input.draft.reviewerOverrideReason,
    workstreamId: input.draft.workstreamId,
    selectionKind: "reviewer",
  });
  const lacksIndependentReviewer =
    input.draft.mutableScope.kind !== "read_only" &&
    matched.memberId === input.ownerSelection.memberId &&
    matched.overrideReason === null;
  return lacksIndependentReviewer
    ? {
        ...matched,
        overrideReason: "No independent reviewer satisfies the hard requirements",
      }
    : matched;
}

function createPlannedWorkstream(input: {
  draft: MissionWorkstreamDraft;
  ownerSelection: SelectedMatch;
  reviewerSelection: SelectedMatch | null;
  planRevision: number;
  rosterSnapshotRevision: number;
}): MissionWorkstream {
  return {
    workstreamId: input.draft.workstreamId,
    kind: input.draft.kind,
    title: input.draft.title,
    objective: input.draft.objective,
    deliverables: structuredClone(input.draft.deliverables),
    acceptanceCriteria: structuredClone(input.draft.acceptanceCriteria),
    requiredSkillIds: structuredClone(input.draft.requiredSkillIds),
    preferredSkillIds: structuredClone(input.draft.preferredSkillIds),
    requiredRuntimeCapabilityIds: structuredClone(input.draft.requiredRuntimeCapabilityIds),
    minimumLevel: input.draft.minimumLevel,
    planRevision: input.planRevision,
    rosterSnapshotRevision: input.rosterSnapshotRevision,
    dependencyWorkstreamIds: structuredClone(input.draft.dependencyWorkstreamIds),
    mutableScope: structuredClone(input.draft.mutableScope),
    ownerMemberId: input.ownerSelection.memberId,
    ownerMatchExplanation: input.ownerSelection.explanation,
    ownerOverrideReason: input.ownerSelection.overrideReason,
    reviewPolicy: input.draft.reviewPolicy,
    reviewerRequirements: structuredClone(input.draft.reviewerRequirements),
    reviewerMemberId: input.reviewerSelection?.memberId ?? null,
    reviewerMatchExplanation: input.reviewerSelection?.explanation ?? null,
    reviewerOverrideReason: input.reviewerSelection?.overrideReason ?? null,
    status: "planned",
  };
}

interface SelectedMatch {
  memberId: string;
  explanation: MissionMemberMatchExplanation;
  overrideReason: string | null;
}

function selectMatchedMember(input: {
  match: WorkstreamOwnerMatch;
  requestedMemberId: string | undefined;
  requestedReason: string | undefined;
  workstreamId: string;
  selectionKind: "owner" | "reviewer";
}): SelectedMatch {
  if (input.match.kind !== "matched") {
    throw new TeamApplicationError(
      `no_eligible_${input.selectionKind}`,
      `Workstream ${input.workstreamId} has no eligible ${input.selectionKind}`,
    );
  }
  const requestedMemberId = input.requestedMemberId?.trim();
  if (!requestedMemberId || requestedMemberId === input.match.memberId) {
    return {
      memberId: input.match.memberId,
      explanation: input.match.explanation,
      overrideReason: null,
    };
  }
  if (!input.match.explanation.eligibleMemberIds.includes(requestedMemberId)) {
    throw new TeamApplicationError(
      `ineligible_${input.selectionKind}_override`,
      `Member ${requestedMemberId} does not satisfy ${input.workstreamId} hard requirements`,
    );
  }
  const reason = input.requestedReason?.trim();
  if (!reason) {
    throw new TeamApplicationError(
      `${input.selectionKind}_override_reason_required`,
      `Selecting ${requestedMemberId} instead of ${input.match.memberId} requires a reason`,
    );
  }
  return {
    memberId: requestedMemberId,
    explanation: input.match.explanation,
    overrideReason: reason,
  };
}

function matchingCandidates(
  roster: MissionRosterMemberSnapshot[],
  loadByMember: ReadonlyMap<string, number>,
): WorkstreamMatchCandidate[] {
  return roster.map((profile) => ({
    profile,
    openAssignments: loadByMember.get(profile.memberId) ?? 0,
  }));
}

function incrementLoad(loadByMember: Map<string, number>, memberId: string): void {
  loadByMember.set(memberId, (loadByMember.get(memberId) ?? 0) + 1);
}

function assertValidPlanProjection(
  mission: TeamMission,
  acceptedTurnsById: ReadonlyMap<string, AcceptedTurnFact>,
): void {
  const validation = validateTeamMission(mission, {
    acceptedTurnsById,
  });
  if (validation.ok) return;
  throw new TeamApplicationError(
    "invalid_mission_plan",
    `Mission plan is invalid: ${validation.issues.map((issue) => issue.kind).join(", ")}`,
  );
}

function resolveReplanAttentionItems(
  mission: TeamMission,
  actorId: string,
  resolvedAt: string,
): TeamMission["attentionItems"] {
  const unsupported = mission.attentionItems.find(
    (item) => item.status === "open" && !REPLAN_ATTENTION_KINDS.has(item.kind),
  );
  if (unsupported) {
    throw new TeamApplicationError(
      "mission_replan_has_unresolved_attention",
      `Attention ${unsupported.attentionId} must be resolved before Mission replanning`,
    );
  }
  return mission.attentionItems.map((item) => {
    if (item.status !== "open") return item;
    const resolution = {
      kind: "replan" as const,
      actorId,
      reason: "Lead submitted a replacement Mission plan",
      resolvedAt,
      ownerAssignmentId: null,
      recoveryAssignmentId: null,
    };
    const issues = validateMissionAttentionResolution(mission, item, resolution);
    if (issues.length > 0) {
      throw new TeamApplicationError(
        "invalid_attention_resolution",
        `Attention ${item.attentionId} cannot be resolved by replanning`,
      );
    }
    return { ...item, status: "resolved" as const, resolution };
  });
}

function resolveMissingReportAttention(
  mission: TeamMission,
  assignmentId: string,
  actorId: string,
  resolvedAt: string,
): TeamMission {
  const matchingAttention = mission.attentionItems.filter(
    (item) =>
      item.status === "open" &&
      item.kind === "missing_report" &&
      item.assignmentId === assignmentId,
  );
  if (matchingAttention.length === 0) return mission;

  const matchingAttentionIds = new Set(matchingAttention.map((item) => item.attentionId));
  const attentionItems = mission.attentionItems.map((item) => {
    if (!matchingAttentionIds.has(item.attentionId)) return item;
    const resolution = {
      kind: "report_received" as const,
      actorId,
      reason: "Assignment report received",
      resolvedAt,
      ownerAssignmentId: null,
      recoveryAssignmentId: null,
    };
    const issues = validateMissionAttentionResolution(mission, item, resolution);
    if (issues.length > 0) {
      throw new TeamApplicationError(
        "invalid_attention_resolution",
        `Attention ${item.attentionId} cannot be resolved by an Assignment report`,
      );
    }
    return { ...item, status: "resolved" as const, resolution };
  });
  const hasOpenAttention = attentionItems.some((item) => item.status === "open");
  return {
    ...mission,
    attentionItems,
    ...(mission.status === "needs_attention" && !hasOpenAttention
      ? { status: matchingAttention[0]?.priorMissionStatus ?? "active", suspendedStatus: null }
      : {}),
  };
}

function assertReplacementCoverage(
  replaceableAssignments: MissionAssignmentContract[],
  replacementDrafts: ReplacementAssignmentDraft[],
): void {
  const replaceableIds = new Set(
    replaceableAssignments.map((assignment) => assignment.assignmentId),
  );
  const supersededIds = replacementDrafts.map((draft) => draft.supersedesAssignmentId);
  const clientKeys = replacementDrafts.map((draft) => draft.clientKey);
  if (new Set(supersededIds).size !== supersededIds.length) {
    throw new TeamApplicationError(
      "duplicate_superseded_assignment",
      "Each old Assignment can have only one replacement",
    );
  }
  if (new Set(clientKeys).size !== clientKeys.length) {
    throw new TeamApplicationError(
      "duplicate_assignment_client_key",
      "Replacement Assignment client keys must be unique",
    );
  }
  const unknownId = supersededIds.find((assignmentId) => !replaceableIds.has(assignmentId));
  if (unknownId) {
    throw new TeamApplicationError(
      "assignment_not_replaceable",
      `Assignment ${unknownId} is not an unsettled Assignment in the current plan`,
    );
  }
  const missingIds = [...replaceableIds].filter(
    (assignmentId) => !supersededIds.includes(assignmentId),
  );
  if (missingIds.length > 0) {
    throw new TeamApplicationError(
      "mission_replan_requires_replacements",
      `Mission replan must replace Assignments: ${missingIds.join(", ")}`,
    );
  }
}

function assertDaemonOwnedQualityGateDrafts(drafts: ReadonlyArray<AssignmentDraft>): void {
  const qualityGateDraft = drafts.find((draft) => draft.kind !== "delivery");
  if (!qualityGateDraft) return;
  throw new TeamApplicationError(
    "quality_gate_assignment_daemon_owned",
    `${qualityGateDraft.kind} Assignment Contracts are generated by the Team runtime`,
  );
}

function assertAssignmentDraftClientKeysUnique(drafts: ReadonlyArray<AssignmentDraft>): void {
  const clientKeys = drafts.map((draft) => draft.clientKey);
  if (new Set(clientKeys).size !== clientKeys.length) {
    throw new TeamApplicationError(
      "duplicate_assignment_client_key",
      "Assignment client keys must be unique within a Mission plan",
    );
  }
}

function buildReplannedAssignmentState(input: {
  existingAssignments: ReadonlyArray<MissionAssignmentContract>;
  replaceableAssignments: ReadonlyArray<MissionAssignmentContract>;
  replacementDrafts: ReadonlyArray<ReplacementAssignmentDraft>;
  replacements: ReadonlyArray<MissionAssignmentContract>;
  additions: ReadonlyArray<MissionAssignmentContract>;
  now: string;
}): {
  assignments: MissionAssignmentContract[];
  assignmentDeltaHandoffs: StoredMission["assignmentDeltaHandoffs"];
  replacementBySupersededId: Map<string, MissionAssignmentContract>;
} {
  const replacementBySupersededId = new Map(
    input.replacementDrafts.map((draft, index) => [
      draft.supersedesAssignmentId,
      requireValue(input.replacements[index], `Replacement for ${draft.supersedesAssignmentId}`),
    ]),
  );
  const assignments = input.existingAssignments.map((assignment) => {
    const replacement = replacementBySupersededId.get(assignment.assignmentId);
    if (!replacement) return assignment;
    return {
      ...assignment,
      revision: assignment.revision + 1,
      semanticState: "canceled" as const,
      supersededBy: replacement.assignmentId,
      terminationReason: "superseded" as const,
      scopeLease: null,
      settledAt: assignment.settledAt ?? input.now,
    };
  });
  assignments.push(...input.replacements, ...input.additions);
  const assignmentDeltaHandoffs = input.replaceableAssignments.flatMap((assignment) => {
    const replacement = replacementBySupersededId.get(assignment.assignmentId);
    const capturedDelta = assignmentHandoffCapturedDelta(assignment);
    const reportHoldLeaseId =
      assignment.scopeLease?.state === "report_hold" ? assignment.scopeLease.leaseId : null;
    if (!replacement || (capturedDelta.length === 0 && reportHoldLeaseId === null)) return [];
    return [
      {
        sourceAssignmentId: assignment.assignmentId,
        replacementAssignmentId: replacement.assignmentId,
        reportHoldLeaseId,
        capturedDelta: structuredClone(capturedDelta),
        createdAt: input.now,
      },
    ];
  });
  return { assignments, assignmentDeltaHandoffs, replacementBySupersededId };
}

function supersedeDaemonQualityGates(input: {
  assignments: ReadonlyArray<MissionAssignmentContract>;
  replaceableQualityGates: ReadonlyArray<MissionAssignmentContract>;
  currentQualityGates: ReadonlyArray<MissionAssignmentContract>;
  workstreams: ReadonlyArray<MissionWorkstream>;
  now: string;
}): MissionAssignmentContract[] {
  const replacementBySourceId = new Map<string, MissionAssignmentContract>();
  const canceledByPlanChangeIds = new Set<string>();
  for (const assignment of input.replaceableQualityGates) {
    const replacement = input.currentQualityGates.find((candidate) =>
      assignment.kind === "verification"
        ? candidate.kind === "verification"
        : candidate.kind === "review" && candidate.workstreamId === assignment.workstreamId,
    );
    if (!replacement) {
      const workstream = input.workstreams.find(
        (candidate) => candidate.workstreamId === assignment.workstreamId,
      );
      if (assignment.kind === "review" && workstream?.reviewPolicy !== "required") {
        canceledByPlanChangeIds.add(assignment.assignmentId);
        continue;
      }
      throw new TeamApplicationError(
        "mission_replan_quality_gate_contract_missing",
        `Mission replan must retain a ${assignment.kind} quality gate for Workstream ${assignment.workstreamId}`,
      );
    }
    replacementBySourceId.set(assignment.assignmentId, replacement);
  }
  return input.assignments.map((assignment) => {
    if (canceledByPlanChangeIds.has(assignment.assignmentId)) {
      return {
        ...assignment,
        revision: assignment.revision + 1,
        semanticState: "canceled",
        supersededBy: null,
        terminationReason: null,
        planChangeReason: "quality_gate_no_longer_required",
        scopeLease: null,
        settledAt: assignment.settledAt ?? input.now,
      };
    }
    const replacement = replacementBySourceId.get(assignment.assignmentId);
    if (!replacement) return assignment;
    return {
      ...assignment,
      revision: assignment.revision + 1,
      semanticState: "canceled",
      supersededBy: replacement.assignmentId,
      terminationReason: "superseded",
      scopeLease: null,
      settledAt: assignment.settledAt ?? input.now,
    };
  });
}

function assertMissionPlanAssignmentCoverage(input: {
  coverage: MissionAssignmentCoverage;
  previousPlanRevision: number;
  hasAdditionalAssignments: boolean;
}): void {
  if (
    input.coverage.missingWorkstreamIds.length > 0 &&
    (input.previousPlanRevision > 0 || input.hasAdditionalAssignments)
  ) {
    throw new TeamApplicationError(
      "mission_plan_missing_assignment_contracts",
      `Mission plan must include Assignment Contracts for Workstreams: ${input.coverage.missingWorkstreamIds.join(", ")}`,
    );
  }
  if (input.coverage.ambiguousWorkstreamIds.length > 0) {
    throw new TeamApplicationError(
      "mission_plan_ambiguous_assignment_contracts",
      `Mission plan has multiple Assignment Contracts for Workstreams: ${input.coverage.ambiguousWorkstreamIds.join(", ")}`,
    );
  }
}

function assignmentCoverageDeliveryId(missionId: string, planRevision: number): string {
  return `${missionId}:plan:${planRevision}:assignment-coverage:lead`;
}

function buildAssignmentCoverageDelivery(input: {
  mission: TeamMission;
  existing: ReadonlyArray<MissionRecipientAttentionDelivery>;
  missingWorkstreamIds: ReadonlyArray<string>;
  now: string;
}): MissionRecipientAttentionDelivery | null {
  const deliveryId = assignmentCoverageDeliveryId(input.mission.id, input.mission.planRevision);
  const existing = input.existing.find((delivery) => delivery.deliveryId === deliveryId);
  if (existing) return null;
  const roster = input.mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === input.mission.activeRosterSnapshotRevision,
  );
  const lead = roster?.members.find((member) => member.memberId === roster.leadMemberId);
  const participant = input.mission.participants
    .filter(
      (candidate) => candidate.memberId === roster?.leadMemberId && candidate.archivedAt === null,
    )
    .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0];
  if (!lead || !participant) {
    throw new TeamApplicationError(
      "lead_participant_unavailable",
      `Mission ${input.mission.id} cannot stage a plan without an active Lead participant`,
    );
  }
  const missingWorkstreamIds = [...input.missingWorkstreamIds].toSorted();
  const idempotencyKey = `${input.mission.id}:plan:${input.mission.planRevision}:assignment-coverage`;
  return {
    deliveryId,
    idempotencyKey,
    requestFingerprint: JSON.stringify({
      missionId: input.mission.id,
      planRevision: input.mission.planRevision,
      missingWorkstreamIds,
    }),
    roomMessageId: `${idempotencyKey}:message`,
    senderMemberId: lead.memberId,
    senderAgentId: participant.agentId,
    recipientMemberId: lead.memberId,
    bindingEpoch: participant.bindingEpoch,
    mentionHandle: lead.mentionHandle,
    body: `@${lead.mentionHandle} Mission plan revision ${input.mission.planRevision} is staged. Call mission_status, then assign_task once with the complete Assignment batch for Workstreams: ${missingWorkstreamIds.join(", ")}.`,
    roomPostedAt: null,
    roomCursor: null,
    attempts: 0,
    createdAt: input.now,
    successorDeliveryId: null,
    state: "pending",
    lastAttemptAt: null,
    nextEligibleAt: input.now,
    acknowledgedAt: null,
    canceledAt: null,
    cancelReason: null,
  };
}

function canonicalizeAssignmentDependencies(
  mission: TeamMission,
  assignment: MissionAssignmentContract,
  coverage: MissionAssignmentCoverage,
): MissionAssignmentContract {
  if (assignment.kind !== "delivery") return assignment;
  const workstream = mission.workstreams.find(
    (candidate) =>
      candidate.workstreamId === assignment.workstreamId &&
      candidate.planRevision === assignment.planRevision,
  );
  if (!workstream) {
    throw new TeamApplicationError(
      "workstream_not_found",
      `Workstream ${assignment.workstreamId} is not in Mission plan revision ${assignment.planRevision}`,
    );
  }
  const dependencyAssignmentIds = workstream.dependencyWorkstreamIds.map(
    (dependencyWorkstreamId) => {
      const dependencyAssignmentId =
        coverage.assignmentIdsByWorkstreamId.get(dependencyWorkstreamId);
      if (!dependencyAssignmentId) {
        throw new TeamApplicationError(
          "assignment_dependency_contract_missing",
          `Workstream ${workstream.workstreamId} depends on ${dependencyWorkstreamId}, which has no reusable Assignment Contract`,
        );
      }
      return dependencyAssignmentId;
    },
  );
  const expectedDependencyIds = new Set(dependencyAssignmentIds);
  const unexpectedDependencyId = assignment.dependencyAssignmentIds.find(
    (dependencyAssignmentId) => !expectedDependencyIds.has(dependencyAssignmentId),
  );
  if (unexpectedDependencyId) {
    throw new TeamApplicationError(
      "assignment_dependency_workstream_mismatch",
      `Assignment ${assignment.assignmentId} depends on ${unexpectedDependencyId}, which is not required by Workstream ${workstream.workstreamId}`,
    );
  }
  return { ...assignment, dependencyAssignmentIds };
}

function assertReportHoldReplacementScopes(
  replaceableAssignments: MissionAssignmentContract[],
  replacementDrafts: ReplacementAssignmentDraft[],
): void {
  const replacementBySourceId = new Map(
    replacementDrafts.map((draft) => [draft.supersedesAssignmentId, draft]),
  );
  for (const assignment of replaceableAssignments) {
    const lease = assignment.scopeLease;
    if (lease?.state !== "report_hold") continue;
    const replacement = replacementBySourceId.get(assignment.assignmentId);
    if (!replacement || isDeepStrictEqual(replacement.mutableScope, lease.scope)) continue;
    throw new TeamApplicationError(
      "report_hold_scope_mismatch",
      `Replacement for Assignment ${assignment.assignmentId} must preserve its report-hold scope`,
    );
  }
}

function buildAssignment(input: {
  draft: AssignmentDraft;
  mission: TeamMission;
  assignmentId: string;
  assignmentIdsByClientKey: Readonly<Record<string, string>>;
  now: string;
}): MissionAssignmentContract {
  const workstream = input.mission.workstreams.find(
    (candidate) => candidate.workstreamId === input.draft.workstreamId,
  );
  if (!workstream || workstream.planRevision !== input.mission.planRevision) {
    throw new TeamApplicationError(
      "workstream_not_found",
      `Workstream ${input.draft.workstreamId} is not in the current Mission plan`,
    );
  }
  const assigneeMemberId = assignmentAssignee(workstream, input.draft.kind);
  return {
    assignmentId: input.assignmentId,
    revision: 1,
    kind: input.draft.kind,
    subjectAssignmentIds: resolveBatchKeys(
      input.draft.subjectKeys,
      input.assignmentIdsByClientKey,
      "subject",
    ),
    missionId: input.mission.id,
    workstreamId: workstream.workstreamId,
    assigneeMemberId,
    runtimeAgentId: null,
    bindingEpoch: null,
    objective: input.draft.objective,
    inputRefs: structuredClone(input.draft.inputRefs),
    deliverables: structuredClone(input.draft.deliverables),
    acceptanceCriteria: structuredClone(input.draft.acceptanceCriteria),
    mutableScope: structuredClone(input.draft.mutableScope),
    dependencyAssignmentIds: resolveBatchKeys(
      input.draft.dependencyKeys,
      input.assignmentIdsByClientKey,
      "dependency",
    ),
    priority: input.draft.priority,
    planRevision: input.mission.planRevision,
    rosterSnapshotRevision: input.mission.activeRosterSnapshotRevision,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "queued",
    semanticState: "planned",
    attempt: 1,
    acceptedTurnId: null,
    createdAt: input.now,
    dispatchedAt: null,
    settledAt: null,
  };
}

function assignmentAssignee(
  workstream: MissionWorkstream,
  kind: MissionAssignmentContract["kind"],
): string {
  if (kind === "delivery" && workstream.kind !== "verification") {
    return workstream.ownerMemberId;
  }
  if (kind === "review" && workstream.kind !== "verification" && workstream.reviewerMemberId) {
    return workstream.reviewerMemberId;
  }
  if (kind === "verification" && workstream.kind === "verification") {
    return workstream.ownerMemberId;
  }
  throw new TeamApplicationError(
    "assignment_kind_workstream_mismatch",
    `${kind} cannot be assigned for Workstream ${workstream.workstreamId}`,
  );
}

function resolveBatchKeys(
  keys: string[],
  assignmentIdsByClientKey: Readonly<Record<string, string>>,
  relationship: "dependency" | "subject",
): string[] {
  return keys.map((key) => {
    const assignmentId = assignmentIdsByClientKey[key];
    if (!assignmentId) {
      throw new TeamApplicationError(
        `unknown_assignment_${relationship}_key`,
        `Assignment ${relationship} key ${key} is not in this batch`,
      );
    }
    return assignmentId;
  });
}

function requireMapValue<K, V>(map: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (!value) throw new Error(`${label} ${String(key)} is missing`);
  return value;
}

function requireRecordValue(record: Readonly<Record<string, string>>, key: string): string {
  const value = record[key];
  if (!value) throw new Error(`Assignment id for ${key} is missing`);
  return value;
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function memberLoad(
  assignments: ReadonlyArray<MissionAssignmentContract>,
  memberId: string,
): TeamMemberLoad {
  const memberAssignments = assignments.filter(
    (assignment) => assignment.assigneeMemberId === memberId,
  );
  return {
    openAssignments: memberAssignments.filter((assignment) =>
      OPEN_ASSIGNMENT_STATES.has(assignment.semanticState),
    ).length,
    plannedAssignments: memberAssignments.filter(
      (assignment) => assignment.semanticState === "planned",
    ).length,
    runningAssignments: memberAssignments.filter(
      (assignment) => assignment.semanticState === "running",
    ).length,
    needsReportAssignments: memberAssignments.filter(
      (assignment) => assignment.semanticState === "needs_report",
    ).length,
    blockedAssignments: memberAssignments.filter(
      (assignment) => assignment.semanticState === "blocked",
    ).length,
  };
}

function collectMissionBlockers(mission: TeamMission): MissionStatusBlocker[] {
  const attentionBlockers = mission.attentionItems
    .filter((item) => item.status === "open")
    .map(
      (item): MissionStatusBlocker => ({
        kind: "attention",
        id: item.attentionId,
        state: item.kind,
        summary: item.summary,
      }),
    );
  const assignmentBlockers = mission.assignments.flatMap((assignment): MissionStatusBlocker[] => {
    if (
      assignment.semanticState !== "blocked" &&
      assignment.semanticState !== "failed" &&
      assignment.semanticState !== "needs_report"
    ) {
      return [];
    }
    return [
      {
        kind: "assignment",
        id: assignment.assignmentId,
        state: assignment.semanticState,
        summary:
          assignment.report?.summary ??
          assignment.terminationReason ??
          `${assignment.assignmentId} requires attention`,
      },
    ];
  });
  return [...attentionBlockers, ...assignmentBlockers];
}

function collectMissionArtifacts(mission: TeamMission): MissionStatusArtifact[] {
  return mission.assignments.flatMap((assignment): MissionStatusArtifact[] => {
    const paths = assignment.report?.artifactPaths ?? [];
    return paths.length === 0
      ? []
      : [
          {
            assignmentId: assignment.assignmentId,
            workstreamId: assignment.workstreamId,
            paths: [...paths],
          },
        ];
  });
}

function latestParticipantForMember(
  mission: TeamMission,
  memberId: string,
): MissionParticipant | null {
  return (
    mission.participants
      .filter((participant) => participant.memberId === memberId)
      .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0] ?? null
  );
}

function isTerminalMission(mission: TeamMission): boolean {
  return (
    mission.status === "completed" || mission.status === "failed" || mission.status === "canceled"
  );
}

const TEAM_MENTION_PATTERN = new RegExp(`(?:^|[\\s(])@(${TEAM_MENTION_TOKEN_SOURCE})`, "g");

function parseTeamMentionTokens(body: string): string[] {
  return Array.from(body.matchAll(TEAM_MENTION_PATTERN), (match) => match[1]).filter(
    (token): token is string => Boolean(token),
  );
}

function resolveMessageRecipient(
  roster: ReadonlyArray<MissionRosterMemberSnapshot>,
  recipient: string,
): MissionRosterMemberSnapshot {
  const normalized = recipient.trim();
  const handle = normalized.startsWith("@") ? normalized.slice(1).toLowerCase() : null;
  const member = roster.find(
    (candidate) =>
      candidate.memberId === normalized ||
      (handle !== null && candidate.mentionHandle.toLowerCase() === handle),
  );
  if (!member) {
    throw new TeamApplicationError(
      "mission_member_not_found",
      `Recipient ${recipient} is not in the active Mission roster`,
    );
  }
  return member;
}

function assertCurrentMessageBindings(input: {
  mission: TeamMission;
  callerAgentId: string;
  callerMemberId: string;
  callerBindingEpoch: number;
  recipientMemberId: string;
  recipientAgentId: string;
  recipientBindingEpoch: number;
}): MissionParticipant {
  if (isTerminalMission(input.mission)) {
    throw new TeamApplicationError(
      "mission_terminal",
      `Mission ${input.mission.id} is ${input.mission.status}`,
    );
  }
  const caller = input.mission.participants.find(
    (participant) =>
      participant.memberId === input.callerMemberId &&
      participant.agentId === input.callerAgentId &&
      participant.bindingEpoch === input.callerBindingEpoch &&
      participant.archivedAt === null,
  );
  if (!caller) {
    throw new TeamApplicationError(
      "participant_binding_changed",
      `Sender binding changed while posting to Mission ${input.mission.id}`,
    );
  }
  const recipient = input.mission.participants.find(
    (participant) =>
      participant.memberId === input.recipientMemberId &&
      participant.agentId === input.recipientAgentId &&
      participant.bindingEpoch === input.recipientBindingEpoch &&
      participant.archivedAt === null,
  );
  if (!recipient) {
    throw new TeamApplicationError(
      "participant_binding_changed",
      `Recipient binding changed while posting to Mission ${input.mission.id}`,
    );
  }
  return recipient;
}

function validateAssignmentReportRequest(
  context: AuthorizedMissionContext,
  input: ReportAssignmentInput,
): ValidatedAssignmentReportRequest {
  if (isTerminalMission(context.mission)) {
    throw new TeamApplicationError(
      "mission_terminal",
      `Mission ${context.mission.id} is ${context.mission.status}`,
    );
  }
  const assignment = context.mission.assignments.find(
    (candidate) => candidate.assignmentId === input.assignmentId,
  );
  if (!assignment) {
    throw new TeamApplicationError(
      "assignment_not_found",
      `Assignment ${input.assignmentId} does not exist in Mission ${input.missionId}`,
    );
  }
  if (
    assignment.assigneeMemberId !== context.callerMember.memberId ||
    assignment.runtimeAgentId !== context.callerParticipant.agentId ||
    assignment.bindingEpoch !== context.callerParticipant.bindingEpoch
  ) {
    throw new TeamApplicationError(
      "assignment_assignee_required",
      `Assignment ${input.assignmentId} belongs to another participant binding`,
    );
  }
  if (assignment.revision !== input.expectedAssignmentRevision) {
    throw new TeamApplicationError(
      "assignment_revision_conflict",
      `Assignment ${input.assignmentId} revision ${assignment.revision} does not match ${input.expectedAssignmentRevision}`,
    );
  }
  const parsedReport = MissionAssignmentReportSchema.safeParse(input.report);
  if (!parsedReport.success) {
    throw new TeamApplicationError(
      "invalid_assignment_report",
      `Assignment ${input.assignmentId} report is invalid`,
    );
  }
  if (assignment.report !== null) {
    if (isDeepStrictEqual(assignment.report, parsedReport.data)) {
      return { kind: "replay", result: { mission: context.mission, assignment } };
    }
    throw new TeamApplicationError(
      "assignment_report_conflict",
      `Assignment ${input.assignmentId} already has a different report`,
    );
  }
  const dispatchStopped = assertReportAllowedDuringFinish(context.storedMission, assignment);
  if (assignment.semanticState !== "running" && assignment.semanticState !== "needs_report") {
    throw new TeamApplicationError(
      "assignment_not_reportable",
      `Assignment ${input.assignmentId} is ${assignment.semanticState}`,
    );
  }
  return {
    kind: "new",
    assignment,
    report: parsedReport.data,
    dispatchStopped,
    lateReport: assignment.semanticState === "needs_report",
  };
}

function reportSemanticState(
  assignmentKind: MissionAssignmentContract["kind"],
  report: MissionAssignmentReport,
): MissionAssignmentContract["semanticState"] {
  switch (report.status) {
    case "completed":
      return assignmentKind !== "delivery" && report.verdict === "changes_requested"
        ? "failed"
        : "completed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
  }
}

function projectAssignmentReplanAttention(input: {
  mission: TeamMission;
  recovery: MissionRecoveryState;
  assignment: MissionAssignmentContract;
  acceptedTurn: AcceptedTurnFact & {
    outcome: "completed" | "failed" | "canceled" | "unknown";
  };
  pathEvidence: Array<{ path: string; fingerprint: string }>;
  createdAt: string;
}): { mission: TeamMission; recovery: MissionRecoveryState } {
  const priorStatus =
    input.mission.status === "needs_attention"
      ? input.mission.suspendedStatus
      : input.mission.status;
  const priorMissionStatus =
    priorStatus === "planning" || priorStatus === "active" || priorStatus === "verifying"
      ? priorStatus
      : "active";
  const attentionId = assignmentReplanAttentionId(input.mission.id, input.assignment.assignmentId);
  const hasAttention = input.mission.attentionItems.some(
    (attention) => attention.attentionId === attentionId,
  );
  const attentionItems = hasAttention
    ? input.mission.attentionItems
    : [
        ...input.mission.attentionItems,
        {
          attentionId,
          kind: "assignment_requires_replan" as const,
          status: "open" as const,
          priorMissionStatus,
          assignmentId: input.assignment.assignmentId,
          summary: assignmentReplanSummary(input.assignment, input.acceptedTurn),
          pathEvidence: input.pathEvidence,
          createdAt: input.createdAt,
          resolution: null,
        },
      ];
  const deliveries = buildLeadReplanDeliveries({
    mission: input.mission,
    existing: input.recovery.recipientAttentionOutbox,
    transitions: [{ assignment: input.assignment, fact: input.acceptedTurn }],
    now: input.createdAt,
  });
  return {
    mission: {
      ...input.mission,
      status: "needs_attention",
      suspendedStatus: priorMissionStatus,
      attentionItems,
    },
    recovery:
      deliveries.length > 0
        ? {
            ...input.recovery,
            recipientAttentionOutbox: [...input.recovery.recipientAttentionOutbox, ...deliveries],
          }
        : input.recovery,
  };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function isTerminalAcceptedTurnFact<Fact extends { outcome: AcceptedTurnFact["outcome"] }>(
  fact: Fact,
): fact is Fact & { outcome: "completed" | "failed" | "canceled" | "unknown" } {
  return (
    fact.outcome === "completed" ||
    fact.outcome === "failed" ||
    fact.outcome === "canceled" ||
    fact.outcome === "unknown"
  );
}
