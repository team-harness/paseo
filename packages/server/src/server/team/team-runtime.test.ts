import { afterEach, describe, expect, test, vi } from "vitest";

import type { TeamMission, TeamRoomMessage, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  createTeamRuntime,
  teamMissionsUnavailableResponse,
  type TeamRuntime,
  type TeamRuntimeService,
} from "./team-runtime.js";

describe("TeamRuntime v2 façade", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps the capability and session surface unavailable when disabled", async () => {
    const runtime = createTeamRuntime({ runtime: { enabled: false } });
    await runtime.start();

    expect(runtime.isReady()).toBe(false);
    expect(runtime.serverFeatures()).toEqual({});
    expect(runtime.sessionDeps()).toBeNull();
    expect(
      teamMissionsUnavailableResponse(
        { type: "team.profile.list.request", requestId: "list-disabled" },
        "disabled",
      ),
    ).toEqual({
      type: "team.profile.list.response",
      payload: {
        requestId: "list-disabled",
        teams: [],
        error: "disabled",
        errorCode: "unsupported",
      },
    });
  });

  test("advertises teamMissions only after startup reconciliation settles", async () => {
    let releaseReconciliation: (() => void) | null = null;
    const service = new FakeTeamRuntimeService(
      new Promise<void>((resolve) => {
        releaseReconciliation = resolve;
      }),
    );
    const runtime = createTeamRuntime({ runtime: { enabled: true }, service });

    const starting = runtime.start();
    expect(runtime.isReady()).toBe(false);
    expect(runtime.serverFeatures()).toEqual({});
    expect(runtime.sessionDeps()).toBeNull();

    releaseReconciliation?.();
    await starting;

    expect(runtime.isReady()).toBe(true);
    expect(runtime.serverFeatures()).toEqual({ teamMissions: true });
    const session = runtime.sessionDeps();
    expect(session).not.toBeNull();
    await expect(
      session?.handleRequest(
        { type: "team.profile.list.request", requestId: "list-ready" },
        { actorId: "client-1" },
      ),
    ).resolves.toEqual({
      type: "team.profile.list.response",
      payload: { requestId: "list-ready", teams: [], error: null, errorCode: null },
    });
  });

  test("does not become ready when stopped during reconciliation", async () => {
    let releaseReconciliation: (() => void) | null = null;
    const service = new FakeTeamRuntimeService(
      new Promise<void>((resolve) => {
        releaseReconciliation = resolve;
      }),
    );
    const runtime = createTeamRuntime({ runtime: { enabled: true }, service });

    const starting = runtime.start();
    runtime.stop();
    releaseReconciliation?.();
    await starting;

    expect(runtime.isReady()).toBe(false);
    expect(runtime.sessionDeps()).toBeNull();
  });

  test("remains stopped when reconciliation rejects after stop", async () => {
    let rejectReconciliation: ((error: Error) => void) | null = null;
    const service = new FakeTeamRuntimeService(
      new Promise<void>((_resolve, reject) => {
        rejectReconciliation = reject;
      }),
    );
    const runtime = createTeamRuntime({ runtime: { enabled: true }, service });

    const starting = runtime.start();
    runtime.stop();
    rejectReconciliation?.(new Error("reconciliation failed"));
    await expect(starting).rejects.toThrow("reconciliation failed");

    await expect(runtime.start()).rejects.toThrow("Team Missions runtime has been stopped");
    expect(runtime.sessionDeps()).toBeNull();
  });

  test("routes the archive business idempotency key independently from request correlation", async () => {
    const team = teamProfile();
    const service = new FakeTeamRuntimeService(Promise.resolve(), team);
    const runtime = createTeamRuntime({ runtime: { enabled: true }, service });
    await runtime.start();

    await expect(
      runtime.sessionDeps()?.handleRequest(
        {
          type: "team.profile.archive.request",
          requestId: "request-attempt-2",
          idempotencyKey: "archive-operation-1",
          teamId: team.id,
          expectedRevision: team.revision,
        },
        { actorId: "client-1" },
      ),
    ).resolves.toMatchObject({
      type: "team.profile.archive.response",
      payload: { requestId: "request-attempt-2", team },
    });
    expect(service.archiveInputs).toEqual([
      {
        idempotencyKey: "archive-operation-1",
        teamId: team.id,
        expectedRevision: team.revision,
      },
    ]);
  });

  test("routes Mission start idempotency independently from request correlation", async () => {
    const team = teamProfile();
    const mission = teamMission(team, {
      id: "mission-started",
      roomId: "room-started",
      status: "planning",
      agentId: "agent-started-lead",
      archivedAt: null,
    });
    const service = new FakeTeamRuntimeService(Promise.resolve(), team, [mission]);
    const runtime = createTeamRuntime({ runtime: { enabled: true }, service });
    await runtime.start();
    const start = {
      idempotencyKey: "mission-operation-1",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Deliver the requested change",
      constraints: ["Keep the transport correlation outside the business fingerprint"],
      acceptanceCriteria: ["A retry returns the same Mission"],
    };

    for (const requestId of ["request-attempt-1", "request-attempt-2"]) {
      await expect(
        runtime
          .sessionDeps()
          ?.handleRequest(
            { type: "team.mission.start.request", requestId, ...start },
            { actorId: "client-1" },
          ),
      ).resolves.toMatchObject({
        type: "team.mission.start.response",
        payload: { requestId, mission },
      });
    }
    expect(service.startInputs).toEqual([start, start]);
  });

  test("posts and subscribes through the Mission-owned room surface", async () => {
    const service = new FakeTeamRuntimeService(Promise.resolve());
    const runtime = createTeamRuntime({ runtime: { enabled: true }, service });
    await runtime.start();
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];

    await expect(
      runtime.sessionDeps()?.handleRequest(
        {
          type: "team.mission.message.post.request",
          requestId: "post-1",
          missionId: "mission-room",
          body: "  Plan the release  ",
        },
        { actorId: "human-client" },
      ),
    ).resolves.toMatchObject({
      type: "team.mission.message.post.response",
      payload: {
        requestId: "post-1",
        missionId: "mission-room",
        message: { missionId: "mission-room", author: { kind: "human", id: "human-client" } },
        error: null,
      },
    });
    expect(service.postMessageInputs).toEqual([
      {
        missionId: "mission-room",
        actorId: "human-client",
        idempotencyKey: "post-1",
        body: "  Plan the release  ",
      },
    ]);

    await expect(
      runtime.sessionDeps()?.handleRequest(
        {
          type: "team.mission.room.subscribe.request",
          requestId: "subscribe-1",
          missionId: "mission-room",
          afterCursor: 0,
          limit: 25,
        },
        {
          actorId: "human-client",
          subscribeMissionRoom: (missionId) => subscribed.push(missionId),
          unsubscribeMissionRoom: (missionId) => unsubscribed.push(missionId),
        },
      ),
    ).resolves.toMatchObject({
      type: "team.mission.room.subscribe.response",
      payload: {
        missionId: "mission-room",
        cursor: 1,
        hasMore: false,
        messages: [{ id: "message-1" }],
        error: null,
      },
    });
    expect(subscribed).toEqual(["mission-room"]);

    await runtime.sessionDeps()?.handleRequest(
      {
        type: "team.mission.room.unsubscribe.request",
        requestId: "unsubscribe-1",
        missionId: "mission-room",
      },
      {
        actorId: "human-client",
        unsubscribeMissionRoom: (missionId) => unsubscribed.push(missionId),
      },
    );
    expect(unsubscribed).toEqual(["mission-room"]);
  });

  test("registers tools for internally recovered Agents while keeping the external facade gated", async () => {
    const service = new FakeTeamRuntimeService(Promise.resolve());
    const calls: string[] = [];
    const registerTool = () => undefined;
    let runtime: TeamRuntime;
    const agentTools = {
      reconcile: async () => {
        calls.push("reconcile-tools");
        runtime.registerAgentTools("agent-recovery", registerTool);
      },
      register: (callerAgentId: string | undefined) => {
        calls.push(`register:${callerAgentId ?? "none"}`);
      },
    };
    runtime = createTeamRuntime({ runtime: { enabled: true }, service, agentTools });

    runtime.registerAgentTools("agent-lead", registerTool);
    await runtime.start();
    runtime.registerAgentTools("agent-lead", registerTool);

    expect(calls).toEqual(["reconcile-tools", "register:agent-recovery", "register:agent-lead"]);
  });

  test("runs a non-overlapping reconciliation sweep and stops the timer", async () => {
    vi.useFakeTimers();
    let reconciliationCall = 0;
    let releaseSweep: (() => void) | null = null;
    const blockedSweep = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    const service = new FakeTeamRuntimeService(() => {
      reconciliationCall += 1;
      return reconciliationCall === 2 ? blockedSweep : Promise.resolve();
    });
    const runtime = createTeamRuntime({
      runtime: { enabled: true, reconcileIntervalMs: 1_000 },
      service,
    });
    await runtime.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.reconcileCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(service.reconcileCalls).toBe(2);

    releaseSweep?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.reconcileCalls).toBe(3);

    runtime.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(service.reconcileCalls).toBe(3);
  });
});

