import {
  FINAL_VERIFICATION_OUTCOME_PREFIX,
  finalVerificationOutcomeIdempotencyKey,
  LEAD_FINAL_SUMMARY_PREFIX,
  leadFinalSummaryIdempotencyKey,
} from "../../application/team-room-closeout.js";

export const TEAM_ROOM_COLLABORATION_PROMPT = [
  "Use the Mission task room for concise human-visible coordination:",
  "- Post a brief task-room update with chat_post when you start an Assignment.",
  "- Post again only for substantive progress, a decision that affects teammates, a blocker, or a delivery/review/verification outcome. Mention a Member or @team only when a response is needed.",
  "- Before assignment_report, post the concise outcome or blocker in the task room. chat_post communicates progress but does not change Assignment state; assignment_report is the authoritative structured state transition and does not publish a task-room update.",
  `- If this Assignment is final verification, post the terminal outcome with idempotencyKey "${finalVerificationOutcomeIdempotencyKey("<assignmentId>")}", start the body with "${FINAL_VERIFICATION_OUTCOME_PREFIX}", mention the Mission Lead, and ask for the final Mission summary. Wait until that Lead summary is visible before assignment_report; if it is not visible yet, end this turn without reporting. If you are also the Mission Lead, post the outcome and then a separate final summary yourself, call chat_read again until that exact summary is visible, and only then report; self-mentions are not required.`,
  "- Do not mirror your transcript or routine tool calls into the task room.",
].join("\n");

export interface FinalVerificationRecoveryObservation {
  outcomeVisible: boolean;
  leadSummaryVisible: boolean;
  verifierIsLead: boolean;
}

export interface FinalVerificationRecoveryAction {
  roomPost: "outcome" | "summary" | null;
  readAfterRoomPost: boolean;
  submitReport: boolean;
}

export function resolveFinalVerificationRecoveryAction(
  observation: FinalVerificationRecoveryObservation,
): FinalVerificationRecoveryAction {
  if (!observation.outcomeVisible) {
    return { roomPost: "outcome", readAfterRoomPost: false, submitReport: false };
  }
  if (!observation.leadSummaryVisible) {
    return observation.verifierIsLead
      ? { roomPost: "summary", readAfterRoomPost: true, submitReport: true }
      : { roomPost: null, readAfterRoomPost: false, submitReport: false };
  }
  return { roomPost: null, readAfterRoomPost: false, submitReport: true };
}

export function teamRoomReportRecoveryPrompt(assignmentId: string): string {
  const outcomeMissing = resolveFinalVerificationRecoveryAction({
    outcomeVisible: false,
    leadSummaryVisible: false,
    verifierIsLead: false,
  });
  const summaryMissing = resolveFinalVerificationRecoveryAction({
    outcomeVisible: true,
    leadSummaryVisible: false,
    verifierIsLead: false,
  });
  const summaryMissingForLead = resolveFinalVerificationRecoveryAction({
    outcomeVisible: true,
    leadSummaryVisible: false,
    verifierIsLead: true,
  });
  const closeoutComplete = resolveFinalVerificationRecoveryAction({
    outcomeVisible: true,
    leadSummaryVisible: true,
    verifierIsLead: false,
  });
  return [
    "This is structured report recovery. Do not repeat implementation work or duplicate an existing task-room update.",
    "Call chat_read before assignment_report.",
    `If Assignment "${assignmentId}" is final verification, find your terminal outcome and a later final Mission summary from the Lead. Call assignment_report only when both are visible.`,
    `If the verifier outcome is missing, ${describeFinalVerificationRecoveryAction(outcomeMissing, assignmentId)} Mention the Mission Lead so they can respond.`,
    `If the verifier outcome exists but the Lead summary does not and you are not the Mission Lead, ${describeFinalVerificationRecoveryAction(summaryMissing, assignmentId)} The Lead reply or scheduler report recovery will wake you again.`,
    `If the verifier outcome exists but the Lead summary does not and you are also the Mission Lead, ${describeFinalVerificationRecoveryAction(summaryMissingForLead, assignmentId)}`,
    `If both the verifier outcome and later Lead summary are visible, ${describeFinalVerificationRecoveryAction(closeoutComplete, assignmentId)}`,
    "For any other Assignment, call assignment_report now without another task-room update.",
  ].join("\n");
}

function describeFinalVerificationRecoveryAction(
  action: FinalVerificationRecoveryAction,
  assignmentId: string,
): string {
  if (action.roomPost === "outcome") {
    return `post it once with idempotencyKey "${finalVerificationOutcomeIdempotencyKey(assignmentId)}", start the body with "${FINAL_VERIFICATION_OUTCOME_PREFIX}", and end this turn without assignment_report.`;
  }
  if (action.roomPost === "summary") {
    return `post the separate final summary with idempotencyKey "${leadFinalSummaryIdempotencyKey(assignmentId)}", start the body with "${LEAD_FINAL_SUMMARY_PREFIX}", then call chat_read again until that exact summary is visible before calling assignment_report exactly once.`;
  }
  return action.submitReport
    ? "do not post another Room update; call assignment_report exactly once."
    : "do not post another Room update and end this turn without assignment_report.";
}

export const TEAM_LEAD_ROOM_COLLABORATION_PROMPT = [
  TEAM_ROOM_COLLABORATION_PROMPT,
  `As Lead, post a short plan/dispatch summary after assigning or replanning work. When the final verifier mentions you with the terminal verification outcome, read the task room, take its Assignment id, and post the final Mission summary with idempotencyKey "${leadFinalSummaryIdempotencyKey("<assignmentId>")}". Start the body with "${LEAD_FINAL_SUMMARY_PREFIX}" and mention that verifier so they are woken to submit assignment_report.`,
].join("\n");
