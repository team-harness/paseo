import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import type { TeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import type { Agent } from "@/stores/session-store";

export interface TeamPanelMember {
  memberId: string;
  agentId: string;
  role: string;
  mentionHandle: string;
  active: boolean;
  isLead: boolean;
  agent: Agent | null;
}

export interface TeamPanelView {
  state: TeamMissionsReplica["status"] | "missing";
  team: TeamV2 | null;
  mission: TeamMission | null;
  members: TeamPanelMember[];
  canStartMission: boolean;
  readOnly: boolean;
  settingsAttentionCount: number;
}

export function describeTeamRoomAuthor(input: {
  role: string | null;
  mentionHandle: string | null;
  isHuman: boolean;
  youLabel: string;
  agentLabel: string;
}): string {
  if (input.isHuman) return input.youLabel;
  if (input.role && input.mentionHandle) return `${input.role} · @${input.mentionHandle}`;
  if (input.role) return input.role;
  if (input.mentionHandle) return `@${input.mentionHandle}`;
  return input.agentLabel;
}

/** Joins one Team profile to the selected Mission and its versioned participant roster. */
export function selectTeamPanelView(
  replica: TeamMissionsReplica,
  teamId: string,
  agents: ReadonlyMap<string, Agent>,
  selectedMissionId: string | null = null,
): TeamPanelView {
  const team = replica.profiles.get(teamId) ?? null;
  if (replica.status !== "ready") {
    return {
      state: replica.status,
      team,
      mission: null,
      members: [],
      canStartMission: false,
      readOnly: true,
      settingsAttentionCount: 0,
    };
  }
  if (!team) {
    return {
      state: "missing",
      team: null,
      mission: null,
      members: [],
      canStartMission: false,
      readOnly: true,
      settingsAttentionCount: 0,
    };
  }

  const missionId = selectedMissionId ?? team.activeMissionId;
  const candidate = missionId ? (replica.missions.get(missionId) ?? null) : null;
  const mission = candidate?.teamId === team.id ? candidate : null;
  const members = mission ? selectMissionMembers(mission, agents) : [];
  return {
    state: "ready",
    team,
    mission,
    members,
    canStartMission: team.lifecycle === "active" && team.activeMissionId === null,
    readOnly: team.lifecycle !== "active" || mission === null || isTerminalMission(mission),
    settingsAttentionCount: countSettingsAttention(team, mission, members),
  };
}

function isTerminalMission(mission: TeamMission): boolean {
  return (
    mission.status === "completed" || mission.status === "failed" || mission.status === "canceled"
  );
}

function countSettingsAttention(
  team: TeamV2,
  mission: TeamMission | null,
  members: readonly TeamPanelMember[],
): number {
  let count = team.lifecycleRecoveryFailure ? 1 : 0;
  if (mission?.lifecycleRecoveryFailure) count += 1;
  count += mission?.attentionItems.filter((item) => item.status === "open").length ?? 0;
  for (const member of members) {
    if (!member.active) continue;
    count += member.agent?.pendingPermissions.length ?? 0;
  }
  return count;
}

function selectMissionMembers(
  mission: TeamMission,
  agents: ReadonlyMap<string, Agent>,
): TeamPanelMember[] {
  const snapshot = mission.rosterSnapshots.find(
    (candidate) => candidate.revision === mission.activeRosterSnapshotRevision,
  );
  if (!snapshot) return [];
  const membersById = new Map(snapshot.members.map((member) => [member.memberId, member]));

  return mission.participants.flatMap((participant) => {
    const member = membersById.get(participant.memberId);
    if (!member) return [];
    return [
      {
        memberId: member.memberId,
        agentId: participant.agentId,
        role: member.role,
        mentionHandle: member.mentionHandle,
        active: participant.archivedAt === null,
        isLead: member.memberId === snapshot.leadMemberId,
        agent: agents.get(participant.agentId) ?? null,
      },
    ];
  });
}
