import type { MissionParticipant, TeamMission } from "@getpaseo/protocol/team/v2-types";
import { TEAM_MENTION_TOKEN_SOURCE } from "@getpaseo/protocol/team/mention-handles";

import { TeamApplicationError } from "./team-mission-service.js";

const TEAM_MENTION_PATTERN = new RegExp(`(?:^|[\\s(])@(${TEAM_MENTION_TOKEN_SOURCE})`, "gi");

export function resolveMentionedParticipants(
  mission: TeamMission,
  body: string,
): MissionParticipant[] {
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
