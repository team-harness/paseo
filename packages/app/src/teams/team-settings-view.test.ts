import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  selectTeamAttentionRecovery,
  buildTeamMethodologyUpgradePreview,
  selectTeamAttentionRows,
  selectTeamMemberSettingsRows,
  selectTeamMissionHistory,
  selectTeamPlanRows,
} from "@/teams/team-settings-view";
import {
  TEST_METHODOLOGY,
  testMissionMethodologySnapshot,
  testTeamMethodologyBinding,
} from "./test-fixtures";

function team(): TeamV2 {
  return {
    id: "team-1",
    name: "Release team",
    creationWorkspaceId: "workspace-1",
    leadMemberId: "member-lead",
    skills: [
      { skillId: "typescript", name: "TypeScript", description: null },
      { skillId: "testing", name: "Testing", description: null },
    ],
    members: [
      {
        memberId: "member-lead",
        role: "Software engineer",
        level: 5,
        skillIds: ["typescript"],
        mentionHandle: "lead",
        executionProfile: {
          provider: "codex",
          model: "gpt-5.6-sol",
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
      },
      {
        memberId: "member-reviewer",
        role: "Software engineer",
        level: 3,
        skillIds: ["testing"],
        mentionHandle: "reviewer",
        executionProfile: {
          provider: "claude",
          model: null,
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
      },
    ],
    methodologyBinding: testTeamMethodologyBinding(
      ["member-lead", "member-reviewer"],
      ["typescript", "testing"],
    ),
    lifecycle: "active",
    activeMissionId: "mission-1",
    lifecycleRecoveryFailure: null,
    revision: 2,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    archivedAt: null,
  };
}

function mission(): TeamMission {
  const rosterMembers = team().members.map((member) =>
    Object.assign({}, member, {
      capabilityFacts: { kind: "known" as const, capabilityIds: [] },
    }),
  );
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Ship Team settings",
    constraints: ["Keep scopes isolated"],
    acceptanceCriteria: ["The UI passes E2E"],
    status: "active",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        teamRevision: 2,
        leadMemberId: "member-lead",
        reason: "initial",
        skills: team().skills,
        members: rosterMembers,
        createdAt: "2026-08-09T00:00:00.000Z",
      },
    ],
    methodologySnapshot: testMissionMethodologySnapshot(2, 1),
    methodologyCompiledAt: "2026-08-09T00:00:00.000Z",
    planRevision: 1,
    revision: 4,
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    },
    chatRoomId: "room-1",
    participants: [
      {
        memberId: "member-lead",
        agentId: "agent-lead",
        bindingEpoch: 1,
        joinedAt: "2026-08-09T00:00:00.000Z",
        archivedAt: null,
      },
      {
        memberId: "member-reviewer",
        agentId: "agent-reviewer",
        bindingEpoch: 1,
        joinedAt: "2026-08-09T00:00:00.000Z",
        archivedAt: "2026-08-09T01:00:00.000Z",
      },
    ],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    reviewWaivers: [],
    lifecycleRecoveryFailure: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    completedAt: null,
  };
}

function acceptedAssignment(
  assigneeMemberId: string,
  semanticState: TeamMission["assignments"][number]["semanticState"],
): TeamMission["assignments"][number] {
  return {
    assignmentId: `assignment-${assigneeMemberId}`,
    revision: 1,
    kind: "delivery",
    subjectAssignmentIds: [],
    reviewGateFingerprint: null,
    reviewSubjectFingerprint: null,
    finalVerificationGateFingerprint: null,
    reviewGateEvidence: [],
    missionId: "mission-1",
    workstreamId: "workstream-ui",
    assigneeMemberId,
    runtimeAgentId: `agent-${assigneeMemberId}`,
    bindingEpoch: 1,
    objective: "Ship UI",
    inputRefs: [],
    deliverables: [],
    acceptanceCriteria: [],
    mutableScope: { kind: "read_only" },
    dependencyAssignmentIds: [],
    priority: 1,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    methodologySnapshotRevision: 1,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: semanticState === "running" ? "dispatched" : "settled",
    semanticState,
    attempt: 1,
    acceptedTurnId: `turn-${assigneeMemberId}`,
    createdAt: "2026-08-09T00:00:00.000Z",
    dispatchedAt: "2026-08-09T00:01:00.000Z",
    settledAt: semanticState === "running" ? null : "2026-08-09T00:02:00.000Z",
  };
}

