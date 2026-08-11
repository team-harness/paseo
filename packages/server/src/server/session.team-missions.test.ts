import { describe, expect, test } from "vitest";

import { CLIENT_CAPS, type ClientCapability } from "@getpaseo/protocol/client-capabilities";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { Session } from "./session.js";
import type { TeamRuntimeSessionDeps } from "./team/team-runtime.js";

const timestamp = "2026-08-08T08:00:00.000Z";

function teamProfile(): TeamV2 {
  return {
    id: "team-v2",
    name: "V2 Team",
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
          provider: "codex",
          model: "gpt-5.6-sol",
          modeId: null,
          thinkingOptionId: "high",
          featureValues: {},
        },
        mentionHandle: "lead-engineer",
      },
    ],
    lifecycle: "active",
    activeMissionId: "mission-v2",
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}

function teamMission(team: TeamV2): TeamMission {
  return {
    id: "mission-v2",
    teamId: team.id,
    workspaceId: team.workspaceId,
    objective: "Verify per-socket snapshot routing.",
    constraints: [],
    acceptanceCriteria: ["Old sockets receive no v2 snapshot."],
    status: "planning",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        teamRevision: team.revision,
        leadMemberId: team.leadMemberId,
        reason: "initial",
        skills: team.skills,
        members: [
          {
            ...team.members[0]!,
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
    chatRoomId: "room-v2",
    participants: [
      {
        memberId: team.leadMemberId,
        agentId: "agent-v2-lead",
        bindingEpoch: 1,
        joinedAt: timestamp,
        archivedAt: null,
      },
    ],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  };
}

interface BroadcastSessionInternals {
  clientCapabilities: ReadonlySet<ClientCapability>;
  clientCapabilitiesBySource: Map<object, ReadonlySet<ClientCapability>>;
  onMessage: (message: SessionOutboundMessage) => void;
  onMessageToSource: (source: object, message: SessionOutboundMessage) => void;
}

function createBroadcastSession(
  targeted: Array<{ source: object; message: SessionOutboundMessage }>,
): Session {
  const session = Object.create(Session.prototype) as Session;
  const internals = session as unknown as BroadcastSessionInternals;
  internals.clientCapabilities = new Set();
  internals.clientCapabilitiesBySource = new Map();
  internals.onMessage = () => {};
  internals.onMessageToSource = (source, message) => targeted.push({ source, message });
  return session;
}

describe("Team Missions per-socket snapshot routing", () => {
  test("only emits snapshots to sockets that claim Team Missions", () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const session = createBroadcastSession(targeted);
    const v2 = {};
    const old = {};
    session.updateClientCapabilities({ [CLIENT_CAPS.teamMissions]: true }, v2);
    session.updateClientCapabilities(null, old);

    const profile = teamProfile();
    session.emitTeamProfileSnapshot(profile);
    session.emitTeamMissionSnapshot(teamMission(profile));

    expect(
      targeted.map(({ source, message }) => ({
        source,
        type: message.type,
      })),
    ).toEqual([
      { source: v2, type: "team.profile.snapshot" },
      { source: v2, type: "team.mission.snapshot" },
    ]);
  });

  test("does not emit a v2 snapshot when no socket claimed Team Missions", () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const session = createBroadcastSession(targeted);
    session.updateClientCapabilities(null, {});

    const profile = teamProfile();
    session.emitTeamProfileSnapshot(profile);
    session.emitTeamMissionSnapshot(teamMission(profile));

    expect(targeted).toEqual([]);
  });
});

interface TeamDispatchSessionInternals {
  clientId: string;
  teamRuntime: TeamRuntimeSessionDeps | null;
  onMessage: (message: SessionOutboundMessage) => void;
  onMessageToSource: (source: object, message: SessionOutboundMessage) => void;
  dispatchTeamMessage(message: SessionInboundMessage, source?: object): Promise<void> | undefined;
}

describe("Team Missions RPC forwarding", () => {
  test("forwards the actor and replies only to the requesting socket", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const handled: Array<{ requestId: string; actorId: string }> = [];
    const session = Object.create(Session.prototype) as Session;
    const internals = session as unknown as TeamDispatchSessionInternals;
    internals.clientId = "human-client";
    internals.onMessage = () => {
      throw new Error("response must be socket-scoped");
    };
    internals.onMessageToSource = (source, message) => targeted.push({ source, message });
    internals.teamRuntime = {
      handleRequest: async (request, context) => {
        handled.push({ requestId: request.requestId, actorId: context.actorId });
        return {
          type: "team.profile.list.response",
          payload: {
            requestId: request.requestId,
            teams: [],
            error: null,
            errorCode: null,
          },
        };
      },
      onMissionRoomMessage: () => () => undefined,
    };
    const source = {};

    await internals.dispatchTeamMessage(
      { type: "team.profile.list.request", requestId: "list-rpc" },
      source,
    );

    expect(handled).toEqual([{ requestId: "list-rpc", actorId: "human-client" }]);
    expect(targeted).toEqual([
      {
        source,
        message: {
          type: "team.profile.list.response",
          payload: { requestId: "list-rpc", teams: [], error: null, errorCode: null },
        },
      },
    ]);
  });
});
