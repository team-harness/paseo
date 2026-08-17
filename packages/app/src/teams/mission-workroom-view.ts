import type { AgentProfileExecutionFacts } from "@getpaseo/protocol/team/execution-source-status";
import type {
  MissionAssignmentReport,
  TeamMission,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";

import {
  selectTeamAttentionRows,
  selectTeamMemberSettingsRows,
  selectTeamPlanRows,
  type TeamAttentionRow,
  type TeamMemberSettingsRow,
  type TeamPlanRow,
} from "@/teams/team-settings-view";
import type { TeamPanelMember } from "@/teams/team-panel-view";
import type { Agent } from "@/stores/session-store";

export interface MissionWorkroomAssignment {
  readonly assignmentId: string;
  readonly kind: "delivery" | "review" | "verification";
  readonly objective: string;
  readonly state: TeamMission["assignments"][number]["semanticState"];
}

export interface MissionWorkroomMember extends TeamMemberSettingsRow {
  readonly agentLifecycleStatus: Agent["status"] | null;
  readonly requiresAttention: boolean;
  readonly attentionReason: Agent["attentionReason"];
  readonly pendingPermissionCount: number;
  readonly currentAssignments: readonly MissionWorkroomAssignment[];
  readonly needsInput: boolean;
}

export interface MissionWorkroomDependency {
  readonly workstreamId: string;
  readonly title: string;
  readonly status: TeamPlanRow["status"];
}

export interface MissionWorkroomWorkstream extends TeamPlanRow {
  readonly dependencies: readonly MissionWorkroomDependency[];
}

export interface MissionWorkroomReport {
  readonly assignmentId: string;
  readonly assignmentKind: "delivery" | "review" | "verification";
  readonly assigneeRole: string;
  readonly status: MissionAssignmentReport["status"];
  readonly summary: string;
  readonly artifactPaths: readonly string[];
  readonly tests: MissionAssignmentReport["tests"];
  readonly verdict: "approved" | "changes_requested" | null;
}

export interface MissionWorkroomResult {
  readonly workstreamId: string;
  readonly workstreamTitle: string;
  readonly reviewOutcome: TeamPlanRow["reviewOutcome"];
  readonly reviewReport: MissionAssignmentReport | null;
  readonly reviewWaiver: TeamPlanRow["reviewWaiver"];
  readonly finalVerificationStatus: TeamPlanRow["finalVerificationStatus"];
  readonly finalVerificationEvidence: TeamPlanRow["finalVerificationEvidence"];
  readonly reports: readonly MissionWorkroomReport[];
}

export interface MissionWorkroomView {
  readonly missionId: string;
  readonly objective: string;
  readonly status: TeamMission["status"];
  readonly workspaceId: string;
  readonly workspaceLabel: string;
  readonly attentionCount: number;
  readonly members: readonly MissionWorkroomMember[];
  readonly workstreams: readonly MissionWorkroomWorkstream[];
  readonly attention: readonly TeamAttentionRow[];
  readonly results: readonly MissionWorkroomResult[];
}

export function selectMissionWorkroomView({
  team,
  mission,
  workspaceLabel,
  agentProfiles = [],
  runtimeMembers = [],
}: {
  team: TeamV2;
  mission: TeamMission;
  workspaceLabel: string;
  agentProfiles?: readonly AgentProfileExecutionFacts[];
  runtimeMembers?: readonly TeamPanelMember[];
}): MissionWorkroomView {
  const planRows = selectTeamPlanRows(team, mission);
  const planRowsById = new Map(planRows.map((row) => [row.workstreamId, row]));
  const workstreams = planRows.map((row) => buildMissionWorkroomWorkstream(row, planRowsById));
  const attention = selectTeamAttentionRows(mission);
  const memberRows = selectTeamMemberSettingsRows(team, mission, agentProfiles);
  const runtimeMembersById = new Map(runtimeMembers.map((member) => [member.memberId, member]));
  const assignmentsByMember = Map.groupBy(
    mission.assignments.filter((assignment) => isCurrentAssignment(mission, assignment)),
    (assignment) => assignment.assigneeMemberId,
  );
  const assignmentsByWorkstream = Map.groupBy(
    mission.assignments.filter((assignment) => assignment.planRevision === mission.planRevision),
    (assignment) => assignment.workstreamId,
  );
  const attentionAssignmentIds = new Set(
    attention.flatMap((item) => (item.assignmentId ? [item.assignmentId] : [])),
  );
  const leadNeedsInput = attention.some((item) => item.kind === "lead_unavailable");
  return {
    missionId: mission.id,
    objective: mission.objective,
    status: mission.status,
    workspaceId: mission.workspaceId,
    workspaceLabel,
    attentionCount: attention.length,
    members: memberRows.map((member) =>
      buildMissionWorkroomMember(
        member,
        assignmentsByMember.get(member.memberId) ?? [],
        attentionAssignmentIds,
        leadNeedsInput,
        runtimeMembersById.get(member.memberId)?.agent ?? null,
      ),
    ),
    workstreams,
    attention,
    results: workstreams.map((workstream) => ({
      workstreamId: workstream.workstreamId,
      workstreamTitle: workstream.title,
      reviewOutcome: workstream.reviewOutcome,
      reviewReport: workstream.reviewReport,
      reviewWaiver: workstream.reviewWaiver,
      finalVerificationStatus: workstream.finalVerificationStatus,
      finalVerificationEvidence: workstream.finalVerificationEvidence,
      reports: (assignmentsByWorkstream.get(workstream.workstreamId) ?? []).flatMap(
        (assignment) => {
          const report = assignment.report;
          if (!report) return [];
          return [
            {
              assignmentId: assignment.assignmentId,
              assignmentKind: assignment.kind,
              assigneeRole: memberForMission(team, mission, assignment.assigneeMemberId).role,
              status: report.status,
              summary: report.summary,
              artifactPaths: report.artifactPaths,
              tests: report.tests,
              verdict: report.status === "completed" ? report.verdict : null,
            },
          ];
        },
      ),
    })),
  };
}

function buildMissionWorkroomWorkstream(
  row: TeamPlanRow,
  planRowsById: ReadonlyMap<string, TeamPlanRow>,
): MissionWorkroomWorkstream {
  return {
    ...row,
    dependencies: row.dependencyWorkstreamIds.map((workstreamId) => {
      const dependency = planRowsById.get(workstreamId);
      return {
        workstreamId,
        title: dependency?.title ?? workstreamId,
        status: dependency?.status ?? "planned",
      };
    }),
  };
}

function buildMissionWorkroomMember(
  member: TeamMemberSettingsRow,
  assignments: readonly TeamMission["assignments"][number][],
  attentionAssignmentIds: ReadonlySet<string>,
  leadNeedsInput: boolean,
  agent: Agent | null,
): MissionWorkroomMember {
  const currentAssignments = assignments.map((assignment) => ({
    assignmentId: assignment.assignmentId,
    kind: assignment.kind,
    objective: assignment.objective,
    state: assignment.semanticState,
  }));
  return {
    ...member,
    agentLifecycleStatus: agent?.status ?? null,
    requiresAttention: agent?.requiresAttention === true,
    attentionReason: agent?.attentionReason ?? null,
    pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
    currentAssignments,
    needsInput:
      (member.isLead && leadNeedsInput) ||
      currentAssignments.some((assignment) =>
        attentionAssignmentIds.has(assignment.assignmentId),
      ) ||
      agent?.requiresAttention === true ||
      (agent?.pendingPermissions.length ?? 0) > 0,
  };
}

function isCurrentAssignment(
  mission: TeamMission,
  assignment: TeamMission["assignments"][number],
): boolean {
  return (
    assignment.planRevision === mission.planRevision &&
    assignment.semanticState !== "completed" &&
    assignment.semanticState !== "failed" &&
    assignment.semanticState !== "canceled"
  );
}

function memberForMission(team: TeamV2, mission: TeamMission, memberId: string) {
  const roster = mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === mission.activeRosterSnapshotRevision,
  );
  const member =
    roster?.members.find((candidate) => candidate.memberId === memberId) ??
    team.members.find((candidate) => candidate.memberId === memberId);
  return {
    role: member?.role ?? memberId,
  };
}
