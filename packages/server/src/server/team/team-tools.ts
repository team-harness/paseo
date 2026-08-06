import type { Logger } from "pino";
import { z } from "zod";

import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import type { TeamInbox } from "./team-inbox.js";

/**
 * A tool blocks the caller's turn for as long as it runs. Five minutes is the
 * contract's ceiling: long enough to be worth waiting, short enough that an
 * unattended agent comes back and can decide what to do next.
 */
const MAX_CHAT_WAIT_MS = 5 * 60 * 1000;

/** The shape `team_status` and the guards need; the rest of the record is not the tools' business. */
export interface TeamToolsTeamView {
  id: string;
  name: string;
  chatRoomId: string;
  leadAgentId: string;
  lifecycle: string;
  members: ReadonlyArray<{ agentId: string; role: string; state: string }>;
}

export interface TeamToolsRoster {
  /** The team this agent belongs to, or null when it belongs to none. */
  findTeamForAgent(agentId: string): Promise<TeamToolsTeamView | null>;
  /** Last known lifecycle of a member, from storage when it is not in memory. */
  getMemberStatus(agentId: string): Promise<string>;
}

export interface TeamToolsChat {
  post(input: {
    actor: { kind: "agent"; id: string };
    room: string;
    body: string;
    replyToMessageId?: string | null;
  }): Promise<{ id: string }>;
  readMessages(input: {
    room: string;
    limit?: number;
    since?: string;
  }): Promise<ReadonlyArray<unknown>>;
  waitForMessages(input: {
    room: string;
    afterMessageId?: string | null;
    timeoutMs?: number;
  }): Promise<ReadonlyArray<unknown>>;
}

type RegisterToolFn = (
  name: string,
  config: PaseoToolConfig,
  handler: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Inputs are schema-validated by the catalog before execution.
    input: any,
    context: PaseoToolExecutionContext,
  ) => Promise<PaseoToolResult>,
) => void;

export interface RegisterTeamToolsOptions {
  registerTool: RegisterToolFn;
  callerAgentId?: string;
  roster: TeamToolsRoster;
  inbox: TeamInbox;
  chat: TeamToolsChat;
  /** Runs a pump pass for the team; the tool does not wait for the outcome of the work. */
  kickPump: (teamId: string) => Promise<void>;
  logger: Logger;
}

function ok(payload: Record<string, unknown>): PaseoToolResult {
  return { content: [], structuredContent: payload };
}

/**
 * A refusal the model can act on, not a thrown error.
 *
 * These tools are called by an agent reasoning about a team whose shape it
 * cannot see. "You are not the lead" is information; a stack trace is not.
 */
function refuse(reason: string): PaseoToolResult {
  return { content: [{ type: "text", text: reason }], isError: true };
}

/**
 * Registers the tools an agent uses to work as part of a team.
 *
 * Kept out of the shared catalog module so the team feature adds one call
 * there rather than a thousand lines, and so this file can be read as the
 * whole of what a team member can do.
 */
