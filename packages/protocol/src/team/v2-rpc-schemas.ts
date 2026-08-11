import { z } from "zod";

import {
  TeamExecutionProfileSchema,
  TeamMemberLevelSchema,
  TeamMissionSchema,
  TeamRoomMessageSchema,
  TeamSkillSchema,
  TeamV2Schema,
} from "./v2-types.js";

export const TeamProfileMemberInputSchema = z.object({
  role: z.string().min(1),
  level: TeamMemberLevelSchema,
  skillIds: z.array(z.string().min(1)).min(1),
  executionProfile: TeamExecutionProfileSchema,
});
export type TeamProfileMemberInput = z.infer<typeof TeamProfileMemberInputSchema>;

export const TeamProfileMemberPatchSchema = z.object({
  memberId: z.string().min(1),
  role: z.string().min(1).optional(),
  level: TeamMemberLevelSchema.optional(),
  skillIds: z.array(z.string().min(1)).min(1).optional(),
  executionProfile: TeamExecutionProfileSchema.optional(),
});
export type TeamProfileMemberPatch = z.infer<typeof TeamProfileMemberPatchSchema>;

export const TeamProfileCreateRequestSchema = z.object({
  type: z.literal("team.profile.create.request"),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  name: z.string().min(1),
  workspaceId: z.string().min(1),
  skills: z.array(TeamSkillSchema).min(1),
  lead: TeamProfileMemberInputSchema,
  members: z.array(TeamProfileMemberInputSchema),
});

export const TeamProfileListRequestSchema = z.object({
  type: z.literal("team.profile.list.request"),
  requestId: z.string().min(1),
  includeArchived: z.boolean().optional(),
});

export const TeamProfileInspectRequestSchema = z.object({
  type: z.literal("team.profile.inspect.request"),
  requestId: z.string().min(1),
  teamId: z.string().min(1),
});

export const TeamProfileUpdateRequestSchema = z.object({
  type: z.literal("team.profile.update.request"),
  requestId: z.string().min(1),
  // COMPAT(teamProfileUpdateIdempotency): added in v0.3.0-beta.3, remove after
  // 2027-02-09 once the client floor always sends update idempotency keys.
  idempotencyKey: z.string().min(1).optional(),
  teamId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  skills: z.array(TeamSkillSchema).min(1).optional(),
  leadMemberId: z.string().min(1).optional(),
  memberAdds: z.array(TeamProfileMemberInputSchema).optional(),
  memberUpdates: z.array(TeamProfileMemberPatchSchema).optional(),
  memberRemovals: z.array(z.string().min(1)).optional(),
});

export const TeamProfileArchiveRequestSchema = z.object({
  type: z.literal("team.profile.archive.request"),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  teamId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
});

const teamResponseFields = {
  requestId: z.string().min(1),
  team: TeamV2Schema.nullable(),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
};

export const TeamProfileCreateResponseSchema = z.object({
  type: z.literal("team.profile.create.response"),
  payload: z.object(teamResponseFields),
});

