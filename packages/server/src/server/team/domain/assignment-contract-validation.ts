import type {
  MissionAssignmentContract,
  MissionMutableScope,
} from "@getpaseo/protocol/team/v2-types";

import {
  isNormalizedWorkspaceFilePath,
  isNormalizedWorkspacePathPrefix,
} from "./mission-plan-validation.js";

export type AcceptedTurnOutcome = "running" | "completed" | "failed" | "canceled" | "unknown";

export interface AcceptedTurnFact {
  assignmentId: string;
  turnId: string;
  runtimeAgentId: string;
  outcome: AcceptedTurnOutcome;
}

export type AssignmentStateViolation =
  | "delivery_subjects_must_be_empty"
  | "subject_assignment_required"
  | "report_hold_required"
  | "dispatch_state_must_be_queued"
  | "dispatch_state_must_be_dispatched"
  | "dispatch_state_must_be_settled"
  | "report_must_be_absent"
  | "completed_report_required"
  | "blocked_report_required"
  | "failed_report_or_reason_required"
  | "accepted_turn_must_be_absent"
  | "accepted_turn_required"
  | "accepted_turn_fact_must_be_absent"
  | "accepted_turn_assignment_mismatch"
  | "accepted_turn_id_mismatch"
  | "accepted_turn_runtime_agent_mismatch"
  | "accepted_turn_must_be_running"
  | "accepted_turn_must_be_settled"
  | "accepted_turn_must_be_completed"
  | "runtime_agent_required"
  | "runtime_agent_must_be_absent"
  | "binding_epoch_required"
  | "binding_epoch_must_be_absent"
  | "workspace_baseline_required"
  | "workspace_baseline_must_be_absent"
  | "execution_scope_lease_required"
  | "scope_lease_must_be_absent"
  | "workspace_baseline_assignment_mismatch"
  | "workspace_baseline_workspace_mismatch"
  | "scope_lease_assignment_mismatch"
  | "scope_lease_scope_mismatch"
  | "scope_lease_workspace_mismatch"
  | "invalid_mutable_path_prefix"
  | "invalid_workspace_baseline_path"
  | "invalid_scope_delta_path"
  | "invalid_report_artifact_path"
  | "invalid_handoff_artifact_path"
  | "workspace_baseline_after_dispatch"
  | "workspace_baseline_before_lease"
  | "report_hold_transition_required"
  | "report_hold_recovery_attempts_exceeded"
  | "execution_lease_transition_must_be_absent"
  | "execution_lease_delta_must_be_empty"
  | "execution_lease_recovery_attempts_must_be_zero"
  | "dispatched_at_required"
  | "dispatched_at_must_be_absent"
  | "settled_at_required"
  | "settled_at_must_be_absent"
  | "completion_verdict_required"
  | "delivery_verdict_must_be_absent"
  | "termination_reason_required"
  | "termination_reason_must_be_absent"
  | "termination_reason_outcome_mismatch"
  | "plan_change_reason_must_be_absent"
  | "superseded_by_required"
  | "superseded_by_must_be_absent";

export interface AssignmentContractIssue {
  kind: "invalid_assignment_state";
  assignmentId: string;
  violations: AssignmentStateViolation[];
}

export type AssignmentContractValidation =
  | { ok: true }
  | { ok: false; issues: AssignmentContractIssue[] };

export interface ValidateAssignmentContractInput {
  assignment: MissionAssignmentContract;
  acceptedTurn: AcceptedTurnFact | null;
  expectedWorkspaceId: string;
}

function sameMutableScope(left: MissionMutableScope, right: MissionMutableScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "paths" || right.kind !== "paths") return true;
  return (
    left.pathPrefixes.length === right.pathPrefixes.length &&
    left.pathPrefixes.every((pathPrefix, index) => pathPrefix === right.pathPrefixes[index])
  );
}

function isAfter(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}

function turnOutcome(input: ValidateAssignmentContractInput): AcceptedTurnOutcome | null {
  return input.acceptedTurn?.outcome ?? null;
}

function validateNoAcceptedTurn(
  input: ValidateAssignmentContractInput,
): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  if (input.assignment.acceptedTurnId !== null) violations.push("accepted_turn_must_be_absent");
  return violations;
}

