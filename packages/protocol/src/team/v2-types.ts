import { z } from "zod";

import { AgentProviderSchema } from "../provider-manifest.js";

const TimestampSchema = z.string().datetime({ offset: true });

export const TeamMemberLevelSchema = z.number().int().min(1).max(5);
export type TeamMemberLevel = z.infer<typeof TeamMemberLevelSchema>;

export const TeamSkillSchema = z.object({
  skillId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type TeamSkill = z.infer<typeof TeamSkillSchema>;

export const TeamExecutionProfileSchema = z.object({
  provider: AgentProviderSchema,
  model: z.string().min(1).nullable(),
  modeId: z.string().min(1).nullable(),
  thinkingOptionId: z.string().min(1).nullable(),
  featureValues: z.record(z.string(), z.unknown()),
});
export type TeamExecutionProfile = z.infer<typeof TeamExecutionProfileSchema>;

export const TeamMemberProfileSchema = z.object({
  memberId: z.string().min(1),
  role: z.string().min(1),
  level: TeamMemberLevelSchema,
  skillIds: z.array(z.string().min(1)).min(1),
  executionProfile: TeamExecutionProfileSchema,
  mentionHandle: z.string().min(1),
});
export type TeamMemberProfile = z.infer<typeof TeamMemberProfileSchema>;

export const TeamLifecycleRecoveryFailureSchema = z.object({
  operation: z.enum(["mission_finish", "team_archive"]),
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  retryAction: z.enum(["cancel_mission", "resume_mission_finish", "archive_team"]),
  attempts: z.number().int().positive(),
  failedAt: TimestampSchema,
});
export type TeamLifecycleRecoveryFailure = z.infer<typeof TeamLifecycleRecoveryFailureSchema>;

export const TeamV2Schema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspaceId: z.string().min(1),
  leadMemberId: z.string().min(1),
  skills: z.array(TeamSkillSchema).min(1),
  members: z.array(TeamMemberProfileSchema).min(1),
  lifecycle: z.enum(["active", "archived"]),
  activeMissionId: z.string().min(1).nullable(),
  lifecycleRecoveryFailure: TeamLifecycleRecoveryFailureSchema.nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
});
export type TeamV2 = z.infer<typeof TeamV2Schema>;

export const MissionMemberRuntimeSnapshotSchema = z.object({
  providerAvailable: z.boolean(),
  toolIds: z.array(z.string().min(1)),
  capabilityIds: z.array(z.string().min(1)),
});
export type MissionMemberRuntimeSnapshot = z.infer<typeof MissionMemberRuntimeSnapshotSchema>;

export const MissionRosterMemberSnapshotSchema = TeamMemberProfileSchema.extend({
  runtimeSnapshot: MissionMemberRuntimeSnapshotSchema.nullable(),
});
export type MissionRosterMemberSnapshot = z.infer<typeof MissionRosterMemberSnapshotSchema>;

export const MissionRosterSnapshotSchema = z.object({
  revision: z.number().int().positive(),
  teamRevision: z.number().int().nonnegative(),
  leadMemberId: z.string().min(1),
  reason: z.enum(["initial", "replan"]),
  skills: z.array(TeamSkillSchema),
  members: z.array(MissionRosterMemberSnapshotSchema).min(1),
  createdAt: TimestampSchema,
});
export type MissionRosterSnapshot = z.infer<typeof MissionRosterSnapshotSchema>;

export const MissionMutableScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read_only") }),
  z.object({ kind: z.literal("paths"), pathPrefixes: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("workspace") }),
]);
export type MissionMutableScope = z.infer<typeof MissionMutableScopeSchema>;

export const MissionParticipantSchema = z.object({
  memberId: z.string().min(1),
  agentId: z.string().min(1),
  bindingEpoch: z.number().int().positive(),
  joinedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
});
export type MissionParticipant = z.infer<typeof MissionParticipantSchema>;

export const TeamRoomMessageAuthorSchema = z.object({
  kind: z.enum(["agent", "human"]),
  id: z.string().min(1),
});
export type TeamRoomMessageAuthor = z.infer<typeof TeamRoomMessageAuthorSchema>;

export const TeamRoomMessageSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  roomId: z.string().min(1),
  authorAgentId: z.string().min(1),
  author: TeamRoomMessageAuthorSchema,
  body: z.string().min(1),
  replyToMessageId: z.string().min(1).nullable(),
  mentionAgentIds: z.array(z.string().min(1)),
  createdAt: TimestampSchema,
});
export type TeamRoomMessage = z.infer<typeof TeamRoomMessageSchema>;

