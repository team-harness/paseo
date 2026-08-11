import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TeamMission } from "@getpaseo/protocol/team/v2-types";

import { MissionRoomStore } from "../persistence/mission-room-store.js";
import type { StoredMission } from "../persistence/schemas.js";
import type { TeamRoomMentionWakePort } from "./ports.js";
import { TeamOperationCoordinator } from "./team-operation-coordinator.js";
import { TeamRoomService } from "./team-room-service.js";

const NOW = "2026-08-11T03:00:00.000Z";

describe("TeamRoomService", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-room-service-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("persists resolved active mentions before waking each participant once", async () => {
    const mission = createMission();
    const rooms = new MissionRoomStore(rootDirectory, () => NOW);
    await rooms.create({
      missionId: mission.id,
      roomId: mission.chatRoomId,
      teamId: mission.teamId,
    });
    const wakeInputs: Array<Parameters<TeamRoomMentionWakePort["wake"]>[0]> = [];
    const wake: TeamRoomMentionWakePort = {
      wake: async (input) => {
        const persisted = await rooms.read({ missionId: mission.id });
        expect(persisted.messages).toHaveLength(1);
        wakeInputs.push(structuredClone(input));
      },
    };
    const service = new TeamRoomService({
      missions: { get: async () => ({ mission, finishIntent: null }) as StoredMission },
      rooms,
      mentionWake: wake,
      ids: { next: () => "message-human-1" },
      operations: new TeamOperationCoordinator(),
    });

    const posted = await service.postHumanMessage({
      missionId: mission.id,
      actorId: "user-1",
      body: "@agent-lead @software-engineer @agent-engineer @reviewer @unknown @everyone please review",
      replyToMessageId: null,
    });

    expect(posted.message).toMatchObject({
      id: "message-human-1",
      author: { kind: "human", id: "user-1" },
      body: "@agent-lead @software-engineer @agent-engineer @reviewer @unknown @everyone please review",
      mentionAgentIds: ["agent-lead", "agent-engineer"],
    });
    expect(wakeInputs).toEqual([
      {
        messageId: "message-human-1",
        missionId: mission.id,
        recipientAgentId: "agent-lead",
        bindingEpoch: 1,
      },
      {
        messageId: "message-human-1",
        missionId: mission.id,
        recipientAgentId: "agent-engineer",
        bindingEpoch: 2,
      },
    ]);
  });

  test("keeps a persisted post successful when a mention wake fails", async () => {
    const mission = createMission();
    const rooms = new MissionRoomStore(rootDirectory, () => NOW);
    await rooms.create({
      missionId: mission.id,
      roomId: mission.chatRoomId,
      teamId: mission.teamId,
    });
    const attemptedAgentIds: string[] = [];
    const wakeErrors: string[] = [];
    const service = new TeamRoomService({
      missions: { get: async () => ({ mission, finishIntent: null }) as StoredMission },
      rooms,
      mentionWake: {
        wake: async ({ recipientAgentId }) => {
          attemptedAgentIds.push(recipientAgentId);
          if (recipientAgentId === "agent-lead") throw new Error("provider unavailable");
        },
      },
      ids: { next: () => "message-human-2" },
      operations: new TeamOperationCoordinator(),
      onWakeError: (error) => wakeErrors.push((error as Error).message),
    });

    await expect(
      service.postHumanMessage({
        missionId: mission.id,
        actorId: "user-1",
        body: "@everyone status?",
      }),
    ).resolves.toMatchObject({ message: { id: "message-human-2" } });

    expect(attemptedAgentIds).toEqual(["agent-lead", "agent-engineer"]);
    expect(wakeErrors).toEqual(["provider unavailable"]);
    await expect(rooms.read({ missionId: mission.id })).resolves.toMatchObject({
      messages: [{ id: "message-human-2" }],
    });
  });

  test("rechecks the finish fence under the Team lock before persisting", async () => {
    const mission = createMission();
    const rooms = new MissionRoomStore(rootDirectory, () => NOW);
    await rooms.create({
      missionId: mission.id,
      roomId: mission.chatRoomId,
      teamId: mission.teamId,
    });
    let reads = 0;
    const service = new TeamRoomService({
      missions: {
        get: async () =>
          ({
            mission: reads++ === 0 ? mission : { ...mission, status: "canceled" },
            finishIntent: null,
          }) as StoredMission,
      },
      rooms,
      mentionWake: { wake: async () => undefined },
      ids: { next: () => "message-after-finish" },
      operations: new TeamOperationCoordinator(),
    });

    await expect(
      service.postHumanMessage({
        missionId: mission.id,
        actorId: "user-1",
        body: "@everyone too late",
      }),
    ).rejects.toMatchObject({ code: "mission_messages_closed" });
    await expect(rooms.read({ missionId: mission.id })).resolves.toMatchObject({ messages: [] });
  });
});

function createMission(): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Implement room mentions",
    constraints: [],
    acceptanceCriteria: ["Mentioned participants wake"],
    status: "active",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        leadMemberId: "member-lead",
        members: [
          createMember("member-lead", "Technical lead", "technical-lead"),
          createMember("member-engineer", "Software engineer", "software-engineer"),
          createMember("member-reviewer", "Reviewer", "reviewer"),
        ],
        createdAt: NOW,
      },
    ],
    planRevision: 1,
    revision: 1,
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
        joinedAt: NOW,
        archivedAt: null,
      },
      {
        memberId: "member-engineer",
        agentId: "agent-engineer",
        bindingEpoch: 2,
        joinedAt: NOW,
        archivedAt: null,
      },
      {
        memberId: "member-reviewer",
        agentId: "agent-reviewer",
        bindingEpoch: 1,
        joinedAt: NOW,
        archivedAt: NOW,
      },
    ],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function createMember(memberId: string, role: string, mentionHandle: string) {
  return {
    memberId,
    role,
    level: 3 as const,
    skillIds: ["typescript"],
    executionProfile: {
      provider: "codex",
      model: "gpt-5.6-sol",
      modeId: "auto",
      thinkingOptionId: null,
      featureValues: {},
    },
    mentionHandle,
    runtimeSnapshot: null,
  };
}
