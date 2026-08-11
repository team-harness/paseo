import { describe, expect, it } from "vitest";

import type {
  MissionAttentionItem,
  MissionAssignmentContract,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";

import type { AcceptedTurnFact } from "./assignment-contract-validation.js";
import {
  resolveMissionAssignmentCoverage,
  validateMissionAttentionResolution,
  validateTeamMission as validateStrictTeamMission,
} from "./mission-validation.js";

function acceptedTurnOutcome(contract: MissionAssignmentContract): AcceptedTurnFact["outcome"] {
  if (contract.semanticState === "running") return "running";
  if (contract.semanticState === "failed") return "failed";
  if (contract.semanticState === "canceled") return "canceled";
  return "completed";
}

function validationContext(aggregate: TeamMission) {
  const acceptedTurnsById = new Map<string, AcceptedTurnFact>();
  for (const candidate of aggregate.assignments) {
    if (candidate.acceptedTurnId === null || candidate.runtimeAgentId === null) continue;
    acceptedTurnsById.set(candidate.acceptedTurnId, {
      assignmentId: candidate.assignmentId,
      turnId: candidate.acceptedTurnId,
      runtimeAgentId: candidate.runtimeAgentId,
      outcome: acceptedTurnOutcome(candidate),
    });
  }
  return { acceptedTurnsById };
}

function validateTeamMission(aggregate: TeamMission) {
  return validateStrictTeamMission(aggregate, validationContext(aggregate));
}

function workstream(workstreamId: string): MissionWorkstream {
  return {
    workstreamId,
    kind: "delivery",
    title: workstreamId,
    objective: `Complete ${workstreamId}.`,
    deliverables: [`${workstreamId} output`],
    acceptanceCriteria: [`${workstreamId} is verified`],
    requiredSkillIds: ["typescript"],
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: ["structured-tools"],
    minimumLevel: 3,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    dependencyWorkstreamIds: [],
    mutableScope: { kind: "read_only" },
    ownerMemberId: "member-engineer",
    ownerMatchExplanation: {
      recommendedMemberId: "member-engineer",
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      matchedPreferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
      selectedLevel: 3,
      eligibleMemberIds: ["member-engineer"],
      excludedMemberIds: [],
      previousMemberId: null,
      candidateOpenAssignments: [
        { memberId: "member-engineer", openAssignments: 0 },
        { memberId: "member-verifier", openAssignments: 0 },
      ],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 0,
    },
    ownerOverrideReason: null,
    reviewPolicy: "none",
    reviewerRequirements: null,
    reviewerMemberId: null,
    reviewerMatchExplanation: null,
    reviewerOverrideReason: null,
    status: "planned",
  };
}

function finalVerificationWorkstream(): MissionWorkstream {
  return {
    ...workstream("workstream-final-verification"),
    kind: "verification",
    title: "Final verification",
    objective: "Verify every delivery path against the Mission acceptance criteria.",
    requiredSkillIds: ["verification"],
    dependencyWorkstreamIds: ["workstream-api"],
    ownerMemberId: "member-verifier",
    ownerMatchExplanation: {
      recommendedMemberId: "member-verifier",
      requiredSkillIds: ["verification"],
      preferredSkillIds: [],
      matchedPreferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
      selectedLevel: 3,
      eligibleMemberIds: ["member-verifier"],
      excludedMemberIds: [],
      previousMemberId: null,
      candidateOpenAssignments: [
        { memberId: "member-engineer", openAssignments: 0 },
        { memberId: "member-verifier", openAssignments: 0 },
      ],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 1,
    },
  };
}

function assignment(
  assignmentId: string,
  workstreamId: string,
  dependencyAssignmentIds: ReadonlyArray<string> = [],
): MissionAssignmentContract {
  return {
    assignmentId,
    revision: 1,
    kind: "delivery",
    subjectAssignmentIds: [],
    missionId: "mission-sdk",
    workstreamId,
    assigneeMemberId: "member-engineer",
    runtimeAgentId: null,
    bindingEpoch: null,
    objective: `Complete ${assignmentId}.`,
    inputRefs: [],
    deliverables: [`${assignmentId} output`],
    acceptanceCriteria: [`${assignmentId} is verified`],
    mutableScope: { kind: "read_only" },
    dependencyAssignmentIds: [...dependencyAssignmentIds],
    priority: 1,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "queued",
    semanticState: "planned",
    attempt: 1,
    acceptedTurnId: null,
    createdAt: "2026-08-07T11:00:00.000Z",
    dispatchedAt: null,
    settledAt: null,
  };
}

function completedReport(summary: string): NonNullable<MissionAssignmentContract["report"]> {
  return {
    status: "completed",
    verdict: null,
    summary,
    artifactPaths: [],
    tests: [{ command: "npm run typecheck", passed: true }],
    decisions: [],
    handoffs: [],
  };
}

function attentionItem(overrides: Partial<MissionAttentionItem> = {}): MissionAttentionItem {
  return {
    attentionId: "attention-missing-report",
    kind: "missing_report",
    status: "open",
    priorMissionStatus: "active",
    assignmentId: "assignment-api",
    summary: "The accepted turn settled without a structured report.",
    pathEvidence: [],
    createdAt: "2026-08-07T11:06:00.000Z",
    resolution: null,
    ...overrides,
  };
}

function mission(): TeamMission {
  return {
    id: "mission-sdk",
    teamId: "team-platform",
    workspaceId: "workspace-platform",
    objective: "Add the Team Mission SDK.",
    constraints: [],
    acceptanceCriteria: ["The focused tests pass."],
    status: "planning",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        teamRevision: 1,
        leadMemberId: "member-engineer",
        reason: "initial",
        skills: [
          { skillId: "typescript", name: "TypeScript", description: null },
          { skillId: "verification", name: "Verification", description: null },
        ],
        members: [
          {
            memberId: "member-engineer",
            role: "Software engineer",
            level: 3,
            skillIds: ["typescript"],
            executionProfile: {
              provider: "codex",
              model: "gpt-5.6-sol",
              modeId: null,
              thinkingOptionId: null,
              featureValues: {},
            },
            mentionHandle: "engineer",
            runtimeSnapshot: {
              providerAvailable: true,
              toolIds: ["mission_status", "assignment_report"],
              capabilityIds: ["structured-tools"],
            },
          },
          {
            memberId: "member-verifier",
            role: "Quality engineer",
            level: 3,
            skillIds: ["verification"],
            executionProfile: {
              provider: "codex",
              model: "gpt-5.6-sol",
              modeId: null,
              thinkingOptionId: null,
              featureValues: {},
            },
            mentionHandle: "verifier",
            runtimeSnapshot: {
              providerAvailable: true,
              toolIds: ["mission_status", "assignment_report"],
              capabilityIds: ["structured-tools"],
            },
          },
        ],
        createdAt: "2026-08-07T11:00:00.000Z",
      },
    ],
    planRevision: 1,
    revision: 1,
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [".git", ".dev/paseo-home"],
    },
    chatRoomId: "room-mission-sdk",
    participants: [
      {
        memberId: "member-engineer",
        agentId: "agent-engineer",
        bindingEpoch: 1,
        joinedAt: "2026-08-07T11:00:00.000Z",
        archivedAt: null,
      },
    ],
    workstreams: [workstream("workstream-api"), finalVerificationWorkstream()],
    workstreamPlanSnapshots: [],
    assignments: [assignment("assignment-api", "workstream-api")],
    attentionItems: [],
    createdAt: "2026-08-07T11:00:00.000Z",
    updatedAt: "2026-08-07T11:00:00.000Z",
    completedAt: null,
  };
}

