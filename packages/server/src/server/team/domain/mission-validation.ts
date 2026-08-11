import type {
  MissionAssignmentContract,
  MissionMemberRequirements,
  MissionRosterMemberSnapshot,
  MissionRosterSnapshot,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";
import { isTeamMentionToken } from "@getpaseo/protocol/team/mention-handles";

import {
  type AcceptedTurnFact,
  type AssignmentStateViolation,
  validateAssignmentContract,
} from "./assignment-contract-validation.js";
import { matchWorkstreamOwner, matchWorkstreamReviewer } from "./member-matching.js";
import {
  isMutableScopeContainedBy,
  isNormalizedWorkspaceFilePath,
  isNormalizedWorkspacePathPrefix,
  type MissionPlanIssue,
  validateMissionWorkstreams,
} from "./mission-plan-validation.js";

export type TeamMissionIssue =
  | MissionPlanIssue
  | { kind: "missing_final_verification" }
  | { kind: "multiple_final_verifications"; workstreamIds: string[] }
  | {
      kind: "multiple_final_verification_assignments";
      workstreamId: string;
      assignmentIds: string[];
    }
  | { kind: "writable_final_verification"; workstreamId: string }
  | {
      kind: "uncovered_final_verification_path";
      verificationWorkstreamId: string;
      workstreamId: string;
    }
  | { kind: "non_independent_final_verification"; workstreamId: string; memberId: string }
  | {
      kind: "undocumented_final_verification_exception";
      workstreamId: string;
      memberId: string;
    }
  | { kind: "missing_completed_final_verification_assignment"; workstreamId: string }
  | {
      kind: "uncovered_final_verification_assignment";
      verificationAssignmentId: string;
      assignmentId: string;
    }
  | {
      kind: "invalid_final_verification_assignment_coverage";
      verificationAssignmentId: string;
      expectedAssignmentIds: string[];
      subjectAssignmentIds: string[];
      dependencyAssignmentIds: string[];
    }
  | { kind: "completed_at_required" }
  | {
      kind: "unaccepted_workstream_at_completion";
      workstreamId: string;
      status: MissionWorkstream["status"];
    }
  | { kind: "needs_attention_without_open_item" }
  | {
      kind: "open_attention_status_mismatch";
      attentionId: string;
      missionStatus: TeamMission["status"];
    }
  | { kind: "attention_resolution_mismatch"; attentionId: string }
  | { kind: "duplicate_attention_id"; attentionId: string }
  | { kind: "attention_suspended_status_mismatch"; attentionId?: string }
  | { kind: "invalid_attention_resolution_kind"; attentionId: string }
  | { kind: "invalid_attention_path"; attentionId: string; path: string }
  | { kind: "unknown_attention_assignment"; attentionId: string; assignmentId: string }
  | { kind: "invalid_audit_excluded_path_prefix"; pathPrefix: string }
  | { kind: "invalid_workspace_audit_policy" }
  | {
      kind: "workspace_baseline_policy_mismatch";
      assignmentId: string;
      policyRevision: number;
    }
  | {
      kind: "workstream_plan_revision_mismatch";
      workstreamId: string;
      planRevision: number;
    }
  | { kind: "duplicate_workstream_plan_snapshot_revision"; planRevision: number }
  | { kind: "non_historical_workstream_plan_snapshot"; planRevision: number }
  | {
      kind: "workstream_plan_snapshot_revision_mismatch";
      snapshotRevision: number;
      workstreamId: string;
      planRevision: number;
    }
  | {
      kind: "future_assignment_plan_revision";
      assignmentId: string;
      planRevision: number;
    }
  | {
      kind: "stale_assignment_plan_revision";
      assignmentId: string;
      planRevision: number;
    }
  | {
      kind: "assignment_kind_workstream_mismatch";
      assignmentId: string;
      workstreamId: string;
    }
  | {
      kind: "assignment_assignee_role_mismatch";
      assignmentId: string;
      expectedMemberId: string;
      actualMemberId: string;
    }
  | { kind: "unknown_active_roster_snapshot"; snapshotRevision: number }
  | { kind: "duplicate_roster_snapshot_revision"; snapshotRevision: number }
  | {
      kind: "invalid_roster_mention_handle";
      snapshotRevision: number;
      memberId: string;
      mentionHandle: string;
    }
  | {
      kind: "duplicate_roster_mention_handle";
      snapshotRevision: number;
      mentionHandle: string;
    }
  | {
      kind: "duplicate_roster_member_id";
      snapshotRevision: number;
      memberId: string;
    }
  | {
      kind: "duplicate_roster_skill_id";
      snapshotRevision: number;
      skillId: string;
    }
  | {
      kind: "unknown_roster_member_skill";
      snapshotRevision: number;
      memberId: string;
      skillId: string;
    }
  | {
      kind: "unknown_workstream_roster_snapshot";
      workstreamId: string;
      snapshotRevision: number;
    }
  | {
      kind: "unknown_assignment_roster_snapshot";
      assignmentId: string;
      snapshotRevision: number;
    }
  | {
      kind: "unknown_workstream_owner";
      workstreamId: string;
      memberId: string;
      snapshotRevision: number;
    }
  | { kind: "incomplete_required_review"; workstreamId: string }
  | { kind: "unexpected_review_configuration"; workstreamId: string }
  | { kind: "ineligible_workstream_owner"; workstreamId: string; memberId: string }
  | { kind: "unknown_workstream_reviewer"; workstreamId: string; memberId: string }
  | { kind: "ineligible_workstream_reviewer"; workstreamId: string; memberId: string }
  | { kind: "non_independent_workstream_reviewer"; workstreamId: string; memberId: string }
  | { kind: "undocumented_workstream_review_exception"; workstreamId: string; memberId: string }
  | { kind: "invalid_owner_match_explanation"; workstreamId: string }
  | { kind: "invalid_reviewer_match_explanation"; workstreamId: string }
  | {
      kind: "unexplained_owner_override";
      workstreamId: string;
      recommendedMemberId: string;
      selectedMemberId: string;
    }
  | {
      kind: "unexplained_reviewer_override";
      workstreamId: string;
      recommendedMemberId: string;
      selectedMemberId: string;
    }
  | {
      kind: "unknown_assignment_assignee";
      assignmentId: string;
      memberId: string;
      snapshotRevision: number;
    }
  | { kind: "duplicate_participant_binding"; memberId: string; bindingEpoch: number }
  | { kind: "multiple_active_participant_bindings"; memberId: string }
  | { kind: "duplicate_participant_agent_id"; agentId: string }
  | { kind: "duplicate_assignment_id"; assignmentId: string }
  | { kind: "assignment_mission_mismatch"; assignmentId: string; missionId: string }
  | { kind: "unknown_assignment_workstream"; assignmentId: string; workstreamId: string }
  | {
      kind: "unknown_assignment_workstream_revision";
      assignmentId: string;
      workstreamId: string;
      planRevision: number;
    }
  | {
      kind: "unknown_assignment_dependency";
      assignmentId: string;
      dependencyAssignmentId: string;
    }
  | {
      kind: "unknown_subject_assignment";
      assignmentId: string;
      subjectAssignmentId: string;
    }
  | { kind: "unknown_superseding_assignment"; assignmentId: string; supersededBy: string }
  | { kind: "assignment_dependency_cycle"; assignmentIds: string[] }
  | { kind: "missing_assignment_contract"; workstreamId: string }
  | { kind: "ambiguous_assignment_contract"; workstreamId: string }
  | {
      kind: "assignment_dependency_workstream_mismatch";
      assignmentId: string;
      workstreamId: string;
    }
  | { kind: "writable_review_assignment"; assignmentId: string }
  | { kind: "assignment_scope_exceeds_workstream"; assignmentId: string; workstreamId: string }
  | { kind: "accepted_workstream_missing_delivery"; workstreamId: string }
  | { kind: "accepted_workstream_missing_approved_review"; workstreamId: string }
  | { kind: "accepted_verification_missing_approval"; workstreamId: string }
  | {
      kind: "accepted_workstream_has_unresolved_assignment";
      workstreamId: string;
      assignmentId: string;
    }
  | {
      kind: "invalid_assignment_contract";
      assignmentId: string;
      violations: AssignmentStateViolation[];
    }
  | { kind: "unknown_roster_lead"; snapshotRevision: number; memberId: string }
  | {
      kind: "assignment_runtime_participant_mismatch";
      assignmentId: string;
      memberId: string;
      runtimeAgentId: string;
    }
  | { kind: "running_assignment_bound_to_archived_participant"; assignmentId: string };

export type TeamMissionValidation = { ok: true } | { ok: false; issues: TeamMissionIssue[] };

export interface ValidateTeamMissionContext {
  /** Accepted-turn facts for the Mission's full history, not only its current plan revision. */
  acceptedTurnsById: ReadonlyMap<string, AcceptedTurnFact>;
}

function duplicateValues<Value>(values: ReadonlyArray<Value>): Value[] {
  const seen = new Set<Value>();
  const reported = new Set<Value>();
  const duplicates: Value[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      continue;
    }
    if (reported.has(value)) continue;
    reported.add(value);
    duplicates.push(value);
  }
  return duplicates;
}

