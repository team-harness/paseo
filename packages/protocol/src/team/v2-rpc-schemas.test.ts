import { describe, expect, it } from "vitest";

import {
  TeamMissionAttentionResolveRequestSchema,
  TeamMissionAttentionResolveResponseSchema,
  TeamMissionCancelRequestSchema,
  TeamMissionCancelResponseSchema,
  TeamMissionCapabilityRefreshRequestSchema,
  TeamMissionCapabilityRefreshResponseSchema,
  TeamMissionInspectRequestSchema,
  TeamMissionInspectResponseSchema,
  TeamMissionListRequestSchema,
  TeamMissionListResponseSchema,
  TeamMissionMessagePostedSchema,
  TeamMissionMessagePostRequestSchema,
  TeamMissionMessagePostResponseSchema,
  TeamMissionRoomSubscribeRequestSchema,
  TeamMissionRoomSubscribeResponseSchema,
  TeamMissionRoomUnsubscribeRequestSchema,
  TeamMissionRoomUnsubscribeResponseSchema,
  TeamMissionSnapshotMessageSchema,
  TeamMissionStartRequestSchema,
  TeamMissionStartResponseSchema,
  TeamProfileArchiveRequestSchema,
  TeamProfileArchiveResponseSchema,
  TeamProfileCreateRequestSchema,
  TeamProfileCreateResponseSchema,
  TeamProfileInspectRequestSchema,
  TeamProfileInspectResponseSchema,
  TeamProfileListRequestSchema,
  TeamProfileListResponseSchema,
  TeamProfileMemberExecutionRefreshRequestSchema,
  TeamProfileMemberExecutionRefreshResponseSchema,
  TeamProfileMemberInputSchema,
  TeamProfileMemberPatchSchema,
  TeamProfileSnapshotMessageSchema,
  TeamProfileUpdateRequestSchema,
  TeamProfileUpdateResponseSchema,
} from "./v2-rpc-schemas.js";

const timestamp = "2026-08-08T08:00:00.000Z";
const digest = `sha256:${"0".repeat(64)}`;

const executionProfile = {
  provider: "codex" as const,
  model: "gpt-5.6-sol",
  modeId: null,
  thinkingOptionId: "high",
  featureValues: {},
};

const memberInput = {
  role: "Software engineer",
  level: 3,
  skillIds: ["typescript"],
  executionProfile,
};

const team = {
  id: "team-platform",
  name: "Platform",
  creationWorkspaceId: "wks-platform",
  leadMemberId: "member-lead",
  skills: [
    {
      skillId: "typescript",
      name: "TypeScript",
      description: "Production TypeScript systems",
    },
  ],
  members: [
    {
      memberId: "member-lead",
      ...memberInput,
      mentionHandle: "software-engineer",
    },
  ],
  methodologyBinding: {
    ref: {
      bundleId: "paseo/standard",
      version: "1",
      digest: `sha256:${"a".repeat(64)}`,
    },
    presetId: "standard",
    memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "generalist" }],
    skillBindings: [{ teamSkillId: "typescript", methodologySkillId: "typescript" }],
  },
  lifecycle: "active" as const,
  activeMissionId: "mission-sdk",
  lifecycleRecoveryFailure: null,
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
};

const mission = {
  id: "mission-sdk",
  teamId: team.id,
  workspaceId: team.creationWorkspaceId,
  objective: "Expose Team Missions through the SDK.",
  constraints: ["Keep the protocol capability-gated."],
  acceptanceCriteria: ["Protocol tests pass."],
  status: "planning" as const,
  suspendedStatus: null,
  activeRosterSnapshotRevision: 1,
  methodologySnapshot: {
    revision: 1 as const,
    ref: team.methodologyBinding.ref,
    compilerVersion: 1 as const,
    teamRevision: team.revision,
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
    hardPolicyDigest: digest,
    promptDigest: digest,
    compiledDigest: digest,
  },
  methodologyCompiledAt: timestamp,
  rosterSnapshots: [
    {
      revision: 1,
      teamRevision: team.revision,
      leadMemberId: team.leadMemberId,
      reason: "initial" as const,
      skills: team.skills,
      members: [
        {
          ...team.members[0],
          capabilityFacts: {
            kind: "known" as const,
            capabilityIds: ["structured-tools"],
          },
        },
      ],
      createdAt: timestamp,
    },
  ],
  planRevision: 0,
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
      memberId: team.leadMemberId,
      agentId: "agent-lead",
      bindingEpoch: 1,
      joinedAt: timestamp,
      archivedAt: null,
    },
  ],
  workstreams: [],
  workstreamPlanSnapshots: [],
  assignments: [],
  attentionItems: [],
  capabilityReplanRequests: [],
  reviewWaivers: [],
  lifecycleRecoveryFailure: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
};

