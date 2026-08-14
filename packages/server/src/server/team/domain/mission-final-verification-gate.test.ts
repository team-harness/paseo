import type { MissionFinalVerificationGateSelection } from "@getpaseo/protocol/team/v2-types";
import { describe, expect, it } from "vitest";

import { buildMissionFinalVerificationGate } from "./mission-final-verification-gate.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

const selection: MissionFinalVerificationGateSelection = {
  kind: "awaiting_verifier",
};

describe("Mission final verification gate", () => {
  it("canonically fingerprints the plan, subjects, review gates and verifier requirements", () => {
    const input = {
      workstreamId: "workstream-verification",
      planRevision: 3,
      methodologySnapshotRevision: 1 as const,
      subjectAssignmentIds: ["assignment-review", "assignment-delivery", "assignment-review"],
      reviewGateFingerprints: [digestB, digestA, digestB],
      requirements: {
        requiredSkillIds: ["verification"],
        preferredSkillIds: ["protocol"],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 4 as const,
      },
      selection,
    };

    const gate = buildMissionFinalVerificationGate(input);
    const reordered = buildMissionFinalVerificationGate({
      ...input,
      subjectAssignmentIds: ["assignment-delivery", "assignment-review"],
      reviewGateFingerprints: [digestA, digestB],
    });

    expect(gate.key.subjectAssignmentIds).toEqual(["assignment-delivery", "assignment-review"]);
    expect(gate.key.reviewGateFingerprints).toEqual([digestA, digestB]);
    expect(gate.fingerprint).toBe(reordered.fingerprint);
    expect(buildMissionFinalVerificationGate({ ...input, planRevision: 4 }).fingerprint).not.toBe(
      gate.fingerprint,
    );
    expect(
      buildMissionFinalVerificationGate({
        ...input,
        requirements: { ...input.requirements, minimumLevel: 5 as const },
      }).fingerprint,
    ).not.toBe(gate.fingerprint);
  });
});
