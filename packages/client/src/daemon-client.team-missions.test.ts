import { afterEach, expect, test } from "vitest";

import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";

import { DaemonClient, type DaemonEvent, type DaemonTransport } from "./daemon-client.js";

const timestamp = "2026-08-08T08:00:00.000Z";
const executionProfile = {
  provider: "codex" as const,
  model: "gpt-5.6-sol",
  modeId: null,
  thinkingOptionId: "high",
  featureValues: {},
};
const memberInput = {
  role: "Lead engineer",
  level: 4,
  skillIds: ["typescript"],
  executionProfile,
};
const team = {
  id: "team-platform",
  name: "Platform",
  workspaceId: "wks-platform",
  leadMemberId: "member-lead",
  skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
  members: [
    {
      memberId: "member-lead",
      ...memberInput,
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
  acceptanceCriteria: ["Client tests pass."],
  status: "planning" as const,
  suspendedStatus: null,
  activeRosterSnapshotRevision: 1,
  rosterSnapshots: [
    {
      revision: 1,
      teamRevision: 1,
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

function createMockTransport() {
  const sent: string[] = [];
  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};

  const transport: DaemonTransport = {
    send(data) {
      if (typeof data === "string") sent.push(data);
    },
    close() {},
    onMessage(handler) {
      onMessage = handler;
      return () => {};
    },
    onOpen(handler) {
      onOpen = handler;
      return () => {};
    },
    onClose() {
      return () => {};
    },
    onError() {
      return () => {};
    },
  };

  return {
    transport,
    sent,
    open(features: Record<string, boolean> = {}) {
      onOpen();
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "server-team-missions",
              hostname: null,
              version: null,
              features,
            },
          },
        }),
      );
    },
    message(message: unknown) {
      onMessage(JSON.stringify({ type: "session", message }));
    },
  };
}

function sentSessionMessage(value: string): Record<string, unknown> {
  return (JSON.parse(value) as { message: Record<string, unknown> }).message;
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connectedClient(features: Record<string, boolean>) {
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "team-missions-client",
    transportFactory: () => mock.transport,
    reconnect: { enabled: false },
  });
  clients.push(client);
  const connected = client.connect();
  mock.open(features);
  await connected;
  return { client, mock };
}

test("hello advertises the per-socket Team Missions capability", async () => {
  const { mock } = await connectedClient({ teamMissions: true });
  const hello = JSON.parse(mock.sent[0]!) as { capabilities?: Record<string, unknown> };
  expect(hello.capabilities?.[CLIENT_CAPS.teamMissions]).toBe(true);
});

test("a daemon without the capability is rejected locally without sending a mutation", async () => {
  const { client, mock } = await connectedClient({});
  const sentBefore = mock.sent.length;

  await expect(
    client.createTeamProfile({
      idempotencyKey: "idem-create",
      name: team.name,
      workspaceId: team.workspaceId,
      skills: team.skills,
      lead: memberInput,
      members: [],
    }),
  ).rejects.toThrow("Update the host to use Team Missions");
  expect(mock.sent).toHaveLength(sentBefore);
});

test("the SDK sends all Team profile and Mission correlated RPCs", async () => {
  const { client, mock } = await connectedClient({ teamMissions: true });

  const cases = [
    {
      type: "team.profile.create.request",
      invoke: () =>
        client.createTeamProfile({
          idempotencyKey: "idem-create",
          name: team.name,
          workspaceId: team.workspaceId,
          skills: team.skills,
          lead: memberInput,
          members: [],
        }),
      result: { team: null },
    },
    {
      type: "team.profile.list.request",
      invoke: () => client.listTeamProfiles(),
      result: { teams: [] },
    },
    {
      type: "team.profile.inspect.request",
      invoke: () => client.inspectTeamProfile({ teamId: team.id }),
      result: { team: null },
    },
    {
      type: "team.profile.update.request",
      invoke: () =>
        client.updateTeamProfile({
          idempotencyKey: "idem-profile-update",
          teamId: team.id,
          expectedRevision: 1,
          name: "Runtime",
        }),
      result: { team: null },
    },
    {
      type: "team.profile.archive.request",
      invoke: () =>
        client.archiveTeamProfile({
          requestId: "req-archive-transport",
          idempotencyKey: "idem-archive-operation",
          teamId: team.id,
          expectedRevision: 1,
        }),
      result: { team: null },
    },
    {
      type: "team.mission.start.request",
      invoke: () =>
        client.startTeamMission({
          idempotencyKey: "idem-start",
          teamId: team.id,
          expectedTeamRevision: 1,
          objective: mission.objective,
          constraints: [],
          acceptanceCriteria: mission.acceptanceCriteria,
        }),
      result: { mission: null },
    },
    {
      type: "team.mission.list.request",
      invoke: () => client.listTeamMissions({ teamId: team.id }),
      result: { missions: [] },
    },
    {
      type: "team.mission.inspect.request",
      invoke: () => client.inspectTeamMission({ missionId: mission.id }),
      result: { mission: null },
    },
    {
      type: "team.mission.cancel.request",
      invoke: () =>
        client.cancelTeamMission({
          idempotencyKey: "idem-cancel",
          missionId: mission.id,
          expectedRevision: 1,
          reason: "Canceled by user.",
        }),
      result: { mission: null },
    },
    {
      type: "team.mission.attention.resolve.request",
      invoke: () =>
        client.resolveTeamMissionAttention({
          idempotencyKey: "idem-mission-resolve",
          missionId: mission.id,
          attentionId: "attention-1",
          expectedRevision: 1,
          resolution: { kind: "external_change", reason: "External edit." },
        }),
      result: { mission: null },
    },
  ];

  for (const entry of cases) {
    const pending = entry.invoke();
    const request = sentSessionMessage(mock.sent.at(-1)!);
    expect(request.type).toBe(entry.type);
    const responseType = entry.type.replace(/\.request$/, ".response");
    mock.message({
      type: responseType,
      payload: {
        requestId: request.requestId,
        ...entry.result,
        error: null,
        errorCode: null,
      },
    });
    await expect(pending).resolves.toMatchObject(entry.result);
  }
});

