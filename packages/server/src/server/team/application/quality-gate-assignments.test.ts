import type {
  MissionAssignmentContract,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";
import { describe, expect, it } from "vitest";

import type { MissionAssignmentCoverage } from "../domain/mission-validation.js";
import { planMissionQualityGates } from "./quality-gate-assignments.js";
import { buildMissionReviewGate, notRequiredReviewGate } from "../domain/mission-review-gate.js";

describe("planMissionQualityGates", () => {
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