class FakeTeamRuntimeService implements TeamRuntimeService {
  readonly archiveInputs: Parameters<TeamRuntimeService["archiveTeam"]>[0][] = [];
  readonly startInputs: Parameters<TeamRuntimeService["startMission"]>[0][] = [];
  readonly postMessageInputs: Parameters<TeamRuntimeService["postMissionMessage"]>[0][] = [];
  private readonly roomMessageListeners = new Set<
    Parameters<TeamRuntimeService["onMissionRoomMessage"]>[0]
  >();
  private readonly roomMessages: TeamRoomMessage[] = [];
  reconcileCalls = 0;

  constructor(
    private readonly reconciliation: Promise<void> | (() => Promise<void>),
    private readonly team: TeamV2 | null = null,
    private readonly missions: TeamMission[] = [],
  ) {}

  reconcile(): Promise<void> {
    this.reconcileCalls += 1;
    return typeof this.reconciliation === "function" ? this.reconciliation() : this.reconciliation;
  }

  async createTeam(): Promise<TeamV2> {
    throw new Error("not used");
  }

  async listTeams(): Promise<TeamV2[]> {
    return [];
  }

  async inspectTeam(teamId: string): Promise<TeamV2 | null> {
    return this.team?.id === teamId ? this.team : null;
  }

