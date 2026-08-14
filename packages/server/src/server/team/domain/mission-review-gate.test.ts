import type { MissionWorkstream } from "@getpaseo/protocol/team/v2-types";
import { describe, expect, it } from "vitest";

import {
  buildMissionReviewGate,
  inheritableApprovedReview,
  missionReviewGateKeyFingerprint,
  missionReviewSubjectFingerprint,
} from "./mission-review-gate.js";

const digest = `sha256:${"0".repeat(64)}`;
const requirements = {
  requiredSkillIds: ["review"],
  preferredSkillIds: [],
  requiredRuntimeCapabilityIds: ["structured-tools"],
  minimumLevel: 3 as const,
};
const selection = {
  kind: "assigned" as const,
  reviewerMemberId: "member-reviewer",
  matchExplanation: {
    recommendedMemberId: "member-reviewer",
    requiredSkillIds: ["review"],
    preferredSkillIds: [],
    matchedPreferredSkillIds: [],
    requiredRuntimeCapabilityIds: ["structured-tools"],
    minimumLevel: 3 as const,
    selectedLevel: 3 as const,
    eligibleMemberIds: ["member-reviewer"],
    excludedMemberIds: ["member-owner"],
    previousMemberId: null,
    candidateOpenAssignments: [{ memberId: "member-reviewer", openAssignments: 4 }],
    continuedPreviousMember: false,
    openAssignments: 4,
    rosterIndex: 1,
  },
  overrideReason: null,
};

describe("Mission review gate", () => {
  it("binds a stable subject to a plan-specific gate independent of assignment order", () => {
    const subject = {
      workstreamId: "api",
      subjectAssignmentIds: ["delivery-b", "delivery-a", "delivery-a"],
    };
    const canonicalSubject = {
      workstreamId: "api",
      subjectAssignmentIds: ["delivery-a", "delivery-b"],
    };

    expect(missionReviewSubjectFingerprint(subject)).toBe(
      missionReviewSubjectFingerprint(canonicalSubject),
    );
    expect(missionReviewGateKeyFingerprint({ subject, planRevision: 1 })).not.toBe(
      missionReviewGateKeyFingerprint({ subject, planRevision: 2 }),
    );
  });

  it("inherits approval only for the exact subject and frozen review policy", () => {
    const previousGate = buildMissionReviewGate({
      workstreamId: "api",
      planRevision: 1,
      subjectAssignmentIds: ["delivery-a"],
      requirements,
      selection,
      outcome: { kind: "pending" },
    });
    if (previousGate.kind !== "required") throw new Error("required gate expected");
    const previous = {
      workstreamId: "api",
      mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
      methodologySnapshotRevision: 1,
      reviewGate: {
        ...previousGate,
        outcome: {
          kind: "approved",
          gateKeyFingerprint: previousGate.gateKeyFingerprint,
          subjectFingerprint: previousGate.subjectFingerprint,
          reviewAssignmentId: "review-a",
          reportFingerprint: digest,
          inheritedFromGateFingerprint: null,
          decidedAt: "2026-08-13T10:00:00.000Z",
        },
      },
    } as MissionWorkstream;

    expect(
      inheritableApprovedReview({
        previous,
        current: {
          ...previous,
          planRevision: 2,
          reviewGate: buildMissionReviewGate({
            workstreamId: "api",
            planRevision: 2,
            subjectAssignmentIds: ["delivery-a"],
            requirements,
            selection,
            outcome: { kind: "pending" },
          }),
        },
        subjectFingerprint: previousGate.subjectFingerprint,
      }),
    ).toMatchObject({ reviewAssignmentId: "review-a" });
    expect(
      inheritableApprovedReview({
        previous,
        current: {
          ...previous,
          planRevision: 2,
          reviewGate: buildMissionReviewGate({
            workstreamId: "api",
            planRevision: 2,
            subjectAssignmentIds: ["delivery-b"],
            requirements,
            selection,
            outcome: { kind: "pending" },
          }),
        },
        subjectFingerprint: missionReviewSubjectFingerprint({
          workstreamId: "api",
          subjectAssignmentIds: ["delivery-b"],
        }),
      }),
    ).toBeNull();
  });

  it("retains an eligible approved reviewer when current ranking recommends another member", () => {
    const previousGate = buildMissionReviewGate({
      workstreamId: "api",
      planRevision: 1,
      subjectAssignmentIds: ["delivery-a"],
      requirements,
      selection,
      outcome: { kind: "pending" },
    });
    if (previousGate.kind !== "required") throw new Error("required gate expected");
    const previous = {
      workstreamId: "api",
      kind: "delivery",
      objective: "Ship the API",
      deliverables: ["API"],
      acceptanceCriteria: ["API passes"],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
      methodologySnapshotRevision: 1,
      reviewGate: {
        ...previousGate,
        outcome: {
          kind: "approved",
          gateKeyFingerprint: previousGate.gateKeyFingerprint,
          subjectFingerprint: previousGate.subjectFingerprint,
          reviewAssignmentId: "review-a",
          reportFingerprint: digest,
          inheritedFromGateFingerprint: null,
          decidedAt: "2026-08-13T10:00:00.000Z",
        },
      },
    } as MissionWorkstream;
    const rerankedSelection = {
      ...selection,
      reviewerMemberId: "member-new-reviewer",
      matchExplanation: {
        ...selection.matchExplanation,
        recommendedMemberId: "member-new-reviewer",
        eligibleMemberIds: ["member-reviewer", "member-new-reviewer"],
      },
    };
    const current = {
      ...previous,
      planRevision: 2,
      reviewGate: buildMissionReviewGate({
        workstreamId: "api",
        planRevision: 2,
        subjectAssignmentIds: ["delivery-a"],
        requirements,
        selection: rerankedSelection,
        outcome: { kind: "pending" },
      }),
    };

    expect(
      inheritableApprovedReview({
        previous,
        current,
        subjectFingerprint: previousGate.subjectFingerprint,
      }),
    ).toMatchObject({
      reviewAssignmentId: "review-a",
      selection: {
        kind: "assigned",
        reviewerMemberId: "member-reviewer",
      },
    });
  });

  it("never inherits a waiver", () => {
    const gate = buildMissionReviewGate({
      workstreamId: "api",
      planRevision: 1,
      subjectAssignmentIds: ["delivery-a"],
      requirements,
      selection,
      outcome: { kind: "pending" },
    });
    if (gate.kind !== "required") throw new Error("required gate expected");
    const previous = {
      workstreamId: "api",
      mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
      methodologySnapshotRevision: 1,
      reviewGate: {
        ...gate,
        outcome: {
          kind: "waived",
          gateKeyFingerprint: gate.gateKeyFingerprint,
          subjectFingerprint: gate.subjectFingerprint,
          waiverId: "waiver-a",
          decidedAt: "2026-08-13T10:00:00.000Z",
        },
      },
    } as MissionWorkstream;

    expect(
      inheritableApprovedReview({
        previous,
        current: previous,
        subjectFingerprint: gate.subjectFingerprint,
      }),
    ).toBeNull();
  });
});
