import { describe, expect, test, vi } from "vitest";

import { CLIENT_CAPS, type ClientCapability } from "@getpaseo/protocol/client-capabilities";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { Session } from "./session.js";
import {
  createTeamRuntime,
  type TeamRuntimeRoomMessageEvent,
  type TeamRuntimeService,
  type TeamRuntimeSessionDeps,
} from "./team/team-runtime.js";
import {
  testMissionMethodologySnapshot,
  testTeamMethodologyBinding,
} from "./team/test-fixtures.js";

const timestamp = "2026-08-08T08:00:00.000Z";

function teamProfile(): TeamV2 {
  return {
    id: "team-v2",
    name: "V2 Team",
    creationWorkspaceId: "wks-platform",
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
    methodologyBinding: testTeamMethodologyBinding(["member-lead"], ["typescript"]),
    lifecycle: "active",
    activeMissionId: "mission-v2",
    lifecycleRecoveryFailure: null,
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
    workspaceId: team.creationWorkspaceId,
    objective: "Verify per-socket snapshot routing.",
    constraints: [],
    acceptanceCriteria: ["Old sockets receive no v2 snapshot."],
    status: "planning",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    methodologySnapshot: testMissionMethodologySnapshot(team.revision, 1),
    methodologyCompiledAt: timestamp,
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
            capabilityFacts: {
              kind: "known",
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
    lifecycleRecoveryFailure: null,
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
  clientCapabilities: ReadonlySet<string>;
  clientCapabilitiesBySource: Map<object, ReadonlySet<string>>;
  viewedTimelineAgentIdsBySource: Map<object, Set<string>>;
  teamControllerIdentityBySource: Map<
    object,
    { connectionId: string; selfReportedClientLabel: string }
  >;
  teamMissionRoomSubscriptions: Map<object, Set<string>>;
  teamMissionRoomSubscriptionTails: Map<object, Map<string, Promise<void>>>;
  subscribeToTeamMissionRoomMessages(): (() => void) | null;
}

function createTeamDispatchSession(
  targeted: Array<{ source: object; message: SessionOutboundMessage }>,
  teamRuntime: TeamRuntimeSessionDeps,
  options: { clientId?: string; onBroadcast?: (message: SessionOutboundMessage) => void } = {},
): { session: Session; internals: TeamDispatchSessionInternals } {
  const session = Object.create(Session.prototype) as Session;
  const internals = session as unknown as TeamDispatchSessionInternals;
  internals.clientId = options.clientId ?? "human-client";
  internals.clientCapabilities = new Set();
  internals.clientCapabilitiesBySource = new Map();
  internals.viewedTimelineAgentIdsBySource = new Map();
  internals.teamControllerIdentityBySource = new Map();
  internals.teamMissionRoomSubscriptions = new Map();
  internals.teamMissionRoomSubscriptionTails = new Map();
  internals.onMessage = options.onBroadcast ?? (() => {});
  internals.onMessageToSource = (source, message) => targeted.push({ source, message });
  internals.teamRuntime = teamRuntime;
  return { session, internals };
}

async function createRoomLifecycleRuntime(
  readMissionRoom: TeamRuntimeService["readMissionRoom"],
): Promise<TeamRuntimeSessionDeps> {
  const runtime = createTeamRuntime({
    runtime: { enabled: true },
    service: {
      reconcile: async () => undefined,
      readMissionRoom,
      onMissionRoomMessage: () => () => undefined,
    } as unknown as TeamRuntimeService,
  });
  await runtime.start();
  const sessionDeps = runtime.sessionDeps();
  if (!sessionDeps) throw new Error("Team runtime did not start");
  return sessionDeps;
}

function installSessionCleanupStubs(
  internals: TeamDispatchSessionInternals,
  unsubscribeRoomMessages = vi.fn(),
): ReturnType<typeof vi.fn> {
  Object.assign(internals as unknown as Record<string, unknown>, {
    sessionLogger: { trace: vi.fn() },
    unsubscribeTeamMissionRoomMessages: unsubscribeRoomMessages,
    agentUpdates: { dispose: vi.fn() },
    providerCatalogSession: { dispose: vi.fn() },
    voiceSession: { cleanup: vi.fn(async () => undefined) },
    terminalController: { dispose: vi.fn() },
    checkoutSession: { cleanup: vi.fn() },
    workspaceGitObserver: { dispose: vi.fn() },
    workspaceFilesSession: { dispose: vi.fn() },
  });
  return unsubscribeRoomMessages;
}

function registerTeamSource(session: Session, source: object, connectionId: string): void {
  session.updateClientCapabilities({ [CLIENT_CAPS.teamMissions]: true }, source);
  session.updatePhysicalSourceIdentity(source, {
    connectionId,
    selfReportedClientLabel: connectionId,
  });
}

function roomMessageEvent(missionId: string): TeamRuntimeRoomMessageEvent {
  return {
    missionId,
    cursor: 1,
    message: {
      id: `message-${missionId}`,
      missionId,
      roomId: `room:${missionId}`,
      authorAgentId: "agent-lead",
      author: { kind: "agent", id: "agent-lead" },
      body: `Update for ${missionId}`,
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: timestamp,
    },
  };
}

function createRoomSubscriptionSession(
  targeted: Array<{ source: object; message: SessionOutboundMessage }>,
): {
  session: Session;
  internals: TeamDispatchSessionInternals;
  emitRoomMessage(event: TeamRuntimeRoomMessageEvent): void;
} {
  let roomMessageListener: ((event: TeamRuntimeRoomMessageEvent) => void) | null = null;
  const teamRuntime: TeamRuntimeSessionDeps = {
    handleRequest: async (request, context) => {
      if (request.type === "team.mission.room.unsubscribe.request") {
        context.unsubscribeMissionRoom?.(request.missionId);
        return {
          type: "team.mission.room.unsubscribe.response",
          payload: {
            requestId: request.requestId,
            missionId: request.missionId,
            error: null,
            errorCode: null,
          },
        };
      }
      if (request.type !== "team.mission.room.subscribe.request") {
        throw new Error(`Unexpected request: ${request.type}`);
      }
      context.subscribeMissionRoom?.(request.missionId);
      return {
        type: "team.mission.room.subscribe.response",
        payload: {
          requestId: request.requestId,
          missionId: request.missionId,
          messages: [],
          cursor: 0,
          hasMore: false,
          error: null,
          errorCode: null,
        },
      };
    },
    onMissionRoomMessage: (listener) => {
      roomMessageListener = listener;
      return () => {
        roomMessageListener = null;
      };
    },
  };
  const { session, internals } = createTeamDispatchSession(targeted, teamRuntime, {
    onBroadcast: () => {
      throw new Error("room events must be socket-scoped");
    },
  });
  internals.subscribeToTeamMissionRoomMessages();
  return {
    session,
    internals,
    emitRoomMessage: (event) => roomMessageListener?.(event),
  };
}

describe("Team Missions RPC forwarding", () => {
  test("keeps a second subscribe after the first subscribe rolls back", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let readCount = 0;
    let rejectFirst: ((error: Error) => void) | null = null;
    const firstRead = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const teamRuntime = await createRoomLifecycleRuntime(async () => {
      readCount += 1;
      if (readCount === 1) return firstRead;
      return { messages: [], cursor: 0, hasMore: false };
    });
    const { session, internals } = createTeamDispatchSession(targeted, teamRuntime);
    const source = {};
    registerTeamSource(session, source, "connection-serial");

    const first = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-first",
        missionId: "mission-shared",
      },
      source,
    );
    await vi.waitFor(() => expect(readCount).toBe(1));
    const second = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-second",
        missionId: "mission-shared",
      },
      source,
    );
    await Promise.resolve();
    expect(readCount).toBe(1);

    rejectFirst?.(new Error("first Room read failed"));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    expect(readCount).toBe(2);
    expect(internals.teamMissionRoomSubscriptions.get(source)).toEqual(new Set(["mission-shared"]));
    expect(
      targeted.map(({ message }) =>
        "requestId" in message.payload ? message.payload.requestId : undefined,
      ),
    ).toEqual(["subscribe-first", "subscribe-second"]);
  });

  test("applies a queued unsubscribe after an in-flight subscribe", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let releaseRead: (() => void) | null = null;
    const pendingRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const teamRuntime = await createRoomLifecycleRuntime(async () => {
      await pendingRead;
      return { messages: [], cursor: 0, hasMore: false };
    });
    const { session, internals } = createTeamDispatchSession(targeted, teamRuntime);
    const source = {};
    registerTeamSource(session, source, "connection-unsubscribe");

    const subscribe = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-before-unsubscribe",
        missionId: "mission-shared",
      },
      source,
    );
    await vi.waitFor(() =>
      expect(internals.teamMissionRoomSubscriptions.get(source)).toEqual(
        new Set(["mission-shared"]),
      ),
    );
    const unsubscribe = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.unsubscribe.request",
        requestId: "unsubscribe-after-subscribe",
        missionId: "mission-shared",
      },
      source,
    );

    releaseRead?.();
    await Promise.all([subscribe, unsubscribe]);

    expect(internals.teamMissionRoomSubscriptions.has(source)).toBe(false);
    expect(
      targeted.map(({ message }) =>
        "requestId" in message.payload ? message.payload.requestId : undefined,
      ),
    ).toEqual(["subscribe-before-unsubscribe", "unsubscribe-after-subscribe"]);
  });

  test("routes Mission room events only to subscribed physical sources", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const { session, internals, emitRoomMessage } = createRoomSubscriptionSession(targeted);
    const sourceA = {};
    const sourceB = {};
    registerTeamSource(session, sourceA, "connection-a");
    registerTeamSource(session, sourceB, "connection-b");

    await internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-a",
        missionId: "mission-a",
      },
      sourceA,
    );
    await internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-b",
        missionId: "mission-b",
      },
      sourceB,
    );
    targeted.length = 0;

    emitRoomMessage(roomMessageEvent("mission-a"));

    expect(targeted).toEqual([
      {
        source: sourceA,
        message: {
          type: "team.mission.message.posted",
          payload: roomMessageEvent("mission-a"),
        },
      },
    ]);
  });

  test("removes only the closed physical source from Mission room subscriptions", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const { session, internals, emitRoomMessage } = createRoomSubscriptionSession(targeted);
    const sourceA = {};
    const sourceB = {};
    registerTeamSource(session, sourceA, "connection-a");
    registerTeamSource(session, sourceB, "connection-b");

    for (const [requestId, source] of [
      ["subscribe-a", sourceA],
      ["subscribe-b", sourceB],
    ] as const) {
      await internals.dispatchTeamMessage(
        {
          type: "team.mission.room.subscribe.request",
          requestId,
          missionId: "mission-shared",
        },
        source,
      );
    }
    session.clearAgentTimelineSubscription(sourceA);
    targeted.length = 0;

    emitRoomMessage(roomMessageEvent("mission-shared"));

    expect(targeted).toEqual([
      {
        source: sourceB,
        message: {
          type: "team.mission.message.posted",
          payload: roomMessageEvent("mission-shared"),
        },
      },
    ]);
  });

  test("does not run a queued Room lifecycle request after its physical source closes", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let readCount = 0;
    let rejectRead: ((error: Error) => void) | null = null;
    const pendingRead = new Promise<never>((_resolve, reject) => {
      rejectRead = reject;
    });
    const teamRuntime = await createRoomLifecycleRuntime(async () => {
      readCount += 1;
      return pendingRead;
    });
    const { session, internals } = createTeamDispatchSession(targeted, teamRuntime);
    const source = {};
    registerTeamSource(session, source, "connection-closing");

    const first = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-before-close",
        missionId: "mission-closing",
      },
      source,
    );
    await vi.waitFor(() => expect(readCount).toBe(1));
    const queued = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-after-close",
        missionId: "mission-closing",
      },
      source,
    );

    session.clearAgentTimelineSubscription(source);
    rejectRead?.(new Error("socket closed during Room read"));
    await expect(first).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();

    expect(readCount).toBe(1);
    expect(internals.teamMissionRoomSubscriptions.has(source)).toBe(false);
    expect(targeted).toEqual([]);
  });

  test("unsubscribes only the requesting physical source from a shared Mission", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const { session, internals, emitRoomMessage } = createRoomSubscriptionSession(targeted);
    const sourceA = {};
    const sourceB = {};
    for (const [source, connectionId] of [
      [sourceA, "connection-a"],
      [sourceB, "connection-b"],
    ] as const) {
      registerTeamSource(session, source, connectionId);
      await internals.dispatchTeamMessage(
        {
          type: "team.mission.room.subscribe.request",
          requestId: `subscribe-${connectionId}`,
          missionId: "mission-shared",
        },
        source,
      );
    }
    await internals.dispatchTeamMessage(
      {
        type: "team.mission.room.unsubscribe.request",
        requestId: "unsubscribe-a",
        missionId: "mission-shared",
      },
      sourceA,
    );
    targeted.length = 0;

    emitRoomMessage(roomMessageEvent("mission-shared"));

    expect(targeted).toEqual([
      {
        source: sourceB,
        message: {
          type: "team.mission.message.posted",
          payload: roomMessageEvent("mission-shared"),
        },
      },
    ]);
  });

  test("stops Room delivery when the subscribed source drops Team capability", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const { session, internals, emitRoomMessage } = createRoomSubscriptionSession(targeted);
    const source = {};
    registerTeamSource(session, source, "connection-capability");
    await internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-capability",
        missionId: "mission-capability",
      },
      source,
    );
    session.updateClientCapabilities(null, source);
    targeted.length = 0;

    emitRoomMessage(roomMessageEvent("mission-capability"));

    expect(targeted).toEqual([]);
  });

  test("forwards the actor and replies only to the requesting socket", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const handled: Array<{ requestId: string; actorId: string }> = [];
    const { session, internals } = createTeamDispatchSession(
      targeted,
      {
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
      },
      {
        onBroadcast: () => {
          throw new Error("response must be socket-scoped");
        },
      },
    );
    const source = {};
    registerTeamSource(session, source, "conn-controller");

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

  test("rejects Team control and projection reads from a less-capable socket in a mixed session", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let handled = false;
    const { session, internals } = createTeamDispatchSession(
      targeted,
      {
        handleRequest: async () => {
          handled = true;
          throw new Error("must not reach Team runtime");
        },
        onMissionRoomMessage: () => () => undefined,
      },
      { clientId: "shared-client" },
    );
    const capable = {};
    const lessCapable = {};
    session.updateClientCapabilities({ [CLIENT_CAPS.teamMissions]: true }, capable);
    session.updateClientCapabilities(null, lessCapable);

    await internals.dispatchTeamMessage(
      { type: "team.profile.list.request", requestId: "mixed-list" },
      lessCapable,
    );

    expect(handled).toBe(false);
    expect(targeted).toMatchObject([
      {
        source: lessCapable,
        message: { payload: { errorCode: "unsupported" } },
      },
    ]);
  });

  test("rejects an unregistered source instead of borrowing a sibling Team capability", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let handled = false;
    const { session, internals } = createTeamDispatchSession(
      targeted,
      {
        handleRequest: async () => {
          handled = true;
          throw new Error("must not reach Team runtime");
        },
        onMissionRoomMessage: () => () => undefined,
      },
      { clientId: "shared-client" },
    );
    const capableSibling = {};
    const unregisteredSource = {};
    session.updateClientCapabilities({ [CLIENT_CAPS.teamMissions]: true }, capableSibling);

    await internals.dispatchTeamMessage(
      { type: "team.profile.list.request", requestId: "unknown-source-list" },
      unregisteredSource,
    );

    expect(handled).toBe(false);
    expect(targeted).toMatchObject([
      {
        source: unregisteredSource,
        message: { payload: { errorCode: "unsupported" } },
      },
    ]);
  });

  test("rejects a Team-capable source until its physical identity is registered", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let handled = false;
    const { session, internals } = createTeamDispatchSession(
      targeted,
      {
        handleRequest: async () => {
          handled = true;
          throw new Error("must not reach Team runtime");
        },
        onMissionRoomMessage: () => () => undefined,
      },
      { clientId: "shared-client" },
    );
    const source = {};
    session.updateClientCapabilities({ [CLIENT_CAPS.teamMissions]: true }, source);

    await internals.dispatchTeamMessage(
      { type: "team.profile.list.request", requestId: "missing-source-identity" },
      source,
    );

    expect(handled).toBe(false);
    expect(targeted).toMatchObject([
      {
        source,
        message: { payload: { errorCode: "unsupported" } },
      },
    ]);
  });

  test("cleanup clears Room state and prevents queued lifecycle work from restarting", async () => {
    const targeted: Array<{ source: object; message: SessionOutboundMessage }> = [];
    let readCount = 0;
    let rejectRead: ((error: Error) => void) | null = null;
    const pendingRead = new Promise<never>((_resolve, reject) => {
      rejectRead = reject;
    });
    const teamRuntime = await createRoomLifecycleRuntime(async () => {
      readCount += 1;
      return pendingRead;
    });
    const { session, internals } = createTeamDispatchSession(targeted, teamRuntime);
    const unsubscribeRoomMessages = installSessionCleanupStubs(internals);
    const source = {};
    registerTeamSource(session, source, "connection-cleanup");

    const first = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-before-cleanup",
        missionId: "mission-cleanup",
      },
      source,
    );
    await vi.waitFor(() => expect(readCount).toBe(1));
    const queued = internals.dispatchTeamMessage(
      {
        type: "team.mission.room.subscribe.request",
        requestId: "subscribe-after-cleanup",
        missionId: "mission-cleanup",
      },
      source,
    );

    await session.cleanup();
    rejectRead?.(new Error("Session cleaned up during Room read"));
    await expect(first).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();

    expect(readCount).toBe(1);
    expect(unsubscribeRoomMessages).toHaveBeenCalledOnce();
    expect(internals.teamMissionRoomSubscriptions.size).toBe(0);
    expect(internals.teamMissionRoomSubscriptionTails.size).toBe(0);
    expect(targeted).toEqual([]);
  });
});
