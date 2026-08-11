import type {
  MissionAssignmentContract,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";

import type { MissionAssignmentCoverage } from "../domain/mission-validation.js";

export interface MissionQualityGatePlan {
  additions: MissionAssignmentContract[];
  selectedAssignments: MissionAssignmentContract[];
  currentVerificationAssignments: MissionAssignmentContract[];
  expectedVerificationSubjectIds: string[];
}

export function planMissionQualityGates(input: {
  mission: TeamMission;
  coverage: MissionAssignmentCoverage;
  createdAt: string;
  materializePending?: boolean;
}): MissionQualityGatePlan {
  const assignmentsById = new Map(
    input.mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  const additions: MissionAssignmentContract[] = [];
  const selectedAssignments: MissionAssignmentContract[] = [];
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
    if (!review.complete) {
      hasCompleteLineage = false;
      continue;
    }
    if (!review.assignment) continue;
    if (review.addition) additions.push(review.addition);
    verificationSubjects.push(review.assignment);
    selectedAssignments.push(review.assignment);
  }

  const finalVerification = input.mission.workstreams.find(
    (workstream) => workstream.kind === "verification",
  );
  const currentVerificationAssignments = finalVerification
    ? input.mission.assignments.filter(
        (assignment) =>
          assignment.kind === "verification" &&
          assignment.workstreamId === finalVerification.workstreamId &&
          assignment.planRevision === input.mission.planRevision &&
          assignment.semanticState !== "canceled",
      )
    : [];
  const expectedVerificationSubjectIds = canonicalAssignmentIds(
    verificationSubjects.map((assignment) => assignment.assignmentId),
  );

  if (
    finalVerification &&
    hasCompleteLineage &&
    expectedVerificationSubjectIds.length > 0 &&
    currentVerificationAssignments.length === 0
  ) {
    const verification = buildQualityGateAssignment({
      mission: input.mission,
      workstream: finalVerification,
      kind: "verification",
      assigneeMemberId: finalVerification.ownerMemberId,
      subjects: verificationSubjects,
      createdAt: input.createdAt,
    });
    additions.push(verification);
    currentVerificationAssignments.push(verification);
  }

  if (currentVerificationAssignments.length === 1) {
    selectedAssignments.push(currentVerificationAssignments[0]!);
  }

  return {
    additions,
    selectedAssignments,
    currentVerificationAssignments,
    expectedVerificationSubjectIds,
  };
}

function planWorkstreamReview(input: {
  mission: TeamMission;
  coverage: MissionAssignmentCoverage;
  createdAt: string;
  materializePending?: boolean;
  workstream: MissionWorkstream;
  deliveryAssignment: MissionAssignmentContract;
  assignmentsById: ReadonlyMap<string, MissionAssignmentContract>;
}): {
  assignment: MissionAssignmentContract | null;
  addition: MissionAssignmentContract | null;
  complete: boolean;
} {
  if (input.workstream.reviewPolicy !== "required") {
    return { assignment: null, addition: null, complete: true };
  }
  const approvedReviewAssignmentId = input.coverage.approvedReviewAssignmentIdsByWorkstreamId.get(
    input.workstream.workstreamId,
  );
  const approvedReviewAssignment = approvedReviewAssignmentId
    ? input.assignmentsById.get(approvedReviewAssignmentId)
    : undefined;
  if (approvedReviewAssignment) {
    return { assignment: approvedReviewAssignment, addition: null, complete: true };
  }
  const currentReviews = input.mission.assignments.filter(
    (assignment) =>
      assignment.kind === "review" &&
      assignment.workstreamId === input.workstream.workstreamId &&
      assignment.planRevision === input.mission.planRevision &&
      assignment.semanticState !== "canceled",
  );
  if (currentReviews.length > 1) {
    return { assignment: null, addition: null, complete: false };
  }
  if (currentReviews[0]) {
    return { assignment: currentReviews[0], addition: null, complete: true };
  }
  if (!input.materializePending && input.workstream.status !== "review") {
    return { assignment: null, addition: null, complete: false };
  }
  if (!input.workstream.reviewerMemberId) {
    throw new Error(`Workstream ${input.workstream.workstreamId} has no required reviewer`);
  }
  const assignment = buildQualityGateAssignment({
    mission: input.mission,
    workstream: input.workstream,
    kind: "review",
    assigneeMemberId: input.workstream.reviewerMemberId,
    subjects: [input.deliveryAssignment],
    createdAt: input.createdAt,
  });
  return { assignment, addition: assignment, complete: true };
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
    missionId: input.mission.id,
    workstreamId: input.workstream.workstreamId,
    assigneeMemberId: input.assigneeMemberId,
    runtimeAgentId: null,
    bindingEpoch: null,
    objective: input.workstream.objective,
    inputRefs: subjectAssignmentIds.map((assignmentId) => `assignment-report:${assignmentId}`),
    deliverables: structuredClone(input.workstream.deliverables),
    acceptanceCriteria: structuredClone(input.workstream.acceptanceCriteria),
    mutableScope: input.kind === "review" ? { kind: "read_only" } : input.workstream.mutableScope,
    dependencyAssignmentIds: subjectAssignmentIds,
    priority: Math.max(0, ...input.subjects.map((assignment) => assignment.priority)),
    planRevision: input.mission.planRevision,
    rosterSnapshotRevision: input.workstream.rosterSnapshotRevision,
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