function findAssignmentDependencyCycle(
  assignments: ReadonlyArray<MissionAssignmentContract>,
): string[] | null {
  const byId = new Map(assignments.map((assignment) => [assignment.assignmentId, assignment]));
  const visited = new Set<string>();
  const path: string[] = [];

  function visit(assignmentId: string): string[] | null {
    const cycleStart = path.indexOf(assignmentId);
    if (cycleStart >= 0) return path.slice(cycleStart);
    if (visited.has(assignmentId)) return null;
    const assignment = byId.get(assignmentId);
    if (!assignment) return null;

    path.push(assignmentId);
    for (const dependencyAssignmentId of assignment.dependencyAssignmentIds) {
      const cycle = visit(dependencyAssignmentId);
      if (cycle) return cycle;
    }
    path.pop();
    visited.add(assignmentId);
    return null;
  }

  for (const assignment of assignments) {
    const cycle = visit(assignment.assignmentId);
    if (cycle) return cycle;
  }
  return null;
}

function workstreamTransitivelyDependsOn(
  workstreamId: string,
  dependencyId: string,
  byId: ReadonlyMap<string, MissionWorkstream>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(workstreamId)) return false;
  visited.add(workstreamId);
  const workstream = byId.get(workstreamId);
  if (!workstream) return false;
  if (workstream.dependencyWorkstreamIds.includes(dependencyId)) return true;
  return workstream.dependencyWorkstreamIds.some((candidateId) =>
    workstreamTransitivelyDependsOn(candidateId, dependencyId, byId, visited),
  );
}

function ownerRequirements(workstream: MissionWorkstream): MissionMemberRequirements {
  return {
    requiredSkillIds: workstream.requiredSkillIds,
    preferredSkillIds: workstream.preferredSkillIds,
    requiredRuntimeCapabilityIds: workstream.requiredRuntimeCapabilityIds,
    minimumLevel: workstream.minimumLevel,
  };
}

function memberMeetsHardRequirements(
  member: MissionRosterMemberSnapshot,
  requirements: MissionMemberRequirements,
): boolean {
  return (
    member.level >= requirements.minimumLevel &&
    member.runtimeSnapshot !== null &&
    member.runtimeSnapshot.providerAvailable &&
    requirements.requiredSkillIds.every((skillId) => member.skillIds.includes(skillId)) &&
    requirements.requiredRuntimeCapabilityIds.every((capabilityId) =>
      member.runtimeSnapshot?.capabilityIds.includes(capabilityId),
    )
  );
}

const allowedAttentionResolutionKinds: Record<
  TeamMission["attentionItems"][number]["kind"],
  ReadonlySet<string>
> = {
  ownership_violation: new Set(["attribute_owner", "external_change", "cancel_mission"]),
  missing_report: new Set(["report_received", "recovery_assignment", "replan", "cancel_mission"]),
  assignment_requires_replan: new Set(["replan", "cancel_mission"]),
  provider_unavailable: new Set(["resume_provider", "replan", "cancel_mission"]),
  dispatch_acceptance_unknown: new Set(["cancel_mission"]),
  participant_unavailable: new Set(["replan", "cancel_mission"]),
  reviewer_unavailable: new Set(["replan", "cancel_mission"]),
  lead_unavailable: new Set(["replace_lead", "cancel_mission"]),
  notification_unacknowledged: new Set(["restore_notification", "cancel_mission"]),
};

export function validateMissionAttentionResolution(
  mission: TeamMission,
  item: TeamMission["attentionItems"][number],
  resolution: NonNullable<TeamMission["attentionItems"][number]["resolution"]>,
): TeamMissionIssue[] {
  const assignmentIds = new Set(mission.assignments.map((assignment) => assignment.assignmentId));
  return validateAttentionItem({ ...item, status: "resolved", resolution }, assignmentIds);
}

function validateAttentionItem(
  item: TeamMission["attentionItems"][number],
  assignmentIds: ReadonlySet<string>,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  const hasMatchingResolution =
    (item.status === "open" && item.resolution === null) ||
    (item.status === "resolved" && item.resolution !== null);
  if (!hasMatchingResolution) {
    issues.push({ kind: "attention_resolution_mismatch", attentionId: item.attentionId });
  }
  if (
    item.resolution !== null &&
    !allowedAttentionResolutionKinds[item.kind].has(item.resolution.kind)
  ) {
    issues.push({ kind: "invalid_attention_resolution_kind", attentionId: item.attentionId });
  }
  const referencedAssignmentIds = [
    item.assignmentId,
    item.resolution?.ownerAssignmentId,
    item.resolution?.recoveryAssignmentId,
  ].filter(
    (assignmentId): assignmentId is string => assignmentId !== null && assignmentId !== undefined,
  );
  for (const assignmentId of referencedAssignmentIds) {
    if (assignmentIds.has(assignmentId)) continue;
    issues.push({
      kind: "unknown_attention_assignment",
      attentionId: item.attentionId,
      assignmentId,
    });
  }
  for (const evidence of item.pathEvidence) {
    if (isNormalizedWorkspaceFilePath(evidence.path)) continue;
    issues.push({
      kind: "invalid_attention_path",
      attentionId: item.attentionId,
      path: evidence.path,
    });
  }
  return issues;
}

function validateAttentionMissionState(
  mission: TeamMission,
  openItems: TeamMission["attentionItems"],
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  if (mission.status === "needs_attention" && openItems.length === 0) {
    issues.push({ kind: "needs_attention_without_open_item" });
  }
  if (mission.status === "needs_attention") {
    if (mission.suspendedStatus === null) {
      issues.push({ kind: "attention_suspended_status_mismatch" });
    } else {
      for (const item of openItems) {
        if (item.priorMissionStatus === mission.suspendedStatus) continue;
        issues.push({ kind: "attention_suspended_status_mismatch", attentionId: item.attentionId });
      }
    }
  } else if (mission.suspendedStatus !== null) {
    issues.push({ kind: "attention_suspended_status_mismatch" });
  }
  if (mission.status !== "needs_attention") {
    for (const item of openItems) {
      issues.push({
        kind: "open_attention_status_mismatch",
        attentionId: item.attentionId,
        missionStatus: mission.status,
      });
    }
  }
  return issues;
}

function validateAttentionState(mission: TeamMission): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  const openItems = mission.attentionItems.filter((item) => item.status === "open");
  const assignmentIds = new Set(mission.assignments.map((assignment) => assignment.assignmentId));
  const attentionIds = new Set<string>();
  for (const item of mission.attentionItems) {
    if (attentionIds.has(item.attentionId)) {
      issues.push({ kind: "duplicate_attention_id", attentionId: item.attentionId });
    } else {
      attentionIds.add(item.attentionId);
    }
    issues.push(...validateAttentionItem(item, assignmentIds));
  }
  issues.push(...validateAttentionMissionState(mission, openItems));
  return issues;
}

