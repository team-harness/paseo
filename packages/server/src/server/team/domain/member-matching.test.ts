import { describe, expect, it } from "vitest";

import type { MissionRosterMemberSnapshot } from "@getpaseo/protocol/team/v2-types";

import { matchWorkstreamOwner, matchWorkstreamReviewer } from "./member-matching.js";

function member(
  memberId: string,
  level: number,
  skillIds: ReadonlyArray<string> = ["typescript"],
  capabilityIds: ReadonlyArray<string> = ["structured-tools"],
  providerAvailable = true,
): MissionRosterMemberSnapshot {
  return {
    memberId,
    role: "Software engineer",
    level,
    skillIds: [...skillIds],
    executionProfile: {
      provider: "codex",
      model: "gpt-5.6-sol",
      modeId: null,
      thinkingOptionId: null,
      featureValues: {},
    },
    mentionHandle: memberId,
    runtimeSnapshot: {
      providerAvailable,
      toolIds: ["mission_status", "assignment_report"],
      capabilityIds: [...capabilityIds],
    },
  };
}

describe("workstream owner matching", () => {
  it("selects the lowest level that is sufficient for the work", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-principal", 5), openAssignments: 0 },
        { profile: member("member-senior", 4), openAssignments: 0 },
        { profile: member("member-mid", 3), openAssignments: 0 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 4,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-senior" });
  });

  it("prefers required skill coverage before level economy", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-partial", 3), openAssignments: 0 },
        {
          profile: member("member-complete", 4, ["typescript", "protocol"]),
          openAssignments: 0,
        },
      ],
      requiredSkillIds: ["typescript", "protocol"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 3,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-complete" });
  });

  it("keeps a sufficient previous owner before balancing load", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-idle", 4), openAssignments: 0 },
        { profile: member("member-owner", 4), openAssignments: 2 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 4,
      previousOwnerMemberId: "member-owner",
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-owner" });
  });

  it("uses lower load when equally capable candidates have no continuity", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-busy", 4), openAssignments: 2 },
        { profile: member("member-idle", 4), openAssignments: 0 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 4,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-idle" });
  });

  it("filters out a provider-ineligible member before ranking", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        {
          profile: member("member-ineligible", 3, ["typescript"], ["structured-tools"], false),
          openAssignments: 0,
        },
        { profile: member("member-eligible", 4), openAssignments: 0 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 3,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-eligible" });
  });

  it("treats required runtime capabilities as hard eligibility constraints", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        {
          profile: member("member-incapable", 3, ["typescript"], []),
          openAssignments: 0,
        },
        {
          profile: member("member-capable", 3),
          openAssignments: 0,
        },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-capable" });
  });

  it("prefers broader preferred-skill coverage after all hard constraints pass", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-generalist", 3), openAssignments: 0 },
        {
          profile: member("member-protocol", 3, ["typescript", "protocol"]),
          openAssignments: 0,
        },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: ["protocol"],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-protocol" });
  });

  it("returns a durable explanation for the deterministic owner decision", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-owner", 4, ["typescript", "protocol"]), openAssignments: 1 },
        { profile: member("member-peer", 4, ["typescript", "protocol"]), openAssignments: 0 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: ["protocol", "testing"],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
      previousOwnerMemberId: "member-owner",
    });

    expect(result).toEqual({
      kind: "matched",
      memberId: "member-owner",
      explanation: {
        recommendedMemberId: "member-owner",
        requiredSkillIds: ["typescript"],
        preferredSkillIds: ["protocol", "testing"],
        matchedPreferredSkillIds: ["protocol"],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 4,
        selectedLevel: 4,
        eligibleMemberIds: ["member-owner", "member-peer"],
        excludedMemberIds: [],
        previousMemberId: "member-owner",
        candidateOpenAssignments: [
          { memberId: "member-owner", openAssignments: 1 },
          { memberId: "member-peer", openAssignments: 0 },
        ],
        continuedPreviousMember: true,
        openAssignments: 1,
        rosterIndex: 0,
      },
    });
  });

  it("reports an explicit gap when no member is eligible", () => {
    const result = matchWorkstreamOwner({
      candidates: [{ profile: member("member-junior", 2), openAssignments: 0 }],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 3,
      previousOwnerMemberId: null,
    });

    expect(result).toEqual({ kind: "unmatched", reason: "no_eligible_member" });
  });

  it("treats every required skill as a hard eligibility constraint", () => {
    const result = matchWorkstreamOwner({
      candidates: [{ profile: member("member-partial", 4, ["typescript"]), openAssignments: 0 }],
      requiredSkillIds: ["typescript", "protocol"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 3,
      previousOwnerMemberId: null,
    });

    expect(result).toEqual({ kind: "unmatched", reason: "no_eligible_member" });
  });

  it("prefers the lowest sufficient level before previous-owner continuity", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-owner", 5), openAssignments: 0 },
        { profile: member("member-sufficient", 4), openAssignments: 0 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 4,
      previousOwnerMemberId: "member-owner",
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-sufficient" });
  });

  it("uses stable roster order as the final tie-breaker", () => {
    const result = matchWorkstreamOwner({
      candidates: [
        { profile: member("member-first", 4), openAssignments: 0 },
        { profile: member("member-second", 4), openAssignments: 0 },
      ],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 4,
      previousOwnerMemberId: null,
    });

    expect(result).toMatchObject({ kind: "matched", memberId: "member-first" });
  });
});

describe("workstream reviewer matching", () => {
  it("selects a distinct qualified reviewer for a writable owner when possible", () => {
    const result = matchWorkstreamReviewer({
      candidates: [
        { profile: member("member-owner", 4, ["typescript", "review"]), openAssignments: 0 },
        { profile: member("member-reviewer", 4, ["typescript", "review"]), openAssignments: 1 },
      ],
      requiredSkillIds: ["review"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
      previousReviewerMemberId: null,
      ownerMemberId: "member-owner",
      ownerMutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
    });

    expect(result).toMatchObject({
      kind: "matched",
      memberId: "member-reviewer",
      explanation: { excludedMemberIds: ["member-owner"] },
    });
  });

  it("allows the only qualified member to review while preserving the exception evidence", () => {
    const result = matchWorkstreamReviewer({
      candidates: [
        { profile: member("member-owner", 4, ["typescript", "review"]), openAssignments: 0 },
        { profile: member("member-junior", 2, ["typescript", "review"]), openAssignments: 0 },
      ],
      requiredSkillIds: ["review"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
      previousReviewerMemberId: null,
      ownerMemberId: "member-owner",
      ownerMutableScope: { kind: "workspace" },
    });

    expect(result).toMatchObject({
      kind: "matched",
      memberId: "member-owner",
      explanation: {
        eligibleMemberIds: ["member-owner"],
        excludedMemberIds: [],
      },
    });
  });
});
