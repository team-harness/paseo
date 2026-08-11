import type { Logger } from "pino";
import { z } from "zod";

import {
  MissionAssignmentReportSchema,
  MissionMemberRequirementsSchema,
  MissionMutableScopeSchema,
  TeamMemberLevelSchema,
} from "@getpaseo/protocol/team/v2-types";

import { ensureValidJson } from "../../../json-utils.js";
import type { RegisterPaseoTool } from "../../../agent/tools/paseo-tools.js";
import type { PaseoToolResult } from "../../../agent/tools/types.js";
import type { TeamCollaborationService } from "../../application/team-collaboration-service.js";
import { TeamApplicationError } from "../../application/team-mission-service.js";
import { MissionRevisionConflictError } from "../../persistence/mission-store.js";

const MissionIdInputSchema = z.object({ missionId: z.string().min(1) }).strict();

const WorkstreamDraftSchema = z
  .object({
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
    dependencyWorkstreamIds: z.array(z.string().min(1)),
    mutableScope: MissionMutableScopeSchema,
    reviewPolicy: z.enum(["none", "required"]),
    reviewerRequirements: MissionMemberRequirementsSchema.nullable(),
    ownerMemberId: z.string().min(1).optional(),
    ownerOverrideReason: z.string().min(1).optional(),
    reviewerMemberId: z.string().min(1).optional(),
    reviewerOverrideReason: z.string().min(1).optional(),
  })
  .strict();

const AssignmentDraftSchema = z
  .object({
    clientKey: z.string().min(1),
    kind: z.literal("delivery"),
    workstreamId: z.string().min(1),
    subjectKeys: z.array(z.string().min(1)),
    dependencyKeys: z.array(z.string().min(1)),
    objective: z.string().min(1),
    inputRefs: z.array(z.string().min(1)),
    deliverables: z.array(z.string().min(1)).min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    mutableScope: MissionMutableScopeSchema,
    priority: z.number().int().nonnegative(),
  })
  .strict();

const ReplacementAssignmentDraftSchema = AssignmentDraftSchema.extend({
  supersedesAssignmentId: z.string().min(1),
}).strict();

const MissionPlanInputSchema = z
  .object({
    missionId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    expectedPlanRevision: z.number().int().nonnegative(),
    workstreams: z.array(WorkstreamDraftSchema).min(1),
    replacementAssignments: z.array(ReplacementAssignmentDraftSchema).optional(),
    assignments: z.array(AssignmentDraftSchema).optional(),
  })
  .strict();

const AssignTaskInputSchema = z
  .object({
    missionId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    expectedPlanRevision: z.number().int().positive(),
    assignments: z.array(AssignmentDraftSchema).min(1),
  })
  .strict();

const AssignmentReportInputSchema = z
  .object({
    missionId: z.string().min(1),
    assignmentId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    expectedAssignmentRevision: z.number().int().positive(),
    report: MissionAssignmentReportSchema,
  })
  .strict();