function validateFinalVerificationPlan(
  workstreams: ReadonlyArray<MissionWorkstream>,
  finalVerifications: ReadonlyArray<MissionWorkstream>,
): TeamMissionIssue[] {
  if (workstreams.length > 0 && finalVerifications.length === 0) {
    return [{ kind: "missing_final_verification" }];
  }
  if (finalVerifications.length > 1) {
    return [
      {
        kind: "multiple_final_verifications",
        workstreamIds: finalVerifications.map((workstream) => workstream.workstreamId),
      },
    ];
  }
  const finalVerification = finalVerifications[0];
  if (!finalVerification) return [];
  const issues: TeamMissionIssue[] = [];
  if (finalVerification.mutableScope.kind !== "read_only") {
    issues.push({
      kind: "writable_final_verification",
      workstreamId: finalVerification.workstreamId,
    });
  }
  const workstreamById = new Map(
    workstreams.map((workstream) => [workstream.workstreamId, workstream]),
  );
  for (const workstream of workstreams) {
    if (workstream.workstreamId === finalVerification.workstreamId) continue;
    const isCovered = workstreamTransitivelyDependsOn(
      finalVerification.workstreamId,
      workstream.workstreamId,
      workstreamById,
    );
    if (isCovered) continue;
    issues.push({
      kind: "uncovered_final_verification_path",
      verificationWorkstreamId: finalVerification.workstreamId,
      workstreamId: workstream.workstreamId,
    });
  }
  return issues;
}

function currentFinalVerificationAssignments(
  mission: TeamMission,
  finalVerification: MissionWorkstream,
): MissionAssignmentContract[] {
  return mission.assignments.filter(
    (assignment) =>
      assignment.kind === "verification" &&
      assignment.workstreamId === finalVerification.workstreamId &&
      assignment.planRevision === mission.planRevision &&
      assignment.semanticState !== "canceled",
  );
}

function validateFinalVerificationAssignments(
  mission: TeamMission,
  finalVerifications: ReadonlyArray<MissionWorkstream>,
): TeamMissionIssue[] {
  const finalVerification = finalVerifications.length === 1 ? finalVerifications[0] : null;
  if (!finalVerification) return [];
  const assignmentIds = currentFinalVerificationAssignments(mission, finalVerification)
    .map((assignment) => assignment.assignmentId)
    .toSorted();
  if (assignmentIds.length <= 1) return [];
  return [
    {
      kind: "multiple_final_verification_assignments",
      workstreamId: finalVerification.workstreamId,
      assignmentIds,
    },
  ];
}

function validateRosterSnapshot(snapshot: MissionRosterSnapshot): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  if (!snapshot.members.some((member) => member.memberId === snapshot.leadMemberId)) {
    issues.push({
      kind: "unknown_roster_lead",
      snapshotRevision: snapshot.revision,
      memberId: snapshot.leadMemberId,
    });
  }
  for (const memberId of duplicateValues(snapshot.members.map((member) => member.memberId))) {
    issues.push({
      kind: "duplicate_roster_member_id",
      snapshotRevision: snapshot.revision,
      memberId,
    });
  }
  for (const skillId of duplicateValues(snapshot.skills.map((skill) => skill.skillId))) {
    issues.push({
      kind: "duplicate_roster_skill_id",
      snapshotRevision: snapshot.revision,
      skillId,
    });
  }
  const knownSkillIds = new Set(snapshot.skills.map((skill) => skill.skillId));
  for (const member of snapshot.members) {
    for (const skillId of new Set(member.skillIds)) {
      if (knownSkillIds.has(skillId)) continue;
      issues.push({
        kind: "unknown_roster_member_skill",
        snapshotRevision: snapshot.revision,
        memberId: member.memberId,
        skillId,
      });
    }
  }
  const canonicalMentionHandles = snapshot.members.map((member) => {
    const canonical = member.mentionHandle.trim().toLowerCase();
    if (
      member.mentionHandle !== canonical ||
      canonical === "everyone" ||
      !isTeamMentionToken(canonical)
    ) {
      issues.push({
        kind: "invalid_roster_mention_handle",
        snapshotRevision: snapshot.revision,
        memberId: member.memberId,
        mentionHandle: member.mentionHandle,
      });
    }
    return canonical;
  });
  for (const mentionHandle of duplicateValues(canonicalMentionHandles)) {
    issues.push({
      kind: "duplicate_roster_mention_handle",
      snapshotRevision: snapshot.revision,
      mentionHandle,
    });
  }
  return issues;
}

function validateRosterSnapshots(mission: TeamMission): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  for (const snapshotRevision of duplicateValues(
    mission.rosterSnapshots.map((snapshot) => snapshot.revision),
  )) {
    issues.push({ kind: "duplicate_roster_snapshot_revision", snapshotRevision });
  }
  for (const snapshot of mission.rosterSnapshots) {
    issues.push(...validateRosterSnapshot(snapshot));
  }
  const snapshotRevisions = new Set(mission.rosterSnapshots.map((snapshot) => snapshot.revision));
  if (!snapshotRevisions.has(mission.activeRosterSnapshotRevision)) {
    issues.push({
      kind: "unknown_active_roster_snapshot",
      snapshotRevision: mission.activeRosterSnapshotRevision,
    });
  }
  return issues;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
    );
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).toSorted();
    const rightKeys = Object.keys(rightRecord).toSorted();
    return (
      sameValue(leftKeys, rightKeys) &&
      leftKeys.every((key) => sameValue(leftRecord[key], rightRecord[key]))
    );
  }
  return false;
}

function candidatesFromExplanation(
  snapshot: MissionRosterSnapshot,
  explanation: MissionWorkstream["ownerMatchExplanation"],
) {
  if (explanation.candidateOpenAssignments.length !== snapshot.members.length) return null;
  const candidates = snapshot.members.map((profile, index) => {
    const recorded = explanation.candidateOpenAssignments[index];
    if (!recorded || recorded.memberId !== profile.memberId) return null;
    return { profile, openAssignments: recorded.openAssignments };
  });
  return candidates.some((candidate) => candidate === null)
    ? null
    : candidates.filter((candidate) => candidate !== null);
}

function recomputeOwnerMatch(workstream: MissionWorkstream, snapshot: MissionRosterSnapshot) {
  const candidates = candidatesFromExplanation(snapshot, workstream.ownerMatchExplanation);
  if (!candidates) return null;
  return matchWorkstreamOwner({
    candidates,
    requiredSkillIds: workstream.requiredSkillIds,
    preferredSkillIds: workstream.preferredSkillIds,
    requiredRuntimeCapabilityIds: workstream.requiredRuntimeCapabilityIds,
    minimumLevel: workstream.minimumLevel,
    previousOwnerMemberId: workstream.ownerMatchExplanation.previousMemberId,
  });
}

function recomputeReviewerMatch(workstream: MissionWorkstream, snapshot: MissionRosterSnapshot) {
  if (!workstream.reviewerRequirements || !workstream.reviewerMatchExplanation) return null;
  const candidates = candidatesFromExplanation(snapshot, workstream.reviewerMatchExplanation);
  if (!candidates) return null;
  return matchWorkstreamReviewer({
    candidates,
    ...workstream.reviewerRequirements,
    previousReviewerMemberId: workstream.reviewerMatchExplanation.previousMemberId,
    ownerMemberId: workstream.ownerMemberId,
    ownerMutableScope: workstream.mutableScope,
  });
}