function validateAcceptedTurnIdentity(
  input: ValidateAssignmentContractInput,
): AssignmentStateViolation[] {
  const { assignment, acceptedTurn } = input;
  const violations: AssignmentStateViolation[] = [];
  if (assignment.acceptedTurnId === null) {
    if (acceptedTurn !== null) violations.push("accepted_turn_fact_must_be_absent");
    return violations;
  }
  if (acceptedTurn === null) return violations;
  if (acceptedTurn.assignmentId !== assignment.assignmentId) {
    violations.push("accepted_turn_assignment_mismatch");
  }
  if (acceptedTurn.turnId !== assignment.acceptedTurnId) {
    violations.push("accepted_turn_id_mismatch");
  }
  if (
    assignment.runtimeAgentId !== null &&
    acceptedTurn.runtimeAgentId !== assignment.runtimeAgentId
  ) {
    violations.push("accepted_turn_runtime_agent_mismatch");
  }
  return violations;
}

function validatePlannedState(input: ValidateAssignmentContractInput): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations: AssignmentStateViolation[] = [];
  if (assignment.dispatchState !== "queued") violations.push("dispatch_state_must_be_queued");
  if (assignment.report !== null) violations.push("report_must_be_absent");
  violations.push(...validateNoAcceptedTurn(input));
  if (assignment.dispatchedAt !== null) violations.push("dispatched_at_must_be_absent");
  if (assignment.settledAt !== null) violations.push("settled_at_must_be_absent");
  return violations;
}

function validateRunningState(input: ValidateAssignmentContractInput): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations: AssignmentStateViolation[] = [];
  if (assignment.dispatchState !== "dispatched") {
    violations.push("dispatch_state_must_be_dispatched");
  }
  if (assignment.acceptedTurnId === null || input.acceptedTurn === null) {
    violations.push("accepted_turn_required");
  }
  if (turnOutcome(input) !== "running") violations.push("accepted_turn_must_be_running");
  if (assignment.dispatchedAt === null) violations.push("dispatched_at_required");
  if (assignment.settledAt !== null) violations.push("settled_at_must_be_absent");
  return violations;
}

function validateSettledAcceptedTurn(
  input: ValidateAssignmentContractInput,
): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations: AssignmentStateViolation[] = [];
  if (assignment.acceptedTurnId === null || input.acceptedTurn === null) {
    violations.push("accepted_turn_required");
  }
  if (assignment.dispatchState !== "settled") violations.push("dispatch_state_must_be_settled");
  const outcome = turnOutcome(input);
  if (outcome === null || outcome === "running") violations.push("accepted_turn_must_be_settled");
  if (assignment.dispatchedAt === null) violations.push("dispatched_at_required");
  if (assignment.settledAt === null) violations.push("settled_at_required");
  return violations;
}

function validateNeedsReportState(
  input: ValidateAssignmentContractInput,
): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations = validateSettledAcceptedTurn(input);
  if (assignment.report !== null) violations.unshift("report_must_be_absent");
  if (turnOutcome(input) !== "completed") violations.push("accepted_turn_must_be_completed");
  if (
    assignment.mutableScope.kind !== "read_only" &&
    assignment.scopeLease?.state !== "report_hold"
  ) {
    violations.push("report_hold_required");
  }
  return violations;
}

function validateBlockedState(input: ValidateAssignmentContractInput): AssignmentStateViolation[] {
  const { assignment } = input;
  if (
    assignment.terminationReason === "provider_unavailable" ||
    assignment.terminationReason === "dispatch_acceptance_unknown"
  ) {
    const violations: AssignmentStateViolation[] = [];
    if (assignment.dispatchState !== "queued") violations.push("dispatch_state_must_be_queued");
    if (assignment.report !== null) violations.push("report_must_be_absent");
    violations.push(...validateNoAcceptedTurn(input));
    if (assignment.dispatchedAt !== null) violations.push("dispatched_at_must_be_absent");
    if (assignment.settledAt !== null) violations.push("settled_at_must_be_absent");
    return violations;
  }
  const violations = validateSettledAcceptedTurn(input);
  if (assignment.report?.status !== "blocked") violations.unshift("blocked_report_required");
  if (assignment.dispatchState === "settled" && turnOutcome(input) !== "completed") {
    violations.push("accepted_turn_must_be_completed");
  }
  if (assignment.terminationReason !== null) {
    violations.push("termination_reason_must_be_absent");
  }
  return violations;
}

