import type {
  MissionAttentionItem,
  MissionAssignmentReport,
  MissionMutableScope,
  TeamMission,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";

export type TeamParticipantState = "not_started" | "active" | "archived";

export interface TeamMemberSettingsRow {
  readonly memberId: string;
  readonly role: string;
  readonly level: number;
  readonly mentionHandle: string;
  readonly skillNames: readonly string[];
  readonly provider: string;
  readonly model: string | null;
  readonly isLead: boolean;
  readonly participantAgentId: string | null;
  readonly participantState: TeamParticipantState;
}

export interface TeamPlanMember {
  readonly memberId: string;
  readonly role: string;
  readonly mentionHandle: string;
}

export interface TeamPlanRow {
  readonly workstreamId: string;
  readonly kind: "delivery" | "integration" | "verification";
  readonly title: string;
  readonly objective: string;
  readonly status: "planned" | "ready" | "active" | "blocked" | "review" | "accepted" | "canceled";
  readonly owner: TeamPlanMember;
  readonly reviewer: TeamPlanMember | null;
  readonly dependencyWorkstreamIds: readonly string[];
  readonly scope: MissionMutableScope;
  readonly assignmentStates: readonly string[];
  readonly reports: readonly MissionAssignmentReport[];
  readonly artifactPaths: readonly string[];
}

export interface TeamAttentionRow {
  readonly attentionId: string;
  readonly kind: MissionAttentionItem["kind"];
  readonly assignmentId: string | null;
  readonly summary: string;
  readonly pathEvidence: MissionAttentionItem["pathEvidence"];
  readonly createdAt: string;
}

export interface TeamAttentionRecoveryView {
  readonly leadAgentId: string | null;
  readonly replacementMembers: readonly TeamPlanMember[];
}

export function selectTeamMissionHistory(
  history: readonly TeamMission[],
  currentMission: TeamMission | null,
): TeamMission[] {
  if (!currentMission) return [...history];
  return history.filter((mission) => mission.id !== currentMission.id);
}

function participantForMember(mission: TeamMission | null, memberId: string) {
  if (!mission) return null;
  return (
    [...mission.participants]
      .filter((participant) => participant.memberId === memberId)
      .sort((left, right) => right.bindingEpoch - left.bindingEpoch)[0] ?? null
  );
}

export function selectTeamMemberSettingsRows(
  team: TeamV2,
  mission: TeamMission | null,
): TeamMemberSettingsRow[] {
  const skillNames = new Map(team.skills.map((skill) => [skill.skillId, skill.name]));
  return team.members.map((member) => {
    const participant = participantForMember(mission, member.memberId);
    let participantState: TeamParticipantState = "not_started";
    if (participant) participantState = participant.archivedAt ? "archived" : "active";
    return {
      memberId: member.memberId,
      role: member.role,
      level: member.level,
      mentionHandle: member.mentionHandle,
      skillNames: member.skillIds.map((skillId) => skillNames.get(skillId) ?? skillId),
      provider: member.executionProfile.provider,
      model: member.executionProfile.model,
      isLead: member.memberId === team.leadMemberId,
      participantAgentId: participant?.agentId ?? null,
      participantState,
    };
  });
}

function memberForPlan(team: TeamV2, mission: TeamMission, memberId: string): TeamPlanMember {
  const activeSnapshot = mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === mission.activeRosterSnapshotRevision,
  );
  const member =
    activeSnapshot?.members.find((candidate) => candidate.memberId === memberId) ??
    team.members.find((candidate) => candidate.memberId === memberId);
  return {
    memberId,
    role: member?.role ?? memberId,
    mentionHandle: member?.mentionHandle ?? memberId,
  };
}

export function selectTeamPlanRows(team: TeamV2, mission: TeamMission | null): TeamPlanRow[] {
  if (!mission) return [];
  return mission.workstreams.map((workstream) => {
    const assignments = mission.assignments.filter(
      (assignment) => assignment.workstreamId === workstream.workstreamId,
    );
    const reports = assignments.flatMap((assignment) =>
      assignment.report ? [assignment.report] : [],
    );
    return {
      workstreamId: workstream.workstreamId,
      kind: workstream.kind,
      title: workstream.title,
      objective: workstream.objective,
      status: workstream.status,
      owner: memberForPlan(team, mission, workstream.ownerMemberId),
      reviewer: workstream.reviewerMemberId
        ? memberForPlan(team, mission, workstream.reviewerMemberId)
        : null,
      dependencyWorkstreamIds: workstream.dependencyWorkstreamIds,
      scope: workstream.mutableScope,
      assignmentStates: assignments.map((assignment) => assignment.semanticState),
      reports,
      artifactPaths: Array.from(new Set(reports.flatMap((report) => report.artifactPaths))),
    };
  });
}

export function selectTeamAttentionRows(mission: TeamMission | null): TeamAttentionRow[] {
  if (!mission) return [];
  return mission.attentionItems
    .filter((item) => item.status === "open")
    .map((item) => ({
      attentionId: item.attentionId,
      kind: item.kind,
      assignmentId: item.assignmentId,
      summary: item.summary,
      pathEvidence: item.pathEvidence,
      createdAt: item.createdAt,
    }));
}

export function selectTeamAttentionRecovery(
  mission: TeamMission | null,
): TeamAttentionRecoveryView {
  if (!mission) return { leadAgentId: null, replacementMembers: [] };
  const roster = mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === mission.activeRosterSnapshotRevision,
  );
  if (!roster) return { leadAgentId: null, replacementMembers: [] };
  const leadParticipant = [...mission.participants]
    .filter(
      (participant) =>
        participant.memberId === roster.leadMemberId && participant.archivedAt === null,
    )
    .sort((left, right) => right.bindingEpoch - left.bindingEpoch)[0];
  const membersWithOpenAcceptedWork = new Set(
    mission.assignments
      .filter(
        (assignment) =>
          assignment.acceptedTurnId !== null &&
          assignment.semanticState !== "completed" &&
          assignment.semanticState !== "failed" &&
          assignment.semanticState !== "canceled",
      )
      .map((assignment) => assignment.assigneeMemberId),
  );
  return {
    leadAgentId: leadParticipant?.agentId ?? null,
    replacementMembers: roster.members
      .filter(
        (member) =>
          member.memberId !== roster.leadMemberId &&
          !membersWithOpenAcceptedWork.has(member.memberId),
      )
      .map((member) => ({
        memberId: member.memberId,
        role: member.role,
        mentionHandle: member.mentionHandle,
      })),
  };
}
