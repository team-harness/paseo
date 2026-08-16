import type {
  MissionParticipant,
  TeamMission,
  TeamRoomMessage,
} from "@getpaseo/protocol/team/v2-types";
import { TEAM_MENTION_TOKEN_SOURCE } from "@getpaseo/protocol/team/mention-handles";

import { TeamApplicationError } from "./team-mission-service.js";

const TEAM_MENTION_PATTERN = new RegExp(`(?:^|[\\s(])@(${TEAM_MENTION_TOKEN_SOURCE})`, "gi");

export interface ResolveRoomMessageRecipientsInput {
  mission: TeamMission;
  body: string;
  author: { kind: "human"; id: string } | { kind: "agent"; id: string };
  replyToMessage: TeamRoomMessage | null;
}

export function resolveRoomMessageRecipients(
  input: ResolveRoomMessageRecipientsInput,
): MissionParticipant[] {
  const roster = input.mission.rosterSnapshots.find(
    (candidate) => candidate.revision === input.mission.activeRosterSnapshotRevision,
  );
  if (!roster) {
    throw new TeamApplicationError(
      "active_roster_not_found",
      `Mission ${input.mission.id} has no active roster snapshot`,
    );
  }

  const index = buildRecipientIndex(input.mission, roster.members);
  const recipientMemberIds = resolveExplicitRecipientMemberIds(
    input.mission.id,
    roster.members,
    input.body,
    index,
  );

  if (input.author.kind === "human" && input.replyToMessage?.author.kind === "agent") {
    const repliedMemberId = index.memberIdByHistoricalAgentId.get(input.replyToMessage.author.id);
    const participant = repliedMemberId ? index.activeByMemberId.get(repliedMemberId) : null;
    if (participant) recipientMemberIds.add(participant.memberId);
  }

  if (input.author.kind === "human" && recipientMemberIds.size === 0) {
    const lead = index.activeByMemberId.get(roster.leadMemberId);
    if (lead) recipientMemberIds.add(lead.memberId);
  }

  if (input.author.kind === "agent") {
    const authorMemberId = index.memberIdByHistoricalAgentId.get(input.author.id);
    if (authorMemberId) recipientMemberIds.delete(authorMemberId);
  }

  return roster.members.flatMap((member) => {
    if (!recipientMemberIds.has(member.memberId)) return [];
    const participant = index.activeByMemberId.get(member.memberId);
    return participant ? [participant] : [];
  });
}

interface RecipientIndex {
  activeByMemberId: Map<string, MissionParticipant>;
  activeByAgentId: Map<string, MissionParticipant>;
  memberIdByHistoricalAgentId: Map<string, string>;
  memberIdByHandle: Map<string, string>;
}

function buildRecipientIndex(
  mission: TeamMission,
  members: readonly { memberId: string; mentionHandle: string }[],
): RecipientIndex {
  const activeByMemberId = new Map<string, MissionParticipant>();
  const memberIdByHistoricalAgentId = new Map<string, string>();
  for (const participant of mission.participants) {
    memberIdByHistoricalAgentId.set(participant.agentId, participant.memberId);
    if (participant.archivedAt !== null) continue;
    const current = activeByMemberId.get(participant.memberId);
    if (!current || participant.bindingEpoch > current.bindingEpoch) {
      activeByMemberId.set(participant.memberId, participant);
    }
  }
  return {
    activeByMemberId,
    activeByAgentId: new Map(
      [...activeByMemberId.values()].map((participant) => [
        participant.agentId.toLowerCase(),
        participant,
      ]),
    ),
    memberIdByHistoricalAgentId,
    memberIdByHandle: new Map(
      members.map((member) => [member.mentionHandle.toLowerCase(), member.memberId]),
    ),
  };
}

function resolveExplicitRecipientMemberIds(
  missionId: string,
  rosterMembers: readonly { memberId: string }[],
  body: string,
  index: RecipientIndex,
): Set<string> {
  const resolved = new Set<string>();
  for (const match of body.matchAll(TEAM_MENTION_PATTERN)) {
    const token = match[1]?.toLowerCase();
    if (!token || token === "everyone") continue;
    if (token === "team") {
      for (const member of rosterMembers) {
        if (index.activeByMemberId.has(member.memberId)) resolved.add(member.memberId);
      }
      continue;
    }
    const memberId = index.memberIdByHandle.get(token);
    if (memberId) {
      if (!index.activeByMemberId.has(memberId)) {
        throw new TeamApplicationError(
          "mission_member_not_provisioned",
          `Member ${memberId} has no active participant in Mission ${missionId}`,
        );
      }
      resolved.add(memberId);
      continue;
    }
    const participant = index.activeByAgentId.get(token);
    if (participant) resolved.add(participant.memberId);
  }
  return resolved;
}