function completedMission(): TeamMission {
  const aggregate = mission();
  aggregate.status = "completed";
  aggregate.completedAt = "2026-08-07T11:10:00.000Z";
  for (const candidate of aggregate.workstreams) candidate.status = "accepted";
  aggregate.assignments[0] = {
    ...aggregate.assignments[0]!,
    runtimeAgentId: "agent-engineer",
    bindingEpoch: 1,
    report: completedReport("Delivered the API."),
    workspaceBaseline: {
      baselineId: "baseline-assignment-api",
      workspaceId: "workspace-platform",
      assignmentId: "assignment-api",
      policyRevision: 1,
      capturedAt: "2026-08-07T11:00:30.000Z",
      entries: [],
    },
    dispatchState: "settled",
    semanticState: "completed",
    acceptedTurnId: "turn-api",
    dispatchedAt: "2026-08-07T11:01:00.000Z",
    settledAt: "2026-08-07T11:05:00.000Z",
  };
  aggregate.participants.push({
    memberId: "member-verifier",
    agentId: "agent-verifier",
    bindingEpoch: 1,
    joinedAt: "2026-08-07T11:05:00.000Z",
    archivedAt: null,
  });
  aggregate.assignments.push({
    ...assignment("assignment-final-verification", "workstream-final-verification", [
      "assignment-api",
    ]),
    kind: "verification",
    subjectAssignmentIds: ["assignment-api"],
    assigneeMemberId: "member-verifier",
    runtimeAgentId: "agent-verifier",
    bindingEpoch: 1,
    report: completedReport("Verified the Mission acceptance criteria."),
    workspaceBaseline: {
      baselineId: "baseline-assignment-final-verification",
      workspaceId: "workspace-platform",
      assignmentId: "assignment-final-verification",
      policyRevision: 1,
      capturedAt: "2026-08-07T11:05:30.000Z",
      entries: [],
    },
    dispatchState: "settled",
    semanticState: "completed",
    acceptedTurnId: "turn-final-verification",
    dispatchedAt: "2026-08-07T11:06:00.000Z",
    settledAt: "2026-08-07T11:09:00.000Z",
  });
  const verificationReport = aggregate.assignments.at(-1)?.report;
  if (verificationReport?.status === "completed") verificationReport.verdict = "approved";
  return aggregate;
}

function completedMissionWithRequiredReview(): TeamMission {
  const aggregate = completedMission();
  const deliveryWorkstream = aggregate.workstreams.find(
    (candidate) => candidate.kind === "delivery",
  )!;
  const verificationWorkstream = aggregate.workstreams.find(
    (candidate) => candidate.kind === "verification",
  )!;
  deliveryWorkstream.reviewPolicy = "required";
  deliveryWorkstream.reviewerRequirements = {
    requiredSkillIds: ["verification"],
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: ["structured-tools"],
    minimumLevel: 3,
  };
  deliveryWorkstream.reviewerMemberId = "member-verifier";
  deliveryWorkstream.reviewerMatchExplanation = {
    ...verificationWorkstream.ownerMatchExplanation,
  };

  const delivery = aggregate.assignments.find((candidate) => candidate.kind === "delivery")!;
  const verificationIndex = aggregate.assignments.findIndex(
    (candidate) => candidate.kind === "verification",
  );
  const verification = aggregate.assignments[verificationIndex]!;
  const review: MissionAssignmentContract = {
    ...delivery,
    assignmentId: "assignment-api-review",
    kind: "review",
    subjectAssignmentIds: [delivery.assignmentId],
    assigneeMemberId: "member-verifier",
    runtimeAgentId: "agent-verifier",
    mutableScope: { kind: "read_only" },
    dependencyAssignmentIds: [delivery.assignmentId],
    acceptedTurnId: "turn-api-review",
    workspaceBaseline: {
      ...delivery.workspaceBaseline!,
      baselineId: "baseline-assignment-api-review",
      assignmentId: "assignment-api-review",
    },
    report: {
      ...completedReport("Approved the API delivery."),
      verdict: "approved",
    },
  };
  aggregate.assignments.splice(verificationIndex, 0, review);
  verification.subjectAssignmentIds = [delivery.assignmentId, review.assignmentId];
  verification.dependencyAssignmentIds = [delivery.assignmentId, review.assignmentId];
  return aggregate;
}

function addAdditionalApprovedReview(aggregate: TeamMission): string {
  const reviewIndex = aggregate.assignments.findIndex((candidate) => candidate.kind === "review");
  const review = aggregate.assignments[reviewIndex]!;
  const assignmentId = "assignment-api-review-extra";
  aggregate.assignments.splice(reviewIndex + 1, 0, {
    ...review,
    assignmentId,
    acceptedTurnId: "turn-api-review-extra",
    workspaceBaseline: {
      ...review.workspaceBaseline!,
      baselineId: "baseline-assignment-api-review-extra",
      assignmentId,
    },
  });
  return assignmentId;
}

function replanCompletedMission(): TeamMission {
  const aggregate = completedMission();
  const priorWorkstreams = structuredClone(aggregate.workstreams);
  aggregate.workstreamPlanSnapshots = [
    {
      planRevision: 1,
      workstreams: priorWorkstreams,
      createdAt: "2026-08-07T11:10:00.000Z",
    },
  ];
  aggregate.planRevision = 2;
  for (const candidate of aggregate.workstreams) candidate.planRevision = 2;
  const priorVerification = aggregate.assignments.find(
    (candidate) => candidate.kind === "verification",
  )!;
  aggregate.assignments.push({
    ...priorVerification,
    assignmentId: "assignment-final-verification-v2",
    planRevision: 2,
    acceptedTurnId: "turn-final-verification-v2",
    workspaceBaseline: {
      ...priorVerification.workspaceBaseline!,
      baselineId: "baseline-assignment-final-verification-v2",
      assignmentId: "assignment-final-verification-v2",
    },
  });
  return aggregate;
}