export function registerTeamTools(options: RegisterTeamToolsOptions): void {
  const { registerTool, callerAgentId, roster, inbox, chat, kickPump } = options;

  // Nothing to scope the tools to. They would have no room to post in and no
  // roster to check against, so they are not offered at all.
  if (!callerAgentId) return;

  /**
   * Resolved per call rather than once at registration.
   *
   * Registration is synchronous and happens when the catalog is built, which
   * can be long before the call — and a team can be archived, or the caller
   * removed from it, in between. Asking every time is what makes the guards
   * mean anything.
   */
  async function requireTeam(): Promise<
    { ok: true; team: TeamToolsTeamView } | { ok: false; result: PaseoToolResult }
  > {
    const team = await roster.findTeamForAgent(callerAgentId!);
    if (!team) {
      return { ok: false, result: refuse("You are not a member of a team.") };
    }
    return { ok: true, team };
  }

  registerTool(
    "assign_task",
    {
      title: "Assign a task",
      description:
        "Assign work to a team member. Lead only. Dispatch does not interrupt: a busy member " +
        "receives the task when its current turn ends. You are told the outcome when it settles.",
      inputSchema: {
        assigneeAgentId: z.string().min(1),
        prompt: z.string().min(1),
      },
      outputSchema: { taskId: z.string() },
    },
    async ({ assigneeAgentId, prompt }) => {
      const found = await requireTeam();
      if (!found.ok) return found.result;
      const { team } = found;

      if (team.leadAgentId !== callerAgentId) {
        return refuse("Only the team lead can assign tasks.");
      }
      if (team.lifecycle !== "active") {
        return refuse(`This team is ${team.lifecycle} and is no longer taking work.`);
      }

      const assignee = team.members.find((member) => member.agentId === assigneeAgentId);
      if (!assignee || assignee.state !== "active") {
        return refuse(
          `${assigneeAgentId} is not an active member of this team. Call team_status for the roster.`,
        );
      }

      const assignment = await inbox.enqueueAssignment({
        teamId: team.id,
        assigneeAgentId,
        prompt,
      });
      // Recorded first, sent second: a crash here leaves the task on disk for
      // the next pass rather than losing it.
      await kickPump(team.id);
      return ok({ taskId: assignment.taskId });
    },
  );

  registerTool(
    "team_status",
    {
      title: "Team status",
      description:
        "The team roster with each member's current status and how much work it still has open.",
    },
    async () => {
      const found = await requireTeam();
      if (!found.ok) return found.result;
      const { team } = found;

      const assignments = await inbox.listAssignments(team.id);
      const members = await Promise.all(
        team.members.map(async (member) => ({
          agentId: member.agentId,
          role: member.role,
          state: member.state,
          status: await roster.getMemberStatus(member.agentId),
          openTasks: assignments.filter(
            (assignment) =>
              assignment.assigneeAgentId === member.agentId && assignment.state !== "settled",
          ).length,
        })),
      );

      return ok({
        teamId: team.id,
        name: team.name,
        lifecycle: team.lifecycle,
        leadAgentId: team.leadAgentId,
        chatRoomId: team.chatRoomId,
        members,
      });
    },
  );

  /**
   * The room a chat tool acts on.
   *
   * Defaulting to the team room is the point of these tools. Naming a room is
   * allowed only when it is the team's own — an agent that can address any
   * room by id can read and write conversations its team has nothing to do
   * with.
   */
  async function resolveRoom(
    requested: string | undefined,
  ): Promise<{ ok: true; team: TeamToolsTeamView } | { ok: false; result: PaseoToolResult }> {
    const found = await requireTeam();
    if (!found.ok) return found;
    const wanted = requested?.trim();
    if (wanted && wanted !== found.team.chatRoomId) {
      return { ok: false, result: refuse("You can only use your own team's room.") };
    }
    return found;
  }

  registerTool(
    "chat_post",
    {
      title: "Post to the team room",
      description: "Post a message to your team's room. Defaults to your own team room.",
      inputSchema: {
        body: z.string().min(1),
        room: z.string().optional(),
        replyToMessageId: z.string().nullable().optional(),
      },
      outputSchema: { messageId: z.string() },
    },
    async ({ body, room, replyToMessageId }) => {
      const found = await resolveRoom(room);
      if (!found.ok) return found.result;

      const message = await chat.post({
        actor: { kind: "agent", id: callerAgentId! },
        room: found.team.chatRoomId,
        body,
        replyToMessageId: replyToMessageId ?? null,
      });
      return ok({ messageId: message.id });
    },
  );

  registerTool(
    "chat_read",
    {
      title: "Read the team room",
      description:
        "Read messages from your team's room. Pass `since` with the last message id you saw to " +
        "get only what is new.",
      inputSchema: {
        room: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
        since: z.string().optional(),
      },
    },
    async ({ room, limit, since }) => {
      const found = await resolveRoom(room);
      if (!found.ok) return found.result;

      const messages = await chat.readMessages({
        room: found.team.chatRoomId,
        ...(limit !== undefined ? { limit } : {}),
        ...(since !== undefined ? { since } : {}),
      });
      return ok({ roomId: found.team.chatRoomId, messages });
    },
  );

  registerTool(
    "chat_wait",
    {
      title: "Wait for team messages",
      description:
        "Block until someone posts to your team's room, or until the timeout. Returns everything " +
        "posted after `afterMessageId`.",
      inputSchema: {
        room: z.string().optional(),
        afterMessageId: z.string().nullable().optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ room, afterMessageId, timeoutMs }) => {
      const found = await resolveRoom(room);
      if (!found.ok) return found.result;

      const messages = await chat.waitForMessages({
        room: found.team.chatRoomId,
        afterMessageId: afterMessageId ?? null,
        timeoutMs: Math.min(timeoutMs ?? MAX_CHAT_WAIT_MS, MAX_CHAT_WAIT_MS),
      });
      return ok({ roomId: found.team.chatRoomId, messages });
    },
  );
}