describe("Team profile v2 RPC schemas", () => {
  it("requires complete facts for every newly created or added member", () => {
    for (const incomplete of [
      { ...memberInput, level: null },
      { ...memberInput, skillIds: [] },
      { ...memberInput, executionProfileSelection: null },
    ]) {
      expect(TeamProfileMemberInputSchema.safeParse(incomplete).success).toBe(false);
    }

    expect(
      TeamProfileMemberPatchSchema.safeParse({
        memberId: "member-existing",
        level: 3,
        skillIds: ["typescript"],
        executionProfileSelection: { kind: "inline", executionProfile },
      }).success,
    ).toBe(true);
    expect(
      TeamProfileMemberPatchSchema.safeParse({
        memberId: "member-engineer",
        executionProfileSelection: null,
      }).success,
    ).toBe(false);
    expect(
      TeamProfileCreateRequestSchema.safeParse({
        type: "team.profile.create.request",
        requestId: "req-incomplete-lead",
        idempotencyKey: "idem-incomplete-lead",
        name: "Incomplete",
        workspaceId: "wks-platform",
        skills: team.skills,
        lead: { ...memberInput, skillIds: [] },
        members: [],
      }).success,
    ).toBe(false);
    expect(
      TeamProfileUpdateRequestSchema.safeParse({
        type: "team.profile.update.request",
        requestId: "req-incomplete-add",
        teamId: team.id,
        expectedRevision: team.revision,
        memberAdds: [{ ...memberInput, executionProfileSelection: null }],
      }).success,
    ).toBe(false);
  });

  it("creates a bound profile by client member key and rejects the pre-Methodology shape", () => {
    const request = {
      type: "team.profile.create.request" as const,
      requestId: "req-profile-create",
      idempotencyKey: "idem-profile-create",
      name: "Platform",
      creationWorkspaceId: "wks-platform",
      skills: team.skills,
      leadClientMemberKey: "lead",
      members: [
        {
          clientMemberKey: "lead",
          ...memberInput,
          executionProfileSelection: { kind: "inline", executionProfile },
        },
        {
          clientMemberKey: "reviewer",
          ...memberInput,
          executionProfileSelection: { kind: "agent_profile", profileId: "profile-review" },
        },
      ].map(({ executionProfile: _executionProfile, ...member }) => member),
      methodologyBinding: {
        ref: {
          bundleId: "paseo/standard",
          version: "1",
          digest: `sha256:${"a".repeat(64)}`,
        },
        presetId: "standard",
        memberArchetypeBindings: [
          { clientMemberKey: "lead", archetypeId: "generalist" },
          { clientMemberKey: "reviewer", archetypeId: "generalist" },
        ],
        skillBindings: [{ teamSkillId: "typescript", methodologySkillId: "typescript" }],
      },
    };

    expect(TeamProfileCreateRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamProfileCreateRequestSchema.safeParse({
        ...request,
        creationWorkspaceId: undefined,
        workspaceId: "wks-platform",
        lead: memberInput,
      }).success,
    ).toBe(false);
    expect(
      TeamProfileCreateRequestSchema.safeParse({
        ...request,
        members: [request.members[0], { ...request.members[1], clientMemberKey: "lead" }],
      }).success,
    ).toBe(false);
  });

  it("updates a profile with compare-and-swap member mutations", () => {
    const request = {
      type: "team.profile.update.request" as const,
      requestId: "req-profile-update",
      idempotencyKey: "idem-profile-update",
      teamId: team.id,
      expectedRevision: 4,
      name: "Platform runtime",
      skills: team.skills,
      leadMemberId: "member-lead",
      memberAdds: [
        {
          ...memberInput,
          executionProfileSelection: { kind: "inline" as const, executionProfile },
        },
      ].map(({ executionProfile: _executionProfile, ...member }) => member),
      memberUpdates: [
        {
          memberId: "member-lead",
          role: "Staff software engineer",
          level: 4,
          skillIds: ["typescript"],
          executionProfileSelection: { kind: "inline", executionProfile },
        },
      ],
      memberRemovals: ["member-retired"],
    };

    expect(TeamProfileUpdateRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamProfileUpdateRequestSchema.safeParse({ ...request, expectedRevision: -1 }).success,
    ).toBe(false);
  });

  it("expresses rebind and detach with the same selection union as creation", () => {
    const rebind = {
      type: "team.profile.update.request" as const,
      requestId: "req-profile-rebind",
      idempotencyKey: "idem-profile-rebind",
      teamId: team.id,
      expectedRevision: team.revision,
      memberUpdates: [
        {
          memberId: "member-lead",
          executionProfileSelection: { kind: "agent_profile", profileId: "profile-review" },
        },
      ],
    };
    const detach = {
      ...rebind,
      requestId: "req-profile-detach",
      idempotencyKey: "idem-profile-detach",
      memberUpdates: [
        {
          memberId: "member-lead",
          executionProfileSelection: { kind: "inline", executionProfile },
        },
      ],
    };

    expect(TeamProfileUpdateRequestSchema.parse(rebind)).toEqual(rebind);
    expect(TeamProfileUpdateRequestSchema.parse(detach)).toEqual(detach);
  });

  it("keeps parsing legacy inline member updates during the compatibility window", () => {
    const request = {
      type: "team.profile.update.request" as const,
      requestId: "req-legacy-profile-update",
      teamId: team.id,
      expectedRevision: team.revision,
      memberAdds: [memberInput],
      memberUpdates: [{ memberId: "member-lead", executionProfile }],
    };

    expect(TeamProfileUpdateRequestSchema.parse(request)).toEqual(request);
  });

  it("plans a Methodology upgrade against the exact ref the form was built from", () => {
    const request = {
      type: "team.profile.update.request" as const,
      requestId: "req-profile-methodology",
      idempotencyKey: "idem-profile-methodology",
      teamId: team.id,
      expectedRevision: team.revision,
      methodologyUpgrade: {
        expectedRef: team.methodologyBinding.ref,
        ref: { bundleId: "paseo/standard", version: "2", digest: `sha256:${"b".repeat(64)}` },
        presetId: "standard",
        memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "generalist" }],
        skillBindings: [{ teamSkillId: "typescript", methodologySkillId: "typescript" }],
      },
    };

    expect(TeamProfileUpdateRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamProfileUpdateRequestSchema.safeParse({
        ...request,
        methodologyUpgrade: { ...request.methodologyUpgrade, expectedRef: undefined },
      }).success,
    ).toBe(false);
    expect(
      TeamProfileUpdateRequestSchema.safeParse({
        ...request,
        methodologyUpgrade: { ...request.methodologyUpgrade, memberArchetypeBindings: undefined },
      }).success,
    ).toBe(false);
  });

  it("refreshes one Member execution snapshot and reports its disposition", () => {
    const request = {
      type: "team.profile.member.execution.refresh.request" as const,
      requestId: "req-execution-refresh",
      idempotencyKey: "idem-execution-refresh",
      teamId: team.id,
      memberId: "member-lead",
      expectedTeamRevision: team.revision,
    };

    expect(TeamProfileMemberExecutionRefreshRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamProfileMemberExecutionRefreshRequestSchema.safeParse({
        ...request,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);

    const unchanged = {
      type: "team.profile.member.execution.refresh.response" as const,
      payload: {
        requestId: request.requestId,
        disposition: "unchanged" as const,
        teamRevision: team.revision,
        appliedDigest: digest,
        team: null,
        error: null,
        errorCode: null,
      },
    };
    const updated = {
      type: "team.profile.member.execution.refresh.response" as const,
      payload: {
        requestId: request.requestId,
        disposition: "updated" as const,
        teamRevision: team.revision + 1,
        appliedDigest: digest,
        team,
        error: null,
        errorCode: null,
      },
    };
    const failed = {
      type: "team.profile.member.execution.refresh.response" as const,
      payload: {
        requestId: request.requestId,
        disposition: null,
        teamRevision: null,
        appliedDigest: null,
        team: null,
        error: "Agent Profile profile-review does not exist",
        errorCode: "team_agent_profile_not_found",
      },
    };

    for (const response of [unchanged, updated, failed]) {
      expect(TeamProfileMemberExecutionRefreshResponseSchema.parse(response)).toEqual(response);
    }
  });

  it("keeps parsing a profile update without update idempotency during compatibility", () => {
    const request = {
      type: "team.profile.update.request" as const,
      requestId: "req-profile-update-without-idempotency",
      teamId: team.id,
      expectedRevision: team.revision,
      name: "Platform runtime",
    };

    expect(TeamProfileUpdateRequestSchema.safeParse(request).success).toBe(true);
  });

  it("round-trips list, inspect and archive", () => {
    const requests = [
      {
        schema: TeamProfileListRequestSchema,
        value: {
          type: "team.profile.list.request",
          requestId: "req-profile-list",
          includeArchived: false,
        },
      },
      {
        schema: TeamProfileInspectRequestSchema,
        value: {
          type: "team.profile.inspect.request",
          requestId: "req-profile-inspect",
          teamId: team.id,
        },
      },
      {
        schema: TeamProfileArchiveRequestSchema,
        value: {
          type: "team.profile.archive.request",
          requestId: "req-profile-archive",
          idempotencyKey: "idem-profile-archive",
          teamId: team.id,
          expectedRevision: 4,
        },
      },
    ];

    for (const { schema, value } of requests) {
      expect(schema.parse(value)).toEqual(value);
    }
    expect(
      TeamProfileArchiveRequestSchema.safeParse({
        type: "team.profile.archive.request",
        requestId: "req-profile-archive-without-key",
        teamId: team.id,
        expectedRevision: 4,
      }).success,
    ).toBe(false);
  });

  it("uses correlated response payloads and an authoritative snapshot broadcast", () => {
    const responses = [
      [TeamProfileCreateResponseSchema, "team.profile.create.response", team],
      [TeamProfileListResponseSchema, "team.profile.list.response", [team]],
      [TeamProfileInspectResponseSchema, "team.profile.inspect.response", team],
      [TeamProfileUpdateResponseSchema, "team.profile.update.response", team],
      [TeamProfileArchiveResponseSchema, "team.profile.archive.response", team],
    ] as const;

    for (const [schema, type, result] of responses) {
      const payload = Array.isArray(result)
        ? { requestId: `req-${type}`, teams: result, error: null, errorCode: null }
        : { requestId: `req-${type}`, team: result, error: null, errorCode: null };
      expect(schema.safeParse({ type, payload }).success).toBe(true);
    }

    expect(
      TeamProfileSnapshotMessageSchema.parse({
        type: "team.profile.snapshot",
        payload: { team },
      }),
    ).toEqual({ type: "team.profile.snapshot", payload: { team } });
  });
});

