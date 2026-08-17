import { describe, expect, it } from "vitest";
import {
  MissionAssignmentContractSchema,
  MissionAttentionItemSchema,
  MissionFinalVerificationEvidenceSchema,
  MissionFinalVerificationGateSchema,
  MissionRosterSnapshotSchema,
  MissionReviewWaiverSchema,
  MissionScopeLeaseSchema,
  MissionWorkspaceAuditPolicySchema,
  MissionWorkstreamPlanSnapshotSchema,
  MissionWorkstreamSchema,
  TeamLifecycleRecoveryFailureSchema,
  TeamMemberProfileSchema,
  TeamMissionSchema,
  TeamV2Schema,
} from "./v2-types.js";

const testDigest = `sha256:${"0".repeat(64)}`;
const testMethodologySnapshot = {
  revision: 1 as const,
  ref: { bundleId: "paseo/standard", version: "1", digest: testDigest },
  compilerVersion: 1 as const,
  teamRevision: 1,
  rosterSnapshotRevision: 1,
  hardPolicy: {
    review: {
      writableWorkstreams: "lead_discretion" as const,
      independentMeans: "different_from_subject_owner" as const,
      unavailable: "review_gate_reviewer_unavailable_attention" as const,
      unknownCapabilities: "review_gate_capability_unknown_attention" as const,
      operatorWaiver: "allowed_with_reason" as const,
    },
    verification: {
      required: true as const,
      mutableScope: "read_only" as const,
      reviewerSelection: "prefer_independent_record_exception" as const,
      operatorWaiver: "forbidden" as const,
    },
  },
  promptSections: [],
  hardPolicyDigest: testDigest,
  promptDigest: testDigest,
  compiledDigest: testDigest,
};

