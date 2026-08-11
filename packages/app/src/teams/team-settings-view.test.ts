import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  selectTeamAttentionRecovery,
  selectTeamAttentionRows,
  selectTeamMemberSettingsRows,
  selectTeamMissionHistory,
  selectTeamPlanRows,
} from "@/teams/team-settings-view";

function team(): TeamV2 {
  return {
    id: "team-1",
    name: "Release team",
    workspaceId: "workspace-1",
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
      runtimeSnapshot: { providerAvailable: true, toolIds: [], capabilityIds: [] },
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
        runtimeSnapshot: { providerAvailable: false, toolIds: [], capabilityIds: [] },
      },
      {
        ...template,
        memberId: "member-unknown",
        mentionHandle: "reviewer-5",
        runtimeSnapshot: null,
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
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths", pathPrefixes: ["packages/app/src/components/teams"] },
      ownerMemberId: "member-lead",
      ownerMatchExplanation: match,
      ownerOverrideReason: null,
      reviewPolicy: "required",
      reviewerRequirements: {
        requiredSkillIds: ["testing"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: [],
        minimumLevel: 2,
      },
      reviewerMemberId: "member-reviewer",
      reviewerMatchExplanation: { ...match, recommendedMemberId: "member-reviewer" },
      reviewerOverrideReason: null,
      status: "active",
    });
    aggregate.assignments.push({
      assignmentId: "assignment-ui",
      revision: 1,
      kind: "delivery",
      subjectAssignmentIds: [],
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
        assignmentStates: ["running"],
        scope: { kind: "paths", pathPrefixes: ["packages/app/src/components/teams"] },
      }),
    ]);
  });

  it("only exposes open Attention items as actionable rows", () => {
    const aggregate = mission();
    aggregate.attentionItems.push(
      {
        attentionId: "attention-open",
        kind: "provider_unavailable",
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
});