function validateWorkstreamOwnerSelection(
  workstream: MissionWorkstream,
  snapshot: MissionRosterSnapshot,
  writableOwnerMemberIds: ReadonlySet<string>,
): TeamMissionIssue[] {
  const owner = snapshot.members.find((member) => member.memberId === workstream.ownerMemberId);
  if (!owner) {
    return [
      {
        kind: "unknown_workstream_owner",
        workstreamId: workstream.workstreamId,
        memberId: workstream.ownerMemberId,
        snapshotRevision: workstream.rosterSnapshotRevision,
      },
    ];
  }
  const issues: TeamMissionIssue[] = [];
  const recomputedMatch = recomputeOwnerMatch(workstream, snapshot);
  const recommendedMemberId = recomputedMatch?.kind === "matched" ? recomputedMatch.memberId : null;
  if (
    recomputedMatch?.kind !== "matched" ||
    !sameValue(recomputedMatch.explanation, workstream.ownerMatchExplanation)
  ) {
    issues.push({ kind: "invalid_owner_match_explanation", workstreamId: workstream.workstreamId });
  }
  if (!memberMeetsHardRequirements(owner, ownerRequirements(workstream))) {
    issues.push({
      kind: "ineligible_workstream_owner",
      workstreamId: workstream.workstreamId,
      memberId: workstream.ownerMemberId,
    });
  }
  if (
    recommendedMemberId !== null &&
    workstream.ownerMemberId !== recommendedMemberId &&
    workstream.ownerOverrideReason === null
  ) {
    issues.push({
      kind: "unexplained_owner_override",
      workstreamId: workstream.workstreamId,
      recommendedMemberId,
      selectedMemberId: workstream.ownerMemberId,
    });
  }
  if (workstream.kind !== "verification" || !writableOwnerMemberIds.has(workstream.ownerMemberId)) {
    return issues;
  }
  const requirements = ownerRequirements(workstream);
  const hasIndependentAlternative = snapshot.members.some(
    (member) =>
      !writableOwnerMemberIds.has(member.memberId) &&
      memberMeetsHardRequirements(member, requirements),
  );
  if (hasIndependentAlternative) {
    issues.push({
      kind: "non_independent_final_verification",
      workstreamId: workstream.workstreamId,
      memberId: workstream.ownerMemberId,
    });
  } else if (workstream.ownerOverrideReason === null) {
    issues.push({
      kind: "undocumented_final_verification_exception",
      workstreamId: workstream.workstreamId,
      memberId: workstream.ownerMemberId,
    });
  }
  return issues;
}

function validateReviewerMatchAudit(
  workstream: MissionWorkstream,
  snapshot: MissionRosterSnapshot,
  reviewerMemberId: string,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  const recomputedMatch = recomputeReviewerMatch(workstream, snapshot);
  const recommendedMemberId = recomputedMatch?.kind === "matched" ? recomputedMatch.memberId : null;
  if (
    recomputedMatch?.kind !== "matched" ||
    !sameValue(recomputedMatch.explanation, workstream.reviewerMatchExplanation)
  ) {
    issues.push({
      kind: "invalid_reviewer_match_explanation",
      workstreamId: workstream.workstreamId,
    });
  }
  if (
    recommendedMemberId !== null &&
    reviewerMemberId !== recommendedMemberId &&
    workstream.reviewerOverrideReason === null
  ) {
    issues.push({
      kind: "unexplained_reviewer_override",
      workstreamId: workstream.workstreamId,
      recommendedMemberId,
      selectedMemberId: reviewerMemberId,
    });
  }
  return issues;
}

function validateReviewerIndependence(
  workstream: MissionWorkstream,
  snapshot: MissionRosterSnapshot,
  requirements: MissionMemberRequirements,
  reviewerMemberId: string,
): TeamMissionIssue[] {
  if (
    workstream.mutableScope.kind === "read_only" ||
    reviewerMemberId !== workstream.ownerMemberId
  ) {
    return [];
  }
  const hasIndependentAlternative = snapshot.members.some(
    (member) =>
      member.memberId !== workstream.ownerMemberId &&
      memberMeetsHardRequirements(member, requirements),
  );
  if (hasIndependentAlternative) {
    return [
      {
        kind: "non_independent_workstream_reviewer",
        workstreamId: workstream.workstreamId,
        memberId: reviewerMemberId,
      },
    ];
  }
  return workstream.reviewerOverrideReason === null
    ? [
        {
          kind: "undocumented_workstream_review_exception",
          workstreamId: workstream.workstreamId,
          memberId: reviewerMemberId,
        },
      ]
    : [];
}

function validateWorkstreamReviewSelection(
  workstream: MissionWorkstream,
  snapshot: MissionRosterSnapshot,
): TeamMissionIssue[] {
  if (workstream.reviewPolicy === "none") {
    const hasUnexpectedConfiguration =
      workstream.reviewerRequirements !== null ||
      workstream.reviewerMemberId !== null ||
      workstream.reviewerMatchExplanation !== null ||
      workstream.reviewerOverrideReason !== null;
    return hasUnexpectedConfiguration
      ? [{ kind: "unexpected_review_configuration", workstreamId: workstream.workstreamId }]
      : [];
  }
  if (
    workstream.reviewerRequirements === null ||
    workstream.reviewerMemberId === null ||
    workstream.reviewerMatchExplanation === null
  ) {
    return [{ kind: "incomplete_required_review", workstreamId: workstream.workstreamId }];
  }
  const reviewerRequirements = workstream.reviewerRequirements;
  const reviewerMemberId = workstream.reviewerMemberId;
  const reviewer = snapshot.members.find((member) => member.memberId === reviewerMemberId);
  if (!reviewer) {
    return [
      {
        kind: "unknown_workstream_reviewer",
        workstreamId: workstream.workstreamId,
        memberId: reviewerMemberId,
      },
    ];
  }
  if (!memberMeetsHardRequirements(reviewer, reviewerRequirements)) {
    return [
      {
        kind: "ineligible_workstream_reviewer",
        workstreamId: workstream.workstreamId,
        memberId: reviewerMemberId,
      },
    ];
  }
  const issues = validateReviewerMatchAudit(workstream, snapshot, reviewerMemberId);
  issues.push(
    ...validateReviewerIndependence(workstream, snapshot, reviewerRequirements, reviewerMemberId),
  );
  return issues;
}

function validateWorkstreamSelections(
  workstreams: ReadonlyArray<MissionWorkstream>,
  expectedPlanRevision: number,
  snapshotByRevision: ReadonlyMap<number, MissionRosterSnapshot>,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  const writableOwnerMemberIds = new Set(
    workstreams
      .filter(
        (workstream) =>
          workstream.kind !== "verification" && workstream.mutableScope.kind !== "read_only",
      )
      .map((workstream) => workstream.ownerMemberId),
  );
  for (const workstream of workstreams) {
    if (workstream.planRevision !== expectedPlanRevision) {
      issues.push({
        kind: "workstream_plan_revision_mismatch",
        workstreamId: workstream.workstreamId,
        planRevision: workstream.planRevision,
      });
    }
    const snapshot = snapshotByRevision.get(workstream.rosterSnapshotRevision);
    if (!snapshot) {
      issues.push({
        kind: "unknown_workstream_roster_snapshot",
        workstreamId: workstream.workstreamId,
        snapshotRevision: workstream.rosterSnapshotRevision,
      });
      continue;
    }
    if (
      new Set(snapshot.members.map((member) => member.memberId)).size !== snapshot.members.length
    ) {
      continue;
    }
    issues.push(...validateWorkstreamOwnerSelection(workstream, snapshot, writableOwnerMemberIds));
    issues.push(...validateWorkstreamReviewSelection(workstream, snapshot));
  }
  return issues;
}

type WorkstreamRevisionIndex = ReadonlyMap<string, MissionWorkstream>;

function workstreamRevisionKey(planRevision: number, workstreamId: string): string {
  return `${planRevision}\0${workstreamId}`;
}

