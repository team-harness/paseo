import type { TeamMissionStatus } from "@getpaseo/protocol/team/v2-types";

import type { TeamMissionsReplica } from "@/runtime/team-missions-sync/replica";

export interface HostLevelTeamMemberSummary {
  memberId: string;
  role: string;
  isLead: boolean;
}

export interface HostLevelMissionSummary {
  missionId: string;
  objective: string;
  status: TeamMissionStatus;
  workspaceId: string;
  workspaceLabel: string;
  openAttentionCount: number;
}

export interface HostLevelTeamRow {
  teamId: string;
  name: string;
  template: string;
  members: HostLevelTeamMemberSummary[];
  mission: HostLevelMissionSummary | null;
  missionPending: boolean;
  action: "enter_room" | "start_mission" | "view_history" | "loading";
}

/** Active Team profiles that remain reachable without a workspace shell. */
export function selectHostLevelTeamRows(
  replica: TeamMissionsReplica,
  workspaceLabels: ReadonlyMap<string, string> = new Map(),
): HostLevelTeamRow[] {
  if (replica.status !== "ready") return [];

  return [...replica.profiles.values()]
    .filter((team) => team.lifecycle === "active")
    .map((team): HostLevelTeamRow => {
      const mission = team.activeMissionId
        ? (replica.missions.get(team.activeMissionId) ?? null)
        : null;
      const terminal = mission ? isTerminalMissionStatus(mission.status) : false;
      const missionPending = team.activeMissionId !== null && mission === null;
      return {
        teamId: team.id,
        name: team.name,
        template: team.methodologyBinding.presetId ?? team.methodologyBinding.ref.bundleId,
        members: team.members.map((member) => ({
          memberId: member.memberId,
          role: member.role,
          isLead: member.memberId === team.leadMemberId,
        })),
        mission: mission
          ? {
              missionId: mission.id,
              objective: mission.objective,
              status: mission.status,
              workspaceId: mission.workspaceId,
              workspaceLabel: workspaceLabels.get(mission.workspaceId) ?? mission.workspaceId,
              openAttentionCount: mission.attentionItems.filter(
                (attention) => attention.status === "open",
              ).length,
            }
          : null,
        missionPending,
        action: selectNextAction(Boolean(team.activeMissionId), terminal, missionPending),
      };
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.teamId.localeCompare(right.teamId),
    );
}

function selectNextAction(
  hasActiveMission: boolean,
  terminal: boolean,
  missionPending: boolean,
): HostLevelTeamRow["action"] {
  if (missionPending) return "loading";
  if (hasActiveMission) return terminal ? "view_history" : "enter_room";
  return "start_mission";
}

function isTerminalMissionStatus(status: TeamMissionStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}
