import type {
  MissionAssignmentContract,
  MissionFinalVerificationGate,
  MissionReviewGateEvidence,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";

import type { MissionAssignmentCoverage } from "../domain/mission-validation.js";
import { reviewGateReviewerMemberId } from "../domain/mission-review-gate.js";
import { buildMissionFinalVerificationGate } from "../domain/mission-final-verification-gate.js";
import { sameCanonicalValue } from "../domain/mission-review-gate.js";
import {
  type AcceptedTurnFact,
  validateAssignmentContract,
} from "../domain/assignment-contract-validation.js";

export interface MissionQualityGatePlan {
  additions: MissionAssignmentContract[];
  selectedAssignments: MissionAssignmentContract[];
  obsoleteReviewAssignments: MissionAssignmentContract[];
  currentVerificationAssignments: MissionAssignmentContract[];
  obsoleteVerificationAssignments: MissionAssignmentContract[];
  expectedVerificationSubjectIds: string[];
  expectedFinalVerificationGate: MissionFinalVerificationGate | null;
}

interface MissionQualityGatePlanInput {
  mission: TeamMission;
  coverage: MissionAssignmentCoverage;
  createdAt: string;
  settledReviewGateWorkstreamIds: ReadonlySet<string>;
  acceptedTurnsById: ReadonlyMap<string, AcceptedTurnFact>;
  materializePending?: boolean;
}

interface FinalVerificationPlan {
  additions: MissionAssignmentContract[];
  selectedAssignments: MissionAssignmentContract[];
  currentAssignments: MissionAssignmentContract[];
  obsoleteAssignments: MissionAssignmentContract[];
  expectedSubjectIds: string[];
  expectedGate: MissionFinalVerificationGate | null;
}

export function planMissionQualityGates(
  input: MissionQualityGatePlanInput,
): MissionQualityGatePlan {
  const assignmentsById = new Map(
    input.mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  const additions: MissionAssignmentContract[] = [];
  const selectedAssignments: MissionAssignmentContract[] = [];
  const obsoleteReviewAssignments: MissionAssignmentContract[] = [];
  const verificationSubjects: MissionAssignmentContract[] = [];
  let hasCompleteLineage = true;

  for (const workstream of input.mission.workstreams) {
    if (workstream.kind === "verification") continue;
    const deliveryAssignmentId = input.coverage.assignmentIdsByWorkstreamId.get(
      workstream.workstreamId,
    );
    const deliveryAssignment = deliveryAssignmentId
      ? assignmentsById.get(deliveryAssignmentId)
      : undefined;
    if (!deliveryAssignment) {
      hasCompleteLineage = false;
      continue;
    }
    const deliveryCompleted = input.coverage.completedDeliveryAssignmentIds.has(
      deliveryAssignment.assignmentId,
    );
    if (!input.materializePending && !deliveryCompleted) {
      hasCompleteLineage = false;
      continue;
    }
    verificationSubjects.push(deliveryAssignment);
    const review = planWorkstreamReview({
      ...input,
      workstream,
      deliveryAssignment,
      assignmentsById,
    });
    obsoleteReviewAssignments.push(...review.obsoleteAssignments);
    if (review.addition) additions.push(review.addition);
    if (review.assignment) selectedAssignments.push(review.assignment);
    if (!review.settled) {
      hasCompleteLineage = false;
      continue;
    }
    if (!review.assignment) continue;
    verificationSubjects.push(review.assignment);
  }

  const finalVerificationPlan = planFinalVerification({
    input,
    verificationSubjects,
    hasCompleteLineage,
  });
  additions.push(...finalVerificationPlan.additions);
  selectedAssignments.push(...finalVerificationPlan.selectedAssignments);

  return {
    additions,
    selectedAssignments,
    obsoleteReviewAssignments,
    currentVerificationAssignments: finalVerificationPlan.currentAssignments,
    obsoleteVerificationAssignments: finalVerificationPlan.obsoleteAssignments,
    expectedVerificationSubjectIds: finalVerificationPlan.expectedSubjectIds,
    expectedFinalVerificationGate: finalVerificationPlan.expectedGate,
  };
}

function planFinalVerification(input: {
  input: MissionQualityGatePlanInput;
  verificationSubjects: MissionAssignmentContract[];
  hasCompleteLineage: boolean;
}): FinalVerificationPlan {
  const finalVerification = input.input.mission.workstreams.find(
    (workstream) => workstream.kind === "verification",
  );
  const finalGate = finalVerification?.finalVerificationGate ?? null;
  const verificationAssignments = finalVerification
    ? input.input.mission.assignments.filter(
        (assignment) =>
          assignment.kind === "verification" &&
          assignment.workstreamId === finalVerification.workstreamId &&
          assignment.planRevision === input.input.mission.planRevision &&
          assignment.semanticState !== "canceled",
      )
    : [];
  const expectedVerificationSubjectIds = canonicalAssignmentIds(
    input.verificationSubjects.map((assignment) => assignment.assignmentId),
  );
  const reviewGateEvidence = finalVerificationReviewGateEvidence(input.input.mission);
  const expectedFinalVerificationGate =
    finalVerification && finalGate
      ? buildMissionFinalVerificationGate({
          workstreamId: finalVerification.workstreamId,
          planRevision: input.input.mission.planRevision,
          methodologySnapshotRevision: finalVerification.methodologySnapshotRevision,
          subjectAssignmentIds: expectedVerificationSubjectIds,
          reviewGateFingerprints: input.input.mission.workstreams.flatMap((workstream) =>
            workstream.reviewGate.kind === "required"
              ? [workstream.reviewGate.gateKeyFingerprint]
              : [],
          ),
          requirements: finalGate.key.requirements,
          selection: finalGate.selection,
        })
      : null;

  const matchingVerificationAssignments = verificationAssignments.filter(
    (assignment) =>
      expectedFinalVerificationGate?.selection.kind === "assigned" &&
      assignment.assigneeMemberId === expectedFinalVerificationGate.selection.verifierMemberId &&
      assignment.finalVerificationGateFingerprint === expectedFinalVerificationGate.fingerprint &&
      sameCanonicalValue(assignment.reviewGateEvidence, reviewGateEvidence) &&
      sameAssignmentIdSet(assignment.subjectAssignmentIds, expectedVerificationSubjectIds) &&
      sameAssignmentIdSet(assignment.dependencyAssignmentIds, expectedVerificationSubjectIds),
  );
  const currentVerificationAssignments =
    matchingVerificationAssignments.length === 1 ? [...matchingVerificationAssignments] : [];
  const obsoleteVerificationAssignments =
    matchingVerificationAssignments.length <= 1
      ? verificationAssignments.filter(
          (assignment) => assignment !== matchingVerificationAssignments[0],
        )
      : [...verificationAssignments];

  if (
    finalVerification &&
    expectedFinalVerificationGate?.selection.kind === "assigned" &&
    input.hasCompleteLineage &&
    expectedVerificationSubjectIds.length > 0 &&
    currentVerificationAssignments.length === 0
  ) {
    const verification = buildQualityGateAssignment({
      mission: input.input.mission,
      workstream: {
        ...finalVerification,
        finalVerificationGate: expectedFinalVerificationGate,
      },
      kind: "verification",
      assigneeMemberId: expectedFinalVerificationGate.selection.verifierMemberId,
      subjects: input.verificationSubjects,
      reviewGateEvidence,
      createdAt: input.input.createdAt,
    });
    const additions = [verification];
    currentVerificationAssignments.push(verification);
    return {
      additions,
      selectedAssignments: [verification],
      currentAssignments: currentVerificationAssignments,
      obsoleteAssignments: obsoleteVerificationAssignments,
      expectedSubjectIds: expectedVerificationSubjectIds,
      expectedGate: expectedFinalVerificationGate,
    };
  }

  return {
    additions: [],
    selectedAssignments:
      currentVerificationAssignments.length === 1 ? [currentVerificationAssignments[0]!] : [],
    currentAssignments: currentVerificationAssignments,
    obsoleteAssignments: obsoleteVerificationAssignments,
    expectedSubjectIds: expectedVerificationSubjectIds,
    expectedGate: expectedFinalVerificationGate,
  };
}

function planWorkstreamReview(input: {
  mission: TeamMission;
  coverage: MissionAssignmentCoverage;
  createdAt: string;
  settledReviewGateWorkstreamIds: ReadonlySet<string>;
  acceptedTurnsById: ReadonlyMap<string, AcceptedTurnFact>;
  materializePending?: boolean;
  workstream: MissionWorkstream;
  deliveryAssignment: MissionAssignmentContract;
  assignmentsById: ReadonlyMap<string, MissionAssignmentContract>;
}): {
  assignment: MissionAssignmentContract | null;
  addition: MissionAssignmentContract | null;
  obsoleteAssignments: MissionAssignmentContract[];
  settled: boolean;
} {
  if (input.settledReviewGateWorkstreamIds.has(input.workstream.workstreamId)) {
    const approved =
      input.workstream.reviewGate.kind === "required" &&
      input.workstream.reviewGate.outcome.kind === "approved"
        ? input.assignmentsById.get(input.workstream.reviewGate.outcome.reviewAssignmentId)
        : undefined;
    return {
      assignment: approved ?? null,
      addition: null,
      obsoleteAssignments: [],
      settled: true,
    };
  }
  if (input.workstream.reviewGate.kind !== "required") {
    return { assignment: null, addition: null, obsoleteAssignments: [], settled: false };
  }
  if (input.workstream.reviewGate.outcome.kind !== "pending") {
    return { assignment: null, addition: null, obsoleteAssignments: [], settled: false };
  }
  const currentReviews = input.mission.assignments.filter(
    (assignment) =>
      assignment.kind === "review" &&
      assignment.workstreamId === input.workstream.workstreamId &&
      assignment.planRevision === input.mission.planRevision &&
      assignment.semanticState !== "canceled",
  );
  const reusableReviews = currentReviews.filter((assignment) =>
    isReusablePendingReviewAssignment(input, assignment),
  );
  if (reusableReviews.length === 1 && currentReviews.length === 1) {
    return {
      assignment: reusableReviews[0]!,
      addition: null,
      obsoleteAssignments: [],
      settled: false,
    };
  }
  const obsoleteAssignments = [...currentReviews];
  if (!input.materializePending && input.workstream.status !== "review") {
    return { assignment: null, addition: null, obsoleteAssignments, settled: false };
  }
  const reviewerMemberId = reviewGateReviewerMemberId(input.workstream.reviewGate);
  if (!reviewerMemberId) {
    return { assignment: null, addition: null, obsoleteAssignments, settled: false };
  }
  const assignment = buildQualityGateAssignment({
    mission: input.mission,
    workstream: input.workstream,
    kind: "review",
    assigneeMemberId: reviewerMemberId,
    subjects: [input.deliveryAssignment],
    createdAt: input.createdAt,
  });
  return { assignment, addition: assignment, obsoleteAssignments, settled: false };
}

function isReusablePendingReviewAssignment(
  input: Parameters<typeof planWorkstreamReview>[0],
  assignment: MissionAssignmentContract,
): boolean {
  const gate = input.workstream.reviewGate;
  if (gate.kind !== "required" || gate.selection.kind !== "assigned") return false;
  if (!["planned", "running", "needs_report"].includes(assignment.semanticState)) {
    return false;
  }
  return (
    hasReusableReviewLifecycle(input, assignment) &&
    assignment.missionId === input.mission.id &&
    assignment.assigneeMemberId === gate.selection.reviewerMemberId &&
    assignment.rosterSnapshotRevision === input.workstream.rosterSnapshotRevision &&
    assignment.methodologySnapshotRevision === input.workstream.methodologySnapshotRevision &&
    assignment.objective === input.workstream.objective &&
    sameStringArray(assignment.deliverables, input.workstream.deliverables) &&
    sameStringArray(assignment.acceptanceCriteria, input.workstream.acceptanceCriteria) &&
    assignment.mutableScope.kind === "read_only" &&
    assignment.reviewGateFingerprint === gate.gateKeyFingerprint &&
    assignment.reviewSubjectFingerprint === gate.subjectFingerprint &&
    sameAssignmentIdSet(assignment.subjectAssignmentIds, [input.deliveryAssignment.assignmentId]) &&
    sameAssignmentIdSet(assignment.dependencyAssignmentIds, [input.deliveryAssignment.assignmentId])
  );
}

function hasReusableReviewLifecycle(
  input: Parameters<typeof planWorkstreamReview>[0],
  assignment: MissionAssignmentContract,
): boolean {
  if (assignment.semanticState === "running") {
    return (
      assignment.dispatchState === "dispatched" &&
      assignment.acceptedTurnId !== null &&
      assignment.runtimeAgentId !== null &&
      assignment.bindingEpoch !== null &&
      assignment.workspaceBaseline !== null &&
      assignment.workspaceBaseline.workspaceId === input.mission.workspaceId &&
      assignment.workspaceBaseline.assignmentId === assignment.assignmentId &&
      assignment.report === null &&
      assignment.scopeLease === null &&
      assignment.dispatchedAt !== null &&
      assignment.settledAt === null &&
      assignment.terminationReason === null &&
      assignment.supersededBy === null
    );
  }
  const acceptedTurn =
    assignment.acceptedTurnId === null
      ? null
      : (input.acceptedTurnsById.get(assignment.acceptedTurnId) ?? null);
  return validateAssignmentContract({
    assignment,
    acceptedTurn,
    expectedWorkspaceId: input.mission.workspaceId,
  }).ok;
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameAssignmentIdSet(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  const canonicalLeft = canonicalAssignmentIds(left);
  const canonicalRight = canonicalAssignmentIds(right);
  return (
    canonicalLeft.length === left.length &&
    canonicalRight.length === right.length &&
    canonicalLeft.length === canonicalRight.length &&
    canonicalLeft.every((assignmentId, index) => assignmentId === canonicalRight[index])
  );
}

function canonicalAssignmentIds(assignmentIds: ReadonlyArray<string>): string[] {
  return [...new Set(assignmentIds)].toSorted();
}

function buildQualityGateAssignment(input: {
  mission: TeamMission;
  workstream: MissionWorkstream;
  kind: "review" | "verification";
  assigneeMemberId: string;
  subjects: MissionAssignmentContract[];
  reviewGateEvidence?: MissionReviewGateEvidence[];
  createdAt: string;
}): MissionAssignmentContract {
  const subjectAssignmentIds = canonicalAssignmentIds(
    input.subjects.map((assignment) => assignment.assignmentId),
  );
  return {
    assignmentId: nextQualityGateAssignmentId(input),
    revision: 1,
    kind: input.kind,
    subjectAssignmentIds,
    reviewGateFingerprint:
      input.kind === "review" && input.workstream.reviewGate.kind === "required"
        ? input.workstream.reviewGate.gateKeyFingerprint
        : null,
    reviewSubjectFingerprint:
      input.kind === "review" && input.workstream.reviewGate.kind === "required"
        ? input.workstream.reviewGate.subjectFingerprint
        : null,
    finalVerificationGateFingerprint:
      input.kind === "verification"
        ? (input.workstream.finalVerificationGate?.fingerprint ?? null)
        : null,
    reviewGateEvidence:
      input.kind === "verification"
        ? (structuredClone(input.reviewGateEvidence ?? []) as MissionReviewGateEvidence[])
        : [],
    missionId: input.mission.id,
    workstreamId: input.workstream.workstreamId,
    assigneeMemberId: input.assigneeMemberId,
    runtimeAgentId: null,
    bindingEpoch: null,
    objective: input.workstream.objective,
    inputRefs: subjectAssignmentIds.map((assignmentId) => `assignment-report:${assignmentId}`),
    deliverables: structuredClone(input.workstream.deliverables),
    acceptanceCriteria: structuredClone(input.workstream.acceptanceCriteria),
    mutableScope: { kind: "read_only" },
    dependencyAssignmentIds: subjectAssignmentIds,
    priority: Math.max(0, ...input.subjects.map((assignment) => assignment.priority)),
    planRevision: input.mission.planRevision,
    rosterSnapshotRevision: input.workstream.rosterSnapshotRevision,
    methodologySnapshotRevision: input.workstream.methodologySnapshotRevision,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "queued",
    semanticState: "planned",
    attempt: 1,
    acceptedTurnId: null,
    createdAt: input.createdAt,
    dispatchedAt: null,
    settledAt: null,
  };
}

function finalVerificationReviewGateEvidence(mission: TeamMission): MissionReviewGateEvidence[] {
  return mission.workstreams.flatMap<MissionReviewGateEvidence>((workstream) => {
    const gate = workstream.reviewGate;
    if (gate.kind !== "required") return [];
    if (gate.outcome.kind === "approved") {
      return [
        {
          kind: "approved" as const,
          gateKey: structuredClone(gate.gateKey),
          gateKeyFingerprint: gate.gateKeyFingerprint,
          subjectFingerprint: gate.subjectFingerprint,
          reviewAssignmentId: gate.outcome.reviewAssignmentId,
          reportFingerprint: gate.outcome.reportFingerprint,
          inheritedFromGateFingerprint: gate.outcome.inheritedFromGateFingerprint,
        },
      ];
    }
    if (gate.outcome.kind === "waived") {
      return [
        {
          kind: "waived" as const,
          gateKey: structuredClone(gate.gateKey),
          gateKeyFingerprint: gate.gateKeyFingerprint,
          subjectFingerprint: gate.subjectFingerprint,
          waiverId: gate.outcome.waiverId,
        },
      ];
    }
    return [];
  });
}

function nextQualityGateAssignmentId(input: {
  mission: TeamMission;
  workstream: MissionWorkstream;
  kind: "review" | "verification";
}): string {
  const baseId = `assignment:${input.mission.id}:${input.mission.planRevision}:${input.workstream.workstreamId}:${input.kind}`;
  const existingIds = new Set(
    input.mission.assignments.map((assignment) => assignment.assignmentId),
  );
  if (!existingIds.has(baseId)) return baseId;
  let ordinal = 2;
  while (existingIds.has(`${baseId}:${ordinal}`)) ordinal += 1;
  return `${baseId}:${ordinal}`;
}
