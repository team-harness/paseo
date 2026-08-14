import type {
  MissionAttentionItem,
  MissionAssignmentReport,
  MissionMutableScope,
  TeamMission,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";
import { selectOpenWorkstreamAttentionAttributions } from "@getpaseo/protocol/team/attention-blocking";
import type {
  AgentProfileExecutionFacts,
  TeamMemberExecutionSourceStatus,
} from "@getpaseo/protocol/team/execution-source-status";
import { selectTeamMemberExecutionSourceStatus } from "@getpaseo/protocol/team/execution-source-status";
import type {
  ExactMethodologyRef,
  MethodologyDescriptor,
} from "@getpaseo/protocol/team/v2-rpc-schemas";

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
  readonly executionSourceStatus: TeamMemberExecutionSourceStatus;
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
  readonly reviewSubjectAssignmentIds: readonly string[];
  readonly reviewSelection:
    | "not_required"
    | "assigned"
    | "awaiting_reviewer"
    | "awaiting_capabilities";
  readonly reviewOutcome: "not_required" | "pending" | "approved" | "waived";
  readonly reviewReport: MissionAssignmentReport | null;
  readonly reviewWaiver: { waiverId: string; actorId: string; reason: string } | null;
  readonly dependencyWorkstreamIds: readonly string[];
  readonly scope: MissionMutableScope;
  readonly assignmentStates: readonly string[];
  readonly reports: readonly MissionAssignmentReport[];
  readonly artifactPaths: readonly string[];
  readonly blockers: readonly TeamWorkstreamBlocker[];
}

export interface TeamWorkstreamBlocker {
  readonly attentionId: string;
  readonly kind: MissionAttentionItem["kind"];
  readonly summary: string;
  readonly sourceWorkstreamId: string;
  readonly direct: boolean;
}

export interface TeamAttentionRow {
  readonly attentionId: string;
  readonly kind: MissionAttentionItem["kind"];
  readonly assignmentId: string | null;
  readonly summary: string;
  readonly pathEvidence: MissionAttentionItem["pathEvidence"];
  readonly createdAt: string;
  readonly scope: "mission" | "workstream";
  readonly workstreamId: string | null;
  readonly workstreamTitle: string | null;
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
  agentProfiles: readonly AgentProfileExecutionFacts[] = [],
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
      executionSourceStatus: selectTeamMemberExecutionSourceStatus(member, agentProfiles),
    };
  });
}

export interface TeamMethodologyUpgrade {
  readonly expectedRef: ExactMethodologyRef;
  readonly ref: ExactMethodologyRef;
  readonly presetId: string | null;
  readonly memberArchetypeBindings: {
    memberId: string;
    archetypeId: string | null;
  }[];
  readonly skillBindings: {
    teamSkillId: string;
    methodologySkillId: string | null;
  }[];
}

export interface TeamMethodologyUpgradePreview {
  readonly methodology: MethodologyDescriptor;
  readonly upgrade: TeamMethodologyUpgrade;
  readonly archetypeChanges: number;
  readonly skillChanges: number;
  readonly playbookChanges: number;
  readonly policyChanges: number;
  readonly memberBindingPreview: string;
  readonly skillBindingPreview: string;
  readonly currentPolicyPreview: string;
  readonly nextPolicyPreview: string;
}

export function buildTeamMethodologyUpgradePreview(
  team: TeamV2,
  current: MethodologyDescriptor,
  methodology: MethodologyDescriptor,
): TeamMethodologyUpgradePreview {
  const validArchetypes = new Set(methodology.archetypes.map((item) => item.archetypeId));
  const validSkills = new Set(methodology.skills.map((item) => item.skillId));
  const memberBindings = new Map(
    team.methodologyBinding.memberArchetypeBindings.map((item) => [
      item.memberId,
      item.archetypeId,
    ]),
  );
  const skillBindings = new Map(
    team.methodologyBinding.skillBindings.map((item) => [
      item.teamSkillId,
      item.methodologySkillId,
    ]),
  );
  const nextMemberBindings = team.members.map((member) => {
    const prior = memberBindings.get(member.memberId) ?? null;
    return {
      memberId: member.memberId,
      archetypeId: prior && validArchetypes.has(prior) ? prior : null,
    };
  });
  const nextSkillBindings = team.skills.map((skill) => {
    const prior = skillBindings.get(skill.skillId) ?? null;
    return {
      teamSkillId: skill.skillId,
      methodologySkillId: prior && validSkills.has(prior) ? prior : null,
    };
  });
  return {
    methodology,
    upgrade: {
      expectedRef: team.methodologyBinding.ref,
      ref: methodology.ref,
      presetId: methodology.presets.some(
        (preset) => preset.presetId === team.methodologyBinding.presetId,
      )
        ? team.methodologyBinding.presetId
        : null,
      memberArchetypeBindings: nextMemberBindings,
      skillBindings: nextSkillBindings,
    },
    archetypeChanges: symmetricIdDifference(
      current.archetypes.map((item) => item.archetypeId),
      methodology.archetypes.map((item) => item.archetypeId),
    ),
    skillChanges: symmetricIdDifference(
      current.skills.map((item) => item.skillId),
      methodology.skills.map((item) => item.skillId),
    ),
    playbookChanges: symmetricIdDifference(
      current.playbooks.map((item) => item.playbookId),
      methodology.playbooks.map((item) => item.playbookId),
    ),
    policyChanges: countLeafDifferences(current.policySummary, methodology.policySummary),
    memberBindingPreview: nextMemberBindings
      .map((binding) => `${binding.memberId}=${binding.archetypeId ?? "-"}`)
      .join(", "),
    skillBindingPreview: nextSkillBindings
      .map((binding) => `${binding.teamSkillId}=${binding.methodologySkillId ?? "-"}`)
      .join(", "),
    currentPolicyPreview: JSON.stringify(current.policySummary),
    nextPolicyPreview: JSON.stringify(methodology.policySummary),
  };
}

