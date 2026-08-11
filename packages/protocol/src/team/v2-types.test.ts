import { describe, expect, it } from "vitest";
import {
  MissionAssignmentContractSchema,
  MissionAttentionItemSchema,
  MissionRosterSnapshotSchema,
  MissionScopeLeaseSchema,
  MissionWorkspaceAuditPolicySchema,
  MissionWorkstreamPlanSnapshotSchema,
  MissionWorkstreamSchema,
  TeamLifecycleRecoveryFailureSchema,
  TeamMemberProfileSchema,
  TeamMissionSchema,
  TeamV2Schema,
} from "./v2-types.js";

describe("reusable team", () => {
  it("rejects incomplete member profiles", () => {
    const member = {
      memberId: "member-engineer",
      role: "Software engineer",
      level: 3,
      skillIds: ["typescript"],
      executionProfile: {
        provider: "codex" as const,
        model: "gpt-5.6-sol",
        modeId: null,
        thinkingOptionId: "high",
        featureValues: {},
      },
      mentionHandle: "engineer",
    };

    expect(TeamMemberProfileSchema.parse(member)).toEqual(member);
    expect(TeamMemberProfileSchema.safeParse({ ...member, level: null }).success).toBe(false);
    expect(TeamMemberProfileSchema.safeParse({ ...member, skillIds: [] }).success).toBe(false);
    expect(TeamMemberProfileSchema.safeParse({ ...member, executionProfile: null }).success).toBe(
      false,
    );
  });

  it("stores member profiles without starting a mission or agent session", () => {
    const team = {
      id: "team-platform",
      name: "Platform team",
      workspaceId: "wks-platform",
      leadMemberId: "member-architect",
      skills: [
        {
          skillId: "typescript",
          name: "TypeScript",
          description: "Design and implement production TypeScript systems.",
        },
      ],
      members: [
        {
          memberId: "member-architect",
          role: "Software architect",
          level: 5,
          skillIds: ["typescript"],
          executionProfile: {
            provider: "codex",
            model: "gpt-5.6-sol",
            modeId: null,
            thinkingOptionId: "high",
            featureValues: {},
          },
          mentionHandle: "architect",
        },
      ],
      lifecycle: "active" as const,
      activeMissionId: null,
      lifecycleRecoveryFailure: null,
      revision: 1,
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T10:00:00.000Z",
      archivedAt: null,
    };

    const parsed = TeamV2Schema.parse(team);

    expect(parsed).toEqual(team);
    expect(parsed).not.toHaveProperty("task");
    expect(parsed.members[0]).not.toHaveProperty("agentId");
  });
});