function expectedFailureReason(
  outcome: AcceptedTurnOutcome | null,
): MissionAssignmentContract["terminationReason"] {
  switch (outcome) {
    case "completed":
      return "missing_report";
    case "failed":
      return "turn_failed";
    case "canceled":
      return "turn_canceled";
    case "unknown":
      return "turn_unknown";
    case "running":
    case null:
      return null;
  }
}

function validateFailedState(input: ValidateAssignmentContractInput): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations = validateSettledAcceptedTurn(input);
  const hasFailedReport = assignment.report?.status === "failed";
  const hasChangesRequestedReport =
    assignment.kind !== "delivery" &&
    assignment.report?.status === "completed" &&
    assignment.report.verdict === "changes_requested";
  const hasFailureEvidence = hasFailedReport || hasChangesRequestedReport;
  if (!hasFailureEvidence && assignment.terminationReason === null) {
    violations.unshift("failed_report_or_reason_required");
  }
  if (
    !hasFailureEvidence &&
    assignment.terminationReason !== null &&
    assignment.terminationReason !== expectedFailureReason(turnOutcome(input))
  ) {
    violations.push("termination_reason_outcome_mismatch");
  }
  return violations;
}

function validateCanceledState(input: ValidateAssignmentContractInput): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations: AssignmentStateViolation[] = [];
  const canceledByPlanChange = assignment.planChangeReason === "quality_gate_no_longer_required";
  if (
    !canceledByPlanChange &&
    assignment.terminationReason !== "superseded" &&
    assignment.terminationReason !== "mission_canceled" &&
    assignment.terminationReason !== "mission_failed" &&
    assignment.terminationReason !== "participant_unavailable"
  ) {
    violations.push("termination_reason_required");
  }
  if (canceledByPlanChange && assignment.terminationReason !== null) {
    violations.push("termination_reason_must_be_absent");
  }
  if (
    !canceledByPlanChange &&
    assignment.terminationReason === "superseded" &&
    assignment.supersededBy === null
  ) {
    violations.push("superseded_by_required");
  }
  if (
    (canceledByPlanChange || assignment.terminationReason !== "superseded") &&
    assignment.supersededBy !== null
  ) {
    violations.push("superseded_by_must_be_absent");
  }
  if (
    assignment.acceptedTurnId === null ||
    assignment.terminationReason === "participant_unavailable"
  ) {
    if (assignment.dispatchState !== "queued") violations.push("dispatch_state_must_be_queued");
    if (assignment.report !== null) violations.push("report_must_be_absent");
    violations.push(...validateNoAcceptedTurn(input));
    if (assignment.dispatchedAt !== null) violations.push("dispatched_at_must_be_absent");
  } else {
    violations.push(...validateSettledAcceptedTurn(input));
  }
  if (assignment.settledAt === null) violations.push("settled_at_required");
  return violations;
}

function validateCompletedState(
  input: ValidateAssignmentContractInput,
): AssignmentStateViolation[] {
  const { assignment } = input;
  const violations: AssignmentStateViolation[] = [];
  if (assignment.dispatchState !== "settled") violations.push("dispatch_state_must_be_settled");
  if (assignment.report?.status !== "completed") violations.push("completed_report_required");
  if (assignment.acceptedTurnId === null || input.acceptedTurn === null) {
    violations.push("accepted_turn_required");
  }
  if (turnOutcome(input) !== "completed") violations.push("accepted_turn_must_be_completed");
  if (assignment.dispatchedAt === null) violations.push("dispatched_at_required");
  if (assignment.settledAt === null) violations.push("settled_at_required");
  return violations;
}

