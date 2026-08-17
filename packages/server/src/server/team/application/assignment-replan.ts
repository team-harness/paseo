import type { MissionAssignmentContract, TeamMission } from "@getpaseo/protocol/team/v2-types";

import type { AcceptedTurnOutcome } from "../domain/assignment-contract-validation.js";
import type { MissionRecipientAttentionDelivery } from "../persistence/schemas.js";

export interface AssignmentReplanTurnFact {
  outcome: Exclude<AcceptedTurnOutcome, "running">;
}

export function buildCapabilityReplanBindingDeliveries(input: {
  mission: TeamMission;
  existing: ReadonlyArray<MissionRecipientAttentionDelivery>;
  now: string;
}): MissionRecipientAttentionDelivery[] {
  const roster = input.mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === input.mission.activeRosterSnapshotRevision,
  );
  if (!roster) return [];
  const participant = input.mission.participants
    .filter(
      (candidate) => candidate.memberId === roster.leadMemberId && candidate.archivedAt === null,
    )
    .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0];
  const lead = roster.members.find((member) => member.memberId === roster.leadMemberId);
  if (!participant || !lead) return [];

  return input.mission.capabilityReplanRequests.flatMap((request) => {
    if (request.consumedAt !== null) return [];
    const root = input.existing.find((delivery) => delivery.deliveryId === request.deliveryId);
    if (!root) return [];
    const hasCurrentBindingDelivery = input.existing.some(
      (delivery) =>
        delivery.recipientMemberId === roster.leadMemberId &&
        delivery.bindingEpoch === participant.bindingEpoch &&
        (delivery.deliveryId === request.deliveryId ||
          delivery.deliveryId.startsWith(`${request.deliveryId}:binding:`)) &&
        delivery.state !== "canceled",
    );
    if (hasCurrentBindingDelivery) return [];

    const currentDeliveryId = nextCapabilityBindingDeliveryId(
      request.deliveryId,
      participant.bindingEpoch,
      input.existing,
    );

    return [
      {
        ...root,
        deliveryId: currentDeliveryId,
        idempotencyKey: `${request.idempotencyKey}:binding:${participant.bindingEpoch}`,
        recipientMemberId: lead.memberId,
        bindingEpoch: participant.bindingEpoch,
        mentionHandle: lead.mentionHandle,
        body: capabilityReplanDeliveryBody({
          mentionHandle: lead.mentionHandle,
          requestId: request.requestId,
          rosterSnapshotRevision: request.rosterSnapshotRevision,
        }),
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

export function capabilityReplanDeliveryBody(input: {
  mentionHandle: string;
  requestId: string;
  rosterSnapshotRevision: number;
}): string {
  return `@${input.mentionHandle} Paseo capability refresh request ${input.requestId} created roster revision ${input.rosterSnapshotRevision}. Read mission_status, then submit a complete mission_plan. This request is not a plan commit and does not change the frozen roster, Skills, or Levels.`;
}

function nextCapabilityBindingDeliveryId(
  rootDeliveryId: string,
  bindingEpoch: number,
  existing: ReadonlyArray<MissionRecipientAttentionDelivery>,
): string {
  let candidate = `${rootDeliveryId}:binding:${bindingEpoch}`;
  const deliveryIds = new Set(existing.map((delivery) => delivery.deliveryId));
  while (deliveryIds.has(candidate)) candidate = `${candidate}:binding:${bindingEpoch}`;
  return candidate;
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
