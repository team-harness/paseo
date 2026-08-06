import { z } from "zod";
import { TeamSnapshotSchema } from "./types.js";

/**
 * Machine-readable `payload.errorCode` values. The field stays a plain string on
 * the wire so a newer daemon can add a code without breaking an older client's
 * parse; clients compare against these constants and treat unknown codes as
 * generic failures.
 */
export const TEAM_ERROR_CODES = {
  idempotencyConflict: "idempotency_conflict",
} as const;

export const TEAM_MAX_NON_LEAD_MEMBERS = 8;
export const TEAM_NAME_MAX_LENGTH = 60;
/** A role is a handle the lead types when assigning work, not a description. */
export const TEAM_ROLE_MAX_LENGTH = 40;

export const TeamMemberSettingsSchema = z.object({
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  features: z.record(z.string(), z.unknown()).optional(),
});

export const TeamMemberSpecSchema = z.object({
  role: z.string().min(1).max(TEAM_ROLE_MAX_LENGTH),
  title: z.string().optional(),
  provider: z.string().min(1),
  settings: TeamMemberSettingsSchema.optional(),
  briefing: z.string().optional(),
});

export type TeamMemberSpec = z.infer<typeof TeamMemberSpecSchema>;

export const TeamCreateRequestSchema = z.object({
  type: z.literal("team.create.request"),
  requestId: z.string(),
  idempotencyKey: z.string(),
  name: z.string().min(1).max(TEAM_NAME_MAX_LENGTH),
  workspaceId: z.string(),
  task: z.string(),
  lead: TeamMemberSpecSchema,
  members: z.array(TeamMemberSpecSchema).max(TEAM_MAX_NON_LEAD_MEMBERS),
  templateId: z.string().optional(),
});

export const TeamListRequestSchema = z.object({
  type: z.literal("team.list.request"),
  requestId: z.string(),
  includeArchived: z.boolean().optional(),
});

export const TeamInspectRequestSchema = z.object({
  type: z.literal("team.inspect.request"),
  requestId: z.string(),
  teamId: z.string(),
});

export const TeamArchiveRequestSchema = z.object({
  type: z.literal("team.archive.request"),
  requestId: z.string(),
  teamId: z.string(),
});

export const TeamMemberRemoveRequestSchema = z.object({
  type: z.literal("team.member.remove.request"),
  requestId: z.string(),
  teamId: z.string(),
  agentId: z.string(),
});

export const TeamCreateResponseSchema = z.object({
  type: z.literal("team.create.response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamSnapshotSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
});

export const TeamListResponseSchema = z.object({
  type: z.literal("team.list.response"),
  payload: z.object({
    requestId: z.string(),
    teams: z.array(TeamSnapshotSchema),
    error: z.string().nullable(),
  }),
});

export const TeamInspectResponseSchema = z.object({
  type: z.literal("team.inspect.response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamSnapshotSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamArchiveResponseSchema = z.object({
  type: z.literal("team.archive.response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamSnapshotSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamMemberRemoveResponseSchema = z.object({
  type: z.literal("team.member.remove.response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamSnapshotSchema.nullable(),
    error: z.string().nullable(),
  }),
});

/**
 * Broadcast, not a correlated response: it carries no `requestId`. Emitted on
 * lifecycle and roster changes only — member agent status travels on
 * `agent_update`. Clients order it by `team.revision`.
 */
export const TeamUpdateMessageSchema = z.object({
  type: z.literal("team.update"),
  payload: z.object({
    team: TeamSnapshotSchema,
  }),
});