  async updateTeam(): Promise<TeamV2> {
    throw new Error("not used");
  }

  async archiveTeam(input: Parameters<TeamRuntimeService["archiveTeam"]>[0]): Promise<TeamV2> {
    this.archiveInputs.push(input);
    if (!this.team) throw new Error("Team fixture is required");
    return this.team;
  }

  async startMission(
    input: Parameters<TeamRuntimeService["startMission"]>[0],
  ): Promise<TeamMission> {
    this.startInputs.push(input);
    const mission = this.missions[0];
    if (!mission) throw new Error("Mission fixture is required");
    return mission;
  }

  async listMissions(teamId: string): Promise<TeamMission[]> {
    return this.missions.filter((mission) => mission.teamId === teamId);
  }

  async inspectMission(missionId: string): Promise<TeamMission | null> {
    return this.missions.find((mission) => mission.id === missionId) ?? null;
  }

  async postMissionMessage(
    input: Parameters<TeamRuntimeService["postMissionMessage"]>[0],
  ): ReturnType<TeamRuntimeService["postMissionMessage"]> {
    this.postMessageInputs.push(input);
    const message: TeamRoomMessage = {
      id: `message-${this.roomMessages.length + 1}`,
      missionId: input.missionId,
      roomId: `room:${input.missionId}`,
      authorAgentId: input.actorId,
      author: { kind: "human", id: input.actorId },
      body: input.body.trim(),
      replyToMessageId: input.replyToMessageId ?? null,
      mentionAgentIds: [],
      createdAt: timestamp,
    };
    this.roomMessages.push(message);
    const event = { missionId: input.missionId, message, cursor: this.roomMessages.length };
    for (const listener of this.roomMessageListeners) listener(event);
    return event;
  }

  async readMissionRoom(): ReturnType<TeamRuntimeService["readMissionRoom"]> {
    return { messages: [...this.roomMessages], cursor: this.roomMessages.length, hasMore: false };
  }

  onMissionRoomMessage(
    listener: Parameters<TeamRuntimeService["onMissionRoomMessage"]>[0],
  ): () => void {
    this.roomMessageListeners.add(listener);
    return () => this.roomMessageListeners.delete(listener);
  }

  async cancelMission(): Promise<TeamMission> {
    throw new Error("not used");
  }

  async resolveAttention(): Promise<TeamMission> {
    throw new Error("not used");
  }
}

const timestamp = "2026-08-08T08:00:00.000Z";

function teamProfile(): TeamV2 {
  return {
    id: "team-v2",
    name: "V2 Team",
    workspaceId: "workspace-v2",
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
    activeMissionId: null,
    lifecycleRecoveryFailure: null,
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}

function teamMission(
  team: TeamV2,
  input: {
    id: string;
    roomId: string;
    status: "planning" | "canceled";
    agentId: string;
    archivedAt: string | null;
  },
): TeamMission {
  return {
    id: input.id,
    teamId: team.id,
    workspaceId: team.workspaceId,
    objective: "Resolve mentions against this Mission.",
    constraints: [],
    acceptanceCriteria: ["Historical rooms never wake later participants."],
    status: input.status,
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
              toolIds: [],
              capabilityIds: [],
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
    chatRoomId: input.roomId,
    participants: [
      {
        memberId: team.leadMemberId,
        agentId: input.agentId,
        bindingEpoch: 1,
        joinedAt: timestamp,
        archivedAt: input.archivedAt,
      },
    ],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: input.status === "canceled" ? timestamp : null,
  };
}
