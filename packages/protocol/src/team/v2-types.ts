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

export const TeamExecutionProfileSourceSchema = z.object({
  kind: z.literal("agent_profile"),
  profileId: z.string().min(1),
  resolverVersion: z.literal(1),
  appliedDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type TeamExecutionProfileSource = z.infer<typeof TeamExecutionProfileSourceSchema>;

export const TeamMemberProfileSchema = z.object({
  memberId: z.string().min(1),
  role: z.string().min(1),
  level: TeamMemberLevelSchema,
  skillIds: z.array(z.string().min(1)).min(1),
  executionProfile: TeamExecutionProfileSchema,
  executionProfileSource: TeamExecutionProfileSourceSchema.optional(),
  mentionHandle: z.string().min(1),
});
export type TeamMemberProfile = z.infer<typeof TeamMemberProfileSchema>;

export const ExactMethodologyRefSchema = z.object({
  bundleId: z.string().regex(/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/),
  version: z.string().regex(/^[1-9][0-9]*$/),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type ExactMethodologyRef = z.infer<typeof ExactMethodologyRefSchema>;

export const TeamMethodologyBindingSchema = z.object({
  ref: ExactMethodologyRefSchema,
  presetId: z.string().min(1).nullable(),
  memberArchetypeBindings: z.array(
    z.object({
      memberId: z.string().min(1),
      archetypeId: z.string().min(1).nullable(),
    }),
  ),
  skillBindings: z.array(
    z.object({
      teamSkillId: z.string().min(1),
      methodologySkillId: z.string().min(1).nullable(),
    }),
  ),
});
export type TeamMethodologyBinding = z.infer<typeof TeamMethodologyBindingSchema>;

export const MissionCapabilityFactsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("known"),
    capabilityIds: z.array(z.string().min(1)),
  }),
  z.object({
    kind: z.literal("unknown"),
    providerId: z.string().min(1),
    reason: z.literal("provider_declaration_unavailable"),
  }),
]);
export type MissionCapabilityFacts = z.infer<typeof MissionCapabilityFactsSchema>;