export const MissionMemberMatchExplanationSchema = z.object({
  recommendedMemberId: z.string().min(1),
  requiredSkillIds: z.array(z.string().min(1)),
  preferredSkillIds: z.array(z.string().min(1)),
  matchedPreferredSkillIds: z.array(z.string().min(1)),
  requiredRuntimeCapabilityIds: z.array(z.string().min(1)),
  minimumLevel: TeamMemberLevelSchema,
  selectedLevel: TeamMemberLevelSchema,
  eligibleMemberIds: z.array(z.string().min(1)).min(1),
  // Hard-eligible candidates removed by an independence constraint.
  excludedMemberIds: z.array(z.string().min(1)),
  previousMemberId: z.string().min(1).nullable(),
  candidateOpenAssignments: z.array(
    z.object({
      memberId: z.string().min(1),
      openAssignments: z.number().int().nonnegative(),
    }),
  ),
  continuedPreviousMember: z.boolean(),
  openAssignments: z.number().int().nonnegative(),
  rosterIndex: z.number().int().nonnegative(),
});
export type MissionMemberMatchExplanation = z.infer<typeof MissionMemberMatchExplanationSchema>;

export const MissionMemberRequirementsSchema = z.object({
  requiredSkillIds: z.array(z.string().min(1)),
  preferredSkillIds: z.array(z.string().min(1)),
  requiredRuntimeCapabilityIds: z.array(z.string().min(1)),
  minimumLevel: TeamMemberLevelSchema,
});
export type MissionMemberRequirements = z.infer<typeof MissionMemberRequirementsSchema>;

export const MissionWorkstreamSchema = z.object({
  workstreamId: z.string().min(1),
  kind: z.enum(["delivery", "integration", "verification"]),
  title: z.string().min(1),
  objective: z.string().min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  requiredSkillIds: z.array(z.string().min(1)),
  preferredSkillIds: z.array(z.string().min(1)),
  requiredRuntimeCapabilityIds: z.array(z.string().min(1)),
  minimumLevel: TeamMemberLevelSchema,
  planRevision: z.number().int().positive(),
  rosterSnapshotRevision: z.number().int().positive(),
  dependencyWorkstreamIds: z.array(z.string().min(1)),
  mutableScope: MissionMutableScopeSchema,
  ownerMemberId: z.string().min(1),
  ownerMatchExplanation: MissionMemberMatchExplanationSchema,
  ownerOverrideReason: z.string().min(1).nullable(),
  reviewPolicy: z.enum(["none", "required"]),
  reviewerRequirements: MissionMemberRequirementsSchema.nullable(),
  reviewerMemberId: z.string().min(1).nullable(),
  reviewerMatchExplanation: MissionMemberMatchExplanationSchema.nullable(),
  reviewerOverrideReason: z.string().min(1).nullable(),
  status: z.enum(["planned", "ready", "active", "blocked", "review", "accepted", "canceled"]),
});
export type MissionWorkstream = z.infer<typeof MissionWorkstreamSchema>;

export const MissionWorkstreamPlanSnapshotSchema = z.object({
  planRevision: z.number().int().positive(),
  // Historical status is evidence from that revision; current state transitions
  // only consult TeamMission.workstreams.
  workstreams: z.array(MissionWorkstreamSchema).min(1),
  createdAt: TimestampSchema,
});
export type MissionWorkstreamPlanSnapshot = z.infer<typeof MissionWorkstreamPlanSnapshotSchema>;

const MissionAssignmentTestResultSchema = z.object({
  command: z.string().min(1),
  passed: z.boolean(),
});

export const MissionAssignmentCompletionReportSchema = z.object({
  status: z.literal("completed"),
  verdict: z.enum(["approved", "changes_requested"]).nullable(),
  summary: z.string().min(1),
  artifactPaths: z.array(z.string().min(1)),
  tests: z.array(MissionAssignmentTestResultSchema),
  decisions: z.array(z.string().min(1)),
  handoffs: z.array(
    z.object({
      targetWorkstreamId: z.string().min(1),
      summary: z.string().min(1),
      artifactPaths: z.array(z.string().min(1)),
    }),
  ),
});
export type MissionAssignmentCompletionReport = z.infer<
  typeof MissionAssignmentCompletionReportSchema
>;

const interruptedReportFields = {
  summary: z.string().min(1),
  blockers: z.array(z.string().min(1)).min(1),
  artifactPaths: z.array(z.string().min(1)),
  tests: z.array(MissionAssignmentTestResultSchema),
  decisions: z.array(z.string().min(1)),
  handoffs: z.array(
    z.object({
      targetWorkstreamId: z.string().min(1),
      summary: z.string().min(1),
      artifactPaths: z.array(z.string().min(1)),
    }),
  ),
};

