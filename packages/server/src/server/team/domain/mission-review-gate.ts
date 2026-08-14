import { createHash } from "node:crypto";

import type {
  MissionAssignmentContract,
  MissionMemberRequirements,
  MissionReviewGate,
  MissionReviewGateKey,
  MissionReviewGateOutcome,
  MissionReviewGateSelection,
  MissionReviewSubjectKey,
  MissionWorkstream,
} from "@getpaseo/protocol/team/v2-types";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** Sorted and duplicate-free, so the subject identity does not depend on order. */
export function canonicalReviewSubjectAssignmentIds(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids)].toSorted();
}

export function missionReviewSubjectFingerprint(subject: MissionReviewSubjectKey): string {
  return fingerprint({
    workstreamId: subject.workstreamId,
    subjectAssignmentIds: canonicalReviewSubjectAssignmentIds(subject.subjectAssignmentIds),
  });
}

export function missionReviewGateKeyFingerprint(gateKey: MissionReviewGateKey): string {
  return fingerprint({
    planRevision: gateKey.planRevision,
    subject: {
      workstreamId: gateKey.subject.workstreamId,
      subjectAssignmentIds: canonicalReviewSubjectAssignmentIds(
        gateKey.subject.subjectAssignmentIds,
      ),
    },
  });
}

export function missionReviewReportFingerprint(
  report: NonNullable<MissionAssignmentContract["report"]>,
): string {
  return fingerprint(report);
}

export const notRequiredReviewGate: MissionReviewGate = {
  kind: "none",
  outcome: { kind: "not_required" },
};

export function buildMissionReviewGate(input: {
  workstreamId: string;
  planRevision: number;
  subjectAssignmentIds: ReadonlyArray<string>;
  requirements: MissionMemberRequirements;
  selection: MissionReviewGateSelection;
  outcome: MissionReviewGateOutcome;
}): MissionReviewGate {
  const gateKey: MissionReviewGateKey = {
    subject: {
      workstreamId: input.workstreamId,
      subjectAssignmentIds: canonicalReviewSubjectAssignmentIds(input.subjectAssignmentIds),
    },
    planRevision: input.planRevision,
  };
  return {
    kind: "required",
    gateKey,
    gateKeyFingerprint: missionReviewGateKeyFingerprint(gateKey),
    subjectFingerprint: missionReviewSubjectFingerprint(gateKey.subject),
    requirements: structuredClone(input.requirements) as MissionMemberRequirements,
    selection: structuredClone(input.selection) as MissionReviewGateSelection,
    outcome: structuredClone(input.outcome) as MissionReviewGateOutcome,
  };
}

export function reviewGateReviewerMemberId(gate: MissionReviewGate): string | null {
  if (gate.kind !== "required" || gate.selection.kind !== "assigned") return null;
  return gate.selection.reviewerMemberId;
}

export interface InheritableApprovedReview {
  reviewAssignmentId: string;
  reportFingerprint: string;
  inheritedFromGateFingerprint: string;
  decidedAt: string;
  selection: MissionReviewGateSelection & { kind: "assigned" };
}

/**
 * An approved outcome carries over to a new plan revision only when the stable
 * subject and immutable Workstream contract are byte-for-byte identical and
 * the approved reviewer remains structurally eligible. Waivers authorize one
 * gate instance and never carry over.
 */
export function inheritableApprovedReview(input: {
  previous: MissionWorkstream | undefined;
  current: MissionWorkstream;
  subjectFingerprint: string;
}): InheritableApprovedReview | null {
  const previousGate = input.previous?.reviewGate;
  const currentGate = input.current.reviewGate;
  if (!input.previous || previousGate?.kind !== "required" || currentGate.kind !== "required") {
    return null;
  }
  if (previousGate.outcome.kind !== "approved") return null;
  if (previousGate.subjectFingerprint !== input.subjectFingerprint) return null;
  if (
    !sameCanonicalValue(
      reviewInheritanceContract(input.previous),
      reviewInheritanceContract(input.current),
    )
  ) {
    return null;
  }
  if (previousGate.selection.kind !== "assigned" || currentGate.selection.kind !== "assigned") {
    return null;
  }
  const reviewerMemberId = previousGate.selection.reviewerMemberId;
  if (
    !currentGate.selection.matchExplanation.eligibleMemberIds.includes(reviewerMemberId) ||
    currentGate.selection.matchExplanation.excludedMemberIds.includes(reviewerMemberId)
  ) {
    return null;
  }
  return {
    reviewAssignmentId: previousGate.outcome.reviewAssignmentId,
    reportFingerprint: previousGate.outcome.reportFingerprint,
    inheritedFromGateFingerprint:
      previousGate.outcome.inheritedFromGateFingerprint ?? previousGate.gateKeyFingerprint,
    decidedAt: previousGate.outcome.decidedAt,
    selection: {
      ...currentGate.selection,
      reviewerMemberId,
      overrideReason: "Retained the structurally eligible reviewer for inherited approval",
    },
  };
}

function reviewInheritanceContract(workstream: MissionWorkstream): unknown {
  return {
    kind: workstream.kind,
    objective: workstream.objective,
    deliverables: workstream.deliverables,
    acceptanceCriteria: workstream.acceptanceCriteria,
    requiredSkillIds: workstream.requiredSkillIds,
    preferredSkillIds: workstream.preferredSkillIds,
    requiredRuntimeCapabilityIds: workstream.requiredRuntimeCapabilityIds,
    minimumLevel: workstream.minimumLevel,
    dependencyWorkstreamIds: workstream.dependencyWorkstreamIds,
    mutableScope: workstream.mutableScope,
    methodologySnapshotRevision: workstream.methodologySnapshotRevision,
    reviewGateKind: workstream.reviewGate.kind,
    reviewerRequirements:
      workstream.reviewGate.kind === "required" ? workstream.reviewGate.requirements : null,
  };
}
