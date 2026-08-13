import type { TeamMission, TeamSkill, TeamV2 } from "@getpaseo/protocol/team/v2-types";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { AgentProfileExecutionFacts } from "@getpaseo/protocol/team/execution-source-status";
import { selectTeamMemberExecutionSourceStatus } from "@getpaseo/protocol/team/execution-source-status";
import type { AnyCommandResult, OutputOptions, OutputSchema } from "../../output/index.js";

export interface TeamProfileRow {
  id: string;
  name: string;
  workspace: string;
  lifecycle: string;
  revision: number;
  lead: string;
  members: number;
  skills: number;
  activeMission: string;
  updatedAt: string;
}

export function toTeamProfileRow(team: TeamV2): TeamProfileRow {
  const lead = team.members.find((member) => member.memberId === team.leadMemberId);
  return {
    id: team.id,
    name: team.name,
    workspace: team.creationWorkspaceId,
    lifecycle: team.lifecycle,
    revision: team.revision,
    lead: lead?.role ?? team.leadMemberId,
    members: team.members.length,
    skills: team.skills.length,
    activeMission: team.activeMissionId ?? "-",
    updatedAt: team.updatedAt,
  };
}

export interface TeamProfileMemberRow {
  memberId: string;
  role: string;
  level: number;
  skillIds: string[];
  provider: string;
  model: string | null;
  mode: string | null;
  thinking: string | null;
  featureValues: Record<string, unknown>;
  mention: string;
  executionSourceKind: "inline" | "agent_profile";
  executionSource: string | null;
  executionSourceStatus: string;
  executionSourceResolver: number | null;
  executionSourceDigest: string | null;
}

export interface TeamProfileDetail extends TeamProfileRow {
  catalog: TeamSkill[];
  roster: TeamProfileMemberRow[];
  methodology: string;
  preset: string | null;
  memberArchetypeBindings: TeamV2["methodologyBinding"]["memberArchetypeBindings"];
  methodologySkillBindings: TeamV2["methodologyBinding"]["skillBindings"];
  methodologyPolicy: MethodologyDescriptor["policySummary"] | null;
}

export function toTeamProfileDetail(
  team: TeamV2,
  agentProfiles: readonly AgentProfileExecutionFacts[] = [],
  methodology: MethodologyDescriptor | null = null,
): TeamProfileDetail {
  return {
    ...toTeamProfileRow(team),
    methodology: `${team.methodologyBinding.ref.bundleId}@${team.methodologyBinding.ref.version} ${team.methodologyBinding.ref.digest}`,
    preset: team.methodologyBinding.presetId,
    memberArchetypeBindings: team.methodologyBinding.memberArchetypeBindings,
    methodologySkillBindings: team.methodologyBinding.skillBindings,
    methodologyPolicy: methodology?.policySummary ?? null,
    catalog: team.skills,
    roster: team.members.map((member) => ({
      memberId: member.memberId,
      role: member.role,
      level: member.level,
      skillIds: member.skillIds,
      provider: member.executionProfile.provider,
      model: member.executionProfile.model,
      mode: member.executionProfile.modeId,
      thinking: member.executionProfile.thinkingOptionId,
      featureValues: member.executionProfile.featureValues,
      mention: member.mentionHandle,
      executionSourceKind: member.executionProfileSource ? "agent_profile" : "inline",
      executionSource: member.executionProfileSource?.profileId ?? null,
      executionSourceStatus: selectTeamMemberExecutionSourceStatus(member, agentProfiles).kind,
      executionSourceResolver: member.executionProfileSource?.resolverVersion ?? null,
      executionSourceDigest: member.executionProfileSource?.appliedDigest ?? null,
    })),
  };
}

