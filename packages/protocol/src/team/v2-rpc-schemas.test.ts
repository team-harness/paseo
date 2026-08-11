import { describe, expect, it } from "vitest";

import {
  TeamMissionAttentionResolveRequestSchema,
  TeamMissionAttentionResolveResponseSchema,
  TeamMissionCancelRequestSchema,
  TeamMissionCancelResponseSchema,
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
  TeamProfileMemberInputSchema,
  TeamProfileMemberPatchSchema,
  TeamProfileSnapshotMessageSchema,
  TeamProfileUpdateRequestSchema,
  TeamProfileUpdateResponseSchema,
} from "./v2-rpc-schemas.js";

const timestamp = "2026-08-08T08:00:00.000Z";

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
  workspaceId: "wks-platform",
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
  workspaceId: team.workspaceId,
  objective: "Expose Team Missions through the SDK.",
  constraints: ["Keep the protocol capability-gated."],
  acceptanceCriteria: ["Protocol tests pass."],
  status: "planning" as const,
  suspendedStatus: null,
  activeRosterSnapshotRevision: 1,
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
          runtimeSnapshot: {
            providerAvailable: true,
            toolIds: ["mission_status"],
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
      { ...memberInput, executionProfile: null },
    ]) {
      expect(TeamProfileMemberInputSchema.safeParse(incomplete).success).toBe(false);
    }

    expect(
      TeamProfileMemberPatchSchema.safeParse({
        memberId: "member-existing",
        level: 3,
        skillIds: ["typescript"],
        executionProfile,
      }).success,
    ).toBe(true);
    expect(
      TeamProfileMemberPatchSchema.safeParse({
        memberId: "member-engineer",
        executionProfile: null,
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
        memberAdds: [{ ...memberInput, executionProfile: null }],
      }).success,
    ).toBe(false);
  });

  it("creates a profile from role, Level, Skills and execution profile without responsibilities", () => {
    const request = {
      type: "team.profile.create.request" as const,
      requestId: "req-profile-create",
      idempotencyKey: "idem-profile-create",
      name: "Platform",
      workspaceId: "wks-platform",
      skills: team.skills,
      lead: memberInput,
      members: [memberInput, memberInput],
    };

    expect(TeamProfileCreateRequestSchema.parse(request)).toEqual(request);
    expect("responsibility" in request.lead).toBe(false);
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
      memberAdds: [memberInput],
      memberUpdates: [
        {
          memberId: "member-lead",
          role: "Staff software engineer",
          level: 4,
          skillIds: ["typescript"],
          executionProfile,
        },
      ],
      memberRemovals: ["member-retired"],
    };

    expect(TeamProfileUpdateRequestSchema.parse(request)).toEqual(request);
    expect(
      TeamProfileUpdateRequestSchema.safeParse({ ...request, expectedRevision: -1 }).success,
    ).toBe(false);
  });

  it("accepts a profile update from a client without update idempotency", () => {
    const request = {
      type: "team.profile.update.request" as const,
      requestId: "req-profile-update-without-idempotency",
      teamId: team.id,
      expectedRevision: team.revision,
      name: "Platform runtime",
    };

    expect(TeamProfileUpdateRequestSchema.parse(request)).toEqual(request);
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
  it("starts a Mission from a task contract and Team revision", () => {
    const request = {
      type: "team.mission.start.request" as const,
      requestId: "req-mission-start",
      idempotencyKey: "idem-mission-start",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: mission.objective,
      constraints: mission.constraints,
      acceptanceCriteria: mission.acceptanceCriteria,
    };

    expect(TeamMissionStartRequestSchema.parse(request)).toEqual(request);
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