describe("team mission", () => {
  it("represents recoverable mission attention separately from terminal failure", () => {
    expect(TeamMissionSchema.shape.status.safeParse("needs_attention").success).toBe(true);
  });

  it("exposes durable lifecycle recovery failures with one retry action", () => {
    const failure = {
      operation: "mission_finish" as const,
      intentId: "finish-mission-sdk",
      idempotencyKey: "cancel-mission-sdk",
      code: "lifecycle_recovery_failed",
      message: "Participant cleanup failed.",
      retryAction: "cancel_mission" as const,
      attempts: 2,
      failedAt: "2026-08-07T11:03:00.000Z",
    };

    expect(TeamLifecycleRecoveryFailureSchema.parse(failure)).toEqual(failure);
  });

  it("stores auditable resolution of a workspace ownership violation", () => {
    const attention = {
      attentionId: "attention-unowned-path",
      kind: "ownership_violation" as const,
      status: "resolved" as const,
      priorMissionStatus: "active" as const,
      assignmentId: "assignment-mission-schema",
      summary: "A changed path had no unique owner.",
      pathEvidence: [
        {
          path: "packages/server/src/server/team/runtime.ts",
          fingerprint: "sha256:changed",
        },
      ],
      createdAt: "2026-08-07T11:05:00.000Z",
      resolution: {
        kind: "attribute_owner" as const,
        actorId: "user-owner",
        reason: "The change belongs to the server delivery Assignment.",
        ownerAssignmentId: "assignment-server",
        recoveryAssignmentId: null,
        resolvedAt: "2026-08-07T11:06:00.000Z",
      },
    };

    expect(MissionAttentionItemSchema.parse(attention)).toEqual(attention);
  });

  it("parses a durable Assignment replan Attention item", () => {
    const attention = {
      attentionId: "attention-assignment-replan",
      kind: "assignment_requires_replan" as const,
      status: "open" as const,
      priorMissionStatus: "active" as const,
      assignmentId: "assignment-server",
      summary: "The accepted Assignment reported a durable blocker.",
      pathEvidence: [],
      createdAt: "2026-08-07T11:05:00.000Z",
      resolution: null,
    };

    expect(MissionAttentionItemSchema.parse(attention)).toEqual(attention);
  });

  it("freezes a versioned roster with provider and tool capabilities", () => {
    const snapshot = {
      revision: 1,
      teamRevision: 3,
      leadMemberId: "member-engineer",
      reason: "initial" as const,
      skills: [
        {
          skillId: "typescript",
          name: "TypeScript",
          description: "Implement TypeScript systems.",
        },
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
            thinkingOptionId: "high",
            featureValues: {},
          },
          mentionHandle: "engineer",
          runtimeSnapshot: {
            providerAvailable: true,
            toolIds: ["mission_status", "assignment_report"],
            capabilityIds: ["structured-tools"],
          },
        },
      ],
      createdAt: "2026-08-07T11:00:00.000Z",
    };

    expect(MissionRosterSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    const { leadMemberId: _, ...withoutLead } = snapshot;
    expect(MissionRosterSnapshotSchema.safeParse(withoutLead).success).toBe(false);
  });

  it("keeps recovery and audit policy leaves forward-compatible", () => {
    expect(
      MissionScopeLeaseSchema.safeParse({
        leaseId: "lease-forward-compatible",
        workspaceId: "workspace-platform",
        assignmentId: "assignment-forward-compatible",
        scope: { kind: "workspace" },
        state: "report_hold",
        acquiredAt: "2026-08-07T11:00:00.000Z",
        transitionedAt: "2026-08-07T11:01:00.000Z",
        capturedDelta: [],
        recoveryAttempts: 3,
      }).success,
    ).toBe(true);
    expect(
      MissionWorkspaceAuditPolicySchema.safeParse({
        revision: 2,
        includeTrackedPaths: true,
        includeNonIgnoredUntrackedPaths: true,
        includeDeclaredArtifactPaths: false,
        excludeGitignoredPathsByDefault: true,
        excludedPathPrefixes: [],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed timestamps and invalid member levels", () => {
    expect(
      TeamMemberProfileSchema.safeParse({
        memberId: "member-invalid",
        role: "Engineer",
        level: 99,
        skillIds: ["typescript"],
        executionProfile: {
          provider: "codex",
          model: null,
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
        mentionHandle: "invalid",
      }).success,
    ).toBe(false);
    expect(
      TeamV2Schema.safeParse({
        id: "team-invalid-time",
        name: "Invalid time",
        workspaceId: "workspace-platform",
        leadMemberId: "member-lead",
        skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
        members: [
          {
            memberId: "member-lead",
            role: "Lead",
            level: 4,
            skillIds: ["typescript"],
            executionProfile: {
              provider: "codex",
              model: null,
              modeId: null,
              thinkingOptionId: null,
              featureValues: {},
            },
            mentionHandle: "lead",
          },
        ],
        lifecycle: "active",
        activeMissionId: null,
        lifecycleRecoveryFailure: null,
        revision: 1,
        createdAt: "not-a-time",
        updatedAt: "not-a-time",
        archivedAt: null,
      }).success,
    ).toBe(false);
  });

  it("persists independent owner and reviewer requirements with auditable matches", () => {
    const explanation = {
      recommendedMemberId: "member-engineer",
      requiredSkillIds: ["typescript"],
      preferredSkillIds: ["protocol"],
      matchedPreferredSkillIds: ["protocol"],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
      selectedLevel: 4,
      eligibleMemberIds: ["member-engineer", "member-reviewer"],
      excludedMemberIds: [],
      previousMemberId: null,
      candidateOpenAssignments: [
        { memberId: "member-engineer", openAssignments: 0 },
        { memberId: "member-reviewer", openAssignments: 0 },
      ],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 0,
    };
    const workstream = {
      workstreamId: "workstream-protocol",
      kind: "delivery" as const,
      title: "Protocol contract",
      objective: "Define the additive Mission contract.",
      deliverables: ["Mission schemas"],
      acceptanceCriteria: ["The Team Mission schema contract parses."],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: ["protocol"],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
      planRevision: 2,
      rosterSnapshotRevision: 1,
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/protocol/src/team"] },
      ownerMemberId: "member-engineer",
      ownerMatchExplanation: explanation,
      ownerOverrideReason: null,
      reviewPolicy: "required" as const,
      reviewerRequirements: {
        requiredSkillIds: ["review"],
        preferredSkillIds: ["protocol"],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 4,
      },
      reviewerMemberId: "member-reviewer",
      reviewerMatchExplanation: {
        ...explanation,
        recommendedMemberId: "member-reviewer",
        requiredSkillIds: ["review"],
        excludedMemberIds: ["member-engineer"],
        rosterIndex: 1,
      },
      reviewerOverrideReason: null,
      status: "planned" as const,
    };

    expect(MissionWorkstreamSchema.parse(workstream)).toEqual(workstream);
    expect(
      MissionWorkstreamPlanSnapshotSchema.parse({
        planRevision: 2,
        workstreams: [workstream],
        createdAt: "2026-08-07T11:10:00.000Z",
      }),
    ).toEqual({
      planRevision: 2,
      workstreams: [workstream],
      createdAt: "2026-08-07T11:10:00.000Z",
    });
    expect(
      MissionWorkstreamPlanSnapshotSchema.safeParse({
        planRevision: 0,
        workstreams: [workstream],
        createdAt: "2026-08-07T11:10:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("stores dynamic ownership and a structured assignment outside member profiles", () => {
    const mission = {
      id: "mission-sdk",
      teamId: "team-platform",
      workspaceId: "wks-platform",
      objective: "Add an SDK endpoint for Team missions.",
      constraints: ["Keep the Team Mission protocol internally consistent."],
      acceptanceCriteria: ["Protocol and domain tests pass."],
      status: "active" as const,
      suspendedStatus: null,
      activeRosterSnapshotRevision: 1,
      rosterSnapshots: [
        {
          revision: 1,
          teamRevision: 1,
          leadMemberId: "member-engineer",
          reason: "initial" as const,
          skills: [
            {
              skillId: "typescript",
              name: "TypeScript",
              description: "Design and implement production TypeScript systems.",
            },
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
                thinkingOptionId: "high",
                featureValues: {},
              },
              mentionHandle: "engineer",
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
      planRevision: 2,
      revision: 3,
      workspaceAuditPolicy: {
        revision: 1,
        includeTrackedPaths: true as const,
        includeNonIgnoredUntrackedPaths: true as const,
        includeDeclaredArtifactPaths: true as const,
        excludeGitignoredPathsByDefault: true as const,
        excludedPathPrefixes: [".git", ".dev/paseo-home"],
      },
      chatRoomId: "room-mission-sdk",
      participants: [
        {
          memberId: "member-engineer",
          agentId: "agent-mission-engineer",
          bindingEpoch: 1,
          joinedAt: "2026-08-07T11:00:00.000Z",
          archivedAt: null,
        },
      ],
      workstreams: [
        {
          workstreamId: "workstream-protocol",
          kind: "delivery" as const,
          title: "Protocol contract",
          objective: "Define the additive Mission contract.",
          deliverables: ["Mission schemas"],
          acceptanceCriteria: ["The Team Mission schema contract parses."],
          requiredSkillIds: ["typescript"],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: ["structured-tools"],
          minimumLevel: 3,
          planRevision: 2,
          rosterSnapshotRevision: 1,
          dependencyWorkstreamIds: [],
          mutableScope: {
            kind: "paths" as const,
            pathPrefixes: ["packages/protocol/src/team"],
          },
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
            candidateOpenAssignments: [{ memberId: "member-engineer", openAssignments: 0 }],
            continuedPreviousMember: false,
            openAssignments: 0,
            rosterIndex: 0,
          },
          ownerOverrideReason: null,
          reviewPolicy: "none" as const,
          reviewerRequirements: null,
          reviewerMemberId: null,
          reviewerMatchExplanation: null,
          reviewerOverrideReason: null,
          status: "active" as const,
        },
      ],
      workstreamPlanSnapshots: [],
      assignments: [
        {
          assignmentId: "assignment-mission-schema",
          revision: 2,
          kind: "delivery" as const,
          subjectAssignmentIds: [],
          missionId: "mission-sdk",
          workstreamId: "workstream-protocol",
          assigneeMemberId: "member-engineer",
          runtimeAgentId: "agent-mission-engineer",
          bindingEpoch: 1,
          objective: "Implement and test the Mission schemas.",
          inputRefs: [".codestable/epics/agent-teams.md"],
          deliverables: ["packages/protocol/src/team/v2-types.ts"],
          acceptanceCriteria: ["The focused protocol test passes."],
          mutableScope: {
            kind: "paths" as const,
            pathPrefixes: ["packages/protocol/src/team"],
          },
          dependencyAssignmentIds: [],
          priority: 1,
          planRevision: 2,
          rosterSnapshotRevision: 1,
          supersededBy: null,
          terminationReason: null,
          scopeLease: null,
          workspaceBaseline: {
            baselineId: "baseline-assignment-mission-schema",
            workspaceId: "wks-platform",
            assignmentId: "assignment-mission-schema",
            policyRevision: 1,
            capturedAt: "2026-08-07T11:01:30.000Z",
            entries: [
              {
                path: "packages/protocol/src/team/v2-types.ts",
                fingerprint: "sha256:before",
                classification: "tracked" as const,
              },
            ],
          },
          report: null,
          dispatchState: "dispatched" as const,
          semanticState: "running" as const,
          attempt: 1,
          acceptedTurnId: "turn-1",
          createdAt: "2026-08-07T11:01:00.000Z",
          dispatchedAt: "2026-08-07T11:02:00.000Z",
          settledAt: null,
        },
      ],
      attentionItems: [],
      lifecycleRecoveryFailure: null,
      createdAt: "2026-08-07T11:00:00.000Z",
      updatedAt: "2026-08-07T11:02:00.000Z",
      completedAt: null,
    };

    expect(TeamMissionSchema.parse(mission)).toEqual(mission);
  });

  it("carries a structured completion report instead of relying on turn text", () => {
    const assignment = {
      assignmentId: "assignment-mission-schema",
      revision: 1,
      kind: "delivery" as const,
      subjectAssignmentIds: [],
      missionId: "mission-sdk",
      workstreamId: "workstream-protocol",
      assigneeMemberId: "member-engineer",
      runtimeAgentId: "agent-mission-engineer",
      bindingEpoch: 1,
      objective: "Implement and test the Mission schemas.",
      inputRefs: [],
      deliverables: ["packages/protocol/src/team/v2-types.ts"],
      acceptanceCriteria: ["The focused protocol test passes."],
      mutableScope: {
        kind: "paths" as const,
        pathPrefixes: ["packages/protocol/src/team"],
      },
      dependencyAssignmentIds: [],
      priority: 1,
      planRevision: 2,
      rosterSnapshotRevision: 1,
      supersededBy: null,
      terminationReason: null,
      scopeLease: null,
      workspaceBaseline: {
        baselineId: "baseline-assignment-mission-schema",
        workspaceId: "wks-platform",
        assignmentId: "assignment-mission-schema",
        policyRevision: 1,
        capturedAt: "2026-08-07T11:01:30.000Z",
        entries: [],
      },
      report: {
        status: "completed" as const,
        verdict: null,
        summary: "Added the additive v2 schemas.",
        artifactPaths: ["packages/protocol/src/team/v2-types.ts"],
        tests: [{ command: "npx vitest run v2-types.test.ts", passed: true }],
        decisions: ["Kept the v1 Team schema unchanged."],
        handoffs: [
          {
            targetWorkstreamId: "workstream-server",
            summary: "Consume TeamMissionSchema from the protocol package.",
            artifactPaths: ["packages/protocol/src/team/v2-types.ts"],
          },
        ],
      },
      dispatchState: "settled" as const,
      semanticState: "completed" as const,
      attempt: 1,
      acceptedTurnId: "turn-1",
      createdAt: "2026-08-07T11:01:00.000Z",
      dispatchedAt: "2026-08-07T11:02:00.000Z",
      settledAt: "2026-08-07T11:05:00.000Z",
    };

    expect(MissionAssignmentContractSchema.parse(assignment)).toEqual(assignment);
  });

  it("keeps plan-change cancellation additive on the Assignment wire shape", () => {
    const oldShape = {
      assignmentId: "assignment-review-canceled",
      revision: 2,
      kind: "review" as const,
      subjectAssignmentIds: ["assignment-delivery"],
      missionId: "mission-sdk",
      workstreamId: "workstream-protocol",
      assigneeMemberId: "member-reviewer",
      runtimeAgentId: null,
      bindingEpoch: null,
      objective: "Review the Mission schemas.",
      inputRefs: ["assignment-report:assignment-delivery"],
      deliverables: ["Review report"],
      acceptanceCriteria: ["The schema remains compatible."],
      mutableScope: { kind: "read_only" as const },
      dependencyAssignmentIds: ["assignment-delivery"],
      priority: 1,
      planRevision: 2,
      rosterSnapshotRevision: 1,
      supersededBy: null,
      terminationReason: "mission_canceled" as const,
      scopeLease: null,
      workspaceBaseline: null,
      report: null,
      dispatchState: "queued" as const,
      semanticState: "canceled" as const,
      attempt: 1,
      acceptedTurnId: null,
      createdAt: "2026-08-07T11:01:00.000Z",
      dispatchedAt: null,
      settledAt: "2026-08-07T11:05:00.000Z",
    };
    const planChanged = {
      ...oldShape,
      terminationReason: null,
      planChangeReason: "quality_gate_no_longer_required" as const,
    };

    expect(MissionAssignmentContractSchema.parse(oldShape)).toEqual(oldShape);
    expect(MissionAssignmentContractSchema.parse(planChanged)).toEqual(planChanged);
    expect(
      MissionAssignmentContractSchema.safeParse({
        ...planChanged,
        planChangeReason: "unrecognized_plan_change",
      }).success,
    ).toBe(false);
  });

  it("carries actionable reports when work is blocked or fails", () => {
    const base = {
      assignmentId: "assignment-integration",
      revision: 1,
      kind: "delivery" as const,
      subjectAssignmentIds: [],
      missionId: "mission-sdk",
      workstreamId: "workstream-integration",
      assigneeMemberId: "member-engineer",
      runtimeAgentId: "agent-mission-engineer",
      bindingEpoch: 1,
      objective: "Integrate the Mission schemas.",
      inputRefs: [],
      deliverables: ["Server integration"],
      acceptanceCriteria: ["The integration test passes."],
      mutableScope: { kind: "workspace" as const },
      dependencyAssignmentIds: [],
      priority: 1,
      planRevision: 2,
      rosterSnapshotRevision: 1,
      supersededBy: null,
      terminationReason: null,
      scopeLease: null,
      workspaceBaseline: {
        baselineId: "baseline-assignment-integration",
        workspaceId: "wks-platform",
        assignmentId: "assignment-integration",
        policyRevision: 1,
        capturedAt: "2026-08-07T11:01:30.000Z",
        entries: [],
      },
      dispatchState: "settled" as const,
      attempt: 1,
      acceptedTurnId: "turn-2",
      createdAt: "2026-08-07T11:01:00.000Z",
      dispatchedAt: "2026-08-07T11:02:00.000Z",
      settledAt: "2026-08-07T11:05:00.000Z",
    };

    for (const status of ["blocked", "failed"] as const) {
      const assignment = {
        ...base,
        semanticState: status,
        report: {
          status,
          summary: "The required server contract is not available.",
          blockers: ["mission.start.request has not been implemented."],
          artifactPaths: [],
          tests: [{ command: "npx vitest run integration.test.ts", passed: false }],
          decisions: [],
          handoffs: [],
        },
      };
      expect(MissionAssignmentContractSchema.parse(assignment)).toEqual(assignment);
    }
  });
});