test("Team room messaging stays inside the Team Missions capability and RPC namespace", async () => {
  const { client, mock } = await connectedClient({ teamMissions: true });
  const post = client.postTeamMissionMessage({
    missionId: mission.id,
    body: "Please review the plan.",
  });
  const postRequest = sentSessionMessage(mock.sent.at(-1)!);
  expect(postRequest).toMatchObject({
    type: "team.mission.message.post.request",
    missionId: mission.id,
    body: "Please review the plan.",
  });
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
  mock.message({
    type: "team.mission.message.post.response",
    payload: {
      requestId: postRequest.requestId,
      missionId: mission.id,
      message,
      error: null,
      errorCode: null,
    },
  });
  await expect(post).resolves.toMatchObject({ missionId: mission.id, message });

  const subscribe = client.subscribeTeamMissionRoom({
    missionId: mission.id,
    afterCursor: 3,
    limit: 50,
  });
  const subscribeRequest = sentSessionMessage(mock.sent.at(-1)!);
  expect(subscribeRequest).toMatchObject({
    type: "team.mission.room.subscribe.request",
    missionId: mission.id,
    afterCursor: 3,
    limit: 50,
  });
  mock.message({
    type: "team.mission.room.subscribe.response",
    payload: {
      requestId: subscribeRequest.requestId,
      missionId: mission.id,
      messages: [message],
      cursor: 4,
      hasMore: false,
      error: null,
      errorCode: null,
    },
  });
  await expect(subscribe).resolves.toMatchObject({
    missionId: mission.id,
    messages: [message],
    cursor: 4,
  });

  const unsubscribe = client.unsubscribeTeamMissionRoom({ missionId: mission.id });
  const unsubscribeRequest = sentSessionMessage(mock.sent.at(-1)!);
  expect(unsubscribeRequest).toMatchObject({
    type: "team.mission.room.unsubscribe.request",
    missionId: mission.id,
  });
  mock.message({
    type: "team.mission.room.unsubscribe.response",
    payload: {
      requestId: unsubscribeRequest.requestId,
      missionId: mission.id,
      error: null,
      errorCode: null,
    },
  });
  await expect(unsubscribe).resolves.toMatchObject({ missionId: mission.id });
});

test("profile, Mission, and room message snapshots surface as addressable events", async () => {
  const { client, mock } = await connectedClient({ teamMissions: true });
  const events: DaemonEvent[] = [];
  client.on((event) => events.push(event));

  mock.message({ type: "team.profile.snapshot", payload: { team } });
  mock.message({ type: "team.mission.snapshot", payload: { mission } });
  const message = {
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
  mock.message({
    type: "team.mission.message.posted",
    payload: { missionId: mission.id, message, cursor: 1 },
  });

  expect(events).toEqual([
    { type: "team.profile.snapshot", teamId: team.id, payload: { team } },
    {
      type: "team.mission.snapshot",
      teamId: team.id,
      missionId: mission.id,
      payload: { mission },
    },
    {
      type: "team.mission.message.posted",
      missionId: mission.id,
      payload: { missionId: mission.id, message, cursor: 1 },
    },
  ]);
});