describe("Team settings view", () => {
  it("offers Members without open accepted work regardless of the frozen provider snapshot", () => {
    const aggregate = mission();
    const template = aggregate.rosterSnapshots[0].members[1];
    aggregate.rosterSnapshots[0].members.push(
      {
        ...template,
        memberId: "member-finished",
        mentionHandle: "reviewer-2",
      },
      {
        ...template,
        memberId: "member-busy",
        mentionHandle: "reviewer-3",
      },
      {
        ...template,
        memberId: "member-offline",
        mentionHandle: "reviewer-4",
        capabilityFacts: {
          kind: "unknown",
          providerId: "codex",
          reason: "provider_declaration_unavailable",
        },
      },
      {
        ...template,
        memberId: "member-unknown",
        mentionHandle: "reviewer-5",
        capabilityFacts: {
          kind: "unknown",
          providerId: "codex",
          reason: "provider_declaration_unavailable",
        },
      },
    );
    aggregate.assignments.push(
      acceptedAssignment("member-busy", "running"),
      acceptedAssignment("member-finished", "completed"),
    );

    expect(selectTeamAttentionRecovery(aggregate)).toEqual({
      leadAgentId: "agent-lead",
      replacementMembers: [
        {
          memberId: "member-reviewer",
          role: "Software engineer",
          mentionHandle: "reviewer",
        },
        {
          memberId: "member-finished",
          role: "Software engineer",
          mentionHandle: "reviewer-2",
        },
        {
          memberId: "member-offline",
          role: "Software engineer",
          mentionHandle: "reviewer-4",
        },
        {
          memberId: "member-unknown",
          role: "Software engineer",
          mentionHandle: "reviewer-5",
        },
      ],
    });
  });

  it("keeps completed Mission history visible without duplicating the current Mission", () => {
    const current = mission();
    const completed = {
      ...mission(),
      id: "mission-completed",
      status: "completed" as const,
      completedAt: "2026-08-09T02:00:00.000Z",
    };

    expect(selectTeamMissionHistory([current, completed], current)).toEqual([completed]);
    expect(selectTeamMissionHistory([current, completed], null)).toEqual([current, completed]);
  });

  it("keeps equal roles distinguishable by handle, level, skills, and participant", () => {
    expect(selectTeamMemberSettingsRows(team(), mission())).toEqual([
      {
        executionSourceStatus: { kind: "inline" },
        memberId: "member-lead",
        role: "Software engineer",
        level: 5,
        mentionHandle: "lead",
        skillNames: ["TypeScript"],
        provider: "codex",
        model: "gpt-5.6-sol",
        isLead: true,
        participantAgentId: "agent-lead",
        participantState: "active",
      },
      {
        executionSourceStatus: { kind: "inline" },
        memberId: "member-reviewer",
        role: "Software engineer",
        level: 3,
        mentionHandle: "reviewer",
        skillNames: ["Testing"],
        provider: "claude",
        model: null,
        isLead: false,
        participantAgentId: "agent-reviewer",
        participantState: "archived",
      },
    ]);
  });

  it("preserves valid bindings and reports Methodology policy changes", () => {
    const current = TEST_METHODOLOGY;
    const next = {
      ...current,
      ref: { ...current.ref, version: "2", digest: `sha256:${"a".repeat(64)}` },
      archetypes: current.archetypes.filter((item) => item.archetypeId === "lead"),
      policySummary: {
        ...current.policySummary,
        review: {
          ...current.policySummary.review,
          writableWorkstreams: "independent_required" as const,
        },
      },
    };
    const preview = buildTeamMethodologyUpgradePreview(team(), current, next);

    expect(preview).toMatchObject({
      archetypeChanges: expect.any(Number),
      policyChanges: 1,
      upgrade: {
        expectedRef: team().methodologyBinding.ref,
        ref: next.ref,
        memberArchetypeBindings: expect.any(Array),
        skillBindings: expect.any(Array),
      },
    });
    expect(preview.upgrade.memberArchetypeBindings).toHaveLength(team().members.length);
    expect(preview.upgrade.skillBindings).toHaveLength(team().skills.length);
  });

  it("shows dynamic workstream ownership and assignment state without profile responsibilities", () => {
    const aggregate = mission();
    const match = {
      recommendedMemberId: "member-lead",
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      matchedPreferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 3 as const,
      selectedLevel: 5 as const,
      eligibleMemberIds: ["member-lead"],
      excludedMemberIds: [],
      previousMemberId: null,
      candidateOpenAssignments: [{ memberId: "member-lead", openAssignments: 0 }],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 0,
    };
    aggregate.workstreams.push({
      workstreamId: "workstream-ui",
      kind: "delivery",
      title: "Team UI",
      objective: "Implement settings",
      deliverables: ["team-settings-sheet.tsx"],
      acceptanceCriteria: ["UI passes"],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 3,
      planRevision: 1,
      rosterSnapshotRevision: 1,
      methodologySnapshotRevision: 1,
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths", pathPrefixes: ["packages/app/src/components/teams"] },
      ownerMemberId: "member-lead",
      ownerMatchExplanation: match,
      ownerOverrideReason: null,
      reviewGate: {
        kind: "required",
        gateKey: {
          subject: { workstreamId: "workstream-ui", subjectAssignmentIds: ["assignment-ui"] },
          planRevision: 1,
        },
        gateKeyFingerprint: `sha256:${"1".repeat(64)}`,
        subjectFingerprint: `sha256:${"2".repeat(64)}`,
        requirements: {
          requiredSkillIds: ["testing"],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: [],
          minimumLevel: 2,
        },
        selection: {
          kind: "assigned",
          reviewerMemberId: "member-reviewer",
          matchExplanation: { ...match, recommendedMemberId: "member-reviewer" },
          overrideReason: null,
        },
        outcome: { kind: "pending" },
      },
      finalVerificationGate: null,
      status: "active",
    });
    aggregate.assignments.push({
      assignmentId: "assignment-ui",
      revision: 1,
      kind: "delivery",
      subjectAssignmentIds: [],
      reviewGateFingerprint: null,
      reviewSubjectFingerprint: null,
      finalVerificationGateFingerprint: null,
      reviewGateEvidence: [],
      missionId: aggregate.id,
      workstreamId: "workstream-ui",
      assigneeMemberId: "member-lead",
      runtimeAgentId: "agent-lead",
      bindingEpoch: 1,
      objective: "Implement settings",
      inputRefs: [],
      deliverables: ["team-settings-sheet.tsx"],
      acceptanceCriteria: ["UI passes"],
      mutableScope: { kind: "paths", pathPrefixes: ["packages/app/src/components/teams"] },
      dependencyAssignmentIds: [],
      priority: 1,
      planRevision: 1,
      rosterSnapshotRevision: 1,
      methodologySnapshotRevision: 1,
      supersededBy: null,
      terminationReason: null,
      scopeLease: null,
      workspaceBaseline: null,
      report: null,
      dispatchState: "dispatched",
      semanticState: "running",
      attempt: 1,
      acceptedTurnId: "turn-1",
      createdAt: "2026-08-09T00:00:00.000Z",
      dispatchedAt: "2026-08-09T00:01:00.000Z",
      settledAt: null,
    });

    expect(selectTeamPlanRows(team(), aggregate)).toEqual([
      expect.objectContaining({
        workstreamId: "workstream-ui",
        owner: expect.objectContaining({ mentionHandle: "lead" }),
        reviewer: expect.objectContaining({ mentionHandle: "reviewer" }),
        reviewSelection: "assigned",
        reviewOutcome: "pending",
        reviewSubjectAssignmentIds: ["assignment-ui"],
        assignmentStates: ["running"],
        scope: { kind: "paths", pathPrefixes: ["packages/app/src/components/teams"] },
      }),
    ]);

    const reviewGate = aggregate.workstreams[0]!.reviewGate;
    if (reviewGate.kind !== "required") throw new Error("required review gate expected");
    reviewGate.outcome = {
      kind: "waived",
      gateKeyFingerprint: reviewGate.gateKeyFingerprint,
      subjectFingerprint: reviewGate.subjectFingerprint,
      waiverId: "waiver-ui",
      decidedAt: "2026-08-09T00:02:00.000Z",
    };
    aggregate.reviewWaivers.push({
      waiverId: "waiver-ui",
      attentionId: "attention-review-ui",
      actorId: "controller-user",
      gateKey: reviewGate.gateKey,
      gateKeyFingerprint: reviewGate.gateKeyFingerprint,
      subjectFingerprint: reviewGate.subjectFingerprint,
      connectionId: "connection-1",
      selfReportedClientLabel: "paseo-app",
      reason: "No eligible reviewer is available.",
      createdAt: "2026-08-09T00:02:00.000Z",
    });

    expect(selectTeamPlanRows(team(), aggregate)[0]?.reviewWaiver).toEqual({
      waiverId: "waiver-ui",
      actorId: "controller-user",
      reason: "No eligible reviewer is available.",
    });
  });

  it("only exposes open Attention items as actionable rows", () => {
    const aggregate = mission();
    aggregate.attentionItems.push(
      {
        attentionId: "attention-open",
        kind: "provider_unavailable",
        scope: { kind: "mission" as const },
        status: "open",
        priorMissionStatus: "active",
        assignmentId: "assignment-ui",
        summary: "Provider is unavailable",
        pathEvidence: [],
        createdAt: "2026-08-09T00:00:00.000Z",
        resolution: null,
      },
      {
        attentionId: "attention-resolved",
        kind: "missing_report",
        scope: { kind: "mission" as const },
        status: "resolved",
        priorMissionStatus: "active",
        assignmentId: "assignment-ui",
        summary: "Resolved",
        pathEvidence: [],
        createdAt: "2026-08-09T00:00:00.000Z",
        resolution: {
          kind: "report_received",
          actorId: "user",
          reason: "Report arrived",
          resolvedAt: "2026-08-09T00:01:00.000Z",
          ownerAssignmentId: null,
          recoveryAssignmentId: null,
        },
      },
    );

    expect(selectTeamAttentionRows(aggregate)).toEqual([
      expect.objectContaining({
        attentionId: "attention-open",
        kind: "provider_unavailable",
        summary: "Provider is unavailable",
      }),
    ]);
  });

  it("derives final verification state and verifier only from typed gate evidence", () => {
    const aggregate = mission();
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const finalGate = {
      key: {
        workstreamId: "workstream-final-verification",
        planRevision: 1,
        methodologySnapshotRevision: 1 as const,
        subjectAssignmentIds: ["assignment-ui"],
        reviewGateFingerprints: [],
        requirements: {
          requiredSkillIds: ["testing"],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: [],
          minimumLevel: 3,
        },
      },
      fingerprint,
      selection: {
        kind: "assigned" as const,
        verifierMemberId: "member-reviewer",
        matchExplanation: {} as never,
        independenceExceptionReason: null,
      },
    };
    aggregate.workstreams = [
      {
        workstreamId: "workstream-final-verification",
        kind: "verification",
        title: "Final verification",
        objective: "Verify the Mission",
        ownerMemberId: "member-lead",
        reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        finalVerificationGate: finalGate,
        dependencyWorkstreamIds: [],
        mutableScope: { kind: "read_only" },
        status: "active",
      } as unknown as TeamMission["workstreams"][number],
    ];
    aggregate.assignments = [
      {
        assignmentId: "assignment-final-verification",
        kind: "verification",
        workstreamId: "workstream-final-verification",
        planRevision: 1,
        semanticState: "completed",
        finalVerificationGateFingerprint: fingerprint,
        reviewGateEvidence: [],
        report: {
          status: "completed",
          verdict: "approved",
          finalVerificationEvidence: {
            kind: "final_verification",
            finalGateFingerprint: fingerprint,
            verdict: "approved",
            reviewGateEvidence: [],
          },
          summary: "Final verification approved",
          artifactPaths: [],
          tests: [],
          decisions: [],
          handoffs: [],
        },
      } as unknown as TeamMission["assignments"][number],
    ];

    expect(selectTeamPlanRows(team(), aggregate)[0]).toMatchObject({
      owner: { memberId: "member-lead" },
      finalVerificationStatus: "approved",
      finalVerifier: { memberId: "member-reviewer", mentionHandle: "reviewer" },
      finalGateFingerprint: fingerprint,
      finalVerificationEvidence: {
        verdict: "approved",
        finalGateFingerprint: fingerprint,
      },
    });

    aggregate.assignments = [];
    finalGate.selection = {
      kind: "awaiting_capabilities",
      candidateMemberIds: ["member-reviewer"],
    } as never;
    expect(selectTeamPlanRows(team(), aggregate)[0]).toMatchObject({
      finalVerificationStatus: "awaiting_capabilities",
      finalVerifier: null,
      finalVerificationEvidence: null,
    });
  });

  it("attributes scoped blockers while preserving independent Workstream readiness", () => {
    const aggregate = mission();
    aggregate.workstreams = [
      {
        workstreamId: "workstream-api",
        title: "API",
        status: "blocked",
        ownerMemberId: "member-lead",
        reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        finalVerificationGate: null,
        dependencyWorkstreamIds: [],
        mutableScope: { kind: "read_only" },
      },
      {
        workstreamId: "workstream-integration",
        title: "Integration",
        status: "blocked",
        ownerMemberId: "member-lead",
        reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        finalVerificationGate: null,
        dependencyWorkstreamIds: ["workstream-api"],
        mutableScope: { kind: "read_only" },
      },
      {
        workstreamId: "workstream-ui",
        title: "UI",
        status: "ready",
        ownerMemberId: "member-lead",
        reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        finalVerificationGate: null,
        dependencyWorkstreamIds: [],
        mutableScope: { kind: "read_only" },
      },
    ] as unknown as TeamMission["workstreams"];
    aggregate.attentionItems = [
      {
        attentionId: "attention-api",
        kind: "review_gate_capability_unknown",
        scope: {
          kind: "workstream",
          workstreamId: "workstream-api",
          blockDependents: true,
        },
        status: "open",
        priorMissionStatus: null,
        assignmentId: null,
        summary: "API capability facts are unknown",
        pathEvidence: [],
        createdAt: "2026-08-09T00:00:00.000Z",
        resolution: null,
        reviewGateDetails: {} as never,
      },
    ];

    expect(selectTeamPlanRows(team(), aggregate)).toEqual([
      expect.objectContaining({
        workstreamId: "workstream-api",
        status: "blocked",
        blockers: [
          expect.objectContaining({
            attentionId: "attention-api",
            kind: "review_gate_capability_unknown",
            sourceWorkstreamId: "workstream-api",
            direct: true,
          }),
        ],
      }),
      expect.objectContaining({
        workstreamId: "workstream-integration",
        status: "blocked",
        blockers: [
          expect.objectContaining({
            attentionId: "attention-api",
            sourceWorkstreamId: "workstream-api",
            direct: false,
          }),
        ],
      }),
      expect.objectContaining({ workstreamId: "workstream-ui", status: "ready", blockers: [] }),
    ]);
    expect(selectTeamAttentionRows(aggregate)).toEqual([
      expect.objectContaining({
        attentionId: "attention-api",
        scope: "workstream",
        workstreamId: "workstream-api",
        workstreamTitle: "API",
      }),
    ]);
  });
});