describe("Team Mission v2 RPC schemas", () => {
  it("accepts only controller-owned capability refresh inputs", () => {
    const request = {
      type: "team.mission.capability.refresh.request" as const,
      requestId: "refresh-request",
      missionId: "mission-sdk",
      attentionId: "attention-review",
      expectedRevision: 4,
      idempotencyKey: "refresh-key",
    };
    expect(TeamMissionCapabilityRefreshRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamMissionCapabilityRefreshRequestSchema.safeParse({
        ...request,
        rosterSnapshots: [],
      }).success,
    ).toBe(false);
    expect(
      TeamMissionCapabilityRefreshResponseSchema.safeParse({
        type: "team.mission.capability.refresh.response",
        payload: {
          requestId: request.requestId,
          result: {
            disposition: "unchanged",
            reason: "capability_declarations_unchanged",
            missionRevision: 4,
            rosterSnapshotRevision: 2,
          },
          error: null,
          errorCode: null,
        },
      }).success,
    ).toBe(true);
  });
  it("requires the exact Team Methodology binding and target workspace for Mission start", () => {
    const request = {
      type: "team.mission.start.request" as const,
      requestId: "req-mission-start",
      idempotencyKey: "idem-mission-start",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      expectedMethodologyRef: team.methodologyBinding.ref,
      workspaceId: "wks-delivery",
      objective: mission.objective,
      constraints: mission.constraints,
      acceptanceCriteria: mission.acceptanceCriteria,
    };

    expect(TeamMissionStartRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamMissionStartRequestSchema.safeParse({ ...request, workspaceId: undefined }).success,
    ).toBe(false);
    expect(
      TeamMissionStartRequestSchema.safeParse({ ...request, expectedMethodologyRef: undefined })
        .success,
    ).toBe(false);
  });

  it("round-trips list, inspect, cancel and durable attention resolution", () => {
    const requests = [
      {
        schema: TeamMissionListRequestSchema,
        value: {
          type: "team.mission.list.request",
          requestId: "req-mission-list",
          teamId: team.id,
          includeTerminal: true,
        },
      },
      {
        schema: TeamMissionInspectRequestSchema,
        value: {
          type: "team.mission.inspect.request",
          requestId: "req-mission-inspect",
          missionId: mission.id,
        },
      },
      {
        schema: TeamMissionCancelRequestSchema,
        value: {
          type: "team.mission.cancel.request",
          requestId: "req-mission-cancel",
          idempotencyKey: "idem-mission-cancel",
          missionId: mission.id,
          expectedRevision: mission.revision,
          reason: "The user canceled the Mission.",
        },
      },
      {
        schema: TeamMissionAttentionResolveRequestSchema,
        value: {
          type: "team.mission.attention.resolve.request",
          requestId: "req-mission-resolve",
          idempotencyKey: "idem-mission-resolve",
          missionId: mission.id,
          attentionId: "attention-1",
          expectedRevision: mission.revision,
          resolution: {
            kind: "attribute_owner",
            reason: "The change belongs to the API delivery.",
            ownerAssignmentId: "assignment-api",
          },
        },
      },
    ];

    for (const { schema, value } of requests) {
      expect(schema.parse(value)).toEqual(value);
    }
  });

  it("keeps the replacement Member optional on the wire for Lead recovery", () => {
    const request = {
      type: "team.mission.attention.resolve.request",
      requestId: "req-replace-lead",
      idempotencyKey: "idem-replace-lead",
      missionId: mission.id,
      attentionId: "attention-lead",
      expectedRevision: mission.revision,
      resolution: {
        kind: "replace_lead",
        reason: "Promote an active roster Member.",
        replacementMemberId: "member-replacement",
      },
    };

    expect(TeamMissionAttentionResolveRequestSchema.parse(request)).toEqual(request);
    const requestWithoutReplacement = {
      ...request,
      resolution: {
        kind: "replace_lead" as const,
        reason: "Promote an active roster Member.",
      },
    };
    expect(TeamMissionAttentionResolveRequestSchema.parse(requestWithoutReplacement)).toEqual(
      requestWithoutReplacement,
    );
  });

  it("requires exact gate identity and a non-empty reason for controller review waiver", () => {
    const request = {
      type: "team.mission.attention.resolve.request" as const,
      requestId: "req-waive-review",
      idempotencyKey: "idem-waive-review",
      missionId: mission.id,
      attentionId: "attention-review",
      expectedRevision: mission.revision,
      resolution: {
        kind: "waive_review" as const,
        gateKeyFingerprint: digest,
        subjectFingerprint: digest,
        reason: "No structurally eligible reviewer exists.",
      },
    };
    expect(TeamMissionAttentionResolveRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamMissionAttentionResolveRequestSchema.safeParse({
        ...request,
        resolution: { ...request.resolution, reason: "" },
      }).success,
    ).toBe(false);
    expect(
      TeamMissionAttentionResolveRequestSchema.safeParse({
        ...request,
        resolution: { kind: "waive_review", reason: "No reviewer." },
      }).success,
    ).toBe(false);
  });

  it("uses Mission-owned room messages without a generic Chat contract", () => {
    const message = {
      id: "message-1",
      missionId: mission.id,
      roomId: mission.chatRoomId,
      authorAgentId: "agent-lead",
      author: { kind: "agent" as const, id: "agent-lead" },
      body: "Please review the plan.",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: timestamp,
    };
    const request = {
      type: "team.mission.message.post.request" as const,
      requestId: "req-message-post",
      missionId: mission.id,
      body: message.body,
    };
    const subscribe = {
      type: "team.mission.room.subscribe.request" as const,
      requestId: "req-room-subscribe",
      missionId: mission.id,
      afterCursor: 4,
      limit: 50,
    };
    const unsubscribe = {
      type: "team.mission.room.unsubscribe.request" as const,
      requestId: "req-room-unsubscribe",
      missionId: mission.id,
    };

    expect(TeamMissionMessagePostRequestSchema.parse(request)).toEqual(request);
    expect(TeamMissionRoomSubscribeRequestSchema.parse(subscribe)).toEqual(subscribe);
    expect(TeamMissionRoomUnsubscribeRequestSchema.parse(unsubscribe)).toEqual(unsubscribe);
    expect(
      TeamMissionMessagePostResponseSchema.parse({
        type: "team.mission.message.post.response",
        payload: {
          requestId: request.requestId,
          missionId: mission.id,
          message,
          error: null,
          errorCode: null,
        },
      }).payload.message,
    ).toEqual(message);
    expect(
      TeamMissionRoomSubscribeResponseSchema.parse({
        type: "team.mission.room.subscribe.response",
        payload: {
          requestId: subscribe.requestId,
          missionId: mission.id,
          messages: [message],
          cursor: 5,
          hasMore: false,
          error: null,
          errorCode: null,
        },
      }).payload.messages,
    ).toEqual([message]);
    expect(
      TeamMissionRoomUnsubscribeResponseSchema.parse({
        type: "team.mission.room.unsubscribe.response",
        payload: {
          requestId: unsubscribe.requestId,
          missionId: mission.id,
          error: null,
          errorCode: null,
        },
      }).payload.missionId,
    ).toBe(mission.id);
    expect(
      TeamMissionMessagePostedSchema.parse({
        type: "team.mission.message.posted",
        payload: { missionId: mission.id, message, cursor: 6 },
      }).payload,
    ).toEqual({ missionId: mission.id, message, cursor: 6 });
  });

  it("uses correlated response payloads and an authoritative snapshot broadcast", () => {
    const responses = [
      [TeamMissionStartResponseSchema, "team.mission.start.response", mission],
      [TeamMissionListResponseSchema, "team.mission.list.response", [mission]],
      [TeamMissionInspectResponseSchema, "team.mission.inspect.response", mission],
      [TeamMissionCancelResponseSchema, "team.mission.cancel.response", mission],
      [
        TeamMissionAttentionResolveResponseSchema,
        "team.mission.attention.resolve.response",
        mission,
      ],
    ] as const;

    for (const [schema, type, result] of responses) {
      const payload = Array.isArray(result)
        ? { requestId: `req-${type}`, missions: result, error: null, errorCode: null }
        : { requestId: `req-${type}`, mission: result, error: null, errorCode: null };
      expect(schema.safeParse({ type, payload }).success).toBe(true);
    }

    expect(
      TeamMissionSnapshotMessageSchema.parse({
        type: "team.mission.snapshot",
        payload: { mission },
      }),
    ).toEqual({ type: "team.mission.snapshot", payload: { mission } });
  });
});
