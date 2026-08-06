import { z } from "zod";

export const TeamLifecycleSchema = z.enum([
  "creating",
  "active",
  "archiving",
  "archived",
  "failed",
]);

export type TeamLifecycle = z.infer<typeof TeamLifecycleSchema>;

export const TeamMemberStateSchema = z.enum(["active", "removed", "archived"]);

export type TeamMemberState = z.infer<typeof TeamMemberStateSchema>;

export const TeamMemberRemovalReasonSchema = z.enum([
  "removed_by_user",
  "hard_deleted",
  "unarchive_evicted",
  "recruitment_failed",
  "recruitment_canceled",
]);

export type TeamMemberRemovalReason = z.infer<typeof TeamMemberRemovalReasonSchema>;

/** Shared by the stored record and the wire snapshot; carries no server-only data. */
export const TeamMemberEntrySchema = z.object({
  agentId: z.string(),
  role: z.string(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
  state: TeamMemberStateSchema,
  removalReason: TeamMemberRemovalReasonSchema.nullable(),
});

export type TeamMemberEntry = z.infer<typeof TeamMemberEntrySchema>;

/** Server-only. Frozen at the first atomic write so any crash point can be replayed. */
export const TeamCreationPlanSchema = z.object({
  task: z.string(),
  room: z.object({ roomId: z.string(), internalName: z.string() }),
  members: z.array(
    z.object({
      agentId: z.string(),
      isLead: z.boolean(),
      role: z.string(),
      title: z.string().nullable(),
      provider: z.string(),
      settings: z.record(z.string(), z.unknown()).nullable(),
      briefing: z.string().nullable(),
    }),
  ),
});

export type TeamCreationPlan = z.infer<typeof TeamCreationPlanSchema>;

export const TeamCreationStageSchema = z.enum([
  "allocated",
  "room_created",
  "agents_created",
  "briefed",
]);

export type TeamCreationStage = z.infer<typeof TeamCreationStageSchema>;

/** Server-only. Complete enough to replay a recruitment after a crash at any step. */
export const RecruitmentIntentSchema = z.object({
  provider: z.string(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  title: z.string().nullable(),
  teamRole: z.string(),
  initialPrompt: z.string(),
  clientMessageId: z.string(),
  recruiterAgentId: z.string(),
  workspaceId: z.string(),
  stage: z.enum(["reserved", "created"]),
});

export type RecruitmentIntent = z.infer<typeof RecruitmentIntentSchema>;

/**
 * The daemon-side team record. `idempotencyKey`, `requestFingerprint`,
 * `creationPlan`, `creationStage`, `failedCleanupAt` and `pendingRecruitments`
 * never reach a client — project with `toTeamSnapshot` instead of spreading.
 */
export const StoredTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  chatRoomId: z.string(),
  leadAgentId: z.string(),
  members: z.array(TeamMemberEntrySchema),
  lifecycle: TeamLifecycleSchema,
  revision: z.number().int(),
  idempotencyKey: z.string(),
  requestFingerprint: z.string(),
  creationPlan: TeamCreationPlanSchema.nullable(),
  creationStage: TeamCreationStageSchema.nullable(),
  templateId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  failedCleanupAt: z.string().nullable(),
  pendingRecruitments: z.record(z.string(), RecruitmentIntentSchema).nullable(),
});

export type StoredTeam = z.infer<typeof StoredTeamSchema>;

export const TeamSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  chatRoomId: z.string(),
  leadAgentId: z.string(),
  members: z.array(TeamMemberEntrySchema),
  lifecycle: TeamLifecycleSchema,
  revision: z.number().int(),
  templateId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

export type TeamSnapshot = z.infer<typeof TeamSnapshotSchema>;

export function toTeamSnapshot(team: StoredTeam): TeamSnapshot {
  return {
    id: team.id,
    name: team.name,
    workspaceId: team.workspaceId,
    chatRoomId: team.chatRoomId,
    leadAgentId: team.leadAgentId,
    members: team.members,
    lifecycle: team.lifecycle,
    revision: team.revision,
    templateId: team.templateId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    archivedAt: team.archivedAt,
  };
}
