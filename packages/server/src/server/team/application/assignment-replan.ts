import type { MissionAssignmentContract, TeamMission } from "@getpaseo/protocol/team/v2-types";

import type { AcceptedTurnOutcome } from "../domain/assignment-contract-validation.js";
import type { MissionRecipientAttentionDelivery } from "../persistence/schemas.js";

export interface AssignmentReplanTurnFact {
  outcome: Exclude<AcceptedTurnOutcome, "running">;
}

export function assignmentReportRequiresReplan(assignment: MissionAssignmentContract): boolean {
  return (
    assignment.report?.status === "blocked" ||
    assignment.report?.status === "failed" ||
    ((assignment.kind === "review" || assignment.kind === "verification") &&
      assignment.report?.verdict === "changes_requested")
  );
}

export function assignmentRequiresReplan(
  assignment: MissionAssignmentContract,
  fact: AssignmentReplanTurnFact,
): boolean {
  return fact.outcome !== "completed" || assignmentReportRequiresReplan(assignment);
}

export function assignmentReplanSummary(
  assignment: MissionAssignmentContract,
  fact: AssignmentReplanTurnFact,
): string {
  if (assignment.report?.status === "blocked") {
    return `Assignment ${assignment.assignmentId} reported blocked: ${assignment.report.summary}`;
  }
  if (assignment.report?.status === "failed") {
    return `Assignment ${assignment.assignmentId} reported failed: ${assignment.report.summary}`;
  }
  if (
    (assignment.kind === "review" || assignment.kind === "verification") &&
    assignment.report?.verdict === "changes_requested"
  ) {
    const assignmentKind = assignment.kind === "verification" ? "Verification" : "Review";
    return `${assignmentKind} Assignment ${assignment.assignmentId} requested changes: ${assignment.report.summary}`;
  }
  return `Assignment ${assignment.assignmentId} accepted turn settled as ${fact.outcome}`;
}

export function assignmentReplanAttentionId(missionId: string, assignmentId: string): string {
  return `${missionId}:${assignmentId}:requires-replan`;
}

export function buildLeadReplanDeliveries(input: {
  mission: TeamMission;
  existing: ReadonlyArray<MissionRecipientAttentionDelivery>;
  transitions: ReadonlyArray<{
    assignment: MissionAssignmentContract;
    fact: AssignmentReplanTurnFact;
  }>;
  now: string;
}): MissionRecipientAttentionDelivery[] {
  const roster = input.mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === input.mission.activeRosterSnapshotRevision,
  );
  if (!roster) return [];
  const lead = roster.members.find((member) => member.memberId === roster.leadMemberId);
  const participant = input.mission.participants
    .filter(
      (candidate) => candidate.memberId === roster.leadMemberId && candidate.archivedAt === null,
    )
    .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0];
  if (!lead || !participant) return [];

  return input.transitions.flatMap(({ assignment, fact }) => {
    if (!assignment.runtimeAgentId) return [];
    const idempotencyKey = assignmentReplanAttentionId(input.mission.id, assignment.assignmentId);
    if (input.existing.some((delivery) => delivery.idempotencyKey === idempotencyKey)) return [];
    return [
      {
        deliveryId: `${idempotencyKey}:lead`,
        idempotencyKey,
        requestFingerprint: JSON.stringify({
          missionId: input.mission.id,
          assignmentId: assignment.assignmentId,
          assignmentRevision: assignment.revision,
          outcome: fact.outcome,
          reportStatus: assignment.report?.status ?? null,
        }),
        roomMessageId: `${idempotencyKey}:message`,
        senderMemberId: assignment.assigneeMemberId,
        senderAgentId: assignment.runtimeAgentId,
        recipientMemberId: lead.memberId,
        bindingEpoch: participant.bindingEpoch,
        mentionHandle: lead.mentionHandle,
        body: `@${lead.mentionHandle} Assignment ${assignment.assignmentId} requires replanning. Call mission_status for the durable blocker, then submit one mission_plan containing the complete replacement Workstream DAG, replacementAssignments, and every additional delivery or integration Assignment Contract.`,
        roomPostedAt: null,
        roomCursor: null,
        attempts: 0,
        createdAt: input.now,
        successorDeliveryId: null,
        state: "pending" as const,
        lastAttemptAt: null,
        nextEligibleAt: input.now,
        acknowledgedAt: null,
        canceledAt: null,
        cancelReason: null,
      },
    ];
  });
}