export const FrozenPromptSectionSchema = z.object({
  sectionId: z.string().min(1),
  audience: z.enum(["lead", "delivery", "review", "verification"]),
  phase: z.enum(["startup", "planning", "assignment", "review", "completion"]),
  content: z.string().min(1),
  contentDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type FrozenPromptSection = z.infer<typeof FrozenPromptSectionSchema>;

export const CompiledMissionPolicyV1Schema = z.object({
  review: z.object({
    writableWorkstreams: z.enum(["lead_discretion", "independent_required"]),
    independentMeans: z.literal("different_from_subject_owner"),
    unavailable: z.literal("review_gate_reviewer_unavailable_attention"),
    unknownCapabilities: z.literal("review_gate_capability_unknown_attention"),
    operatorWaiver: z.enum(["allowed_with_reason", "forbidden"]),
  }),
  verification: z.object({
    required: z.literal(true),
    mutableScope: z.literal("read_only"),
    reviewerSelection: z.literal("prefer_independent_record_exception"),
    operatorWaiver: z.literal("forbidden"),
  }),
});
export type CompiledMissionPolicyV1 = z.infer<typeof CompiledMissionPolicyV1Schema>;

export const MissionMethodologySnapshotSchema = z.object({
  revision: z.literal(1),
  ref: ExactMethodologyRefSchema,
  compilerVersion: z.literal(1),
  teamRevision: z.number().int().nonnegative(),
  rosterSnapshotRevision: z.number().int().positive(),
  hardPolicy: CompiledMissionPolicyV1Schema,
  promptSections: z.array(FrozenPromptSectionSchema),
  hardPolicyDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  promptDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  compiledDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type MissionMethodologySnapshot = z.infer<typeof MissionMethodologySnapshotSchema>;

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
  creationWorkspaceId: z.string().min(1),
  leadMemberId: z.string().min(1),
  skills: z.array(TeamSkillSchema).min(1),
  members: z.array(TeamMemberProfileSchema).min(1),
  methodologyBinding: TeamMethodologyBindingSchema,
  lifecycle: z.enum(["active", "archived"]),
  activeMissionId: z.string().min(1).nullable(),
  lifecycleRecoveryFailure: TeamLifecycleRecoveryFailureSchema.nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
});
export type TeamV2 = z.infer<typeof TeamV2Schema>;

export const MissionRosterMemberSnapshotSchema = TeamMemberProfileSchema.extend({
  capabilityFacts: MissionCapabilityFactsSchema,
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

export const MissionCapabilityReplanRequestSchema = z.object({
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  sourceAttentionIds: z.array(z.string().min(1)),
  rosterSnapshotRevision: z.number().int().positive(),
  deliveryId: z.string().min(1),
  createdAt: TimestampSchema,
  consumedAt: TimestampSchema.nullable(),
});
export type MissionCapabilityReplanRequest = z.infer<typeof MissionCapabilityReplanRequestSchema>;

export const MissionCapabilityReplanInspectRequestSchema =
  MissionCapabilityReplanRequestSchema.extend({
    currentBindingDelivery: z
      .object({
        deliveryId: z.string().min(1),
        bindingEpoch: z.number().int().positive(),
        state: z.enum(["pending", "notified", "acknowledged", "canceled"]),
      })
      .nullable(),
  });
export type MissionCapabilityReplanInspectRequest = z.infer<
  typeof MissionCapabilityReplanInspectRequestSchema
>;

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

const MissionReviewFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

// The stable identity of one review subject: a Workstream plus the exact,
// sorted, duplicate-free delivery Assignment set under review. It survives a
// replan that reuses those exact Assignments, so an approved report can be
// inherited. Empty while the plan is staged without delivery Assignments.
export const MissionReviewSubjectKeySchema = z.object({
  workstreamId: z.string().min(1),
  subjectAssignmentIds: z.array(z.string().min(1)),
});
export type MissionReviewSubjectKey = z.infer<typeof MissionReviewSubjectKeySchema>;

// The plan-instance identity. Replanning creates a new gate instance for the
// same subject; settled evidence from the previous instance is never rewritten.
export const MissionReviewGateKeySchema = z.object({
  subject: MissionReviewSubjectKeySchema,
  planRevision: z.number().int().positive(),
});
export type MissionReviewGateKey = z.infer<typeof MissionReviewGateKeySchema>;

export const MissionReviewGateOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({
    kind: z.literal("approved"),
    gateKeyFingerprint: MissionReviewFingerprintSchema,
    subjectFingerprint: MissionReviewFingerprintSchema,
    reviewAssignmentId: z.string().min(1),
    reportFingerprint: MissionReviewFingerprintSchema,
    inheritedFromGateFingerprint: MissionReviewFingerprintSchema.nullable(),
    decidedAt: TimestampSchema,
  }),
  z.object({
    kind: z.literal("waived"),
    gateKeyFingerprint: MissionReviewFingerprintSchema,
    subjectFingerprint: MissionReviewFingerprintSchema,
    waiverId: z.string().min(1),
    decidedAt: TimestampSchema,
  }),
]);
export type MissionReviewGateOutcome = z.infer<typeof MissionReviewGateOutcomeSchema>;

// Structural eligibility only. Busy Members, Participant state and runtime
// provider failures change scheduling readiness, never this selection.
export const MissionReviewGateSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("assigned"),
    reviewerMemberId: z.string().min(1),
    matchExplanation: MissionMemberMatchExplanationSchema,
    overrideReason: z.string().min(1).nullable(),
  }),
  // Every candidate is structurally known and none qualifies.
  z.object({ kind: z.literal("awaiting_reviewer") }),
  // No known qualifying candidate, and at least one candidate's capability
  // facts are unknown. Unknown is never treated as ineligible.
  z.object({
    kind: z.literal("awaiting_capabilities"),
    candidateMemberIds: z.array(z.string().min(1)).min(1),
  }),
]);
export type MissionReviewGateSelection = z.infer<typeof MissionReviewGateSelectionSchema>;

// The single authoritative review fact. Workstream transitions, dependency
// readiness, final verification materialization, Mission validation, UI and
// audit export read this and never re-derive approval from completed
// Assignments or room text.
export const MissionReviewGateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("none"),
    outcome: z.object({ kind: z.literal("not_required") }),
  }),
  z.object({
    kind: z.literal("required"),
    gateKey: MissionReviewGateKeySchema,
    gateKeyFingerprint: MissionReviewFingerprintSchema,
    subjectFingerprint: MissionReviewFingerprintSchema,
    requirements: MissionMemberRequirementsSchema,
    selection: MissionReviewGateSelectionSchema,
    outcome: MissionReviewGateOutcomeSchema,
  }),
]);
export type MissionReviewGate = z.infer<typeof MissionReviewGateSchema>;

export const MissionFinalVerificationGateKeySchema = z.object({
  workstreamId: z.string().min(1),
  planRevision: z.number().int().positive(),
  methodologySnapshotRevision: z.literal(1),
  subjectAssignmentIds: z.array(z.string().min(1)),
  reviewGateFingerprints: z.array(MissionReviewFingerprintSchema),
  requirements: MissionMemberRequirementsSchema,
});
export type MissionFinalVerificationGateKey = z.infer<typeof MissionFinalVerificationGateKeySchema>;

export const MissionFinalVerificationGateSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("assigned"),
    verifierMemberId: z.string().min(1),
    matchExplanation: MissionMemberMatchExplanationSchema,
    independenceExceptionReason: z.string().min(1).nullable(),
  }),
  z.object({ kind: z.literal("awaiting_verifier") }),
  z.object({
    kind: z.literal("awaiting_capabilities"),
    candidateMemberIds: z.array(z.string().min(1)).min(1),
  }),
]);
export type MissionFinalVerificationGateSelection = z.infer<
  typeof MissionFinalVerificationGateSelectionSchema
>;

export const MissionFinalVerificationGateSchema = z.object({
  key: MissionFinalVerificationGateKeySchema,
  fingerprint: MissionReviewFingerprintSchema,
  selection: MissionFinalVerificationGateSelectionSchema,
});
export type MissionFinalVerificationGate = z.infer<typeof MissionFinalVerificationGateSchema>;

export const MissionReviewGateEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approved"),
    gateKey: MissionReviewGateKeySchema,
    gateKeyFingerprint: MissionReviewFingerprintSchema,
    subjectFingerprint: MissionReviewFingerprintSchema,
    reviewAssignmentId: z.string().min(1),
    reportFingerprint: MissionReviewFingerprintSchema,
    inheritedFromGateFingerprint: MissionReviewFingerprintSchema.nullable(),
  }),
  z.object({
    kind: z.literal("waived"),
    gateKey: MissionReviewGateKeySchema,
    gateKeyFingerprint: MissionReviewFingerprintSchema,
    subjectFingerprint: MissionReviewFingerprintSchema,
    waiverId: z.string().min(1),
    connectionId: z.string().min(1),
    selfReportedClientLabel: z.string().min(1),
    reason: z.string().min(1),
  }),
]);
export type MissionReviewGateEvidence = z.infer<typeof MissionReviewGateEvidenceSchema>;

export const MissionFinalVerificationEvidenceSchema = z.object({
  kind: z.literal("final_verification"),
  finalGateFingerprint: MissionReviewFingerprintSchema,
  verdict: z.enum(["approved", "changes_requested"]),
  reviewGateEvidence: z.array(MissionReviewGateEvidenceSchema),
});
export type MissionFinalVerificationEvidence = z.infer<
  typeof MissionFinalVerificationEvidenceSchema
>;

export const MissionReviewWaiverSchema = z.object({
  waiverId: z.string().min(1),
  attentionId: z.string().min(1),
  gateKey: MissionReviewGateKeySchema,
  gateKeyFingerprint: MissionReviewFingerprintSchema,
  subjectFingerprint: MissionReviewFingerprintSchema,
  connectionId: z.string().min(1),
  selfReportedClientLabel: z.string().min(1),
  reason: z.string().min(1),
  createdAt: TimestampSchema,
});
export type MissionReviewWaiver = z.infer<typeof MissionReviewWaiverSchema>;

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
  methodologySnapshotRevision: z.literal(1),
  dependencyWorkstreamIds: z.array(z.string().min(1)),
  mutableScope: MissionMutableScopeSchema,
  ownerMemberId: z.string().min(1),
  ownerMatchExplanation: MissionMemberMatchExplanationSchema,
  ownerOverrideReason: z.string().min(1).nullable(),
  reviewGate: MissionReviewGateSchema,
  finalVerificationGate: MissionFinalVerificationGateSchema.nullable(),
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
  finalVerificationEvidence: MissionFinalVerificationEvidenceSchema.nullable(),
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

const reviewWaiverResolutionCommon = {
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
    replacementMemberId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("waive_review"),
    ...reviewWaiverResolutionCommon,
    idempotencyKey: z.string().min(1),
    gateKeyFingerprint: MissionReviewFingerprintSchema,
    subjectFingerprint: MissionReviewFingerprintSchema,
    connectionId: z.string().min(1),
    selfReportedClientLabel: z.string().min(1),
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.null(),
  }),
  z.object({
    kind: z.literal("replan"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.null(),
    rosterSnapshotRevision: z.number().int().positive().nullable(),
  }),
  ...(
    ["report_received", "resume_provider", "restore_notification", "cancel_mission"] as const
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

const MissionFinalVerificationAttentionResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("replan"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.null(),
    rosterSnapshotRevision: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("cancel_mission"),
    ...attentionResolutionCommon,
    ownerAssignmentId: z.null(),
    recoveryAssignmentId: z.null(),
  }),
]);

const missionAttentionItemCommon = {
  attentionId: z.string().min(1),
  status: z.enum(["open", "resolved"]),
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
};

function missionScopedAttentionItemSchema<
  const Kind extends
    | "ownership_violation"
    | "missing_report"
    | "assignment_requires_replan"
    | "provider_unavailable"
    | "dispatch_acceptance_unknown"
    | "participant_unavailable"
    | "reviewer_unavailable"
    | "lead_unavailable"
    | "notification_unacknowledged",