function validateSemanticState(input: ValidateAssignmentContractInput): AssignmentStateViolation[] {
  switch (input.assignment.semanticState) {
    case "planned":
      return validatePlannedState(input);
    case "running":
      return validateRunningState(input);
    case "needs_report":
      return validateNeedsReportState(input);
    case "blocked":
      return validateBlockedState(input);
    case "failed":
      return validateFailedState(input);
    case "canceled":
      return validateCanceledState(input);
    case "completed":
      return validateCompletedState(input);
  }
}

function validateDispatchEvidence(
  assignment: MissionAssignmentContract,
): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  const hasDispatchEvidence =
    assignment.dispatchState !== "queued" ||
    assignment.dispatchedAt !== null ||
    assignment.acceptedTurnId !== null;
  if (hasDispatchEvidence && assignment.runtimeAgentId === null) {
    violations.push("runtime_agent_required");
  }
  if (!hasDispatchEvidence && assignment.runtimeAgentId !== null) {
    violations.push("runtime_agent_must_be_absent");
  }
  if (hasDispatchEvidence && assignment.bindingEpoch === null) {
    violations.push("binding_epoch_required");
  }
  if (!hasDispatchEvidence && assignment.bindingEpoch !== null) {
    violations.push("binding_epoch_must_be_absent");
  }
  if (hasDispatchEvidence && assignment.workspaceBaseline === null) {
    violations.push("workspace_baseline_required");
  }
  if (!hasDispatchEvidence && assignment.workspaceBaseline !== null) {
    violations.push("workspace_baseline_must_be_absent");
  }
  return violations;
}

function validateLeaseLifecycle(assignment: MissionAssignmentContract): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  const isWritable = assignment.mutableScope.kind !== "read_only";
  if (
    assignment.semanticState === "running" &&
    assignment.dispatchState === "dispatched" &&
    isWritable &&
    assignment.scopeLease?.state !== "execution"
  ) {
    violations.push("execution_scope_lease_required");
  }
  if (
    assignment.scopeLease !== null &&
    (!isWritable ||
      assignment.semanticState === "planned" ||
      assignment.semanticState === "blocked" ||
      assignment.semanticState === "completed" ||
      assignment.semanticState === "failed" ||
      assignment.semanticState === "canceled")
  ) {
    violations.push("scope_lease_must_be_absent");
  }
  return violations;
}

function validateEvidenceIdentity(
  assignment: MissionAssignmentContract,
  expectedWorkspaceId: string,
): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  const baseline = assignment.workspaceBaseline;
  const lease = assignment.scopeLease;
  if (baseline && baseline.assignmentId !== assignment.assignmentId) {
    violations.push("workspace_baseline_assignment_mismatch");
  }
  if (baseline && baseline.workspaceId !== expectedWorkspaceId) {
    violations.push("workspace_baseline_workspace_mismatch");
  }
  if (lease && lease.assignmentId !== assignment.assignmentId) {
    violations.push("scope_lease_assignment_mismatch");
  }
  if (lease && !sameMutableScope(lease.scope, assignment.mutableScope)) {
    violations.push("scope_lease_scope_mismatch");
  }
  if (lease && lease.workspaceId !== expectedWorkspaceId) {
    violations.push("scope_lease_workspace_mismatch");
  }
  return violations;
}

function validateEvidencePaths(assignment: MissionAssignmentContract): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  if (
    assignment.mutableScope.kind === "paths" &&
    assignment.mutableScope.pathPrefixes.some(
      (pathPrefix) => !isNormalizedWorkspacePathPrefix(pathPrefix),
    )
  ) {
    violations.push("invalid_mutable_path_prefix");
  }
  if (
    assignment.workspaceBaseline?.entries.some(
      (entry) => !isNormalizedWorkspaceFilePath(entry.path),
    )
  ) {
    violations.push("invalid_workspace_baseline_path");
  }
  if (
    assignment.scopeLease?.capturedDelta.some((entry) => !isNormalizedWorkspaceFilePath(entry.path))
  ) {
    violations.push("invalid_scope_delta_path");
  }
  if (assignment.report?.artifactPaths.some((path) => !isNormalizedWorkspaceFilePath(path))) {
    violations.push("invalid_report_artifact_path");
  }
  if (
    assignment.report?.handoffs.some((handoff) =>
      handoff.artifactPaths.some((path) => !isNormalizedWorkspaceFilePath(path)),
    )
  ) {
    violations.push("invalid_handoff_artifact_path");
  }
  return violations;
}

