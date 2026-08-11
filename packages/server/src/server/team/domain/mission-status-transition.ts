import type { TeamMissionStatus } from "@getpaseo/protocol/team/v2-types";

export type MissionStatusTransitionIntent =
  | "plan_accepted"
  | "attention_raised"
  | "attention_resolved"
  | "begin_verification"
  | "changes_requested"
  | "quality_gate_passed"
  | "fatal_failure"
  | "cancel";

export interface MissionStatusTransitionInput {
  from: TeamMissionStatus;
  to: TeamMissionStatus;
  intent: MissionStatusTransitionIntent;
  qualityGateSatisfied: boolean;
  fatalFailureIntentId: string | null;
  suspendedStatus: "planning" | "active" | "verifying" | null;
}

export type MissionStatusTransitionIssue =
  | { kind: "terminal_mission_state"; from: TeamMissionStatus; to: TeamMissionStatus }
  | { kind: "quality_gate_required"; from: TeamMissionStatus; to: TeamMissionStatus }
  | { kind: "fatal_failure_intent_required"; from: TeamMissionStatus; to: TeamMissionStatus }
  | { kind: "invalid_mission_transition"; from: TeamMissionStatus; to: TeamMissionStatus };

export type MissionStatusTransitionValidation =
  | { ok: true }
  | { ok: false; issue: MissionStatusTransitionIssue };

const terminalStatuses = new Set<TeamMissionStatus>(["completed", "failed", "canceled"]);
const ordinaryTransitions = new Set<string>([
  "planning\0active\0plan_accepted",
  "active\0verifying\0begin_verification",
  "verifying\0active\0changes_requested",
]);

function invalidTransition(input: MissionStatusTransitionInput): MissionStatusTransitionValidation {
  return {
    ok: false,
    issue: { kind: "invalid_mission_transition", from: input.from, to: input.to },
  };
}

function validateFatalFailure(
  input: MissionStatusTransitionInput,
): MissionStatusTransitionValidation {
  if (input.to !== "failed") return invalidTransition(input);
  return input.fatalFailureIntentId
    ? { ok: true }
    : {
        ok: false,
        issue: { kind: "fatal_failure_intent_required", from: input.from, to: input.to },
      };
}

function validateQualityGate(
  input: MissionStatusTransitionInput,
): MissionStatusTransitionValidation {
  if (input.from !== "verifying" || input.to !== "completed") {
    return invalidTransition(input);
  }
  return input.qualityGateSatisfied
    ? { ok: true }
    : {
        ok: false,
        issue: { kind: "quality_gate_required", from: input.from, to: input.to },
      };
}

function validateAttentionTransition(
  input: MissionStatusTransitionInput,
): MissionStatusTransitionValidation {
  if (input.intent === "attention_raised") {
    const canSuspend =
      (input.from === "planning" || input.from === "active" || input.from === "verifying") &&
      input.to === "needs_attention" &&
      input.suspendedStatus === input.from;
    return canSuspend ? { ok: true } : invalidTransition(input);
  }
  const canResume =
    input.from === "needs_attention" &&
    input.suspendedStatus !== null &&
    input.to === input.suspendedStatus;
  return canResume ? { ok: true } : invalidTransition(input);
}

export function validateMissionStatusTransition(
  input: MissionStatusTransitionInput,
): MissionStatusTransitionValidation {
  if (terminalStatuses.has(input.from)) {
    return {
      ok: false,
      issue: { kind: "terminal_mission_state", from: input.from, to: input.to },
    };
  }
  if (input.intent === "cancel") {
    return input.to === "canceled" ? { ok: true } : invalidTransition(input);
  }
  if (input.intent === "fatal_failure") {
    return validateFatalFailure(input);
  }
  if (input.intent === "quality_gate_passed") {
    return validateQualityGate(input);
  }
  if (input.intent === "attention_raised" || input.intent === "attention_resolved") {
    return validateAttentionTransition(input);
  }
  const transitionKey = `${input.from}\0${input.to}\0${input.intent}`;
  return ordinaryTransitions.has(transitionKey) ? { ok: true } : invalidTransition(input);
}
