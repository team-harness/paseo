import { createHash } from "node:crypto";

export const FINAL_VERIFICATION_OUTCOME_PREFIX = "Final verification outcome:";
export const LEAD_FINAL_SUMMARY_PREFIX = "Final Mission summary:";

export function finalVerificationOutcomeIdempotencyKey(assignmentId: string): string {
  return `assignment:${assignmentId}:final-verification-outcome`;
}

export function leadFinalSummaryIdempotencyKey(assignmentId: string): string {
  return `assignment:${assignmentId}:lead-final-summary`;
}

export function agentRoomCloseoutMessageId(
  missionId: string,
  agentId: string,
  idempotencyKey: string,
): string {
  return `agent-room:${createHash("sha256")
    .update(`${missionId}\0${agentId}\0${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function agentRoomMentionDeliveryId(roomMessageId: string, memberId: string): string {
  return `${roomMessageId}:mention:${createHash("sha256")
    .update(memberId)
    .digest("hex")
    .slice(0, 16)}`;
}