function symmetricIdDifference(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}

function countLeafDifferences(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return 1;
  }
  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>),
  ]);
  return Array.from(keys).reduce(
    (count, key) =>
      countLeafDifferences(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ) + count,
    0,
  );
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
  const attentionAttributions = selectOpenWorkstreamAttentionAttributions(mission);
  return mission.workstreams.map((workstream) => {
    const assignments = mission.assignments.filter(
      (assignment) => assignment.workstreamId === workstream.workstreamId,
    );
    const reports = assignments.flatMap((assignment) =>
      assignment.report ? [assignment.report] : [],
    );
    const gate = workstream.reviewGate;
    const reviewerMemberId =
      gate.kind === "required" && gate.selection.kind === "assigned"
        ? gate.selection.reviewerMemberId
        : null;
    const reviewAssignmentId =
      gate.kind === "required" && gate.outcome.kind === "approved"
        ? gate.outcome.reviewAssignmentId
        : null;
    const waiverId =
      gate.kind === "required" && gate.outcome.kind === "waived" ? gate.outcome.waiverId : null;
    const reviewWaiver =
      waiverId === null
        ? null
        : (mission.reviewWaivers.find((waiver) => waiver.waiverId === waiverId) ?? null);
    return {
      workstreamId: workstream.workstreamId,
      kind: workstream.kind,
      title: workstream.title,
      objective: workstream.objective,
      status: workstream.status,
      owner: memberForPlan(team, mission, workstream.ownerMemberId),
      reviewer: reviewerMemberId ? memberForPlan(team, mission, reviewerMemberId) : null,
      reviewSubjectAssignmentIds:
        gate.kind === "required" ? gate.gateKey.subject.subjectAssignmentIds : [],
      reviewSelection: gate.kind === "required" ? gate.selection.kind : "not_required",
      reviewOutcome: gate.outcome.kind,
      reviewReport:
        reviewAssignmentId === null
          ? null
          : (mission.assignments.find(
              (assignment) => assignment.assignmentId === reviewAssignmentId,
            )?.report ?? null),
      reviewWaiver:
        reviewWaiver === null
          ? null
          : {
              waiverId: reviewWaiver.waiverId,
              actorId: reviewWaiver.actorId,
              reason: reviewWaiver.reason,
            },
      dependencyWorkstreamIds: workstream.dependencyWorkstreamIds,
      scope: workstream.mutableScope,
      assignmentStates: assignments.map((assignment) => assignment.semanticState),
      reports,
      artifactPaths: Array.from(new Set(reports.flatMap((report) => report.artifactPaths))),
      blockers: attentionAttributions
        .filter((item) => item.targetWorkstreamId === workstream.workstreamId)
        .map((item) => ({
          attentionId: item.attentionId,
          kind: item.kind,
          summary: item.summary,
          sourceWorkstreamId: item.sourceWorkstreamId,
          direct: item.direct,
        })),
    };
  });
}

export function selectTeamAttentionRows(mission: TeamMission | null): TeamAttentionRow[] {
  if (!mission) return [];
  return mission.attentionItems
    .filter((item) => item.status === "open")
    .map((item) => {
      const workstreamId = item.scope.kind === "workstream" ? item.scope.workstreamId : null;
      return {
        attentionId: item.attentionId,
        kind: item.kind,
        assignmentId: item.assignmentId,
        summary: item.summary,
        pathEvidence: item.pathEvidence,
        createdAt: item.createdAt,
        scope: item.scope.kind,
        workstreamId,
        workstreamTitle:
          workstreamId === null
            ? null
            : (mission.workstreams.find((workstream) => workstream.workstreamId === workstreamId)
                ?.title ?? workstreamId),
      };
    });
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
