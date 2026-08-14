import type {
  MissionAssignmentContract,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";
import { describe, expect, it } from "vitest";

import type { MissionAssignmentCoverage } from "../domain/mission-validation.js";
import { buildMissionFinalVerificationGate } from "../domain/mission-final-verification-gate.js";
import { planMissionQualityGates } from "./quality-gate-assignments.js";
import {
  buildMissionReviewGate,
  missionReviewReportFingerprint,
  notRequiredReviewGate,
} from "../domain/mission-review-gate.js";

function assignedFinalGate(subjectAssignmentIds: string[]) {
  return buildMissionFinalVerificationGate({
    workstreamId: "final-verification",
    planRevision: 2,
    methodologySnapshotRevision: 1,
    subjectAssignmentIds,
    reviewGateFingerprints: [],
    requirements: {
      requiredSkillIds: ["verification"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
    },
    selection: {
      kind: "assigned",
      verifierMemberId: "member-verifier",
      matchExplanation: {} as never,
      independenceExceptionReason: null,
    },
  });
}

describe("planMissionQualityGates", () => {
  it("rebuilds the final gate from approved review evidence before materializing verification", () => {
    const delivery = {
      assignmentId: "assignment-delivery",
      priority: 3,
    } as MissionAssignmentContract;
    const pendingGate = buildMissionReviewGate({
      workstreamId: "api",
      planRevision: 2,
      subjectAssignmentIds: [delivery.assignmentId],
      requirements: {
        requiredSkillIds: ["review"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 4,
      },
      selection: {
        kind: "assigned",
        reviewerMemberId: "member-reviewer",
        matchExplanation: {} as never,
        overrideReason: null,
      },
      outcome: { kind: "pending" },
    });
    if (pendingGate.kind !== "required") throw new Error("required review gate expected");
    const reviewReport = {
      status: "completed" as const,
      verdict: "approved" as const,
      finalVerificationEvidence: null,
      summary: "Approved delivery",
      artifactPaths: [],
      tests: [],
      decisions: [],
      handoffs: [],
    };
    const review = {
      assignmentId: "assignment-review",
      priority: 3,
      report: reviewReport,
    } as MissionAssignmentContract;
    const reviewGate = {
      ...pendingGate,
      outcome: {
        kind: "approved" as const,
        gateKeyFingerprint: pendingGate.gateKeyFingerprint,
        subjectFingerprint: pendingGate.subjectFingerprint,
        reviewAssignmentId: review.assignmentId,
        reportFingerprint: missionReviewReportFingerprint(reviewReport),
        inheritedFromGateFingerprint: null,
        decidedAt: "2026-08-10T11:59:00.000Z",
      },
    };
    const initialFinalGate = buildMissionFinalVerificationGate({
      ...assignedFinalGate([delivery.assignmentId]).key,
      selection: assignedFinalGate([delivery.assignmentId]).selection,
      reviewGateFingerprints: [reviewGate.gateKeyFingerprint],
    });
    const mission = {
      id: "mission-1",
      planRevision: 2,
      assignments: [delivery, review],
      workstreams: [
        { workstreamId: "api", kind: "delivery", reviewGate, status: "accepted" },
        {
          workstreamId: "final-verification",
          kind: "verification",
          objective: "Verify the Mission",
          deliverables: ["Verification report"],
          acceptanceCriteria: ["All criteria pass"],
          mutableScope: { kind: "read_only" },
          ownerMemberId: "member-lead",
          rosterSnapshotRevision: 1,
          methodologySnapshotRevision: 1,
          reviewGate: notRequiredReviewGate,
          finalVerificationGate: initialFinalGate,
          status: "planned",
        },
      ],
    } as TeamMission;
    const coverage: MissionAssignmentCoverage = {
      assignmentIdsByWorkstreamId: new Map([["api", delivery.assignmentId]]),
      completedDeliveryAssignmentIds: new Set([delivery.assignmentId]),
      approvedReviewAssignmentIdsByWorkstreamId: new Map([["api", review.assignmentId]]),
      missingWorkstreamIds: [],
      ambiguousWorkstreamIds: [],
    };

    const plan = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds: new Set(["api"]),
      acceptedTurnsById: new Map(),
      createdAt: "2026-08-10T12:00:00.000Z",
    });

    expect(plan.expectedFinalVerificationGate?.key.subjectAssignmentIds).toEqual([
      delivery.assignmentId,
      review.assignmentId,
    ]);
    expect(plan.currentVerificationAssignments[0]).toMatchObject({
      finalVerificationGateFingerprint: plan.expectedFinalVerificationGate?.fingerprint,
      reviewGateEvidence: [
        expect.objectContaining({
          kind: "approved",
          gateKeyFingerprint: reviewGate.gateKeyFingerprint,
          reviewAssignmentId: review.assignmentId,
        }),
      ],
    });
  });

  it("keeps an awaiting final verification gate Assignment-free", () => {
    const delivery = {
      assignmentId: "assignment-delivery",
      priority: 3,
    } as MissionAssignmentContract;
    const finalGate = buildMissionFinalVerificationGate({
      workstreamId: "final-verification",
      planRevision: 2,
      methodologySnapshotRevision: 1,
      subjectAssignmentIds: [delivery.assignmentId],
      reviewGateFingerprints: [],
      requirements: {
        requiredSkillIds: ["verification"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 4,
      },
      selection: { kind: "awaiting_verifier" },
    });
    const mission = {
      id: "mission-1",
      planRevision: 2,
      assignments: [delivery],
      workstreams: [
        {
          workstreamId: "api",
          kind: "delivery",
          reviewGate: notRequiredReviewGate,
          finalVerificationGate: null,
          status: "accepted",
        },
        {
          workstreamId: "final-verification",
          kind: "verification",
          objective: "Verify the Mission",
          deliverables: ["Verification report"],
          acceptanceCriteria: ["All criteria pass"],
          mutableScope: { kind: "read_only" },
          ownerMemberId: "member-lead",
          rosterSnapshotRevision: 1,
          methodologySnapshotRevision: 1,
          reviewGate: notRequiredReviewGate,
          finalVerificationGate: finalGate,
          status: "planned",
        },
      ],
    } as TeamMission;
    const coverage: MissionAssignmentCoverage = {
      assignmentIdsByWorkstreamId: new Map([["api", delivery.assignmentId]]),
      completedDeliveryAssignmentIds: new Set([delivery.assignmentId]),
      approvedReviewAssignmentIdsByWorkstreamId: new Map(),
      missingWorkstreamIds: [],
      ambiguousWorkstreamIds: [],
    };

    const plan = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds: new Set(["api"]),
      acceptedTurnsById: new Map(),
      createdAt: "2026-08-10T12:00:00.000Z",
    });

    expect(plan.additions.filter((assignment) => assignment.kind === "verification")).toEqual([]);
    expect(plan.currentVerificationAssignments).toEqual([]);
  });

  it("replaces an invalid terminal review without adding it to verification subjects", () => {
    const delivery = {
      assignmentId: "assignment-delivery",
      priority: 3,
    } as MissionAssignmentContract;
    const gate = buildMissionReviewGate({
      workstreamId: "api",
      planRevision: 2,
      subjectAssignmentIds: [delivery.assignmentId],
      requirements: {
        requiredSkillIds: [],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: [],
        minimumLevel: 1,
      },
      selection: {
        kind: "assigned",
        reviewerMemberId: "member-reviewer",
        matchExplanation: {} as never,
        overrideReason: null,
      },
      outcome: { kind: "pending" },
    });
    if (gate.kind !== "required") throw new Error("required review gate expected");
    const invalidReview = {
      assignmentId: "assignment-review-invalid",
      kind: "review",
      workstreamId: "api",
      planRevision: 2,
      semanticState: "completed",
      dispatchState: "settled",
      subjectAssignmentIds: [delivery.assignmentId],
      dependencyAssignmentIds: [],
      reviewGateFingerprint: gate.gateKeyFingerprint,
      reviewSubjectFingerprint: gate.subjectFingerprint,
      assigneeMemberId: "member-reviewer",
    } as MissionAssignmentContract;
    const mission = {
      id: "mission-1",
      planRevision: 2,
      assignments: [delivery, invalidReview],
      workstreams: [
        {
          workstreamId: "api",
          kind: "delivery",
          objective: "Implement the parser API",
          deliverables: ["Parser implementation"],
          acceptanceCriteria: ["Parser tests pass"],
          mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
          ownerMemberId: "member-owner",
          rosterSnapshotRevision: 1,
          methodologySnapshotRevision: 1,
          reviewGate: gate,
          status: "review",
        },
        {
          workstreamId: "final-verification",
          kind: "verification",
          objective: "Verify the Mission",
          deliverables: ["Verification report"],
          acceptanceCriteria: ["All criteria pass"],
          mutableScope: { kind: "read_only" },
          ownerMemberId: "member-lead",
          rosterSnapshotRevision: 1,
          methodologySnapshotRevision: 1,
          reviewGate: notRequiredReviewGate,
          finalVerificationGate: assignedFinalGate([delivery.assignmentId]),
          status: "planned",
        },
      ],
    } as TeamMission;
    const coverage: MissionAssignmentCoverage = {
      assignmentIdsByWorkstreamId: new Map([["api", delivery.assignmentId]]),
      completedDeliveryAssignmentIds: new Set([delivery.assignmentId]),
      approvedReviewAssignmentIdsByWorkstreamId: new Map(),
      missingWorkstreamIds: [],
      ambiguousWorkstreamIds: [],
    };

    const plan = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds: new Set(),
      acceptedTurnsById: new Map(),
      createdAt: "2026-08-10T12:00:00.000Z",
    });

    expect(plan.obsoleteReviewAssignments).toEqual([invalidReview]);
    expect(plan.additions).toEqual([
      expect.objectContaining({
        kind: "review",
        subjectAssignmentIds: [delivery.assignmentId],
        dependencyAssignmentIds: [delivery.assignmentId],
      }),
    ]);
    expect(plan.expectedVerificationSubjectIds).toEqual([delivery.assignmentId]);
    expect(plan.currentVerificationAssignments).toEqual([]);
  });

  it("uses :2 when the canonical quality-gate Assignment id is already occupied", () => {
    const delivery = {
      assignmentId: "assignment-delivery",
      priority: 3,
    } as MissionAssignmentContract;
    const occupiedBaseId = "assignment:mission-1:2:api:review";
    const occupied = {
      assignmentId: occupiedBaseId,
      kind: "review",
      workstreamId: "api",
      planRevision: 1,
      semanticState: "canceled",
    } as MissionAssignmentContract;
    const deliveryWorkstream = {
      workstreamId: "api",
      kind: "delivery",
      objective: "Implement the parser API",
      deliverables: ["Parser implementation"],
      acceptanceCriteria: ["Parser tests pass"],
      mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
      rosterSnapshotRevision: 1,
      methodologySnapshotRevision: 1,
      reviewGate: buildMissionReviewGate({
        workstreamId: "api",
        planRevision: 2,
        subjectAssignmentIds: [delivery.assignmentId],
        requirements: {
          requiredSkillIds: [],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: [],
          minimumLevel: 1,
        },
        selection: {
          kind: "assigned",
          reviewerMemberId: "member-reviewer",
          matchExplanation: {} as never,
          overrideReason: null,
        },
        outcome: { kind: "pending" },
      }),
      status: "review",
    } as MissionWorkstream;
    const finalVerification = {
      workstreamId: "final-verification",
      kind: "verification",
      objective: "Verify the Mission",
      deliverables: ["Verification report"],
      acceptanceCriteria: ["All criteria pass"],
      mutableScope: { kind: "read_only" },
      ownerMemberId: "member-lead",
      rosterSnapshotRevision: 1,
      methodologySnapshotRevision: 1,
      reviewGate: notRequiredReviewGate,
      status: "planned",
    } as MissionWorkstream;
    const mission = {
      id: "mission-1",
      planRevision: 2,
      assignments: [delivery, occupied],
      workstreams: [deliveryWorkstream, finalVerification],
    } as TeamMission;
    const coverage: MissionAssignmentCoverage = {
      assignmentIdsByWorkstreamId: new Map([["api", delivery.assignmentId]]),
      completedDeliveryAssignmentIds: new Set([delivery.assignmentId]),
      approvedReviewAssignmentIdsByWorkstreamId: new Map(),
      missingWorkstreamIds: [],
      ambiguousWorkstreamIds: [],
    };

    const plan = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds: new Set(),
      acceptedTurnsById: new Map(),
      createdAt: "2026-08-10T12:00:00.000Z",
      materializePending: true,
    });

    expect(plan.additions.find((assignment) => assignment.kind === "review")).toMatchObject({
      assignmentId: `${occupiedBaseId}:2`,
      workstreamId: "api",
      subjectAssignmentIds: [delivery.assignmentId],
    });
  });

  it("replaces an existing final verification whose subjects came from a fabricated gate", () => {
    const delivery = {
      assignmentId: "assignment-delivery",
      priority: 3,
    } as MissionAssignmentContract;
    const staleVerification = {
      assignmentId: "assignment-verification-stale",
      kind: "verification",
      workstreamId: "final-verification",
      planRevision: 2,
      semanticState: "planned",
      subjectAssignmentIds: [delivery.assignmentId, "assignment-review-fabricated"],
      dependencyAssignmentIds: [delivery.assignmentId, "assignment-review-fabricated"],
    } as MissionAssignmentContract;
    const mission = {
      id: "mission-1",
      planRevision: 2,
      assignments: [delivery, staleVerification],
      workstreams: [
        {
          workstreamId: "api",
          kind: "delivery",
          reviewGate: notRequiredReviewGate,
          status: "accepted",
        },
        {
          workstreamId: "final-verification",
          kind: "verification",
          objective: "Verify the Mission",
          deliverables: ["Verification report"],
          acceptanceCriteria: ["All criteria pass"],
          mutableScope: { kind: "read_only" },
          ownerMemberId: "member-lead",
          rosterSnapshotRevision: 1,
          methodologySnapshotRevision: 1,
          reviewGate: notRequiredReviewGate,
          finalVerificationGate: assignedFinalGate([delivery.assignmentId]),
          status: "planned",
        },
      ],
    } as TeamMission;
    const coverage: MissionAssignmentCoverage = {
      assignmentIdsByWorkstreamId: new Map([["api", delivery.assignmentId]]),
      completedDeliveryAssignmentIds: new Set([delivery.assignmentId]),
      approvedReviewAssignmentIdsByWorkstreamId: new Map(),
      missingWorkstreamIds: [],
      ambiguousWorkstreamIds: [],
    };

    const plan = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds: new Set(["api"]),
      acceptedTurnsById: new Map(),
      createdAt: "2026-08-10T12:00:00.000Z",
    });

    expect(plan.obsoleteVerificationAssignments).toEqual([staleVerification]);
    expect(plan.additions).toContainEqual(
      expect.objectContaining({
        kind: "verification",
        assigneeMemberId: "member-verifier",
        mutableScope: { kind: "read_only" },
        finalVerificationGateFingerprint:
          mission.workstreams[1]?.finalVerificationGate?.fingerprint,
        reviewGateEvidence: [],
        subjectAssignmentIds: [delivery.assignmentId],
        dependencyAssignmentIds: [delivery.assignmentId],
      }),
    );
  });

  it("replaces duplicate final verifications with one deterministic assignment", () => {
    const delivery = {
      assignmentId: "assignment-delivery",
      priority: 3,
    } as MissionAssignmentContract;
    const verificationAssignments = [1, 2].map(
      (suffix) =>
        ({
          assignmentId: `assignment-verification-${suffix}`,
          kind: "verification",
          workstreamId: "final-verification",
          planRevision: 2,
          semanticState: "planned",
          subjectAssignmentIds: [delivery.assignmentId],
          dependencyAssignmentIds: [delivery.assignmentId],
        }) as MissionAssignmentContract,
    );
    const mission = {
      id: "mission-1",
      planRevision: 2,
      assignments: [delivery, ...verificationAssignments],
      workstreams: [
        {
          workstreamId: "api",
          kind: "delivery",
          reviewGate: notRequiredReviewGate,
          status: "accepted",
        },
        {
          workstreamId: "final-verification",
          kind: "verification",
          objective: "Verify the Mission",
          deliverables: ["Verification report"],
          acceptanceCriteria: ["All criteria pass"],
          mutableScope: { kind: "read_only" },
          ownerMemberId: "member-lead",
          rosterSnapshotRevision: 1,
          methodologySnapshotRevision: 1,
          reviewGate: notRequiredReviewGate,
          finalVerificationGate: assignedFinalGate([delivery.assignmentId]),
          status: "planned",
        },
      ],
    } as TeamMission;
    const coverage: MissionAssignmentCoverage = {
      assignmentIdsByWorkstreamId: new Map([["api", delivery.assignmentId]]),
      completedDeliveryAssignmentIds: new Set([delivery.assignmentId]),
      approvedReviewAssignmentIdsByWorkstreamId: new Map(),
      missingWorkstreamIds: [],
      ambiguousWorkstreamIds: [],
    };

    const plan = planMissionQualityGates({
      mission,
      coverage,
      settledReviewGateWorkstreamIds: new Set(["api"]),
      acceptedTurnsById: new Map(),
      createdAt: "2026-08-10T12:00:00.000Z",
    });

    expect(plan.obsoleteVerificationAssignments).toEqual(verificationAssignments);
    expect(plan.currentVerificationAssignments).toHaveLength(1);
    expect(plan.currentVerificationAssignments[0]).toMatchObject({
      kind: "verification",
      subjectAssignmentIds: [delivery.assignmentId],
      dependencyAssignmentIds: [delivery.assignmentId],
    });
    expect(plan.additions).toEqual([plan.currentVerificationAssignments[0]]);
  });
});
