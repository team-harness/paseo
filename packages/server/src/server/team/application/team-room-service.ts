import type { MissionParticipant, TeamMission } from "@getpaseo/protocol/team/v2-types";
import { TEAM_MENTION_TOKEN_SOURCE } from "@getpaseo/protocol/team/mention-handles";

import type { MissionStore } from "../persistence/mission-store.js";
import type {
  MissionRoomMessageEvent,
  MissionRoomStore,
} from "../persistence/mission-room-store.js";
import type { StoredMission } from "../persistence/schemas.js";
import { TeamApplicationError } from "./team-mission-service.js";
import type { TeamOperationCoordinator } from "./team-operation-coordinator.js";
import type { TeamIdentityPort, TeamRoomMentionWakePort } from "./ports.js";

const TEAM_MENTION_PATTERN = new RegExp(`(?:^|[\\s(])@(${TEAM_MENTION_TOKEN_SOURCE})`, "gi");

interface TeamRoomServiceOptions {
  missions: Pick<MissionStore, "get">;
  rooms: MissionRoomStore;
  mentionWake: TeamRoomMentionWakePort;
  ids: TeamIdentityPort;
  operations: Pick<TeamOperationCoordinator, "serialize">;
  onWakeError?: (
    error: unknown,
    context: { missionId: string; messageId: string; recipientAgentId: string },
  ) => void;
}

export class TeamRoomService {
  constructor(private readonly options: TeamRoomServiceOptions) {}

  async postHumanMessage(input: {
    missionId: string;
    actorId: string;
    body: string;
    replyToMessageId?: string | null;
  }): Promise<MissionRoomMessageEvent> {
    const initial = await this.requireOpenMission(input.missionId);
    const prepared = await this.options.operations.serialize(initial.mission.teamId, async () => {
      const stored = await this.requireOpenMission(input.missionId);
      const messageId = this.options.ids.next("message");
      const mentionedParticipants = resolveMentionedParticipants(stored.mission, input.body);
      const posted = await this.options.rooms.post({
        missionId: input.missionId,
        roomId: stored.mission.chatRoomId,
        messageId,
        author: { kind: "human", id: input.actorId },
        body: input.body,
        replyToMessageId: input.replyToMessageId,
        mentionAgentIds: mentionedParticipants.map((participant) => participant.agentId),
      });
      return { messageId, mentionedParticipants, posted };
    });

    for (const participant of prepared.mentionedParticipants) {
      try {
        await this.options.mentionWake.wake({
          messageId: prepared.messageId,
          missionId: input.missionId,
          recipientAgentId: participant.agentId,
          bindingEpoch: participant.bindingEpoch,
        });
      } catch (error) {
        try {
          this.options.onWakeError?.(error, {
            missionId: input.missionId,
            messageId: prepared.messageId,
            recipientAgentId: participant.agentId,
          });
        } catch {
          // Observability must not turn a best-effort wake into a failed room post.
        }
      }
    }

    return prepared.posted;
  }

  private async requireOpenMission(missionId: string): Promise<StoredMission> {
    const stored = await this.options.missions.get(missionId);
    if (!stored) {
      throw new TeamApplicationError("mission_not_found", `Mission ${missionId} does not exist`);
    }
    if (isTerminalMission(stored.mission) || stored.finishIntent) {
      throw new TeamApplicationError(
        "mission_messages_closed",
        `Mission ${missionId} no longer accepts messages`,
      );
    }
    return stored;
  }
}

function resolveMentionedParticipants(mission: TeamMission, body: string): MissionParticipant[] {
  const roster = mission.rosterSnapshots.find(
    (candidate) => candidate.revision === mission.activeRosterSnapshotRevision,
  );
  if (!roster) {
    throw new TeamApplicationError(
      "active_roster_not_found",
      `Mission ${mission.id} has no active roster snapshot`,
    );
  }

  const activeByMemberId = new Map<string, MissionParticipant>();
  for (const participant of mission.participants) {
    if (participant.archivedAt !== null) continue;
    const current = activeByMemberId.get(participant.memberId);
    if (!current || participant.bindingEpoch > current.bindingEpoch) {
      activeByMemberId.set(participant.memberId, participant);
    }
  }
  const activeParticipants = roster.members.flatMap((member) => {
    const participant = activeByMemberId.get(member.memberId);
    return participant ? [{ member, participant }] : [];
  });
  const byToken = new Map<string, MissionParticipant>();
  for (const { member, participant } of activeParticipants) {
    byToken.set(member.mentionHandle.toLowerCase(), participant);
    byToken.set(participant.agentId.toLowerCase(), participant);
  }

  const resolved: MissionParticipant[] = [];
  const seenAgentIds = new Set<string>();
  const add = (participant: MissionParticipant) => {
    if (seenAgentIds.has(participant.agentId)) return;
    seenAgentIds.add(participant.agentId);
    resolved.push(participant);
  };
  for (const match of body.matchAll(TEAM_MENTION_PATTERN)) {
    const token = match[1]?.toLowerCase();
    if (!token) continue;
    if (token === "everyone") {
      for (const { participant } of activeParticipants) add(participant);
      continue;
    }
    const participant = byToken.get(token);
    if (participant) add(participant);
  }
  return resolved;
}

function isTerminalMission(mission: TeamMission): boolean {
  return (
    mission.status === "completed" || mission.status === "failed" || mission.status === "canceled"
  );
}