describe("reusable team", () => {
  it("persists an Assignment-independent final verification gate and typed evidence", () => {
    const matchExplanation = {
      recommendedMemberId: "member-verifier",
      requiredSkillIds: ["verification"],
      preferredSkillIds: ["protocol"],
      matchedPreferredSkillIds: ["protocol"],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
      selectedLevel: 4,
      eligibleMemberIds: ["member-verifier"],
      excludedMemberIds: [],
      previousMemberId: null,
      candidateOpenAssignments: [{ memberId: "member-verifier", openAssignments: 0 }],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 0,
    };
    const gate = {
      key: {
        workstreamId: "workstream-verification",
        planRevision: 2,
        methodologySnapshotRevision: 1,
        subjectAssignmentIds: ["assignment-delivery", "assignment-review"],
        reviewGateFingerprints: [testDigest],
        requirements: {
          requiredSkillIds: ["verification"],
          preferredSkillIds: ["protocol"],
          requiredRuntimeCapabilityIds: ["structured-tools"],
          minimumLevel: 4,
        },
      },
      fingerprint: testDigest,
      selection: {
        kind: "assigned" as const,
        verifierMemberId: "member-verifier",
        matchExplanation,
        independenceExceptionReason: null,
      },
    };
    const reviewGateEvidence = [
      {
        kind: "approved" as const,
        gateKey: {
          subject: {
            workstreamId: "workstream-delivery",
            subjectAssignmentIds: ["assignment-delivery"],
          },
          planRevision: 2,
        },
        gateKeyFingerprint: testDigest,
        subjectFingerprint: testDigest,
        reviewAssignmentId: "assignment-review",
        reportFingerprint: testDigest,
        inheritedFromGateFingerprint: null,
      },
    ];
    const evidence = {
      kind: "final_verification" as const,
      finalGateFingerprint: testDigest,
      verdict: "approved" as const,
      reviewGateEvidence,
    };

    expect(MissionFinalVerificationGateSchema.parse(gate)).toEqual(gate);
    expect(MissionFinalVerificationEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(
      MissionFinalVerificationGateSchema.safeParse({
        ...gate,
        selection: { kind: "awaiting_capabilities", candidateMemberIds: [] },
      }).success,
    ).toBe(false);
    expect(
      MissionFinalVerificationGateSchema.safeParse({ ...gate, fingerprint: undefined }).success,
    ).toBe(false);
  });

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
      creationWorkspaceId: "wks-platform",
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
      methodologyBinding: {
        ref: {
          bundleId: "paseo/standard",
          version: "1",
          digest: `sha256:${"0".repeat(64)}`,
        },
        presetId: "lean-delivery",
        memberArchetypeBindings: [{ memberId: "member-architect", archetypeId: "lead" }],
        skillBindings: [{ teamSkillId: "typescript", methodologySkillId: null }],
      },
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

  it("persists review waivers with controller attribution and exact gate identity", () => {
    const waiver = {
      waiverId: "waiver-api",
      attentionId: "attention-review-api",
      gateKey: {
        subject: { workstreamId: "workstream-api", subjectAssignmentIds: ["assignment-api"] },
        planRevision: 1,
      },
      gateKeyFingerprint: testDigest,
      subjectFingerprint: testDigest,
      connectionId: "connection-1",
      selfReportedClientLabel: "paseo-app",
      reason: "No structurally eligible reviewer is available.",
      createdAt: "2026-08-07T11:09:00.000Z",
    };

    expect(MissionReviewWaiverSchema.parse(waiver)).toEqual(waiver);
  });

  it("persists a workstream-scoped review waiver Attention resolution", () => {
    const attention = {
      attentionId: "attention-review-api",
      kind: "review_gate_reviewer_unavailable" as const,
      scope: {
        kind: "workstream" as const,
        workstreamId: "workstream-api",
        blockDependents: true as const,
      },
      reviewGateDetails: {
        gateKey: {
          subject: { workstreamId: "workstream-api", subjectAssignmentIds: ["assignment-api"] },
          planRevision: 1,
        },
        gateKeyFingerprint: testDigest,
        subjectFingerprint: testDigest,
      },
      status: "resolved" as const,
      priorMissionStatus: null,
      assignmentId: null,
      summary: "No structurally eligible reviewer is available.",
      pathEvidence: [],
      createdAt: "2026-08-07T11:08:00.000Z",
      resolution: {
        kind: "waive_review" as const,
        idempotencyKey: "waive-review-1",
        gateKeyFingerprint: testDigest,
        subjectFingerprint: testDigest,
        connectionId: "connection-1",
        selfReportedClientLabel: "paseo-app",
        reason: "No structurally eligible reviewer is available.",
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
        resolvedAt: "2026-08-07T11:09:00.000Z",
      },
    };

    expect(MissionAttentionItemSchema.parse(attention)).toEqual(attention);
    expect(
      MissionAttentionItemSchema.safeParse({
        ...attention,
        reviewGateDetails: undefined,
      }).success,
    ).toBe(false);
  });

  it("separates known-empty and capability-unknown Workstream Attention kinds", () => {
    const common = {
      attentionId: "attention-review-api",
      scope: {
        kind: "workstream" as const,
        workstreamId: "workstream-api",
        blockDependents: true as const,
      },
      reviewGateDetails: {
        gateKey: {
          subject: { workstreamId: "workstream-api", subjectAssignmentIds: ["assignment-api"] },
          planRevision: 1,
        },
        gateKeyFingerprint: testDigest,
        subjectFingerprint: testDigest,
      },
      status: "open" as const,
      priorMissionStatus: null,
      assignmentId: null,
      summary: "Review gate is structurally blocked.",
      pathEvidence: [],
      createdAt: "2026-08-07T11:08:00.000Z",
      resolution: null,
    };

    expect(
      MissionAttentionItemSchema.parse({
        ...common,
        kind: "review_gate_reviewer_unavailable",
      }).kind,
    ).toBe("review_gate_reviewer_unavailable");
    expect(
      MissionAttentionItemSchema.parse({
        ...common,
        kind: "review_gate_capability_unknown",
      }).kind,
    ).toBe("review_gate_capability_unknown");
    expect(
      MissionAttentionItemSchema.safeParse({
        ...common,
        kind: "review_gate_capability_unknown",
        scope: { kind: "mission" },
      }).success,
    ).toBe(false);
    expect(
      MissionAttentionItemSchema.safeParse({
        ...common,
        kind: "review_gate_capability_unknown",
        priorMissionStatus: "active",
      }).success,
    ).toBe(false);
  });

  it("makes final verifier Attention Workstream-scoped and non-waivable", () => {
    const common = {
      attentionId: "attention-final-verification",
      scope: {
        kind: "workstream" as const,
        workstreamId: "workstream-final-verification",
        blockDependents: true as const,
      },
      finalVerificationGateDetails: {
        gateKey: {
          workstreamId: "workstream-final-verification",
          planRevision: 2,
          methodologySnapshotRevision: 1 as const,
          subjectAssignmentIds: ["assignment-api"],
          reviewGateFingerprints: [testDigest],
          requirements: {
            requiredSkillIds: ["verification"],
            preferredSkillIds: [],
            requiredRuntimeCapabilityIds: ["structured-tools"],
            minimumLevel: 4,
          },
        },
        gateFingerprint: testDigest,
      },
      status: "open" as const,
      priorMissionStatus: null,
      assignmentId: null,
      summary: "Final verifier selection is blocked.",
      pathEvidence: [],
      createdAt: "2026-08-07T11:08:00.000Z",
      resolution: null,
    };

    expect(
      MissionAttentionItemSchema.parse({ ...common, kind: "final_verifier_unavailable" }).kind,
    ).toBe("final_verifier_unavailable");
    expect(
      MissionAttentionItemSchema.parse({
        ...common,
        kind: "final_verifier_capability_unknown",
      }).kind,
    ).toBe("final_verifier_capability_unknown");
    expect(
      MissionAttentionItemSchema.safeParse({
        ...common,
        kind: "final_verifier_unavailable",
        status: "resolved",
        resolution: {
          kind: "waive_review",
          idempotencyKey: "waive-final",
          gateKeyFingerprint: `sha256:${"a".repeat(64)}`,
          subjectFingerprint: `sha256:${"b".repeat(64)}`,
          connectionId: "connection-1",
          selfReportedClientLabel: "paseo-app",
          reason: "Skip final verification.",
          ownerAssignmentId: null,
          recoveryAssignmentId: null,
          resolvedAt: "2026-08-07T11:09:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("requires the unshipped V1 Mission waiver collection", () => {
    expect(TeamMissionSchema.shape.reviewWaivers.safeParse(undefined).success).toBe(false);
  });

  it("stores auditable resolution of a workspace ownership violation", () => {
    const attention = {
      attentionId: "attention-unowned-path",
      kind: "ownership_violation" as const,
      scope: { kind: "mission" as const },
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
      scope: { kind: "mission" as const },
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
          capabilityFacts: {
            kind: "known" as const,
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
      methodologySnapshotRevision: 1,
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/protocol/src/team"] },
      ownerMemberId: "member-engineer",
      ownerMatchExplanation: explanation,
      ownerOverrideReason: null,
      reviewGate: {
        kind: "required" as const,
        gateKey: {
          subject: { workstreamId: "workstream-protocol", subjectAssignmentIds: [] },
          planRevision: 2,
        },
        gateKeyFingerprint: testDigest,
        subjectFingerprint: testDigest,
        requirements: {
          requiredSkillIds: ["review"],
          preferredSkillIds: ["protocol"],
          requiredRuntimeCapabilityIds: ["structured-tools"],
          minimumLevel: 4,
        },
        selection: {
          kind: "assigned" as const,
          reviewerMemberId: "member-reviewer",
          matchExplanation: {
            ...explanation,
            recommendedMemberId: "member-reviewer",
            requiredSkillIds: ["review"],
            excludedMemberIds: ["member-engineer"],
            rosterIndex: 1,
          },
          overrideReason: null,
        },
        outcome: { kind: "pending" as const },
      },
      finalVerificationGate: null,
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
    expect(
      MissionWorkstreamSchema.safeParse({
        ...workstream,
        finalVerificationGate: undefined,
      }).success,
    ).toBe(false);
    expect(
      MissionWorkstreamSchema.parse({
        ...workstream,
        kind: "verification",
        mutableScope: { kind: "read_only" },
        finalVerificationGate: {
          key: {
            workstreamId: workstream.workstreamId,
            planRevision: workstream.planRevision,
            methodologySnapshotRevision: 1,
            subjectAssignmentIds: [],
            reviewGateFingerprints: [],
            requirements: {
              requiredSkillIds: workstream.requiredSkillIds,
              preferredSkillIds: workstream.preferredSkillIds,
              requiredRuntimeCapabilityIds: workstream.requiredRuntimeCapabilityIds,
              minimumLevel: workstream.minimumLevel,
            },
          },
          fingerprint: testDigest,
          selection: { kind: "awaiting_verifier" },
        },
      }).finalVerificationGate,
    ).not.toBeNull();
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
      methodologySnapshot: testMethodologySnapshot,
      methodologyCompiledAt: "2026-08-07T11:00:00.000Z",
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
              capabilityFacts: {
                kind: "known" as const,
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
          methodologySnapshotRevision: 1,
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
          reviewGate: { kind: "none" as const, outcome: { kind: "not_required" as const } },
          finalVerificationGate: null,
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
          reviewGateFingerprint: null,
          reviewSubjectFingerprint: null,
          finalVerificationGateFingerprint: null,
          reviewGateEvidence: [],
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
          methodologySnapshotRevision: 1,
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
      reviewWaivers: [],
      capabilityReplanRequests: [],
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
      reviewGateFingerprint: null,
      reviewSubjectFingerprint: null,
      finalVerificationGateFingerprint: null,
      reviewGateEvidence: [],
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
      methodologySnapshotRevision: 1,
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
        finalVerificationEvidence: null,
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
    expect(
      MissionAssignmentContractSchema.safeParse({
        ...assignment,
        finalVerificationGateFingerprint: undefined,
      }).success,
    ).toBe(false);
  });

  it("keeps plan-change cancellation additive on the Assignment wire shape", () => {
    const oldShape = {
      assignmentId: "assignment-review-canceled",
      revision: 2,
      kind: "review" as const,
      subjectAssignmentIds: ["assignment-delivery"],
      reviewGateFingerprint: testDigest,
      reviewSubjectFingerprint: testDigest,
      finalVerificationGateFingerprint: null,
      reviewGateEvidence: [],
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
      methodologySnapshotRevision: 1,
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
      reviewGateFingerprint: null,
      reviewSubjectFingerprint: null,
      finalVerificationGateFingerprint: null,
      reviewGateEvidence: [],
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
      methodologySnapshotRevision: 1,
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