function validateWorkstreamPlanSnapshots(
  mission: TeamMission,
  snapshotByRevision: ReadonlyMap<number, MissionRosterSnapshot>,
): { issues: TeamMissionIssue[]; workstreamByRevision: WorkstreamRevisionIndex } {
  const issues: TeamMissionIssue[] = [];
  const workstreamByRevision = new Map<string, MissionWorkstream>();
  for (const workstream of mission.workstreams) {
    workstreamByRevision.set(
      workstreamRevisionKey(workstream.planRevision, workstream.workstreamId),
      workstream,
    );
  }
  for (const planRevision of duplicateValues(
    mission.workstreamPlanSnapshots.map((snapshot) => snapshot.planRevision),
  )) {
    issues.push({ kind: "duplicate_workstream_plan_snapshot_revision", planRevision });
  }
  for (const snapshot of mission.workstreamPlanSnapshots) {
    if (snapshot.planRevision >= mission.planRevision) {
      issues.push({
        kind: "non_historical_workstream_plan_snapshot",
        planRevision: snapshot.planRevision,
      });
    }
    const planValidation = validateMissionWorkstreams(snapshot.workstreams);
    if (!planValidation.ok) issues.push(...planValidation.issues);
    const finalVerifications = snapshot.workstreams.filter(
      (workstream) => workstream.kind === "verification",
    );
    issues.push(...validateFinalVerificationPlan(snapshot.workstreams, finalVerifications));
    issues.push(
      ...validateWorkstreamSelections(
        snapshot.workstreams,
        snapshot.planRevision,
        snapshotByRevision,
      ),
    );
    for (const workstream of snapshot.workstreams) {
      if (workstream.planRevision !== snapshot.planRevision) {
        issues.push({
          kind: "workstream_plan_snapshot_revision_mismatch",
          snapshotRevision: snapshot.planRevision,
          workstreamId: workstream.workstreamId,
          planRevision: workstream.planRevision,
        });
        continue;
      }
      const key = workstreamRevisionKey(snapshot.planRevision, workstream.workstreamId);
      if (!workstreamByRevision.has(key)) workstreamByRevision.set(key, workstream);
    }
  }
  return { issues, workstreamByRevision };
}

function validateAssignmentSnapshotReferences(
  mission: TeamMission,
  snapshotByRevision: ReadonlyMap<number, MissionRosterSnapshot>,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  for (const assignment of mission.assignments) {
    const snapshot = snapshotByRevision.get(assignment.rosterSnapshotRevision);
    if (!snapshot) {
      issues.push({
        kind: "unknown_assignment_roster_snapshot",
        assignmentId: assignment.assignmentId,
        snapshotRevision: assignment.rosterSnapshotRevision,
      });
      continue;
    }
    if (!snapshot.members.some((member) => member.memberId === assignment.assigneeMemberId)) {
      issues.push({
        kind: "unknown_assignment_assignee",
        assignmentId: assignment.assignmentId,
        memberId: assignment.assigneeMemberId,
        snapshotRevision: assignment.rosterSnapshotRevision,
      });
    }
  }
  return issues;
}

interface ParticipantBindingValidation {
  issues: TeamMissionIssue[];
  canResolveAssignmentBindings: boolean;
}

function validateParticipantBindings(mission: TeamMission): ParticipantBindingValidation {
  const issues: TeamMissionIssue[] = [];
  const participantBindings = new Set<string>();
  let hasDuplicateParticipantBinding = false;
  for (const participant of mission.participants) {
    const bindingKey = `${participant.memberId}\0${participant.bindingEpoch}`;
    if (participantBindings.has(bindingKey)) {
      hasDuplicateParticipantBinding = true;
      issues.push({
        kind: "duplicate_participant_binding",
        memberId: participant.memberId,
        bindingEpoch: participant.bindingEpoch,
      });
      continue;
    }
    participantBindings.add(bindingKey);
  }
  const duplicateActiveMemberIds = duplicateValues(
    mission.participants
      .filter((participant) => participant.archivedAt === null)
      .map((participant) => participant.memberId),
  );
  for (const memberId of duplicateActiveMemberIds) {
    issues.push({ kind: "multiple_active_participant_bindings", memberId });
  }
  const duplicateAgentIds = duplicateValues(
    mission.participants.map((participant) => participant.agentId),
  );
  for (const agentId of duplicateAgentIds) {
    issues.push({ kind: "duplicate_participant_agent_id", agentId });
  }
  return {
    issues,
    canResolveAssignmentBindings:
      !hasDuplicateParticipantBinding &&
      duplicateActiveMemberIds.length === 0 &&
      duplicateAgentIds.length === 0,
  };
}

function validateAssignmentHeader(
  mission: TeamMission,
  assignment: MissionAssignmentContract,
  workstreamByRevision: WorkstreamRevisionIndex,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  if (assignment.planRevision > mission.planRevision) {
    issues.push({
      kind: "future_assignment_plan_revision",
      assignmentId: assignment.assignmentId,
      planRevision: assignment.planRevision,
    });
  } else if (
    assignment.planRevision < mission.planRevision &&
    assignment.semanticState !== "completed" &&
    assignment.semanticState !== "canceled"
  ) {
    issues.push({
      kind: "stale_assignment_plan_revision",
      assignmentId: assignment.assignmentId,
      planRevision: assignment.planRevision,
    });
  }
  if (
    assignment.workspaceBaseline !== null &&
    assignment.workspaceBaseline.policyRevision !== mission.workspaceAuditPolicy.revision
  ) {
    issues.push({
      kind: "workspace_baseline_policy_mismatch",
      assignmentId: assignment.assignmentId,
      policyRevision: assignment.workspaceBaseline.policyRevision,
    });
  }
  if (assignment.missionId !== mission.id) {
    issues.push({
      kind: "assignment_mission_mismatch",
      assignmentId: assignment.assignmentId,
      missionId: assignment.missionId,
    });
  }
  if (
    !workstreamByRevision.has(
      workstreamRevisionKey(assignment.planRevision, assignment.workstreamId),
    )
  ) {
    issues.push(
      assignment.planRevision === mission.planRevision
        ? {
            kind: "unknown_assignment_workstream",
            assignmentId: assignment.assignmentId,
            workstreamId: assignment.workstreamId,
          }
        : {
            kind: "unknown_assignment_workstream_revision",
            assignmentId: assignment.assignmentId,
            workstreamId: assignment.workstreamId,
            planRevision: assignment.planRevision,
          },
    );
  }
  return issues;
}

function expectedAssignmentMemberId(
  assignment: MissionAssignmentContract,
  workstream: MissionWorkstream,
): string | null {
  if (assignment.kind === "delivery" && workstream.kind !== "verification") {
    return workstream.ownerMemberId;
  }
  if (
    assignment.kind === "review" &&
    workstream.kind !== "verification" &&
    workstream.reviewPolicy === "required"
  ) {
    return workstream.reviewerMemberId;
  }
  if (assignment.kind === "verification" && workstream.kind === "verification") {
    return workstream.ownerMemberId;
  }
  return null;
}

function validateAssignmentRole(
  assignment: MissionAssignmentContract,
  workstream: MissionWorkstream | undefined,
  snapshotByRevision: ReadonlyMap<number, MissionRosterSnapshot>,
): TeamMissionIssue[] {
  if (!workstream) return [];
  const expectedMemberId = expectedAssignmentMemberId(assignment, workstream);
  if (expectedMemberId === null) {
    return [
      {
        kind: "assignment_kind_workstream_mismatch",
        assignmentId: assignment.assignmentId,
        workstreamId: assignment.workstreamId,
      },
    ];
  }
  const snapshot = snapshotByRevision.get(assignment.rosterSnapshotRevision);
  const expectedMemberExists = snapshot?.members.some(
    (member) => member.memberId === expectedMemberId,
  );
  const assigneeExists = snapshot?.members.some(
    (member) => member.memberId === assignment.assigneeMemberId,
  );
  if (
    !expectedMemberExists ||
    !assigneeExists ||
    assignment.assigneeMemberId === expectedMemberId
  ) {
    return [];
  }
  return [
    {
      kind: "assignment_assignee_role_mismatch",
      assignmentId: assignment.assignmentId,
      expectedMemberId,
      actualMemberId: assignment.assigneeMemberId,
    },
  ];
}

function validateAssignmentReferences(
  assignment: MissionAssignmentContract,
  assignmentIds: ReadonlySet<string>,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  for (const dependencyAssignmentId of assignment.dependencyAssignmentIds) {
    if (assignmentIds.has(dependencyAssignmentId)) continue;
    issues.push({
      kind: "unknown_assignment_dependency",
      assignmentId: assignment.assignmentId,
      dependencyAssignmentId,
    });
  }
  for (const subjectAssignmentId of assignment.subjectAssignmentIds) {
    if (assignmentIds.has(subjectAssignmentId)) continue;
    issues.push({
      kind: "unknown_subject_assignment",
      assignmentId: assignment.assignmentId,
      subjectAssignmentId,
    });
  }
  if (assignment.supersededBy !== null && !assignmentIds.has(assignment.supersededBy)) {
    issues.push({
      kind: "unknown_superseding_assignment",
      assignmentId: assignment.assignmentId,
      supersededBy: assignment.supersededBy,
    });
  }
  return issues;
}