export const MissionAssignmentBlockedReportSchema = z.object({
  status: z.literal("blocked"),
  ...interruptedReportFields,
});
export const MissionAssignmentFailedReportSchema = z.object({
  status: z.literal("failed"),
  ...interruptedReportFields,
});
export const MissionAssignmentReportSchema = z.discriminatedUnion("status", [
  MissionAssignmentCompletionReportSchema,
  MissionAssignmentBlockedReportSchema,
  MissionAssignmentFailedReportSchema,
]);
export type MissionAssignmentReport = z.infer<typeof MissionAssignmentReportSchema>;

const MissionTerminalPathEvidenceSchema = z.object({
  path: z.string().min(1),
  fingerprint: z.string().min(1),
});

export const MissionAssignmentTerminalEvidenceSchema = z.object({
  assignmentId: z.string().min(1),
  acceptedTurn: z.object({
    turnId: z.string().min(1),
    runtimeAgentId: z.string().min(1),
    outcome: z.enum(["completed", "failed", "canceled", "unknown"]),
    recordedAt: TimestampSchema,
  }),
  capturedDelta: z.array(MissionTerminalPathEvidenceSchema),
  ownershipViolations: z.array(MissionTerminalPathEvidenceSchema),
  report: MissionAssignmentReportSchema.nullable(),
  handoffs: z.array(
    z.object({
      targetWorkstreamId: z.string().min(1),
      summary: z.string().min(1),
      artifactPaths: z.array(z.string().min(1)),
    }),
  ),
  capturedAt: TimestampSchema,
});
export type MissionAssignmentTerminalEvidence = z.infer<
  typeof MissionAssignmentTerminalEvidenceSchema
>;

export const MissionScopeLeaseSchema = z.object({
  leaseId: z.string().min(1),
  workspaceId: z.string().min(1),
  assignmentId: z.string().min(1),
  scope: MissionMutableScopeSchema,
  state: z.enum(["execution", "report_hold"]),
  acquiredAt: TimestampSchema,
  transitionedAt: TimestampSchema.nullable(),
  capturedDelta: z.array(
    z.object({
      path: z.string().min(1),
      fingerprint: z.string().min(1),
    }),
  ),
  recoveryAttempts: z.number().int().min(0),
});
export type MissionScopeLease = z.infer<typeof MissionScopeLeaseSchema>;

export const MissionWorkspaceAuditPolicySchema = z.object({
  revision: z.number().int().positive(),
  includeTrackedPaths: z.boolean(),
  includeNonIgnoredUntrackedPaths: z.boolean(),
  includeDeclaredArtifactPaths: z.boolean(),
  excludeGitignoredPathsByDefault: z.boolean(),
  excludedPathPrefixes: z.array(z.string().min(1)),
});
export type MissionWorkspaceAuditPolicy = z.infer<typeof MissionWorkspaceAuditPolicySchema>;

export const MissionWorkspaceBaselineSchema = z.object({
  baselineId: z.string().min(1),
  workspaceId: z.string().min(1),
  assignmentId: z.string().min(1),
  policyRevision: z.number().int().positive(),
  capturedAt: TimestampSchema,
  entries: z.array(
    z.object({
      path: z.string().min(1),
      fingerprint: z.string().min(1),
      classification: z.enum(["tracked", "non_ignored_untracked", "declared_artifact"]),
    }),
  ),
});
export type MissionWorkspaceBaseline = z.infer<typeof MissionWorkspaceBaselineSchema>;

const attentionResolutionCommon = {
  actorId: z.string().min(1),
  reason: z.string().min(1),
  resolvedAt: TimestampSchema,
};

