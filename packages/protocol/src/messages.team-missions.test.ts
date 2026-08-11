import { z } from "zod";
import { describe, expect, it } from "vitest";

import { CLIENT_CAPS } from "./client-capabilities.js";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "./messages.js";

const timestamp = "2026-08-08T08:00:00.000Z";
const team = {
  id: "team-platform",
  name: "Platform",
  workspaceId: "wks-platform",
  leadMemberId: "member-lead",
  skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
  members: [
    {
      memberId: "member-lead",
      role: "Lead engineer",
      level: 4,
      skillIds: ["typescript"],
      executionProfile: {
        provider: "codex" as const,
        model: "gpt-5.6-sol",
        modeId: null,
        thinkingOptionId: "high",
        featureValues: {},
      },
      mentionHandle: "lead-engineer",
    },
  ],
  lifecycle: "active" as const,
  activeMissionId: "mission-sdk",
  lifecycleRecoveryFailure: null,
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
};

const mission = {
  id: "mission-sdk",
  teamId: team.id,
  workspaceId: team.workspaceId,
  objective: "Expose Team Missions through the SDK.",
  constraints: [],
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
    excludedPathPrefixes: [".git"],
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

const roomMessage = {
  id: "message-1",
  missionId: mission.id,
  roomId: mission.chatRoomId,
  authorAgentId: "agent-lead",
  author: { kind: "agent" as const, id: "agent-lead" },
  body: "Planning has started.",
  replyToMessageId: null,
  mentionAgentIds: [],
  createdAt: timestamp,
};

describe("Team Missions session unions", () => {
  it("accepts every v2 request on the inbound union", () => {
    const requests = [
      {
        type: "team.profile.create.request",
        requestId: "req-1",
        idempotencyKey: "idem-1",
        name: team.name,
        workspaceId: team.workspaceId,
        skills: team.skills,
        lead: {
          role: "Lead engineer",
          level: 4,
          skillIds: ["typescript"],
          executionProfile: team.members[0].executionProfile,
        },
        members: [],
      },
      { type: "team.profile.list.request", requestId: "req-2" },
      { type: "team.profile.inspect.request", requestId: "req-3", teamId: team.id },
      {
        type: "team.profile.update.request",
        requestId: "req-4",
        teamId: team.id,
        expectedRevision: 1,
        name: "Platform runtime",
      },
      {
        type: "team.profile.archive.request",
        requestId: "req-5",
        idempotencyKey: "idem-5",
        teamId: team.id,
        expectedRevision: 1,
      },
      {
        type: "team.mission.start.request",
        requestId: "req-6",
        idempotencyKey: "idem-6",
        teamId: team.id,
        expectedTeamRevision: 1,
        objective: mission.objective,
        constraints: [],
        acceptanceCriteria: mission.acceptanceCriteria,
      },
      { type: "team.mission.list.request", requestId: "req-7", teamId: team.id },
      { type: "team.mission.inspect.request", requestId: "req-8", missionId: mission.id },
      {
        type: "team.mission.cancel.request",
        requestId: "req-9",
        idempotencyKey: "idem-9",
        missionId: mission.id,
        expectedRevision: 1,
        reason: "Canceled by user.",
      },
      {
        type: "team.mission.attention.resolve.request",
        requestId: "req-10",
        idempotencyKey: "idem-10",
        missionId: mission.id,
        attentionId: "attention-1",
        expectedRevision: 1,
        resolution: { kind: "external_change", reason: "Owned outside this Mission." },
      },
      {
        type: "team.mission.message.post.request",
        requestId: "req-11",
        missionId: mission.id,
        body: "Please review the plan.",
      },
      {
        type: "team.mission.room.subscribe.request",
        requestId: "req-12",
        missionId: mission.id,
        afterCursor: 4,
        limit: 50,
      },
      {
        type: "team.mission.room.unsubscribe.request",
        requestId: "req-13",
        missionId: mission.id,
      },
    ];

    for (const request of requests) {
      expect(SessionInboundMessageSchema.safeParse(request).success).toBe(true);
    }
  });

  it("accepts every v2 response and authoritative snapshot on the outbound union", () => {
    const responses = [
      {
        type: "team.profile.create.response",
        payload: { requestId: "req-1", team: null, error: null, errorCode: null },
      },
      {
        type: "team.profile.list.response",
        payload: { requestId: "req-2", teams: [], error: null, errorCode: null },
      },
      {
        type: "team.profile.inspect.response",
        payload: { requestId: "req-3", team: null, error: null, errorCode: null },
      },
      {
        type: "team.profile.update.response",
        payload: { requestId: "req-4", team: null, error: null, errorCode: null },
      },
      {
        type: "team.profile.archive.response",
        payload: { requestId: "req-5", team: null, error: null, errorCode: null },
      },
      {
        type: "team.mission.start.response",
        payload: { requestId: "req-6", mission: null, error: null, errorCode: null },
      },
      {
        type: "team.mission.list.response",
        payload: { requestId: "req-7", missions: [], error: null, errorCode: null },
      },
      {
        type: "team.mission.inspect.response",
        payload: { requestId: "req-8", mission: null, error: null, errorCode: null },
      },
      {
        type: "team.mission.cancel.response",
        payload: { requestId: "req-9", mission: null, error: null, errorCode: null },
      },
      {
        type: "team.mission.attention.resolve.response",
        payload: { requestId: "req-10", mission: null, error: null, errorCode: null },
      },
      {
        type: "team.mission.message.post.response",
        payload: {
          requestId: "req-11",
          missionId: mission.id,
          message: roomMessage,
          error: null,
          errorCode: null,
        },
      },
      {
        type: "team.mission.room.subscribe.response",
        payload: {
          requestId: "req-12",
          missionId: mission.id,
          messages: [roomMessage],
          cursor: 5,
          hasMore: false,
          error: null,
          errorCode: null,
        },
      },
      {
        type: "team.mission.room.unsubscribe.response",
        payload: {
          requestId: "req-13",
          missionId: mission.id,
          error: null,
          errorCode: null,
        },
      },
      { type: "team.profile.snapshot", payload: { team } },
      { type: "team.mission.snapshot", payload: { mission } },
      {
        type: "team.mission.message.posted",
        payload: { missionId: mission.id, message: roomMessage, cursor: 6 },
      },
    ];

    for (const response of responses) {
      expect(SessionOutboundMessageSchema.safeParse(response).success).toBe(true);
    }
  });
});

describe("Team Missions capability compatibility", () => {
  it("adds one server feature and one per-socket client capability", () => {
    expect(CLIENT_CAPS.teamMissions).toBe("team_missions");
    expect(
      WSHelloMessageSchema.safeParse({
        type: "hello",
        clientId: "new-client",
        clientType: "browser",
        protocolVersion: 1,
        capabilities: { [CLIENT_CAPS.teamMissions]: true },
      }).success,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "new-daemon",
        features: { teamMissions: true },
      }).features?.teamMissions,
    ).toBe(true);
  });

  it("lets a new client parse an old daemon that omits the feature", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "old-daemon",
      features: {},
    });
    expect(parsed.features?.teamMissions).toBeUndefined();
  });

  it("lets an old client parser ignore the new server feature", () => {
    const LegacyServerInfoSchema = z.object({
      status: z.literal("server_info"),
      serverId: z.string(),
      features: z.object({}).passthrough().optional(),
    });

    expect(
      LegacyServerInfoSchema.safeParse({
        status: "server_info",
        serverId: "new-daemon",
        features: { teamMissions: true },
      }).success,
    ).toBe(true);
  });

  it("lets an old daemon parser ignore the new hello capability", () => {
    const LegacyHelloSchema = z.object({
      type: z.literal("hello"),
      clientId: z.string(),
      clientType: z.enum(["mobile", "browser", "cli", "mcp"]),
      protocolVersion: z.number().int(),
      capabilities: z.object({}).passthrough().optional(),
    });

    expect(
      LegacyHelloSchema.safeParse({
        type: "hello",
        clientId: "new-client",
        clientType: "browser",
        protocolVersion: 1,
        capabilities: { [CLIENT_CAPS.teamMissions]: true },
      }).success,
    ).toBe(true);
  });
});