/** Reserved: the lead role is granted by the creation transaction and by nothing else. */
const RESERVED_TEAM_ROLES: ReadonlySet<string> = new Set(["lead"]);

/**
 * Extra `create_agent` input a team member sees. Merged into the tool's schema
 * so a recruiting agent is told what to send rather than having to guess.
 */
export const CREATE_AGENT_TEAM_EXTENSION = {
  teamRole: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Required when you are in a team: what the new member is for, for example "server" or ' +
        '"reviewer". The new agent joins your team. Pass inheritTeam: false to create a plain ' +
        "agent instead.",
    ),
  inheritTeam: z
    .boolean()
    .optional()
    .describe("Set false to create an agent outside your team rather than recruiting into it."),
};

export interface TeamRecruitmentHookOptions {
  callerAgentId?: string;
  roster: TeamToolsRoster;
  recruit(input: {
    teamId: string;
    recruiterAgentId: string;
    teamRole: string;
    provider: string;
    title: string | null;
    settings: Record<string, unknown> | null;
    initialPrompt: string;
  }): Promise<{ agentId: string }>;
  describeAgent(
    agentId: string,
  ): Promise<{ agentId: string; provider: string; status: string; cwd: string }>;
  logger: Logger;
}

export interface TeamRecruitmentHook {
  /**
   * Handles `create_agent` when the call is a recruitment, or returns null to
   * let the ordinary create path run.
   */
  handleCreateAgent(args: unknown): Promise<PaseoToolResult | null>;
}

const RecruitmentArgsSchema = z
  .object({
    provider: z.string().min(1),
    initialPrompt: z.string().min(1),
    title: z.string().nullish(),
    settings: z.record(z.string(), z.unknown()).nullish(),
    teamRole: z.string().nullish(),
    inheritTeam: z.boolean().nullish(),
  })
  .passthrough();

/**
 * Turns `create_agent` into recruitment for an agent that is already in a team.
 *
 * Recruiting is not "create an agent, then add it" — the seat, the roster entry
 * and the intent are written before anything is built, so a crash cannot leave
 * an agent wearing team labels that the roster has never heard of. That is why
 * this diverts the whole call rather than decorating the result of the normal
 * one.
 */
export function createTeamRecruitmentHook(
  options: TeamRecruitmentHookOptions,
): TeamRecruitmentHook {
  const { callerAgentId, roster, recruit, describeAgent } = options;

  return {
    async handleCreateAgent(args: unknown): Promise<PaseoToolResult | null> {
      if (!callerAgentId) return null;

      const parsed = RecruitmentArgsSchema.safeParse(args);
      // Malformed input is the ordinary tool's to reject, with the ordinary
      // tool's message. Diverting here would replace it with a worse one.
      if (!parsed.success) return null;
      if (parsed.data.inheritTeam === false) return null;

      const team = await roster.findTeamForAgent(callerAgentId);
      if (!team) return null;

      if (team.lifecycle !== "active") {
        return refuse(`This team is ${team.lifecycle} and is no longer recruiting.`);
      }

      const teamRole = parsed.data.teamRole?.trim();
      if (!teamRole) {
        return refuse(
          "You are in a team, so create_agent recruits into it and needs teamRole — what the " +
            "new member is for. Pass inheritTeam: false to create a plain agent instead.",
        );
      }
      if (RESERVED_TEAM_ROLES.has(teamRole.toLowerCase())) {
        return refuse(`"${teamRole}" is reserved. A team has one lead, chosen when it is created.`);
      }

      const { agentId } = await recruit({
        teamId: team.id,
        recruiterAgentId: callerAgentId,
        teamRole,
        provider: parsed.data.provider,
        title: parsed.data.title ?? null,
        settings: parsed.data.settings ?? null,
        initialPrompt: parsed.data.initialPrompt,
      });

      const agent = await describeAgent(agentId);
      return ok({
        agentId: agent.agentId,
        type: agent.provider,
        status: agent.status,
        cwd: agent.cwd,
        teamId: team.id,
        teamRole,
        guidance:
          `${agent.agentId} has joined the team as ${teamRole} and has your briefing. ` +
          "Send it work with assign_task; talk to it in the team room.",
      });
    },
  };
}