function validateAssignmentRuntimeBinding(
  mission: TeamMission,
  assignment: MissionAssignmentContract,
  canResolveAssignmentBindings: boolean,
): TeamMissionIssue[] {
  if (!canResolveAssignmentBindings || assignment.runtimeAgentId === null) return [];
  const binding = mission.participants.find(
    (participant) =>
      participant.memberId === assignment.assigneeMemberId &&
      participant.agentId === assignment.runtimeAgentId &&
      participant.bindingEpoch === assignment.bindingEpoch,
  );
  if (!binding) {
    return [
      {
        kind: "assignment_runtime_participant_mismatch",
        assignmentId: assignment.assignmentId,
        memberId: assignment.assigneeMemberId,
        runtimeAgentId: assignment.runtimeAgentId,
      },
    ];
  }
  if (assignment.semanticState === "running" && binding.archivedAt !== null) {
    return [
      {
        kind: "running_assignment_bound_to_archived_participant",
        assignmentId: assignment.assignmentId,
      },
    ];
  }
  return [];
}

function validateAssignments(
  mission: TeamMission,
  snapshotByRevision: ReadonlyMap<number, MissionRosterSnapshot>,
  workstreamByRevision: WorkstreamRevisionIndex,
  canResolveAssignmentBindings: boolean,
  context: ValidateTeamMissionContext,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  const duplicateAssignmentIds = duplicateValues(
    mission.assignments.map((assignment) => assignment.assignmentId),
  );
  for (const assignmentId of duplicateAssignmentIds) {
    issues.push({ kind: "duplicate_assignment_id", assignmentId });
  }
  const assignmentIds = new Set(mission.assignments.map((assignment) => assignment.assignmentId));
  for (const assignment of mission.assignments) {
    const workstream = workstreamByRevision.get(
      workstreamRevisionKey(assignment.planRevision, assignment.workstreamId),
    );
    issues.push(...validateAssignmentHeader(mission, assignment, workstreamByRevision));
    issues.push(...validateAssignmentRole(assignment, workstream, snapshotByRevision));
    issues.push(...validateAssignmentReferences(assignment, assignmentIds));
    issues.push(
      ...validateAssignmentRuntimeBinding(mission, assignment, canResolveAssignmentBindings),
    );
    if (workstream) {
      if (assignment.kind === "review" && assignment.mutableScope.kind !== "read_only") {
        issues.push({ kind: "writable_review_assignment", assignmentId: assignment.assignmentId });
      }
      if (!isMutableScopeContainedBy(assignment.mutableScope, workstream.mutableScope)) {
        issues.push({
          kind: "assignment_scope_exceeds_workstream",
          assignmentId: assignment.assignmentId,
          workstreamId: workstream.workstreamId,
        });
      }
    }
    const acceptedTurn =
      assignment.acceptedTurnId === null
        ? null
        : (context.acceptedTurnsById.get(assignment.acceptedTurnId) ?? null);
    const contractValidation = validateAssignmentContract({
      assignment,
      acceptedTurn,
      expectedWorkspaceId: mission.workspaceId,
    });
    if (!contractValidation.ok) {
      for (const issue of contractValidation.issues) {
        issues.push({
          kind: "invalid_assignment_contract",
          assignmentId: issue.assignmentId,
          violations: issue.violations,
        });
      }
    }
  }
  if (duplicateAssignmentIds.length === 0) {
    const cycle = findAssignmentDependencyCycle(mission.assignments);
    if (cycle) issues.push({ kind: "assignment_dependency_cycle", assignmentIds: cycle });
  }
  return issues;
}

function hasCompletedTurnFact(
  assignment: MissionAssignmentContract,
  context: ValidateTeamMissionContext,
): boolean {
  if (assignment.acceptedTurnId === null || assignment.runtimeAgentId === null) return false;
  const fact = context.acceptedTurnsById.get(assignment.acceptedTurnId);
  return (
    fact?.assignmentId === assignment.assignmentId &&
    fact.turnId === assignment.acceptedTurnId &&
    fact.runtimeAgentId === assignment.runtimeAgentId &&
    fact.outcome === "completed"
  );
}

function isCompletedAssignment(
  assignment: MissionAssignmentContract,
  kind: MissionAssignmentContract["kind"],
  verdict: "approved" | null,
  context: ValidateTeamMissionContext,
): boolean {
  return (
    assignment.kind === kind &&
    assignment.semanticState === "completed" &&
    assignment.dispatchState === "settled" &&
    assignment.report?.status === "completed" &&
    assignment.report.verdict === verdict &&
    hasCompletedTurnFact(assignment, context)
  );
}

function sameReusableWorkstreamContract(
  previous: MissionWorkstream,
  current: MissionWorkstream,
  assignmentKind: MissionAssignmentContract["kind"],
): boolean {
  const previousContract = {
    kind: previous.kind,
    objective: previous.objective,
    deliverables: previous.deliverables,
    acceptanceCriteria: previous.acceptanceCriteria,
    requiredSkillIds: previous.requiredSkillIds,
    requiredRuntimeCapabilityIds: previous.requiredRuntimeCapabilityIds,
    minimumLevel: previous.minimumLevel,
    dependencyWorkstreamIds: previous.dependencyWorkstreamIds,
    mutableScope: previous.mutableScope,
    ...(assignmentKind === "review"
      ? {
          reviewPolicy: previous.reviewPolicy,
          reviewerRequirements: previous.reviewerRequirements,
        }
      : {}),
  };
  const currentContract = {
    kind: current.kind,
    objective: current.objective,
    deliverables: current.deliverables,
    acceptanceCriteria: current.acceptanceCriteria,
    requiredSkillIds: current.requiredSkillIds,
    requiredRuntimeCapabilityIds: current.requiredRuntimeCapabilityIds,
    minimumLevel: current.minimumLevel,
    dependencyWorkstreamIds: current.dependencyWorkstreamIds,
    mutableScope: current.mutableScope,
    ...(assignmentKind === "review"
      ? {
          reviewPolicy: current.reviewPolicy,
          reviewerRequirements: current.reviewerRequirements,
        }
      : {}),
  };
  return sameValue(previousContract, currentContract);
}

function assignmentCanSatisfyWorkstream(
  assignment: MissionAssignmentContract,
  currentWorkstream: MissionWorkstream,
  workstreamByRevision: WorkstreamRevisionIndex,
): boolean {
  const assignmentWorkstream = workstreamByRevision.get(
    workstreamRevisionKey(assignment.planRevision, assignment.workstreamId),
  );
  return (
    assignmentWorkstream !== undefined &&
    sameReusableWorkstreamContract(assignmentWorkstream, currentWorkstream, assignment.kind)
  );
}

export function findWorkstreamsMissingAssignmentContracts(
  mission: TeamMission,
  context: ValidateTeamMissionContext,
): string[] {
  return resolveMissionAssignmentCoverage(mission, context).missingWorkstreamIds;
}

export interface MissionAssignmentCoverage {
  assignmentIdsByWorkstreamId: ReadonlyMap<string, string>;
  completedDeliveryAssignmentIds: ReadonlySet<string>;
  approvedReviewAssignmentIdsByWorkstreamId: ReadonlyMap<string, string>;
  missingWorkstreamIds: string[];
  ambiguousWorkstreamIds: string[];
}