export const teamProfileSchema: OutputSchema<TeamProfileRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "NAME", field: "name", width: 24 },
    { header: "LIFECYCLE", field: "lifecycle", width: 10 },
    { header: "REV", field: "revision", width: 5, align: "right" },
    { header: "MEMBERS", field: "members", width: 8, align: "right" },
    { header: "LEAD ROLE", field: "lead", width: 18 },
    { header: "ACTIVE MISSION", field: "activeMission", width: 20 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

export const teamProfileDetailSchema: OutputSchema<TeamProfileDetail> = {
  ...teamProfileSchema,
  renderHuman(result, _options) {
    const teams = result.type === "list" ? result.data : [result.data];
    return teams.map(renderTeamProfileBlock).join("\n\n");
  },
};

function renderTeamProfileBlock(team: TeamProfileDetail): string {
  const lines = [
    `${team.name} [${team.id}] - ${team.lifecycle} (revision ${team.revision})`,
    `  workspace: ${team.workspace}`,
    `  active Mission: ${team.activeMission}`,
    `  methodology: ${team.methodology}`,
    `  preset: ${team.preset ?? "-"}`,
    `  member archetypes: ${team.memberArchetypeBindings.map((binding) => `${binding.memberId}=${binding.archetypeId ?? "-"}`).join(", ")}`,
    `  methodology skills: ${team.methodologySkillBindings.map((binding) => `${binding.teamSkillId}=${binding.methodologySkillId ?? "-"}`).join(", ")}`,
    `  policy: ${team.methodologyPolicy ? JSON.stringify(team.methodologyPolicy) : "catalog entry unavailable"}`,
    `  skills: ${team.catalog.map((skill) => `${skill.skillId} (${skill.name})`).join(", ")}`,
    "",
    "  ROLE                 LVL PROVIDER       MODEL                 SKILLS",
  ];
  for (const member of team.roster) {
    lines.push(
      `  ${member.role.padEnd(20)} ${String(member.level).padEnd(3)} ` +
        `${member.provider.padEnd(14)} ${(member.model ?? "-").padEnd(21)} ` +
        member.skillIds.join(","),
    );
    lines.push(
      `    source: ${member.executionSourceKind}` +
        (member.executionSource
          ? ` ${member.executionSource} (${member.executionSourceStatus}, resolver ${member.executionSourceResolver}, ${member.executionSourceDigest})`
          : ""),
    );
  }
  return lines.join("\n");
}

export interface MissionRow {
  id: string;
  teamId: string;
  status: string;
  revision: number;
  planRevision: number;
  objective: string;
  participants: number;
  workstreams: number;
  updatedAt: string;
}

export function toMissionRow(mission: TeamMission): MissionRow {
  return {
    id: mission.id,
    teamId: mission.teamId,
    status: mission.status,
    revision: mission.revision,
    planRevision: mission.planRevision,
    objective: mission.objective,
    participants: mission.participants.length,
    workstreams: mission.workstreams.length,
    updatedAt: mission.updatedAt,
  };
}

export interface MissionDetail extends MissionRow {
  workspace: string;
  constraints: string[];
  acceptanceCriteria: string[];
  room: string;
  assignments: number;
  attentionItems: number;
  completedAt: string | null;
}

export function toMissionDetail(mission: TeamMission): MissionDetail {
  return {
    ...toMissionRow(mission),
    workspace: mission.workspaceId,
    constraints: mission.constraints,
    acceptanceCriteria: mission.acceptanceCriteria,
    room: mission.chatRoomId,
    assignments: mission.assignments.length,
    attentionItems: mission.attentionItems.length,
    completedAt: mission.completedAt,
  };
}

export const missionSchema: OutputSchema<MissionRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "STATUS", field: "status", width: 16 },
    { header: "REV", field: "revision", width: 5, align: "right" },
    { header: "PLAN", field: "planRevision", width: 5, align: "right" },
    { header: "PARTICIPANTS", field: "participants", width: 12, align: "right" },
    { header: "WORKSTREAMS", field: "workstreams", width: 11, align: "right" },
    { header: "OBJECTIVE", field: "objective", width: 42 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

export const missionDetailSchema: OutputSchema<MissionDetail> = {
  ...missionSchema,
  renderHuman(result: AnyCommandResult<MissionDetail>, _options: OutputOptions) {
    const missions = result.type === "list" ? result.data : [result.data];
    return missions.map(renderMissionBlock).join("\n\n");
  },
};

function renderMissionBlock(mission: MissionDetail): string {
  return [
    `${mission.objective} [${mission.id}] - ${mission.status} (revision ${mission.revision})`,
    `  Team: ${mission.teamId}`,
    `  workspace: ${mission.workspace}`,
    `  room: ${mission.room}`,
    `  constraints: ${mission.constraints.length ? mission.constraints.join("; ") : "-"}`,
    `  acceptance: ${mission.acceptanceCriteria.join("; ")}`,
    `  participants: ${mission.participants}`,
    `  workstreams: ${mission.workstreams}`,
    `  assignments: ${mission.assignments}`,
    `  attention items: ${mission.attentionItems}`,
  ].join("\n");
}
