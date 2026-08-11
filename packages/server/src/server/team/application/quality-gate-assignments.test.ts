import type {
  MissionAssignmentContract,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";
import { describe, expect, it } from "vitest";

import type { MissionAssignmentCoverage } from "../domain/mission-validation.js";
import { planMissionQualityGates } from "./quality-gate-assignments.js";

describe("planMissionQualityGates", () => {
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
      reviewPolicy: "required",
      reviewerMemberId: "member-reviewer",
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
      reviewPolicy: "none",
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
      createdAt: "2026-08-10T12:00:00.000Z",
      materializePending: true,
    });

    expect(plan.additions.find((assignment) => assignment.kind === "review")).toMatchObject({
      assignmentId: `${occupiedBaseId}:2`,
      workstreamId: "api",
      subjectAssignmentIds: [delivery.assignmentId],
    });
  });
});