>(kind: Kind) {
  return z.object({
    ...missionAttentionItemCommon,
    kind: z.literal(kind),
    scope: z.object({ kind: z.literal("mission") }),
    priorMissionStatus: z.enum(["planning", "active", "verifying"]),
  });
}

function reviewGateAttentionItemSchema<
  const Kind extends "review_gate_reviewer_unavailable" | "review_gate_capability_unknown",
>(kind: Kind) {
  return z.object({
    ...missionAttentionItemCommon,
    kind: z.literal(kind),
    scope: z.object({
      kind: z.literal("workstream"),
      workstreamId: z.string().min(1),
      blockDependents: z.literal(true),
    }),
    reviewGateDetails: z.object({
      gateKey: MissionReviewGateKeySchema,
      gateKeyFingerprint: MissionReviewFingerprintSchema,
      subjectFingerprint: MissionReviewFingerprintSchema,
    }),
    priorMissionStatus: z.null(),
  });
}

function finalVerifierAttentionItemSchema<
  const Kind extends "final_verifier_unavailable" | "final_verifier_capability_unknown",
>(kind: Kind) {
  return z.object({
    ...missionAttentionItemCommon,
    kind: z.literal(kind),
    scope: z.object({
      kind: z.literal("workstream"),
      workstreamId: z.string().min(1),
      blockDependents: z.literal(true),
    }),
    finalVerificationGateDetails: z.object({
      gateKey: MissionFinalVerificationGateKeySchema,
      gateFingerprint: MissionReviewFingerprintSchema,
    }),
    priorMissionStatus: z.null(),
    resolution: MissionFinalVerificationAttentionResolutionSchema.nullable(),
  });
}

export const MissionAttentionItemSchema = z.discriminatedUnion("kind", [
  missionScopedAttentionItemSchema("ownership_violation"),
  missionScopedAttentionItemSchema("missing_report"),
  missionScopedAttentionItemSchema("assignment_requires_replan"),
  missionScopedAttentionItemSchema("provider_unavailable"),
  missionScopedAttentionItemSchema("dispatch_acceptance_unknown"),
  missionScopedAttentionItemSchema("participant_unavailable"),
  missionScopedAttentionItemSchema("reviewer_unavailable"),
  missionScopedAttentionItemSchema("lead_unavailable"),
  missionScopedAttentionItemSchema("notification_unacknowledged"),
  reviewGateAttentionItemSchema("review_gate_reviewer_unavailable"),
  reviewGateAttentionItemSchema("review_gate_capability_unknown"),
  finalVerifierAttentionItemSchema("final_verifier_unavailable"),
  finalVerifierAttentionItemSchema("final_verifier_capability_unknown"),
]);
export type MissionAttentionItem = z.infer<typeof MissionAttentionItemSchema>;

export const MissionAssignmentContractSchema = z.object({
  assignmentId: z.string().min(1),
  revision: z.number().int().positive(),
  kind: z.enum(["delivery", "review", "verification"]),
  subjectAssignmentIds: z.array(z.string().min(1)),
  reviewGateFingerprint: MissionReviewFingerprintSchema.nullable(),
  reviewSubjectFingerprint: MissionReviewFingerprintSchema.nullable(),
  finalVerificationGateFingerprint: MissionReviewFingerprintSchema.nullable(),
  reviewGateEvidence: z.array(MissionReviewGateEvidenceSchema),
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
  methodologySnapshotRevision: z.literal(1),
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
  capabilityReplanRequests: z.array(MissionCapabilityReplanRequestSchema),
  methodologySnapshot: MissionMethodologySnapshotSchema,
  methodologyCompiledAt: TimestampSchema,
  planRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  workspaceAuditPolicy: MissionWorkspaceAuditPolicySchema,
  chatRoomId: z.string().min(1),
  participants: z.array(MissionParticipantSchema).min(1),
  workstreams: z.array(MissionWorkstreamSchema),
  workstreamPlanSnapshots: z.array(MissionWorkstreamPlanSnapshotSchema),
  assignments: z.array(MissionAssignmentContractSchema),
  attentionItems: z.array(MissionAttentionItemSchema),
  reviewWaivers: z.array(MissionReviewWaiverSchema),
  lifecycleRecoveryFailure: TeamLifecycleRecoveryFailureSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type TeamMission = z.infer<typeof TeamMissionSchema>;

export const TeamMissionInspectSchema = TeamMissionSchema.extend({
  capabilityReplanRequests: z.array(MissionCapabilityReplanInspectRequestSchema),
});
export type TeamMissionInspect = z.infer<typeof TeamMissionInspectSchema>;
