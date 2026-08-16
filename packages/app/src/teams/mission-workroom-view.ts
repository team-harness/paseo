import type { AgentProfileExecutionFacts } from "@getpaseo/protocol/team/execution-source-status";
import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  selectTeamAttentionRows,
  selectTeamMemberSettingsRows,
  selectTeamPlanRows,
  type TeamAttentionRow,
  type TeamMemberSettingsRow,
  type TeamPlanRow,
} from "@/teams/team-settings-view";

export interface MissionWorkroomResult {
  readonly id: string;
  readonly workstreamId: string;
  readonly workstreamTitle: string;
  readonly status: "completed" | "blocked" | "failed";
  readonly summary: string;
  readonly artifactPaths: readonly string[];
}

export interface MissionWorkroomView {
  readonly missionId: string;
  readonly objective: string;
  readonly status: TeamMission["status"];
  readonly workspaceId: string;
  readonly workspaceLabel: string;
  readonly attentionCount: number;
  readonly members: readonly TeamMemberSettingsRow[];
  readonly workstreams: readonly TeamPlanRow[];
  readonly attention: readonly TeamAttentionRow[];
  readonly results: readonly MissionWorkroomResult[];
}

export function selectMissionWorkroomView({
  team,
  mission,
  workspaceLabel,
  agentProfiles = [],
}: {
  team: TeamV2;
  mission: TeamMission;
  workspaceLabel: string;
  agentProfiles?: readonly AgentProfileExecutionFacts[];
}): MissionWorkroomView {
  const workstreams = selectTeamPlanRows(team, mission);
  const attention = selectTeamAttentionRows(mission);
  return {
    missionId: mission.id,
    objective: mission.objective,
    status: mission.status,
    workspaceId: mission.workspaceId,
    workspaceLabel,
    attentionCount: attention.length,
    members: selectTeamMemberSettingsRows(team, mission, agentProfiles),
    workstreams,
    attention,
    results: workstreams.flatMap((workstream) =>
      workstream.reports.map((report, index) => ({
        id: `${workstream.workstreamId}:${index}`,
        workstreamId: workstream.workstreamId,
        workstreamTitle: workstream.title,
        status: report.status,
        summary: report.summary,
        artifactPaths: report.artifactPaths,
      })),
    ),
  };
}
