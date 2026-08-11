import { z } from "zod";

import {
  MissionMutableScopeSchema,
  MissionAssignmentTerminalEvidenceSchema,
  MissionRosterSnapshotSchema,
  MissionScopeLeaseSchema,
  MissionWorkspaceBaselineSchema,
  MissionWorkspaceAuditPolicySchema,
  TeamMissionSchema,
  TeamMissionStatusSchema,
  TeamV2Schema,
} from "@getpaseo/protocol/team/v2-types";

const TimestampSchema = z.string().datetime({ offset: true });

export const TeamMissionStartStageSchema = z.enum([
  "reserved",
  "mission_written",
  "room_created",
  "lead_created",
]);
export type TeamMissionStartStage = z.infer<typeof TeamMissionStartStageSchema>;

export const TeamMissionStartIntentSchema = z.object({
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  expectedTeamRevision: z.number().int().nonnegative(),
  missionId: z.string().min(1),
  chatRoomId: z.string().min(1),
  teamName: z.string().min(1),
  leadAgentId: z.string().min(1),
  bindingEpoch: z.number().int().positive(),
  objective: z.string().min(1),
  constraints: z.array(z.string().min(1)),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  rosterSnapshot: MissionRosterSnapshotSchema,
  workspaceAuditPolicy: MissionWorkspaceAuditPolicySchema,
  stage: TeamMissionStartStageSchema,
  requestedAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TeamMissionStartIntent = z.infer<typeof TeamMissionStartIntentSchema>;

export const TeamLeadReplacementStageSchema = z.enum(["reserved", "superseded_archived"]);
export type TeamLeadReplacementStage = z.infer<typeof TeamLeadReplacementStageSchema>;

export const TeamLeadReplacementIntentSchema = z.object({
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  attentionId: z.string().min(1),
  missionStartIntentId: z.string().min(1).nullable().default(null),
  previousLeadMemberId: z.string().min(1),
  replacementMemberId: z.string().min(1),
  replacementAgentId: z.string().min(1),
  supersededParticipantAgentIds: z.array(z.string().min(1)).default([]),
  bindingEpoch: z.number().int().positive(),
  rosterSnapshotRevision: z.number().int().positive(),
  stage: TeamLeadReplacementStageSchema,
  requestedAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TeamLeadReplacementIntent = z.infer<typeof TeamLeadReplacementIntentSchema>;

export const TeamMissionFinishKindSchema = z.enum(["completed", "failed", "canceled"]);
export type TeamMissionFinishKind = z.infer<typeof TeamMissionFinishKindSchema>;

export const TeamMissionFinishStageSchema = z.enum([
  "requested",
  "dispatch_stopped",
  "participants_archived",
  "evidence_prepared",
  "finalized",
]);
export type TeamMissionFinishStage = z.infer<typeof TeamMissionFinishStageSchema>;

export const TeamMissionFinishIntentSchema = z.object({
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  completionEventId: z.string().min(1),
  kind: TeamMissionFinishKindSchema,
  reason: z.string().min(1),
  stage: TeamMissionFinishStageSchema,
  requestedAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TeamMissionFinishIntent = z.infer<typeof TeamMissionFinishIntentSchema>;

export const TeamArchiveStageSchema = z.enum(["requested", "mission_finished"]);
export type TeamArchiveStage = z.infer<typeof TeamArchiveStageSchema>;

export const TeamArchiveIntentSchema = z.object({
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  expectedTeamRevision: z.number().int().nonnegative(),
  missionId: z.string().min(1).nullable(),
  missionFinishIntent: TeamMissionFinishIntentSchema.nullable(),
  stage: TeamArchiveStageSchema,
  requestedAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TeamArchiveIntent = z.infer<typeof TeamArchiveIntentSchema>;

export const TeamProfileUpdateReceiptSchema = z.object({
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  resultingRevision: z.number().int().nonnegative(),
});

export const TeamPersistenceAttentionCodeSchema = z.enum([
  "active_mission_missing",
  "active_mission_team_mismatch",
  "active_mission_workspace_mismatch",
  "archive_mission_missing",
  "archive_mission_team_mismatch",
  "archive_mission_workspace_mismatch",
  "team_profile_missing",
  "mission_not_active",
  "start_reconciliation_failed",
  "finish_reconciliation_failed",
  "terminal_link_reconciliation_failed",
]);
export type TeamPersistenceAttentionCode = z.infer<typeof TeamPersistenceAttentionCodeSchema>;

export const TeamPersistenceAttentionSchema = z.object({
  attentionId: z.string().min(1),
  missionId: z.string().min(1),
  code: TeamPersistenceAttentionCodeSchema,
  detectedAt: TimestampSchema,
});
export type TeamPersistenceAttention = z.infer<typeof TeamPersistenceAttentionSchema>;

export const StoredTeamProfileSchema = z.object({
  storageRevision: z.number().int().positive(),
  profile: TeamV2Schema,
  createIdempotencyKey: z.string().min(1),
  createRequestFingerprint: z.string().min(1),
  updateReceipts: z.array(TeamProfileUpdateReceiptSchema).max(100).optional(),
  retiredMentionHandles: z.array(z.string().min(1)),
  persistenceAttentions: z.array(TeamPersistenceAttentionSchema).default([]),
  startIntent: TeamMissionStartIntentSchema.nullable(),
  archiveIntent: TeamArchiveIntentSchema.nullable(),
});
export type StoredTeamProfile = z.infer<typeof StoredTeamProfileSchema>;

const ownershipIntervalFields = {
  intervalId: z.string().min(1),
  workspaceId: z.string().min(1),
  assignmentId: z.string().min(1),
  scope: MissionMutableScopeSchema,
  startedAt: TimestampSchema,
};

export const MissionOwnershipIntervalSchema = z.discriminatedUnion("state", [
  z.object({
    ...ownershipIntervalFields,
    state: z.literal("open"),
    endedAt: z.null(),
    closure: z.null(),
  }),
  z.object({
    ...ownershipIntervalFields,
    state: z.literal("closed"),
    endedAt: TimestampSchema,
    closure: z.enum(["report", "handoff", "canceled", "external"]),
  }),
]);
export type MissionOwnershipInterval = z.infer<typeof MissionOwnershipIntervalSchema>;

const recipientAttentionFields = {
  deliveryId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  roomMessageId: z.string().min(1),
  senderMemberId: z.string().min(1),
  senderAgentId: z.string().min(1),
  recipientMemberId: z.string().min(1),
  bindingEpoch: z.number().int().positive(),
  mentionHandle: z.string().min(1),
  body: z.string().min(1),
  roomPostedAt: TimestampSchema.nullable(),
  roomCursor: z.number().int().positive().nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  successorDeliveryId: z.string().min(1).nullable(),
};

export const MissionRecipientAttentionDeliverySchema = z.discriminatedUnion("state", [
  z.object({
    ...recipientAttentionFields,
    state: z.literal("pending"),
    lastAttemptAt: z.null(),
    nextEligibleAt: TimestampSchema,
    acknowledgedAt: z.null(),
    canceledAt: z.null(),
    cancelReason: z.null(),
  }),
  z.object({
    ...recipientAttentionFields,
    state: z.literal("notified"),
    lastAttemptAt: TimestampSchema,
    nextEligibleAt: TimestampSchema,
    acknowledgedAt: z.null(),
    canceledAt: z.null(),
    cancelReason: z.null(),
  }),
  z.object({
    ...recipientAttentionFields,
    state: z.literal("acknowledged"),
    lastAttemptAt: TimestampSchema,
    nextEligibleAt: z.null(),
    acknowledgedAt: TimestampSchema,
    canceledAt: z.null(),
    cancelReason: z.null(),
  }),
  z.object({
    ...recipientAttentionFields,
    state: z.literal("canceled"),
    lastAttemptAt: TimestampSchema.nullable(),
    nextEligibleAt: z.null(),
    acknowledgedAt: z.null(),
    canceledAt: TimestampSchema,
    cancelReason: z.enum([
      "mission_terminal",
      "recipient_left",
      "user_canceled",
      "binding_replaced",
      "attention_resolved",
    ]),
  }),
]);
export type MissionRecipientAttentionDelivery = z.infer<
  typeof MissionRecipientAttentionDeliverySchema
>;

const completionDeliveryFields = {
  eventId: z.string().min(1),
  missionStatus: TeamMissionStatusSchema.extract(["completed", "failed", "canceled"]),
  attempts: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
};

export const MissionCompletionDeliverySchema = z.discriminatedUnion("state", [
  z.object({
    ...completionDeliveryFields,
    state: z.literal("pending"),
    lastAttemptAt: z.null(),
    acknowledgedAt: z.null(),
  }),
  z.object({
    ...completionDeliveryFields,
    state: z.literal("notified"),
    lastAttemptAt: TimestampSchema,
    acknowledgedAt: z.null(),
  }),
  z.object({
    ...completionDeliveryFields,
    state: z.literal("acknowledged"),
    lastAttemptAt: TimestampSchema,
    acknowledgedAt: TimestampSchema,
  }),
]);
export type MissionCompletionDelivery = z.infer<typeof MissionCompletionDeliverySchema>;

export const MissionRecipientChatCursorSchema = z.object({
  memberId: z.string().min(1),
  cursor: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
});
export type MissionRecipientChatCursor = z.infer<typeof MissionRecipientChatCursorSchema>;

export const MissionAcceptedTurnFactSchema = z.object({
  assignmentId: z.string().min(1),
  turnId: z.string().min(1),
  runtimeAgentId: z.string().min(1),
  outcome: z.enum(["completed", "failed", "canceled", "unknown"]),
  recordedAt: TimestampSchema,
});
export type MissionAcceptedTurnFact = z.infer<typeof MissionAcceptedTurnFactSchema>;

export const MissionFinishEvidenceSchema = z.object({
  intentId: z.string().min(1),
  preparedAt: TimestampSchema,
  assignments: z.array(MissionAssignmentTerminalEvidenceSchema),
});
export type MissionFinishEvidence = z.infer<typeof MissionFinishEvidenceSchema>;

export const MissionAssignmentDeltaHandoffSchema = z.object({
  sourceAssignmentId: z.string().min(1),
  replacementAssignmentId: z.string().min(1),
  reportHoldLeaseId: z.string().min(1).nullable(),
  capturedDelta: z.array(
    z.object({
      path: z.string().min(1),
      fingerprint: z.string().min(1),
    }),
  ),
  createdAt: TimestampSchema,
});
export type MissionAssignmentDeltaHandoff = z.infer<typeof MissionAssignmentDeltaHandoffSchema>;

export const MissionAssignmentDispatchIntentSchema = z.object({
  assignmentId: z.string().min(1),
  runtimeAgentId: z.string().min(1),
  bindingEpoch: z.number().int().positive(),
  scopeLease: MissionScopeLeaseSchema.nullable(),
  workspaceBaseline: MissionWorkspaceBaselineSchema,
  messageId: z.string().min(1),
  preparedAt: TimestampSchema,
  attempts: z.number().int().nonnegative(),
  nextEligibleAt: TimestampSchema,
  lastFailureKind: z.enum(["busy", "provider_unavailable"]).nullable(),
  lastFailureReason: z.string().min(1).nullable(),
});
export type MissionAssignmentDispatchIntent = z.infer<typeof MissionAssignmentDispatchIntentSchema>;

const assignmentReportRecoveryFields = {
  deliveryId: z.string().min(1),
  assignmentId: z.string().min(1),
  agentId: z.string().min(1),
  bindingEpoch: z.number().int().positive(),
  attempt: z.number().int().min(1).max(2),
  messageId: z.string().min(1),
  createdAt: TimestampSchema,
  dispatchAttempts: z.number().int().nonnegative(),
  lastFailureKind: z.enum(["busy", "provider_unavailable", "acceptance_unknown"]).nullable(),
  lastFailureReason: z.string().min(1).nullable(),
};

export const MissionAssignmentReportRecoveryDeliverySchema = z.discriminatedUnion("state", [
  z.object({
    ...assignmentReportRecoveryFields,
    state: z.literal("pending"),
    turnId: z.null(),
    nextEligibleAt: TimestampSchema,
    dispatchedAt: z.null(),
    settledAt: z.null(),
  }),
  z.object({
    ...assignmentReportRecoveryFields,
    state: z.literal("dispatched"),
    turnId: z.string().min(1),
    nextEligibleAt: z.null(),
    dispatchedAt: TimestampSchema,
    settledAt: z.null(),
  }),
  z.object({
    ...assignmentReportRecoveryFields,
    state: z.literal("settled"),
    turnId: z.string().min(1),
    nextEligibleAt: z.null(),
    dispatchedAt: TimestampSchema,
    settledAt: TimestampSchema,
  }),
  z.object({
    ...assignmentReportRecoveryFields,
    state: z.literal("failed"),
    turnId: z.null(),
    nextEligibleAt: z.null(),
    dispatchedAt: z.null(),
    settledAt: TimestampSchema,
  }),
]);
export type MissionAssignmentReportRecoveryDelivery = z.infer<
  typeof MissionAssignmentReportRecoveryDeliverySchema
>;

export const StoredMissionSchema = z
  .object({
    storageRevision: z.number().int().positive(),
    mission: TeamMissionSchema,
    startIdempotencyKey: z.string().min(1),
    startRequestFingerprint: z.string().min(1),
    leadReplacementIntent: TeamLeadReplacementIntentSchema.nullable().default(null),
    finishIntent: TeamMissionFinishIntentSchema.nullable(),
    finishEvidence: MissionFinishEvidenceSchema.nullable().default(null),
    ownershipIntervals: z.array(MissionOwnershipIntervalSchema),
    acceptedTurnFacts: z.array(MissionAcceptedTurnFactSchema),
    assignmentDeltaHandoffs: z.array(MissionAssignmentDeltaHandoffSchema),
    assignmentDispatchIntents: z.array(MissionAssignmentDispatchIntentSchema),
    assignmentReportRecoveryOutbox: z.array(MissionAssignmentReportRecoveryDeliverySchema),
    recipientChatCursors: z.array(MissionRecipientChatCursorSchema),
    recipientAttentionOutbox: z.array(MissionRecipientAttentionDeliverySchema),
    completionOutbox: z.array(MissionCompletionDeliverySchema),
  })
  .superRefine((record, context) => {
    const factsByTurnId = new Map(record.acceptedTurnFacts.map((fact) => [fact.turnId, fact]));
    record.mission.assignments.forEach((assignment, index) => {
      const evidence = assignment.terminalEvidence;
      if (!evidence) return;
      const fact = factsByTurnId.get(evidence.acceptedTurn.turnId);
      const isSettled =
        assignment.dispatchState === "settled" &&
        assignment.semanticState !== "running" &&
        assignment.settledAt !== null;
      const matchesAssignment =
        evidence.assignmentId === assignment.assignmentId &&
        evidence.acceptedTurn.turnId === assignment.acceptedTurnId &&
        evidence.acceptedTurn.runtimeAgentId === assignment.runtimeAgentId;
      const matchesFact =
        fact?.assignmentId === assignment.assignmentId &&
        fact.runtimeAgentId === evidence.acceptedTurn.runtimeAgentId &&
        fact.outcome === evidence.acceptedTurn.outcome &&
        fact.recordedAt === evidence.acceptedTurn.recordedAt;
      if (isSettled && matchesAssignment && matchesFact) return;
      context.addIssue({
        code: "custom",
        path: ["mission", "assignments", index, "terminalEvidence"],
        message: `Assignment ${assignment.assignmentId} terminal evidence does not match its settled accepted turn fact`,
      });
    });
  });
export type StoredMission = z.infer<typeof StoredMissionSchema>;