const TeamMessageInputSchema = z
  .object({
    missionId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    recipient: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

const TeamMemberHistoryInputSchema = z
  .object({
    missionId: z.string().min(1),
    memberId: z.string().min(1),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();

const ChatReadInputSchema = z
  .object({
    missionId: z.string().min(1),
    afterCursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

type CollaborationToolService = Pick<
  TeamCollaborationService,
  | "teamStatus"
  | "missionStatus"
  | "teamMemberHistory"
  | "planMission"
  | "assignTasks"
  | "reportAssignment"
  | "sendTeamMessage"
  | "readTeamChat"
  | "reconcilePendingMessages"
>;

interface PaseoTeamToolRegistrarOptions {
  service: CollaborationToolService;
  logger: Logger;
}

export class PaseoTeamToolRegistrar {
  private readonly logger: Logger;

  constructor(private readonly options: PaseoTeamToolRegistrarOptions) {
    this.logger = options.logger.child({ module: "team", component: "v2-agent-tools" });
  }

  register(callerAgentId: string | undefined, registerTool: RegisterPaseoTool): void {
    if (!callerAgentId) return;
    const execute = <T>(operation: () => Promise<T>) => this.execute(operation);

    registerTool(
      "team_status",
      {
        title: "Team status",
        description: "Read the persisted Team roster, participant bindings, and Member load.",
        inputSchema: MissionIdInputSchema,
      },
      ({ missionId }) =>
        execute(() => this.options.service.teamStatus({ callerAgentId, missionId })),
    );
    registerTool(
      "mission_status",
      {
        title: "Mission status",
        description:
          "Read the authoritative Mission plan, DAG, assignments, reports, blockers, and delta handoffs.",
        inputSchema: MissionIdInputSchema,
      },
      ({ missionId }) =>
        execute(() => this.options.service.missionStatus({ callerAgentId, missionId })),
    );
    registerTool(
      "team_member_history",
      {
        title: "Team Member history",
        description: "Read one Mission participant's curated Agent activity by stable Member id.",
        inputSchema: TeamMemberHistoryInputSchema,
      },
      ({ missionId, memberId, limit }) =>
        execute(() =>
          this.options.service.teamMemberHistory({
            callerAgentId,
            missionId,
            memberId,
            limit,
          }),
        ),
    );
    registerTool(
      "mission_plan",
      {
        title: "Plan Mission",
        description:
          "Lead only. Atomically submit a complete Workstream DAG with every initial, new, or replacement delivery/integration Assignment Contract. Omitting assignments on the initial plan leaves the Mission staged in planning; the daemon matches owners and reviewers.",
        inputSchema: MissionPlanInputSchema,
      },
      (input) => execute(() => this.options.service.planMission({ callerAgentId, ...input })),
    );
    registerTool(
      "assign_task",
      {
        title: "Assign structured work",
        description:
          "Lead only. While a Mission is staged in planning, atomically submit one complete batch of Assignment Contracts for its plan revision. Replan an active Mission with mission_plan instead.",
        inputSchema: AssignTaskInputSchema,
      },
      (input) => execute(() => this.options.service.assignTasks({ callerAgentId, ...input })),
    );
    registerTool(
      "assignment_report",
      {
        title: "Report Assignment",
        description:
          "Assignee only. Persist completed, blocked, or failed delivery evidence for the current binding.",
        inputSchema: AssignmentReportInputSchema,
      },
      (input) => execute(() => this.options.service.reportAssignment({ callerAgentId, ...input })),
    );
    registerTool(
      "team_message",
      {
        title: "Message Team Member",
        description:
          "Post one persistent directed message by Member id or @handle and enqueue recipient attention.",
        inputSchema: TeamMessageInputSchema,
      },
      (input) => execute(() => this.options.service.sendTeamMessage({ callerAgentId, ...input })),
    );
    registerTool(
      "chat_read",
      {
        title: "Read Team chat",
        description:
          "Immediately read a Mission room page and advance this Member's durable cursor.",
        inputSchema: ChatReadInputSchema,
      },
      (input) => execute(() => this.options.service.readTeamChat({ callerAgentId, ...input })),
    );
  }

  async reconcile(): Promise<void> {
    const result = await this.options.service.reconcilePendingMessages();
    for (const failure of result.failures) {
      this.logger.warn(failure, "Team room message recovery remains pending");
    }
  }

  private async execute<T>(operation: () => Promise<T>): Promise<PaseoToolResult> {
    try {
      const result = await operation();
      return { content: [], structuredContent: ensureValidJson(result) };
    } catch (error) {
      if (error instanceof TeamApplicationError) {
        return refuse(`${error.code}: ${error.message}`);
      }
      if (error instanceof MissionRevisionConflictError) {
        return refuse(`mission_revision_conflict: ${error.message}`);
      }
      this.logger.error({ err: error }, "Team Agent tool failed");
      return refuse("team_tool_failed: The Team tool could not complete. Read status and retry.");
    }
  }
}

function refuse(reason: string): PaseoToolResult {
  return { content: [{ type: "text", text: reason }], isError: true };
}