describe("team mission validation", () => {
  it("accepts a mission with internally consistent identities and references", () => {
    expect(validateTeamMission(mission())).toEqual({ ok: true });
  });

  it("allows staged planning but rejects an active Mission with incomplete Assignment coverage", () => {
    const staged = mission();
    staged.assignments = [];
    expect(validateTeamMission(staged)).toEqual({ ok: true });

    staged.status = "active";
    expect(validateTeamMission(staged)).toEqual({
      ok: false,
      issues: [
        {
          kind: "missing_assignment_contract",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("rejects ambiguous coverage and dependency drift while a plan is still staged", () => {
    const ambiguous = mission();
    ambiguous.assignments.push(assignment("assignment-api-duplicate", "workstream-api"));
    const ambiguousResult = validateTeamMission(ambiguous);
    expect(ambiguousResult.ok).toBe(false);
    if (ambiguousResult.ok) return;
    expect(ambiguousResult.issues).toContainEqual({
      kind: "ambiguous_assignment_contract",
      workstreamId: "workstream-api",
    });

    const dependencyDrift = mission();
    dependencyDrift.assignments[0]!.dependencyAssignmentIds = ["assignment-unknown"];
    const dependencyResult = validateTeamMission(dependencyDrift);
    expect(dependencyResult.ok).toBe(false);
    if (dependencyResult.ok) return;
    expect(dependencyResult.issues).toContainEqual({
      kind: "assignment_dependency_workstream_mismatch",
      assignmentId: "assignment-api",
      workstreamId: "workstream-api",
    });
  });

  it("rejects a persisted Assignment whose dependencies contradict the Workstream DAG", () => {
    const aggregate = mission();
    const downstream: MissionWorkstream = {
      ...workstream("workstream-downstream"),
      dependencyWorkstreamIds: ["workstream-api"],
    };
    aggregate.workstreams.splice(1, 0, downstream);
    aggregate.workstreams.at(-1)!.dependencyWorkstreamIds.push("workstream-downstream");
    aggregate.assignments.push(assignment("assignment-downstream", "workstream-downstream"));
    aggregate.status = "active";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "assignment_dependency_workstream_mismatch",
          assignmentId: "assignment-downstream",
          workstreamId: "workstream-downstream",
        },
      ],
    });
  });

  it("requires an open durable item for needs_attention", () => {
    const aggregate = mission();
    aggregate.status = "needs_attention";
    aggregate.suspendedStatus = "active";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "needs_attention_without_open_item" }],
    });
  });

  it("requires needs_attention while any durable item remains open", () => {
    const aggregate = mission();
    aggregate.status = "active";
    aggregate.attentionItems.push(attentionItem());

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "open_attention_status_mismatch",
          attentionId: "attention-missing-report",
          missionStatus: "active",
        },
      ],
    });
  });

  it("rejects resolved attention without auditable resolution", () => {
    const aggregate = mission();
    aggregate.attentionItems.push(attentionItem({ status: "resolved" }));

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "attention_resolution_mismatch",
          attentionId: "attention-missing-report",
        },
      ],
    });
  });

  it("rejects duplicate durable Attention identities", () => {
    const aggregate = mission();
    aggregate.status = "needs_attention";
    aggregate.suspendedStatus = "active";
    aggregate.attentionItems.push(attentionItem(), attentionItem());

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "duplicate_attention_id", attentionId: "attention-missing-report" }],
    });
  });

  it("rejects an assignment baseline captured under another audit policy", () => {
    const aggregate = completedMission();
    aggregate.assignments[0]!.workspaceBaseline = {
      ...aggregate.assignments[0]!.workspaceBaseline!,
      policyRevision: 2,
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "workspace_baseline_policy_mismatch",
          assignmentId: "assignment-api",
          policyRevision: 2,
        },
      ],
    });
  });

  it("keeps the versioned wire policy flexible but enforces the canonical audit policy", () => {
    const aggregate = mission();
    aggregate.workspaceAuditPolicy.includeDeclaredArtifactPaths = false;

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "invalid_workspace_audit_policy" }],
    });
  });

  it("rejects workstreams and assignments from an impossible plan revision", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.planRevision = 2;
    aggregate.assignments[0]!.planRevision = 2;

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "workstream_plan_revision_mismatch",
          workstreamId: "workstream-api",
          planRevision: 2,
        },
        {
          kind: "future_assignment_plan_revision",
          assignmentId: "assignment-api",
          planRevision: 2,
        },
      ],
    });
  });

  it("rejects a non-empty plan without a final verification workstream", () => {
    const aggregate = mission();
    aggregate.workstreams = aggregate.workstreams.filter(
      (candidate) => candidate.kind !== "verification",
    );

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "missing_final_verification" }],
    });
  });

  it("rejects more than one final verification workstream", () => {
    const aggregate = mission();
    aggregate.workstreams.push({
      ...finalVerificationWorkstream(),
      workstreamId: "workstream-extra-verification",
    });

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "multiple_final_verifications",
          workstreamIds: ["workstream-final-verification", "workstream-extra-verification"],
        },
      ],
    });
  });

  it("rejects more than one current final verification Assignment with stable ids", () => {
    const aggregate = completedMission();
    const verificationIndex = aggregate.assignments.findIndex(
      (candidate) => candidate.kind === "verification",
    );
    const verification = aggregate.assignments[verificationIndex]!;
    aggregate.assignments.splice(verificationIndex, 0, {
      ...verification,
      assignmentId: "assignment-final-verification-duplicate",
      acceptedTurnId: "turn-final-verification-duplicate",
      workspaceBaseline: {
        ...verification.workspaceBaseline!,
        baselineId: "baseline-assignment-final-verification-duplicate",
        assignmentId: "assignment-final-verification-duplicate",
      },
    });

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "multiple_final_verification_assignments",
      workstreamId: "workstream-final-verification",
      assignmentIds: ["assignment-final-verification", "assignment-final-verification-duplicate"],
    });
  });

  it("ignores a canceled current final verification Assignment when enforcing uniqueness", () => {
    const aggregate = completedMission();
    aggregate.assignments.push({
      ...assignment("assignment-final-verification-canceled", "workstream-final-verification", [
        "assignment-api",
      ]),
      kind: "verification",
      subjectAssignmentIds: ["assignment-api"],
      assigneeMemberId: "member-verifier",
      semanticState: "canceled",
      terminationReason: "mission_canceled",
      settledAt: "2026-08-07T11:09:30.000Z",
    });

    expect(validateTeamMission(aggregate)).toEqual({ ok: true });
  });

  it("requires final verification to be read-only", () => {
    const aggregate = mission();
    aggregate.workstreams[1]!.mutableScope = {
      kind: "paths",
      pathPrefixes: ["packages/server"],
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "writable_final_verification",
          workstreamId: "workstream-final-verification",
        },
      ],
    });
  });

  it("requires final verification to depend on every delivery path", () => {
    const aggregate = mission();
    aggregate.workstreams[1]!.dependencyWorkstreamIds = [];

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "uncovered_final_verification_path",
          verificationWorkstreamId: "workstream-final-verification",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("rejects final verification by a writable owner when a qualified alternative exists", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.mutableScope = {
      kind: "paths",
      pathPrefixes: ["packages/server"],
    };
    aggregate.rosterSnapshots[0]!.members[0]!.skillIds.push("verification");
    aggregate.workstreams[1]!.ownerMemberId = "member-engineer";
    aggregate.workstreams[1]!.ownerMatchExplanation = {
      ...aggregate.workstreams[1]!.ownerMatchExplanation,
      recommendedMemberId: "member-engineer",
      eligibleMemberIds: ["member-engineer", "member-verifier"],
      rosterIndex: 0,
    };
    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "non_independent_final_verification",
          workstreamId: "workstream-final-verification",
          memberId: "member-engineer",
        },
      ],
    });
  });

  it("requires a reason when no independent final verifier is qualified", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.mutableScope = {
      kind: "paths",
      pathPrefixes: ["packages/server"],
    };
    aggregate.rosterSnapshots[0]!.members[0]!.skillIds.push("verification");
    aggregate.rosterSnapshots[0]!.members = aggregate.rosterSnapshots[0]!.members.filter(
      (member) => member.memberId !== "member-verifier",
    );
    aggregate.workstreams[1]!.ownerMemberId = "member-engineer";
    aggregate.workstreams[1]!.ownerMatchExplanation = {
      ...aggregate.workstreams[1]!.ownerMatchExplanation,
      recommendedMemberId: "member-engineer",
      eligibleMemberIds: ["member-engineer"],
      rosterIndex: 0,
    };
    for (const candidate of aggregate.workstreams) {
      candidate.ownerMatchExplanation.candidateOpenAssignments = [
        { memberId: "member-engineer", openAssignments: 0 },
      ];
    }

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "undocumented_final_verification_exception",
          workstreamId: "workstream-final-verification",
          memberId: "member-engineer",
        },
      ],
    });
  });

  it("rejects mission completion without a completed final verification assignment", () => {
    const aggregate = mission();
    aggregate.status = "completed";
    aggregate.completedAt = "2026-08-07T11:10:00.000Z";
    for (const candidate of aggregate.workstreams) candidate.status = "accepted";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "accepted_workstream_has_unresolved_assignment",
          workstreamId: "workstream-api",
          assignmentId: "assignment-api",
        },
        {
          kind: "accepted_workstream_missing_delivery",
          workstreamId: "workstream-api",
        },
        {
          kind: "accepted_verification_missing_approval",
          workstreamId: "workstream-final-verification",
        },
        {
          kind: "missing_completed_final_verification_assignment",
          workstreamId: "workstream-final-verification",
        },
      ],
    });
  });

  it("accepts mission completion after the full final verification gate", () => {
    expect(validateTeamMission(completedMission())).toEqual({ ok: true });
  });

  it("rejects final verification whose dependency coverage omits an approved required review", () => {
    const aggregate = completedMissionWithRequiredReview();
    const verification = aggregate.assignments.find(
      (candidate) => candidate.kind === "verification",
    )!;
    verification.dependencyAssignmentIds = ["assignment-api"];

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_final_verification_assignment_coverage",
          verificationAssignmentId: "assignment-final-verification",
          expectedAssignmentIds: ["assignment-api", "assignment-api-review"],
          subjectAssignmentIds: ["assignment-api", "assignment-api-review"],
          dependencyAssignmentIds: ["assignment-api"],
        },
      ],
    });
  });

  it("accepts exact final verification coverage in either order", () => {
    const aggregate = completedMissionWithRequiredReview();
    const verification = aggregate.assignments.find(
      (candidate) => candidate.kind === "verification",
    )!;
    verification.subjectAssignmentIds.reverse();
    verification.dependencyAssignmentIds.reverse();

    expect(validateTeamMission(aggregate)).toEqual({ ok: true });
  });

  it.each(["subjectAssignmentIds", "dependencyAssignmentIds"] as const)(
    "rejects missing expected ids in final verification %s",
    (field) => {
      const aggregate = completedMissionWithRequiredReview();
      const verification = aggregate.assignments.find(
        (candidate) => candidate.kind === "verification",
      )!;
      verification[field] = ["assignment-api"];

      expect(validateTeamMission(aggregate).ok).toBe(false);
    },
  );

  it.each(["subjectAssignmentIds", "dependencyAssignmentIds"] as const)(
    "rejects extra ids in final verification %s",
    (field) => {
      const aggregate = completedMissionWithRequiredReview();
      const extraReviewId = addAdditionalApprovedReview(aggregate);
      const verification = aggregate.assignments.find(
        (candidate) => candidate.kind === "verification",
      )!;
      verification[field] = [...verification[field], extraReviewId];

      const result = validateTeamMission(aggregate);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues).toContainEqual({
        kind: "invalid_final_verification_assignment_coverage",
        verificationAssignmentId: "assignment-final-verification",
        expectedAssignmentIds: ["assignment-api", "assignment-api-review"],
        subjectAssignmentIds: verification.subjectAssignmentIds.toSorted(),
        dependencyAssignmentIds: verification.dependencyAssignmentIds.toSorted(),
      });
    },
  );

  it.each(["subjectAssignmentIds", "dependencyAssignmentIds"] as const)(
    "rejects duplicate ids in final verification %s",
    (field) => {
      const aggregate = completedMissionWithRequiredReview();
      const verification = aggregate.assignments.find(
        (candidate) => candidate.kind === "verification",
      )!;
      verification[field] = [...verification[field], "assignment-api-review"];

      const result = validateTeamMission(aggregate);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues).toContainEqual({
        kind: "invalid_final_verification_assignment_coverage",
        verificationAssignmentId: "assignment-final-verification",
        expectedAssignmentIds: ["assignment-api", "assignment-api-review"],
        subjectAssignmentIds: verification.subjectAssignmentIds.toSorted(),
        dependencyAssignmentIds: verification.dependencyAssignmentIds.toSorted(),
      });
    },
  );

  it("does not accept a forged runtime fact for the final verification turn", () => {
    const aggregate = completedMission();
    const context = validationContext(aggregate);
    context.acceptedTurnsById.set("turn-final-verification", {
      assignmentId: "assignment-final-verification",
      turnId: "turn-other",
      runtimeAgentId: "agent-verifier",
      outcome: "completed",
    });

    expect(validateStrictTeamMission(aggregate, context).ok).toBe(false);
  });

  it("does not let a prior review turn prove final verification by the same agent", () => {
    const aggregate = completedMissionWithRequiredReview();
    const review = aggregate.assignments.find((candidate) => candidate.kind === "review")!;
    const verification = aggregate.assignments.find(
      (candidate) => candidate.kind === "verification",
    )!;
    verification.acceptedTurnId = review.acceptedTurnId;
    const context = validationContext(aggregate);
    const reviewFact = {
      assignmentId: review.assignmentId,
      turnId: review.acceptedTurnId!,
      runtimeAgentId: review.runtimeAgentId!,
      outcome: "completed" as const,
    };
    context.acceptedTurnsById.set(reviewFact.turnId, reviewFact);

    const result = validateStrictTeamMission(aggregate, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "invalid_assignment_contract",
      assignmentId: "assignment-final-verification",
      violations: ["accepted_turn_assignment_mismatch"],
    });
  });

  it("does not accept changes requested as final verification approval", () => {
    const aggregate = completedMission();
    const verification = aggregate.assignments.find(
      (candidate) => candidate.kind === "verification",
    )!;
    if (verification.report?.status === "completed") {
      verification.report.verdict = "changes_requested";
    }

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("requires final verification to cover every completed current-plan Assignment", () => {
    const aggregate = completedMission();
    const additionalDelivery = {
      ...aggregate.assignments[0]!,
      assignmentId: "assignment-api-docs",
      acceptedTurnId: "turn-api-docs",
      workspaceBaseline: {
        ...aggregate.assignments[0]!.workspaceBaseline!,
        baselineId: "baseline-assignment-api-docs",
        assignmentId: "assignment-api-docs",
      },
    };
    aggregate.assignments.push(additionalDelivery);

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("does not accept a Workstream while a current-plan Assignment remains unresolved", () => {
    const aggregate = completedMission();
    aggregate.assignments.push(assignment("assignment-api-follow-up", "workstream-api"));

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("rejects completion without runtime evidence for the final verification turn", () => {
    const aggregate = completedMission();
    const verification = aggregate.assignments.find(
      (candidate) => candidate.kind === "verification",
    )!;
    verification.runtimeAgentId = null;
    verification.bindingEpoch = null;
    verification.workspaceBaseline = null;
    verification.acceptedTurnId = null;
    verification.dispatchedAt = null;

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("rejects a stale final verification after the Mission is replanned", () => {
    const aggregate = completedMission();
    const priorWorkstreams = structuredClone(aggregate.workstreams);
    aggregate.workstreamPlanSnapshots = [
      {
        planRevision: 1,
        workstreams: priorWorkstreams,
        createdAt: "2026-08-07T11:10:00.000Z",
      },
    ];
    aggregate.planRevision = 2;
    for (const candidate of aggregate.workstreams) candidate.planRevision = 2;

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "accepted_verification_missing_approval",
          workstreamId: "workstream-final-verification",
        },
        {
          kind: "missing_completed_final_verification_assignment",
          workstreamId: "workstream-final-verification",
        },
      ],
    });
  });

  it("accepts retained completed delivery after replan and verifies it in the current plan", () => {
    expect(validateTeamMission(replanCompletedMission())).toEqual({ ok: true });
  });

  it("does not reuse a historical downstream Assignment after its selected dependency changes", () => {
    const aggregate = replanCompletedMission();
    const currentApi = aggregate.workstreams[0]!;
    currentApi.acceptanceCriteria = ["The revised API contract is verified."];
    const currentDownstream: MissionWorkstream = {
      ...structuredClone(currentApi),
      workstreamId: "workstream-downstream",
      title: "Downstream implementation",
      objective: "Consume the API contract.",
      deliverables: ["Downstream implementation"],
      acceptanceCriteria: ["The downstream implementation consumes the API."],
      dependencyWorkstreamIds: ["workstream-api"],
    };
    aggregate.workstreams.splice(1, 0, currentDownstream);
    aggregate.workstreams.at(-1)!.dependencyWorkstreamIds.push("workstream-downstream");

    const historicalPlan = aggregate.workstreamPlanSnapshots[0]!;
    const historicalDownstream = {
      ...structuredClone(currentDownstream),
      planRevision: 1,
    };
    historicalPlan.workstreams.splice(1, 0, historicalDownstream);
    historicalPlan.workstreams.at(-1)!.dependencyWorkstreamIds.push("workstream-downstream");

    const historicalApi = aggregate.assignments.find(
      (candidate) => candidate.assignmentId === "assignment-api",
    )!;
    aggregate.assignments.push({
      ...historicalApi,
      assignmentId: "assignment-downstream-v1",
      workstreamId: "workstream-downstream",
      dependencyAssignmentIds: ["assignment-api"],
      acceptedTurnId: "turn-downstream-v1",
      workspaceBaseline: {
        ...historicalApi.workspaceBaseline!,
        baselineId: "baseline-assignment-downstream-v1",
        assignmentId: "assignment-downstream-v1",
      },
    });
    aggregate.assignments.push({
      ...assignment("assignment-api-v2", "workstream-api"),
      planRevision: 2,
    });

    const coverage = resolveMissionAssignmentCoverage(aggregate, validationContext(aggregate));

    expect([...coverage.assignmentIdsByWorkstreamId]).toEqual([
      ["workstream-api", "assignment-api-v2"],
    ]);
    expect(coverage.missingWorkstreamIds).toEqual(["workstream-downstream"]);
    expect(coverage.ambiguousWorkstreamIds).toEqual([]);
  });

  it("validates a retained Assignment role against its historical Workstream plan", () => {
    const aggregate = replanCompletedMission();
    const historicalDelivery = aggregate.assignments[0]!;
    historicalDelivery.assigneeMemberId = "member-verifier";
    historicalDelivery.runtimeAgentId = "agent-verifier";

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "assignment_assignee_role_mismatch",
      assignmentId: "assignment-api",
      expectedMemberId: "member-engineer",
      actualMemberId: "member-verifier",
    });
  });

  it("validates retained Assignment scope against its historical Workstream plan", () => {
    const aggregate = replanCompletedMission();
    aggregate.assignments[0]!.mutableScope = { kind: "workspace" };

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "assignment_scope_exceeds_workstream",
      assignmentId: "assignment-api",
      workstreamId: "workstream-api",
    });
  });

  it("rejects a writable historical review Assignment", () => {
    const aggregate = replanCompletedMission();
    const historicalReview = {
      ...aggregate.assignments[0]!,
      assignmentId: "assignment-api-review",
      kind: "review" as const,
      subjectAssignmentIds: ["assignment-api"],
      assigneeMemberId: "member-verifier",
      runtimeAgentId: "agent-verifier",
      mutableScope: { kind: "workspace" as const },
      dependencyAssignmentIds: ["assignment-api"],
      acceptedTurnId: "turn-api-review",
      workspaceBaseline: {
        ...aggregate.assignments[0]!.workspaceBaseline!,
        baselineId: "baseline-assignment-api-review",
        assignmentId: "assignment-api-review",
      },
      report: {
        ...completedReport("Reviewed the API."),
        verdict: "approved" as const,
      },
    };
    aggregate.assignments.push(historicalReview);

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "writable_review_assignment",
      assignmentId: "assignment-api-review",
    });
  });

  it("requires an exact historical Workstream plan for every retained Assignment", () => {
    const aggregate = replanCompletedMission();
    aggregate.workstreamPlanSnapshots = [];

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "unknown_assignment_workstream_revision",
      assignmentId: "assignment-api",
      workstreamId: "workstream-api",
      planRevision: 1,
    });
  });

  it("rejects duplicate historical Workstream plan revisions", () => {
    const aggregate = replanCompletedMission();
    aggregate.workstreamPlanSnapshots.push(structuredClone(aggregate.workstreamPlanSnapshots[0]!));

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "duplicate_workstream_plan_snapshot_revision",
      planRevision: 1,
    });
  });

  it("rejects a Workstream plan snapshot that is not historical", () => {
    const aggregate = mission();
    aggregate.workstreamPlanSnapshots = [
      {
        planRevision: 1,
        workstreams: structuredClone(aggregate.workstreams),
        createdAt: "2026-08-07T11:10:00.000Z",
      },
    ];

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "non_historical_workstream_plan_snapshot",
      planRevision: 1,
    });
  });

  it("rejects a Workstream whose revision disagrees with its plan snapshot", () => {
    const aggregate = replanCompletedMission();
    aggregate.workstreamPlanSnapshots[0]!.workstreams[0]!.planRevision = 2;

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "workstream_plan_snapshot_revision_mismatch",
      snapshotRevision: 1,
      workstreamId: "workstream-api",
      planRevision: 2,
    });
  });

  it("does not reuse historical delivery after its Workstream contract changes", () => {
    const aggregate = replanCompletedMission();
    aggregate.workstreams[0]!.acceptanceCriteria = ["The revised API contract is verified."];

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "accepted_workstream_missing_delivery",
      workstreamId: "workstream-api",
    });
  });

  it("requires an approved review Assignment before accepting required-review work", () => {
    const aggregate = completedMission();
    const delivery = aggregate.workstreams[0]!;
    delivery.reviewPolicy = "required";
    delivery.reviewerRequirements = {
      requiredSkillIds: ["verification"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
    };
    delivery.reviewerMemberId = "member-verifier";
    delivery.reviewerMatchExplanation = {
      ...aggregate.workstreams[1]!.ownerMatchExplanation,
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "accepted_workstream_missing_approved_review",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("does not reuse an approved historical review for a different selected delivery", () => {
    const aggregate = replanCompletedMission();
    const currentDelivery = aggregate.workstreams[0]!;
    const historicalDelivery = aggregate.workstreamPlanSnapshots[0]!.workstreams[0]!;
    for (const candidate of [currentDelivery, historicalDelivery]) {
      candidate.reviewPolicy = "required";
      candidate.reviewerRequirements = {
        requiredSkillIds: ["verification"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 3,
      };
      candidate.reviewerMemberId = "member-verifier";
      candidate.reviewerMatchExplanation = {
        ...aggregate.workstreams[1]!.ownerMatchExplanation,
      };
    }
    const v1Delivery = aggregate.assignments.find(
      (candidate) => candidate.assignmentId === "assignment-api",
    )!;
    aggregate.assignments.push({
      ...v1Delivery,
      assignmentId: "assignment-api-review-v1",
      kind: "review",
      subjectAssignmentIds: [v1Delivery.assignmentId],
      dependencyAssignmentIds: [v1Delivery.assignmentId],
      assigneeMemberId: "member-verifier",
      runtimeAgentId: "agent-verifier",
      mutableScope: { kind: "read_only" },
      acceptedTurnId: "turn-api-review-v1",
      workspaceBaseline: {
        ...v1Delivery.workspaceBaseline!,
        baselineId: "baseline-assignment-api-review-v1",
        assignmentId: "assignment-api-review-v1",
      },
      report: {
        ...completedReport("Approved the first API delivery."),
        verdict: "approved",
      },
    });
    aggregate.assignments.push({
      ...v1Delivery,
      assignmentId: "assignment-api-v2",
      planRevision: 2,
      acceptedTurnId: "turn-api-v2",
      workspaceBaseline: {
        ...v1Delivery.workspaceBaseline!,
        baselineId: "baseline-assignment-api-v2",
        assignmentId: "assignment-api-v2",
      },
    });
    const verification = aggregate.assignments.find(
      (candidate) => candidate.assignmentId === "assignment-final-verification-v2",
    )!;
    verification.subjectAssignmentIds = [
      "assignment-api",
      "assignment-api-v2",
      "assignment-api-review-v1",
    ];
    verification.dependencyAssignmentIds = [...verification.subjectAssignmentIds];

    const result = validateTeamMission(aggregate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      kind: "accepted_workstream_missing_approved_review",
      workstreamId: "workstream-api",
    });
  });

  it("requires a completion timestamp after the quality gate passes", () => {
    const aggregate = completedMission();
    aggregate.completedAt = null;

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "completed_at_required" }],
    });
  });

  it("requires every workstream to be accepted before mission completion", () => {
    const aggregate = completedMission();
    aggregate.workstreams[0]!.status = "active";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unaccepted_workstream_at_completion",
          workstreamId: "workstream-api",
          status: "active",
        },
      ],
    });
  });

  it("rejects an active roster revision that has no frozen snapshot", () => {
    const aggregate = mission();
    aggregate.activeRosterSnapshotRevision = 2;

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "unknown_active_roster_snapshot", snapshotRevision: 2 }],
    });
  });

  it("rejects duplicate roster snapshot revisions", () => {
    const aggregate = mission();
    aggregate.rosterSnapshots.push({ ...aggregate.rosterSnapshots[0]! });

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [{ kind: "duplicate_roster_snapshot_revision", snapshotRevision: 1 }],
    });
  });

  it("rejects non-canonical and duplicate mention handles inside a roster snapshot", () => {
    const aggregate = mission();
    aggregate.rosterSnapshots[0]!.members[1]!.mentionHandle = "ENGINEER";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_roster_mention_handle",
          snapshotRevision: 1,
          memberId: "member-verifier",
          mentionHandle: "ENGINEER",
        },
        {
          kind: "duplicate_roster_mention_handle",
          snapshotRevision: 1,
          mentionHandle: "engineer",
        },
      ],
    });
  });

  it("rejects duplicate member and skill identities inside a roster snapshot", () => {
    const aggregate = mission();
    aggregate.rosterSnapshots[0]!.members.push({
      ...aggregate.rosterSnapshots[0]!.members[0]!,
      mentionHandle: "engineer-copy",
    });
    aggregate.rosterSnapshots[0]!.skills.push({
      ...aggregate.rosterSnapshots[0]!.skills[0]!,
    });

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "duplicate_roster_member_id",
          snapshotRevision: 1,
          memberId: "member-engineer",
        },
        {
          kind: "duplicate_roster_skill_id",
          snapshotRevision: 1,
          skillId: "typescript",
        },
      ],
    });
  });

  it("rejects plan and assignment references to unknown roster snapshots", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.rosterSnapshotRevision = 2;
    aggregate.assignments[0]!.rosterSnapshotRevision = 3;

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_workstream_roster_snapshot",
          workstreamId: "workstream-api",
          snapshotRevision: 2,
        },
        {
          kind: "unknown_assignment_roster_snapshot",
          assignmentId: "assignment-api",
          snapshotRevision: 3,
        },
      ],
    });
  });

  it("rejects owners and assignees absent from their frozen roster snapshots", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.ownerMemberId = "member-missing-owner";
    aggregate.assignments[0]!.assigneeMemberId = "member-missing-assignee";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_workstream_owner",
          workstreamId: "workstream-api",
          memberId: "member-missing-owner",
          snapshotRevision: 1,
        },
        {
          kind: "unknown_assignment_assignee",
          assignmentId: "assignment-api",
          memberId: "member-missing-assignee",
          snapshotRevision: 1,
        },
      ],
    });
  });

  it("rejects an incomplete required-review contract", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.reviewPolicy = "required";
    aggregate.workstreams[0]!.reviewerRequirements = {
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "incomplete_required_review",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("rejects an owner override that bypasses a hard skill requirement", () => {
    const aggregate = mission();
    aggregate.workstreams[0]!.requiredSkillIds = ["typescript", "protocol"];
    aggregate.workstreams[0]!.ownerOverrideReason = "Use the available engineer.";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_owner_match_explanation",
          workstreamId: "workstream-api",
        },
        {
          kind: "ineligible_workstream_owner",
          workstreamId: "workstream-api",
          memberId: "member-engineer",
        },
      ],
    });
  });

  it("rejects self-review for writable work when a qualified alternative exists", () => {
    const aggregate = mission();
    aggregate.rosterSnapshots[0]!.skills.push({
      skillId: "review",
      name: "Review",
      description: null,
    });
    const owner = aggregate.rosterSnapshots[0]!.members[0]!;
    owner.skillIds = ["typescript", "review"];
    aggregate.rosterSnapshots[0]!.members.push({
      ...owner,
      memberId: "member-reviewer",
      role: "Software reviewer",
      mentionHandle: "reviewer",
    });
    const candidateOpenAssignments = aggregate.rosterSnapshots[0]!.members.map((member) => ({
      memberId: member.memberId,
      openAssignments: 0,
    }));
    aggregate.workstreams[0]!.ownerMatchExplanation = {
      ...aggregate.workstreams[0]!.ownerMatchExplanation,
      eligibleMemberIds: ["member-engineer", "member-reviewer"],
      candidateOpenAssignments,
    };
    aggregate.workstreams[1]!.ownerMatchExplanation.candidateOpenAssignments =
      candidateOpenAssignments;
    aggregate.workstreams[0] = {
      ...aggregate.workstreams[0]!,
      mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
      reviewPolicy: "required",
      reviewerRequirements: {
        requiredSkillIds: ["review"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 3,
      },
      reviewerMemberId: "member-engineer",
      reviewerMatchExplanation: {
        ...aggregate.workstreams[0]!.ownerMatchExplanation,
        recommendedMemberId: "member-reviewer",
        requiredSkillIds: ["review"],
        eligibleMemberIds: ["member-engineer", "member-reviewer"],
        excludedMemberIds: ["member-engineer"],
        rosterIndex: 2,
      },
      reviewerOverrideReason: "Exercise the independent-review guard.",
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "non_independent_workstream_reviewer",
          workstreamId: "workstream-api",
          memberId: "member-engineer",
        },
      ],
    });
  });

  it("rejects an owner selection that differs from the recommendation without a reason", () => {
    const aggregate = mission();
    const owner = aggregate.rosterSnapshots[0]!.members[0]!;
    aggregate.rosterSnapshots[0]!.members.push({
      ...owner,
      memberId: "member-peer",
      mentionHandle: "peer",
    });
    const candidateOpenAssignments = aggregate.rosterSnapshots[0]!.members.map((member) => ({
      memberId: member.memberId,
      openAssignments: 0,
    }));
    aggregate.workstreams[0]!.ownerMatchExplanation = {
      ...aggregate.workstreams[0]!.ownerMatchExplanation,
      eligibleMemberIds: ["member-engineer", "member-peer"],
      candidateOpenAssignments,
    };
    aggregate.workstreams[1]!.ownerMatchExplanation.candidateOpenAssignments =
      candidateOpenAssignments;
    aggregate.workstreams[0]!.ownerMemberId = "member-peer";
    aggregate.assignments[0]!.assigneeMemberId = "member-peer";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unexplained_owner_override",
          workstreamId: "workstream-api",
          recommendedMemberId: "member-engineer",
          selectedMemberId: "member-peer",
        },
      ],
    });
  });

  it("rejects a forged match explanation that rewrites the deterministic recommendation", () => {
    const aggregate = mission();
    const owner = aggregate.rosterSnapshots[0]!.members[0]!;
    aggregate.rosterSnapshots[0]!.members.push({
      ...owner,
      memberId: "member-peer",
      mentionHandle: "peer",
    });
    aggregate.workstreams[0]!.ownerMemberId = "member-peer";
    aggregate.workstreams[0]!.ownerMatchExplanation = {
      ...aggregate.workstreams[0]!.ownerMatchExplanation,
      recommendedMemberId: "member-peer",
      eligibleMemberIds: ["member-engineer", "member-peer"],
      rosterIndex: 1,
    };
    aggregate.assignments[0]!.assigneeMemberId = "member-peer";

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("requires an auditable exception when writable work has no independent reviewer", () => {
    const aggregate = mission();
    const delivery = aggregate.workstreams[0]!;
    aggregate.rosterSnapshots[0]!.skills.push({
      skillId: "review",
      name: "Review",
      description: null,
    });
    aggregate.rosterSnapshots[0]!.members[0]!.skillIds.push("review");
    delivery.mutableScope = { kind: "paths", pathPrefixes: ["packages/server"] };
    delivery.reviewPolicy = "required";
    delivery.reviewerRequirements = {
      requiredSkillIds: ["review"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
    };
    delivery.reviewerMemberId = "member-engineer";
    delivery.reviewerMatchExplanation = {
      ...delivery.ownerMatchExplanation,
      requiredSkillIds: ["review"],
    };

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("requires review assignments to be read-only", () => {
    const aggregate = mission();
    const delivery = aggregate.workstreams[0]!;
    delivery.reviewPolicy = "required";
    delivery.reviewerRequirements = {
      requiredSkillIds: ["verification"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3,
    };
    delivery.reviewerMemberId = "member-verifier";
    delivery.reviewerMatchExplanation = {
      ...aggregate.workstreams[1]!.ownerMatchExplanation,
    };
    aggregate.assignments.push({
      ...assignment("assignment-review", "workstream-api", ["assignment-api"]),
      kind: "review",
      subjectAssignmentIds: ["assignment-api"],
      assigneeMemberId: "member-verifier",
      mutableScope: { kind: "workspace" },
    });

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("rejects an Assignment scope broader than its Workstream scope", () => {
    const aggregate = mission();
    aggregate.assignments[0]!.mutableScope = { kind: "workspace" };

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("rejects duplicate participant binding epochs", () => {
    const aggregate = mission();
    aggregate.participants.push({
      ...aggregate.participants[0]!,
      agentId: "agent-engineer-replacement",
      archivedAt: "2026-08-07T11:04:00.000Z",
    });

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "duplicate_participant_binding",
          memberId: "member-engineer",
          bindingEpoch: 1,
        },
      ],
    });
  });

  it("preserves old assignment bindings after a member explicitly rebinds", () => {
    const aggregate = mission();
    aggregate.participants[0]!.archivedAt = "2026-08-07T11:04:00.000Z";
    aggregate.participants.push({
      memberId: "member-engineer",
      agentId: "agent-engineer-rebound",
      bindingEpoch: 2,
      joinedAt: "2026-08-07T11:05:00.000Z",
      archivedAt: null,
    });
    aggregate.assignments[0]!.runtimeAgentId = "agent-engineer";
    aggregate.assignments[0]!.bindingEpoch = 1;
    aggregate.assignments[0]!.report = completedReport("Delivered before the participant rebind.");
    aggregate.assignments[0]!.workspaceBaseline = {
      baselineId: "baseline-assignment-api",
      workspaceId: "workspace-platform",
      assignmentId: "assignment-api",
      policyRevision: 1,
      capturedAt: "2026-08-07T11:00:30.000Z",
      entries: [],
    };
    aggregate.assignments[0]!.dispatchState = "settled";
    aggregate.assignments[0]!.semanticState = "completed";
    aggregate.assignments[0]!.acceptedTurnId = "turn-api-before-rebind";
    aggregate.assignments[0]!.dispatchedAt = "2026-08-07T11:01:00.000Z";
    aggregate.assignments[0]!.settledAt = "2026-08-07T11:04:00.000Z";

    expect(validateTeamMission(aggregate)).toEqual({ ok: true });
  });

  it("rejects running work bound to an archived participant without attention", () => {
    const aggregate = mission();
    aggregate.participants[0]!.archivedAt = "2026-08-07T11:04:00.000Z";
    aggregate.assignments[0] = {
      ...aggregate.assignments[0]!,
      runtimeAgentId: "agent-engineer",
      bindingEpoch: 1,
      workspaceBaseline: {
        baselineId: "baseline-assignment-api",
        workspaceId: "workspace-platform",
        assignmentId: "assignment-api",
        policyRevision: 1,
        capturedAt: "2026-08-07T11:00:30.000Z",
        entries: [],
      },
      dispatchState: "dispatched",
      semanticState: "running",
      acceptedTurnId: "turn-api",
      dispatchedAt: "2026-08-07T11:01:00.000Z",
    };

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("rejects an attention resolution that is not valid for its item kind", () => {
    const aggregate = mission();
    aggregate.attentionItems.push(
      attentionItem({
        status: "resolved",
        resolution: {
          kind: "attribute_owner",
          actorId: "user-owner",
          reason: "This is not a missing-report resolution.",
          ownerAssignmentId: "assignment-api",
          recoveryAssignmentId: null,
          resolvedAt: "2026-08-07T11:07:00.000Z",
        },
      }),
    );

    expect(validateTeamMission(aggregate).ok).toBe(false);
  });

  it("does not let a replan release an unknown provider acceptance fence", () => {
    const aggregate = mission();
    const item = attentionItem({
      attentionId: "attention-acceptance-unknown",
      kind: "dispatch_acceptance_unknown",
    });

    expect(
      validateMissionAttentionResolution(aggregate, item, {
        kind: "replan",
        actorId: "member-lead",
        reason: "Try the work again",
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
        resolvedAt: "2026-08-07T11:07:00.000Z",
      }),
    ).toEqual([
      {
        kind: "invalid_attention_resolution_kind",
        attentionId: "attention-acceptance-unknown",
      },
    ]);
  });

  it("allows a Lead replan to resolve an accepted Assignment blocker", () => {
    const aggregate = mission();
    const item = attentionItem({
      attentionId: "attention-assignment-replan",
      kind: "assignment_requires_replan",
    });

    expect(
      validateMissionAttentionResolution(aggregate, item, {
        kind: "replan",
        actorId: "member-lead",
        reason: "Replace the blocked Assignment with a corrected contract",
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
        resolvedAt: "2026-08-07T11:07:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects an agent session bound to more than one member", () => {
    const aggregate = mission();
    aggregate.participants.push({
      ...aggregate.participants[0]!,
      memberId: "member-reviewer",
    });

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "duplicate_participant_agent_id",
          agentId: "agent-engineer",
        },
      ],
    });
  });

  it("rejects duplicate assignment identities", () => {
    const aggregate = mission();
    aggregate.assignments.push(assignment("assignment-api", "workstream-api"));

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "duplicate_assignment_id",
          assignmentId: "assignment-api",
        },
        {
          kind: "ambiguous_assignment_contract",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("requires a superseded Assignment to reference its durable replacement", () => {
    const aggregate = mission();
    aggregate.assignments[0] = {
      ...aggregate.assignments[0]!,
      semanticState: "canceled",
      terminationReason: "superseded",
      supersededBy: "assignment-replacement-missing",
      settledAt: "2026-08-07T11:05:00.000Z",
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_superseding_assignment",
          assignmentId: "assignment-api",
          supersededBy: "assignment-replacement-missing",
        },
      ],
    });
  });

  it("rejects assignments that reference another mission or an unknown workstream", () => {
    const aggregate = mission();
    aggregate.assignments[0] = {
      ...aggregate.assignments[0]!,
      missionId: "mission-other",
      workstreamId: "workstream-missing",
    };

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "assignment_mission_mismatch",
          assignmentId: "assignment-api",
          missionId: "mission-other",
        },
        {
          kind: "unknown_assignment_workstream",
          assignmentId: "assignment-api",
          workstreamId: "workstream-missing",
        },
      ],
    });
  });

  it("rejects a current-plan delivery assignment sent to someone other than its owner", () => {
    const aggregate = mission();
    aggregate.assignments[0]!.assigneeMemberId = "member-verifier";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "assignment_assignee_role_mismatch",
          assignmentId: "assignment-api",
          expectedMemberId: "member-engineer",
          actualMemberId: "member-verifier",
        },
      ],
    });
  });

  it("rejects an assignment dependency that is not in the mission", () => {
    const aggregate = mission();
    aggregate.assignments[0]!.dependencyAssignmentIds = ["assignment-missing"];

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_assignment_dependency",
          assignmentId: "assignment-api",
          dependencyAssignmentId: "assignment-missing",
        },
        {
          kind: "assignment_dependency_workstream_mismatch",
          assignmentId: "assignment-api",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("rejects a review or verification subject outside the mission", () => {
    const aggregate = mission();
    aggregate.assignments[0]!.kind = "verification";
    aggregate.assignments[0]!.workstreamId = "workstream-final-verification";
    aggregate.assignments[0]!.assigneeMemberId = "member-verifier";
    aggregate.assignments[0]!.subjectAssignmentIds = ["assignment-missing"];

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_subject_assignment",
          assignmentId: "assignment-api",
          subjectAssignmentId: "assignment-missing",
        },
      ],
    });
  });

  it("rejects a cycle in the assignment dependency graph", () => {
    const aggregate = mission();
    aggregate.assignments = [
      assignment("assignment-api", "workstream-api", ["assignment-ui"]),
      assignment("assignment-ui", "workstream-api", ["assignment-api"]),
    ];

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "assignment_dependency_cycle",
          assignmentIds: ["assignment-api", "assignment-ui"],
        },
        {
          kind: "ambiguous_assignment_contract",
          workstreamId: "workstream-api",
        },
      ],
    });
  });

  it("rejects a runtime agent that does not match the participant binding", () => {
    const aggregate = mission();
    aggregate.assignments[0]!.runtimeAgentId = "agent-other";
    aggregate.assignments[0]!.bindingEpoch = 1;
    aggregate.assignments[0]!.workspaceBaseline = {
      baselineId: "baseline-assignment-api",
      workspaceId: "workspace-platform",
      assignmentId: "assignment-api",
      policyRevision: 1,
      capturedAt: "2026-08-07T11:00:30.000Z",
      entries: [],
    };
    aggregate.assignments[0]!.dispatchState = "dispatched";
    aggregate.assignments[0]!.semanticState = "running";
    aggregate.assignments[0]!.acceptedTurnId = "turn-api";
    aggregate.assignments[0]!.dispatchedAt = "2026-08-07T11:01:00.000Z";

    expect(validateTeamMission(aggregate)).toEqual({
      ok: false,
      issues: [
        {
          kind: "assignment_runtime_participant_mismatch",
          assignmentId: "assignment-api",
          memberId: "member-engineer",
          runtimeAgentId: "agent-other",
        },
      ],
    });
  });
});