export function resolveMissionAssignmentCoverage(
  mission: TeamMission,
  context: ValidateTeamMissionContext,
): MissionAssignmentCoverage {
  const workstreamByRevision = new Map<string, MissionWorkstream>();
  for (const workstream of mission.workstreams) {
    workstreamByRevision.set(
      workstreamRevisionKey(workstream.planRevision, workstream.workstreamId),
      workstream,
    );
  }
  for (const snapshot of mission.workstreamPlanSnapshots) {
    for (const workstream of snapshot.workstreams) {
      const key = workstreamRevisionKey(snapshot.planRevision, workstream.workstreamId);
      if (!workstreamByRevision.has(key)) workstreamByRevision.set(key, workstream);
    }
  }

  const assignmentIdsByWorkstreamId = new Map<string, string>();
  const completedDeliveryAssignmentIds = new Set<string>();
  const approvedReviewAssignmentIdsByWorkstreamId = new Map<string, string>();
  const missingWorkstreamIds: string[] = [];
  const ambiguousWorkstreamIds: string[] = [];
  const executableWorkstreams = mission.workstreams.filter(
    (workstream) => workstream.kind === "delivery" || workstream.kind === "integration",
  );
  const executableWorkstreamById = new Map(
    executableWorkstreams.map((workstream) => [workstream.workstreamId, workstream]),
  );
  const resolvedWorkstreamIds = new Set<string>();
  const resolvingWorkstreamIds = new Set<string>();

  function resolveWorkstream(workstream: MissionWorkstream): void {
    if (resolvedWorkstreamIds.has(workstream.workstreamId)) return;
    if (resolvingWorkstreamIds.has(workstream.workstreamId)) {
      if (!missingWorkstreamIds.includes(workstream.workstreamId)) {
        missingWorkstreamIds.push(workstream.workstreamId);
      }
      return;
    }
    resolvingWorkstreamIds.add(workstream.workstreamId);
    for (const dependencyWorkstreamId of workstream.dependencyWorkstreamIds) {
      const dependencyWorkstream = executableWorkstreamById.get(dependencyWorkstreamId);
      if (dependencyWorkstream) resolveWorkstream(dependencyWorkstream);
    }
    const assignments = mission.assignments.filter(
      (assignment) =>
        assignment.kind === "delivery" && assignment.workstreamId === workstream.workstreamId,
    );
    const currentAssignments = assignments.filter(
      (assignment) =>
        assignment.planRevision === mission.planRevision && assignment.semanticState !== "canceled",
    );
    const selectedDependencyAssignmentIds = workstream.dependencyWorkstreamIds.map(
      (dependencyWorkstreamId) => assignmentIdsByWorkstreamId.get(dependencyWorkstreamId),
    );
    const hasCompleteDependencyLineage = selectedDependencyAssignmentIds.every(
      (assignmentId): assignmentId is string => assignmentId !== undefined,
    );
    const reusableAssignments = assignments
      .filter(
        (assignment) =>
          isCompletedAssignment(assignment, "delivery", null, context) &&
          assignmentCanSatisfyWorkstream(assignment, workstream, workstreamByRevision) &&
          hasCompleteDependencyLineage &&
          assignment.dependencyAssignmentIds.length === selectedDependencyAssignmentIds.length &&
          assignment.dependencyAssignmentIds.every(
            (assignmentId, index) => assignmentId === selectedDependencyAssignmentIds[index],
          ),
      )
      .toSorted(
        (left, right) =>
          right.planRevision - left.planRevision ||
          left.assignmentId.localeCompare(right.assignmentId),
      );
    const candidates =
      currentAssignments.length > 0
        ? currentAssignments
        : reusableAssignments.filter(
            (assignment) => assignment.planRevision === reusableAssignments[0]?.planRevision,
          );
    if (candidates.length === 0) {
      missingWorkstreamIds.push(workstream.workstreamId);
    } else if (candidates.length > 1) {
      ambiguousWorkstreamIds.push(workstream.workstreamId);
    } else {
      const candidate = candidates[0];
      if (candidate) {
        assignmentIdsByWorkstreamId.set(workstream.workstreamId, candidate.assignmentId);
      }
    }
    resolvingWorkstreamIds.delete(workstream.workstreamId);
    resolvedWorkstreamIds.add(workstream.workstreamId);
  }

  for (const workstream of executableWorkstreams) resolveWorkstream(workstream);
  const assignmentsById = new Map(
    mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  for (const workstream of executableWorkstreams) {
    const deliveryAssignmentId = assignmentIdsByWorkstreamId.get(workstream.workstreamId);
    const deliveryAssignment = deliveryAssignmentId
      ? assignmentsById.get(deliveryAssignmentId)
      : undefined;
    if (
      !deliveryAssignment ||
      !isCompletedAssignment(deliveryAssignment, "delivery", null, context)
    ) {
      continue;
    }
    completedDeliveryAssignmentIds.add(deliveryAssignment.assignmentId);
    if (workstream.reviewPolicy !== "required") continue;
    const approvedReview = mission.assignments
      .filter(
        (assignment) =>
          assignment.kind === "review" &&
          assignment.workstreamId === workstream.workstreamId &&
          assignment.subjectAssignmentIds.length === 1 &&
          assignment.subjectAssignmentIds[0] === deliveryAssignment.assignmentId &&
          assignment.dependencyAssignmentIds.length === 1 &&
          assignment.dependencyAssignmentIds[0] === deliveryAssignment.assignmentId &&
          isCompletedAssignment(assignment, "review", "approved", context) &&
          assignmentCanSatisfyWorkstream(assignment, workstream, workstreamByRevision),
      )
      .toSorted(
        (left, right) =>
          right.planRevision - left.planRevision ||
          left.assignmentId.localeCompare(right.assignmentId),
      )[0];
    if (approvedReview) {
      approvedReviewAssignmentIdsByWorkstreamId.set(
        workstream.workstreamId,
        approvedReview.assignmentId,
      );
    }
  }
  return {
    assignmentIdsByWorkstreamId,
    completedDeliveryAssignmentIds,
    approvedReviewAssignmentIdsByWorkstreamId,
    missingWorkstreamIds,
    ambiguousWorkstreamIds,
  };
}

function validateAssignmentCoverage(
  mission: TeamMission,
  context: ValidateTeamMissionContext,
): TeamMissionIssue[] {
  const requiresCompleteCoverage =
    mission.status === "active" ||
    mission.status === "verifying" ||
    mission.status === "completed" ||
    (mission.status === "needs_attention" && mission.suspendedStatus !== "planning");
  const coverage = resolveMissionAssignmentCoverage(mission, context);
  const issues: TeamMissionIssue[] = [
    ...(requiresCompleteCoverage
      ? coverage.missingWorkstreamIds.map((workstreamId) => ({
          kind: "missing_assignment_contract" as const,
          workstreamId,
        }))
      : []),
    ...coverage.ambiguousWorkstreamIds.map((workstreamId) => ({
      kind: "ambiguous_assignment_contract" as const,
      workstreamId,
    })),
  ];
  const assignmentsById = new Map(
    mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  for (const workstream of mission.workstreams) {
    if (workstream.kind !== "delivery" && workstream.kind !== "integration") continue;
    const assignmentId = coverage.assignmentIdsByWorkstreamId.get(workstream.workstreamId);
    const assignment = assignmentId ? assignmentsById.get(assignmentId) : undefined;
    if (!assignment) continue;
    const expectedDependencyIds = workstream.dependencyWorkstreamIds.map((dependencyWorkstreamId) =>
      coverage.assignmentIdsByWorkstreamId.get(dependencyWorkstreamId),
    );
    if (expectedDependencyIds.some((dependencyId) => dependencyId === undefined)) continue;
    if (
      assignment.dependencyAssignmentIds.length === expectedDependencyIds.length &&
      assignment.dependencyAssignmentIds.every(
        (dependencyId, index) => dependencyId === expectedDependencyIds[index],
      )
    ) {
      continue;
    }
    issues.push({
      kind: "assignment_dependency_workstream_mismatch",
      assignmentId: assignment.assignmentId,
      workstreamId: workstream.workstreamId,
    });
  }
  return issues;
}

function validateAcceptedWorkstreams(
  mission: TeamMission,
  context: ValidateTeamMissionContext,
): TeamMissionIssue[] {
  const issues: TeamMissionIssue[] = [];
  const coverage = resolveMissionAssignmentCoverage(mission, context);
  for (const workstream of mission.workstreams) {
    if (workstream.status !== "accepted") continue;
    const assignments = mission.assignments.filter(
      (assignment) => assignment.workstreamId === workstream.workstreamId,
    );
    const currentPlanAssignments = assignments.filter(
      (assignment) => assignment.planRevision === mission.planRevision,
    );
    for (const assignment of assignments) {
      if (assignment.semanticState === "completed" || assignment.semanticState === "canceled") {
        continue;
      }
      issues.push({
        kind: "accepted_workstream_has_unresolved_assignment",
        workstreamId: workstream.workstreamId,
        assignmentId: assignment.assignmentId,
      });
    }
    if (workstream.kind === "verification") {
      if (
        !currentPlanAssignments.some((assignment) =>
          isCompletedAssignment(assignment, "verification", "approved", context),
        )
      ) {
        issues.push({
          kind: "accepted_verification_missing_approval",
          workstreamId: workstream.workstreamId,
        });
      }
      continue;
    }
    const deliveryAssignmentId = coverage.assignmentIdsByWorkstreamId.get(workstream.workstreamId);
    if (
      !deliveryAssignmentId ||
      !coverage.completedDeliveryAssignmentIds.has(deliveryAssignmentId)
    ) {
      issues.push({
        kind: "accepted_workstream_missing_delivery",
        workstreamId: workstream.workstreamId,
      });
    }
    if (
      workstream.reviewPolicy === "required" &&
      !coverage.approvedReviewAssignmentIdsByWorkstreamId.has(workstream.workstreamId)
    ) {
      issues.push({
        kind: "accepted_workstream_missing_approved_review",
        workstreamId: workstream.workstreamId,
      });
    }
  }
  return issues;
}

function hasExactUniqueAssignmentIds(
  actualAssignmentIds: ReadonlyArray<string>,
  expectedAssignmentIds: ReadonlyArray<string>,
): boolean {
  const actualIds = new Set(actualAssignmentIds);
  const expectedIds = new Set(expectedAssignmentIds);
  return (
    actualIds.size === actualAssignmentIds.length &&
    expectedIds.size === expectedAssignmentIds.length &&
    actualIds.size === expectedIds.size &&
    [...expectedIds].every((assignmentId) => actualIds.has(assignmentId))
  );
}

function validateMissionCompletion(
  mission: TeamMission,
  finalVerifications: ReadonlyArray<MissionWorkstream>,
  context: ValidateTeamMissionContext,
): TeamMissionIssue[] {
  const finalVerification = finalVerifications.length === 1 ? finalVerifications[0] : null;
  if (mission.status !== "completed" || !finalVerification) return [];
  const issues: TeamMissionIssue[] = [];
  if (mission.completedAt === null) issues.push({ kind: "completed_at_required" });
  for (const workstream of mission.workstreams) {
    if (workstream.status === "accepted") continue;
    issues.push({
      kind: "unaccepted_workstream_at_completion",
      workstreamId: workstream.workstreamId,
      status: workstream.status,
    });
  }
  const currentVerifications = currentFinalVerificationAssignments(mission, finalVerification);
  const completedVerification =
    currentVerifications.length === 1 &&
    isCompletedAssignment(currentVerifications[0]!, "verification", "approved", context)
      ? currentVerifications[0]
      : null;
  if (!completedVerification) {
    issues.push({
      kind: "missing_completed_final_verification_assignment",
      workstreamId: finalVerification.workstreamId,
    });
    return issues;
  }
  const currentWorkstreamById = new Map(
    mission.workstreams.map((workstream) => [workstream.workstreamId, workstream]),
  );
  const coverage = resolveMissionAssignmentCoverage(mission, context);
  const requiredSubjectIds = [...currentWorkstreamById.values()].flatMap((workstream) => {
    if (workstream.kind === "verification") return [];
    const deliveryAssignmentId = coverage.assignmentIdsByWorkstreamId.get(workstream.workstreamId);
    if (
      !deliveryAssignmentId ||
      !coverage.completedDeliveryAssignmentIds.has(deliveryAssignmentId)
    ) {
      return [];
    }
    const reviewAssignmentId = coverage.approvedReviewAssignmentIdsByWorkstreamId.get(
      workstream.workstreamId,
    );
    return reviewAssignmentId ? [deliveryAssignmentId, reviewAssignmentId] : [deliveryAssignmentId];
  });
  for (const assignmentId of requiredSubjectIds) {
    if (completedVerification.subjectAssignmentIds.includes(assignmentId)) continue;
    issues.push({
      kind: "uncovered_final_verification_assignment",
      verificationAssignmentId: completedVerification.assignmentId,
      assignmentId,
    });
  }
  const hasExactSubjectCoverage = hasExactUniqueAssignmentIds(
    completedVerification.subjectAssignmentIds,
    requiredSubjectIds,
  );
  const hasExactDependencyCoverage = hasExactUniqueAssignmentIds(
    completedVerification.dependencyAssignmentIds,
    requiredSubjectIds,
  );
  const hasMissingSubject = requiredSubjectIds.some(
    (assignmentId) => !completedVerification.subjectAssignmentIds.includes(assignmentId),
  );
  if ((!hasExactSubjectCoverage || !hasExactDependencyCoverage) && !hasMissingSubject) {
    issues.push({
      kind: "invalid_final_verification_assignment_coverage",
      verificationAssignmentId: completedVerification.assignmentId,
      expectedAssignmentIds: requiredSubjectIds.toSorted(),
      subjectAssignmentIds: completedVerification.subjectAssignmentIds.toSorted(),
      dependencyAssignmentIds: completedVerification.dependencyAssignmentIds.toSorted(),
    });
  }
  return issues;
}

export function validateTeamMission(
  mission: TeamMission,
  context: ValidateTeamMissionContext,
): TeamMissionValidation {
  const planValidation = validateMissionWorkstreams(mission.workstreams);
  const issues: TeamMissionIssue[] = planValidation.ok ? [] : [...planValidation.issues];
  const finalVerifications = mission.workstreams.filter(
    (workstream) => workstream.kind === "verification",
  );
  for (const pathPrefix of mission.workspaceAuditPolicy.excludedPathPrefixes) {
    if (isNormalizedWorkspacePathPrefix(pathPrefix)) continue;
    issues.push({ kind: "invalid_audit_excluded_path_prefix", pathPrefix });
  }
  if (
    !mission.workspaceAuditPolicy.includeTrackedPaths ||
    !mission.workspaceAuditPolicy.includeNonIgnoredUntrackedPaths ||
    !mission.workspaceAuditPolicy.includeDeclaredArtifactPaths ||
    !mission.workspaceAuditPolicy.excludeGitignoredPathsByDefault
  ) {
    issues.push({ kind: "invalid_workspace_audit_policy" });
  }
  issues.push(...validateAttentionState(mission));
  issues.push(...validateFinalVerificationPlan(mission.workstreams, finalVerifications));
  issues.push(...validateFinalVerificationAssignments(mission, finalVerifications));
  const snapshotByRevision = new Map(
    mission.rosterSnapshots.map((snapshot) => [snapshot.revision, snapshot]),
  );
  issues.push(...validateRosterSnapshots(mission));
  issues.push(
    ...validateWorkstreamSelections(mission.workstreams, mission.planRevision, snapshotByRevision),
  );
  const workstreamPlanValidation = validateWorkstreamPlanSnapshots(mission, snapshotByRevision);
  issues.push(...workstreamPlanValidation.issues);
  issues.push(...validateAssignmentSnapshotReferences(mission, snapshotByRevision));
  const participantValidation = validateParticipantBindings(mission);
  issues.push(...participantValidation.issues);
  issues.push(
    ...validateAssignments(
      mission,
      snapshotByRevision,
      workstreamPlanValidation.workstreamByRevision,
      participantValidation.canResolveAssignmentBindings,
      context,
    ),
  );
  issues.push(...validateAssignmentCoverage(mission, context));
  issues.push(...validateAcceptedWorkstreams(mission, context));
  issues.push(...validateMissionCompletion(mission, finalVerifications, context));
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}