export const TeamProfileListResponseSchema = z.object({
  type: z.literal("team.profile.list.response"),
  payload: z.object({
    requestId: z.string().min(1),
    teams: z.array(TeamV2Schema),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
});

export const TeamProfileInspectResponseSchema = z.object({
  type: z.literal("team.profile.inspect.response"),
  payload: z.object(teamResponseFields),
});

export const TeamProfileUpdateResponseSchema = z.object({
  type: z.literal("team.profile.update.response"),
  payload: z.object(teamResponseFields),
});

export const TeamProfileArchiveResponseSchema = z.object({
  type: z.literal("team.profile.archive.response"),
  payload: z.object(teamResponseFields),
});

export const TeamMissionStartRequestSchema = z.object({
  type: z.literal("team.mission.start.request"),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  teamId: z.string().min(1),
  expectedTeamRevision: z.number().int().nonnegative(),
  objective: z.string().min(1),
  constraints: z.array(z.string().min(1)),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});

export const TeamMissionListRequestSchema = z.object({
  type: z.literal("team.mission.list.request"),
  requestId: z.string().min(1),
  teamId: z.string().min(1),
  includeTerminal: z.boolean().optional(),
});

export const TeamMissionInspectRequestSchema = z.object({
  type: z.literal("team.mission.inspect.request"),
  requestId: z.string().min(1),
  missionId: z.string().min(1),
});

export const TeamMissionCancelRequestSchema = z.object({
  type: z.literal("team.mission.cancel.request"),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  missionId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().min(1),
});

export const TeamMissionMessagePostRequestSchema = z.object({
  type: z.literal("team.mission.message.post.request"),
  requestId: z.string().min(1),
  missionId: z.string().min(1),
  body: z.string().min(1),
  replyToMessageId: z.string().min(1).optional(),
});

export const TeamMissionRoomSubscribeRequestSchema = z.object({
  type: z.literal("team.mission.room.subscribe.request"),
  requestId: z.string().min(1),
  missionId: z.string().min(1),
  afterCursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().nonnegative().optional(),
});

export const TeamMissionRoomUnsubscribeRequestSchema = z.object({
  type: z.literal("team.mission.room.unsubscribe.request"),
  requestId: z.string().min(1),
  missionId: z.string().min(1),
});

const attentionReasonField = { reason: z.string().min(1) };

export const TeamMissionAttentionResolutionInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attribute_owner"),
    ...attentionReasonField,
    ownerAssignmentId: z.string().min(1),
  }),
  z.object({ kind: z.literal("external_change"), ...attentionReasonField }),
  z.object({
    kind: z.literal("recovery_assignment"),
    ...attentionReasonField,
    recoveryAssignmentId: z.string().min(1),
  }),
  z.object({ kind: z.literal("report_received"), ...attentionReasonField }),
  z.object({ kind: z.literal("resume_provider"), ...attentionReasonField }),
  z.object({ kind: z.literal("replan"), ...attentionReasonField }),
  z.object({
    kind: z.literal("replace_lead"),
    ...attentionReasonField,
    // COMPAT(teamLeadReplacementMember): added in v0.3.0-beta.3, remove after
    // 2027-02-10 once the client floor always selects a replacement Member.
    replacementMemberId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("restore_notification"), ...attentionReasonField }),
  z.object({ kind: z.literal("cancel_mission"), ...attentionReasonField }),
]);
export type TeamMissionAttentionResolutionInput = z.infer<
  typeof TeamMissionAttentionResolutionInputSchema
>;

export const TeamMissionAttentionResolveRequestSchema = z.object({
  type: z.literal("team.mission.attention.resolve.request"),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  missionId: z.string().min(1),
  attentionId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  resolution: TeamMissionAttentionResolutionInputSchema,
});

const missionResponseFields = {
  requestId: z.string().min(1),
  mission: TeamMissionSchema.nullable(),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
};

export const TeamMissionStartResponseSchema = z.object({
  type: z.literal("team.mission.start.response"),
  payload: z.object(missionResponseFields),
});

export const TeamMissionListResponseSchema = z.object({
  type: z.literal("team.mission.list.response"),
  payload: z.object({
    requestId: z.string().min(1),
    missions: z.array(TeamMissionSchema),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
});

export const TeamMissionInspectResponseSchema = z.object({
  type: z.literal("team.mission.inspect.response"),
  payload: z.object(missionResponseFields),
});

export const TeamMissionCancelResponseSchema = z.object({
  type: z.literal("team.mission.cancel.response"),
  payload: z.object(missionResponseFields),
});

export const TeamMissionMessagePostResponseSchema = z.object({
  type: z.literal("team.mission.message.post.response"),
  payload: z.object({
    requestId: z.string().min(1),
    missionId: z.string().min(1),
    message: TeamRoomMessageSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
});

export const TeamMissionRoomSubscribeResponseSchema = z.object({
  type: z.literal("team.mission.room.subscribe.response"),
  payload: z.object({
    requestId: z.string().min(1),
    missionId: z.string().min(1),
    messages: z.array(TeamRoomMessageSchema),
    cursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
});

export const TeamMissionRoomUnsubscribeResponseSchema = z.object({
  type: z.literal("team.mission.room.unsubscribe.response"),
  payload: z.object({
    requestId: z.string().min(1),
    missionId: z.string().min(1),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
});

export const TeamMissionAttentionResolveResponseSchema = z.object({
  type: z.literal("team.mission.attention.resolve.response"),
  payload: z.object(missionResponseFields),
});

// Authoritative replacement broadcasts carry the aggregate revision and no request id.
export const TeamProfileSnapshotMessageSchema = z.object({
  type: z.literal("team.profile.snapshot"),
  payload: z.object({ team: TeamV2Schema }),
});

export const TeamMissionSnapshotMessageSchema = z.object({
  type: z.literal("team.mission.snapshot"),
  payload: z.object({ mission: TeamMissionSchema }),
});

export const TeamMissionMessagePostedSchema = z.object({
  type: z.literal("team.mission.message.posted"),
  payload: z.object({
    missionId: z.string().min(1),
    message: TeamRoomMessageSchema,
    cursor: z.number().int().nonnegative(),
  }),
});