function validateEvidenceTimeline(
  assignment: MissionAssignmentContract,
): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  const baseline = assignment.workspaceBaseline;
  const lease = assignment.scopeLease;
  if (
    baseline &&
    assignment.dispatchedAt &&
    isAfter(baseline.capturedAt, assignment.dispatchedAt)
  ) {
    violations.push("workspace_baseline_after_dispatch");
  }
  if (lease && baseline && isAfter(lease.acquiredAt, baseline.capturedAt)) {
    violations.push("workspace_baseline_before_lease");
  }
  return violations;
}

function validateLeaseMetadata(assignment: MissionAssignmentContract): AssignmentStateViolation[] {
  const violations: AssignmentStateViolation[] = [];
  const lease = assignment.scopeLease;
  if (lease?.state === "report_hold" && lease.transitionedAt === null) {
    violations.push("report_hold_transition_required");
  }
  if (lease?.state === "report_hold" && lease.recoveryAttempts > 2) {
    violations.push("report_hold_recovery_attempts_exceeded");
  }
  if (lease?.state !== "execution") return violations;
  if (lease.transitionedAt !== null) {
    violations.push("execution_lease_transition_must_be_absent");
  }
  if (lease.capturedDelta.length > 0) {
    violations.push("execution_lease_delta_must_be_empty");
  }
  if (lease.recoveryAttempts !== 0) {
    violations.push("execution_lease_recovery_attempts_must_be_zero");
  }
  return violations;
}

function validateReportVerdict(assignment: MissionAssignmentContract): AssignmentStateViolation[] {
  if (assignment.report?.status !== "completed") return [];
  if (assignment.kind === "delivery") {
    return assignment.report.verdict === null ? [] : ["delivery_verdict_must_be_absent"];
  }
  return assignment.report.verdict === null ? ["completion_verdict_required"] : [];
}

function validateTerminationMetadata(
  assignment: MissionAssignmentContract,
): AssignmentStateViolation[] {
  const permitsTerminationReason =
    assignment.semanticState === "blocked" ||
    assignment.semanticState === "failed" ||
    assignment.semanticState === "canceled";
  const violations: AssignmentStateViolation[] = [];
  if (!permitsTerminationReason && assignment.terminationReason !== null) {
    violations.push("termination_reason_must_be_absent");
  }
  if (
    assignment.planChangeReason !== undefined &&
    (assignment.semanticState !== "canceled" || assignment.kind === "delivery")
  ) {
    violations.push("plan_change_reason_must_be_absent");
  }
  if (
    assignment.semanticState !== "canceled" &&
    (assignment.supersededBy !== null || assignment.terminationReason === "superseded")
  ) {
    violations.push("superseded_by_must_be_absent");
  }
  return violations;
}

export function validateAssignmentContract(
  input: ValidateAssignmentContractInput,
): AssignmentContractValidation {
  const violations: AssignmentStateViolation[] = [];
  if (input.assignment.kind === "delivery" && input.assignment.subjectAssignmentIds.length > 0) {
    violations.push("delivery_subjects_must_be_empty");
  }
  if (input.assignment.kind !== "delivery" && input.assignment.subjectAssignmentIds.length === 0) {
    violations.push("subject_assignment_required");
  }
  violations.push(...validateSemanticState(input));
  violations.push(...validateAcceptedTurnIdentity(input));
  violations.push(...validateDispatchEvidence(input.assignment));
  violations.push(...validateLeaseLifecycle(input.assignment));
  violations.push(...validateEvidenceIdentity(input.assignment, input.expectedWorkspaceId));
  violations.push(...validateEvidencePaths(input.assignment));
  violations.push(...validateEvidenceTimeline(input.assignment));
  violations.push(...validateLeaseMetadata(input.assignment));
  violations.push(...validateReportVerdict(input.assignment));
  violations.push(...validateTerminationMetadata(input.assignment));

  return violations.length > 0
    ? {
        ok: false,
        issues: [
          {
            kind: "invalid_assignment_state",
            assignmentId: input.assignment.assignmentId,
            violations,
          },
        ],
      }
    : { ok: true };
}