export const MissionAttentionResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attribute_owner"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.string().min(1),
    recoveryAssignmentId: z.null(),
  }),
  z.object({
    kind: z.literal("external_change"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.null(),
  }),
  z.object({
    kind: z.literal("recovery_assignment"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("replace_lead"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.null(),
    // COMPAT(teamLeadReplacementMember): added in v0.3.0-beta.3, remove after
    // 2027-02-10 once every stored resolution names the replacement Member.
    replacementMemberId: z.string().min(1).optional(),
  }),
  ...(
    [
      "report_received",
      "resume_provider",
      "replan",
      "restore_notification",
      "cancel_mission",
    ] as const
  ).map((kind) =>
    z.object({
      kind: z.literal(kind),
      ...attentionResolutionCommon,
      ownerAssignmentId: z.null(),
      recoveryAssignmentId: z.null(),
    }),
  ),
]);
export type MissionAttentionResolution = z.infer<typeof MissionAttentionResolutionSchema>;

export const MissionAttentionItemSchema = z.object({
  attentionId: z.string().min(1),
  kind: z.enum([
    "ownership_violation",
    "missing_report",
    "assignment_requires_replan",
    "provider_unavailable",
    "dispatch_acceptance_unknown",
    "participant_unavailable",
    "reviewer_unavailable",
    "lead_unavailable",
    "notification_unacknowledged",
  ]),
  status: z.enum(["open", "resolved"]),
  priorMissionStatus: z.enum(["planning", "active", "verifying"]),
  assignmentId: z.string().min(1).nullable(),
  summary: z.string().min(1),
  pathEvidence: z.array(
    z.object({
      path: z.string().min(1),
      fingerprint: z.string().min(1),
    }),
  ),
  createdAt: TimestampSchema,
  resolution: MissionAttentionResolutionSchema.nullable(),
});
export type MissionAttentionItem = z.infer<typeof MissionAttentionItemSchema>;

export const MissionAssignmentContractSchema = z.object({
  assignmentId: z.string().min(1),
  revision: z.number().int().positive(),
  kind: z.enum(["delivery", "review", "verification"]),
  subjectAssignmentIds: z.array(z.string().min(1)),
  missionId: z.string().min(1),
  workstreamId: z.string().min(1),
  assigneeMemberId: z.string().min(1),
  runtimeAgentId: z.string().min(1).nullable(),
  bindingEpoch: z.number().int().positive().nullable(),
  objective: z.string().min(1),
  inputRefs: z.array(z.string().min(1)),
  deliverables: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  mutableScope: MissionMutableScopeSchema,
  dependencyAssignmentIds: z.array(z.string().min(1)),
  priority: z.number().int().nonnegative(),
  planRevision: z.number().int().positive(),
  rosterSnapshotRevision: z.number().int().positive(),
  supersededBy: z.string().min(1).nullable(),
  terminationReason: z
    .enum([
      "provider_unavailable",
      "dispatch_acceptance_unknown",
      "participant_unavailable",
      "turn_failed",
      "turn_canceled",
      "turn_unknown",
      "missing_report",
      "superseded",
      "mission_canceled",
      "mission_failed",
    ])
    .nullable(),
  planChangeReason: z.literal("quality_gate_no_longer_required").optional(),
  scopeLease: MissionScopeLeaseSchema.nullable(),
  workspaceBaseline: MissionWorkspaceBaselineSchema.nullable(),
  report: MissionAssignmentReportSchema.nullable(),
  dispatchState: z.enum(["queued", "dispatched", "settled"]),
  semanticState: z.enum([
    "planned",
    "running",
    "needs_report",
    "blocked",
    "completed",
    "failed",
    "canceled",
  ]),
  attempt: z.number().int().positive(),
  acceptedTurnId: z.string().min(1).nullable(),
  terminalEvidence: MissionAssignmentTerminalEvidenceSchema.nullable().optional(),
  createdAt: TimestampSchema,
  dispatchedAt: TimestampSchema.nullable(),
  settledAt: TimestampSchema.nullable(),
});
export type MissionAssignmentContract = z.infer<typeof MissionAssignmentContractSchema>;

export const TeamMissionStatusSchema = z.enum([
  "planning",
  "active",
  "needs_attention",
  "verifying",
  "completed",
  "failed",
  "canceled",
]);
export type TeamMissionStatus = z.infer<typeof TeamMissionStatusSchema>;

export const TeamMissionSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  objective: z.string().min(1),
  constraints: z.array(z.string().min(1)),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  status: TeamMissionStatusSchema,
  suspendedStatus: z.enum(["planning", "active", "verifying"]).nullable(),
  activeRosterSnapshotRevision: z.number().int().positive(),
  rosterSnapshots: z.array(MissionRosterSnapshotSchema).min(1),
  planRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  workspaceAuditPolicy: MissionWorkspaceAuditPolicySchema,
  chatRoomId: z.string().min(1),
  participants: z.array(MissionParticipantSchema).min(1),
  workstreams: z.array(MissionWorkstreamSchema),
  workstreamPlanSnapshots: z.array(MissionWorkstreamPlanSnapshotSchema),
  assignments: z.array(MissionAssignmentContractSchema),
  attentionItems: z.array(MissionAttentionItemSchema),
  lifecycleRecoveryFailure: TeamLifecycleRecoveryFailureSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type TeamMission = z.infer<typeof TeamMissionSchema>;
