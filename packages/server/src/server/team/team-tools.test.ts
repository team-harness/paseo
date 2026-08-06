import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamInbox } from "./team-inbox.js";
import {
  createTeamRecruitmentHook,
  registerTeamTools,
  type TeamToolsChat,
  type TeamToolsRoster,
} from "./team-tools.js";
import type { PaseoToolConfig, PaseoToolResult } from "../agent/tools/types.js";

const logger = createTestLogger();

interface StubRoom {
  messages: Array<{ id: string; body: string; author: { kind: string; id: string } }>;
}

/** Just enough of the chat service for the tools to talk to. */
class StubChat implements TeamToolsChat {
  readonly rooms = new Map<string, StubRoom>([["room-1", { messages: [] }]]);
  /** What `chat_wait` was actually asked to wait for. */
  waited: Array<{ room: string; timeoutMs: number | undefined }> = [];

  async post(input: { actor: { kind: "agent"; id: string }; room: string; body: string }) {
    const room = this.rooms.get(input.room);
    if (!room) throw new Error(`no such room: ${input.room}`);
    const message = {
      id: `msg-${room.messages.length + 1}`,
      body: input.body,
      author: input.actor,
    };
    room.messages.push(message);
    return message;
  }

  async readMessages(input: { room: string; limit?: number; since?: string }) {
    const room = this.rooms.get(input.room);
    if (!room) throw new Error(`no such room: ${input.room}`);
    const from = input.since
      ? room.messages.findIndex((message) => message.id === input.since) + 1
      : 0;
    return room.messages.slice(from, input.limit ? from + input.limit : undefined);
  }

  async waitForMessages(input: {
    room: string;
    afterMessageId?: string | null;
    timeoutMs?: number;
  }) {
    this.waited.push({ room: input.room, timeoutMs: input.timeoutMs });
    return this.readMessages({ room: input.room, since: input.afterMessageId ?? undefined });
  }
}

/** The roster half of TeamService, as the tools see it. */
class StubRoster implements TeamToolsRoster {
  team: {
    id: string;
    name: string;
    chatRoomId: string;
    leadAgentId: string;
    lifecycle: string;
    members: Array<{ agentId: string; role: string; state: string }>;
  } | null = {
    id: "team-1",
    name: "Disk usage",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    lifecycle: "active",
    members: [
      { agentId: "lead-1", role: "lead", state: "active" },
      { agentId: "member-1", role: "server", state: "active" },
      { agentId: "gone-1", role: "app", state: "removed" },
    ],
  };

  statuses = new Map<string, string>([
    ["lead-1", "running"],
    ["member-1", "idle"],
  ]);

  /**
   * Returns the team an agent appears on, `removed` or not — matching the real
   * roster lookup's job. Deciding what a `removed` entry means is the tools',
   * so a stub that filtered here would hide whether they do it.
   */
  async findTeamForAgent(agentId: string) {
    if (!this.team) return null;
    const isMember = this.team.members.some((member) => member.agentId === agentId);
    return isMember ? (this.team as never) : null;
  }

  async getMemberStatus(agentId: string) {
    return this.statuses.get(agentId) ?? "unknown";
  }
}

function openTasksByAgent(payload: Record<string, unknown>): Map<unknown, unknown> {
  const members = payload.members as Array<Record<string, unknown>>;
  return new Map(members.map((member) => [member.agentId, member.openTasks]));
}

describe("team agent tools", () => {
  let home: string;
  let inbox: TeamInbox;
  let chat: StubChat;
  let roster: StubRoster;
  let kicked: string[];
  let tools: Map<
    string,
    {
      config: PaseoToolConfig;
      handler: (input: unknown) => Promise<PaseoToolResult>;
    }
  >;

  function install(callerAgentId: string | undefined): void {
    tools = new Map();
    registerTeamTools({
      registerTool: (name, config, handler) => {
        tools.set(name, { config, handler: (input) => handler(input, {}) });
      },
      callerAgentId,
      roster,
      inbox,
      chat,
      kickPump: async (teamId: string) => {
        kicked.push(teamId);
      },
      logger,
    });
  }

  async function call(name: string, input: unknown): Promise<PaseoToolResult> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool.handler(input);
  }

  function structured(result: PaseoToolResult): Record<string, unknown> {
    return result.structuredContent as Record<string, unknown>;
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-tools-"));
    inbox = new TeamInbox(home, logger);
    chat = new StubChat();
    roster = new StubRoster();
    kicked = [];
    install("lead-1");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  describe("assign_task", () => {
    test("records the assignment and wakes the pump", async () => {
      const result = await call("assign_task", { assigneeAgentId: "member-1", prompt: "look" });

      const assignments = await inbox.listAssignments("team-1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.assigneeAgentId).toBe("member-1");
      expect(assignments[0]?.prompt).toBe("look");
      expect(structured(result).taskId).toBe(assignments[0]?.taskId);
      // The pump is what turns a recorded assignment into a sent prompt. Without
      // this the task sits until the next sweep.
      expect(kicked).toEqual(["team-1"]);
    });

    test("refuses a caller who is not the lead", async () => {
      install("member-1");

      const result = await call("assign_task", { assigneeAgentId: "member-1", prompt: "look" });

      expect(result.isError).toBe(true);
      expect(await inbox.listAssignments("team-1")).toEqual([]);
    });

    test("refuses an assignee who is not an active member", async () => {
      const result = await call("assign_task", { assigneeAgentId: "gone-1", prompt: "look" });

      expect(result.isError).toBe(true);
      expect(await inbox.listAssignments("team-1")).toEqual([]);
    });

    test("refuses an assignee from outside the roster", async () => {
      const result = await call("assign_task", { assigneeAgentId: "stranger", prompt: "look" });

      expect(result.isError).toBe(true);
      expect(await inbox.listAssignments("team-1")).toEqual([]);
    });

    test("refuses once the team is no longer active", async () => {
      roster.team = { ...roster.team!, lifecycle: "archiving" };

      const result = await call("assign_task", { assigneeAgentId: "member-1", prompt: "look" });

      expect(result.isError).toBe(true);
      expect(await inbox.listAssignments("team-1")).toEqual([]);
    });
  });

  describe("team_status", () => {
    test("reports every member with its current status", async () => {
      const payload = structured(await call("team_status", {}));

      expect(payload.teamId).toBe("team-1");
      expect(payload.leadAgentId).toBe("lead-1");
      expect(payload.members).toEqual([
        { agentId: "lead-1", role: "lead", state: "active", status: "running", openTasks: 0 },
        { agentId: "member-1", role: "server", state: "active", status: "idle", openTasks: 0 },
        { agentId: "gone-1", role: "app", state: "removed", status: "unknown", openTasks: 0 },
      ]);
    });

    test("reports queued and in-flight work per member", async () => {
      await call("assign_task", { assigneeAgentId: "member-1", prompt: "look" });

      const openTasks = openTasksByAgent(structured(await call("team_status", {})));
      expect(openTasks.get("member-1")).toBe(1);
      expect(openTasks.get("lead-1")).toBe(0);
    });
  });

  describe("chat tools", () => {
    test("post defaults to the caller's team room", async () => {
      await call("chat_post", { body: "on it" });

      expect(chat.rooms.get("room-1")?.messages).toEqual([
        { id: "msg-1", body: "on it", author: { kind: "agent", id: "lead-1" } },
      ]);
    });

    test("read defaults to the caller's team room", async () => {
      await chat.post({ actor: { kind: "agent", id: "member-1" }, room: "room-1", body: "hi" });

      const payload = structured(await call("chat_read", {}));

      expect((payload.messages as unknown[]).length).toBe(1);
    });

    test("wait caps the timeout at five minutes", async () => {
      await call("chat_wait", { timeoutMs: 60 * 60 * 1000 });

      // A tool that can block for an hour holds the caller's turn open for an
      // hour. The cap is what keeps an unattended wait recoverable.
      expect(chat.waited).toEqual([{ room: "room-1", timeoutMs: 5 * 60 * 1000 }]);
    });

    test("refuses to touch a room the caller's team does not own", async () => {
      chat.rooms.set("room-2", { messages: [] });

      const result = await call("chat_post", { room: "room-2", body: "leak" });

      expect(result.isError).toBe(true);
      expect(chat.rooms.get("room-2")?.messages).toEqual([]);
    });
  });

  describe("outside a team", () => {
    test("registers nothing for an agent with no team", async () => {
      roster.team = null;
      install("stranger");

      // Registration cannot await the lookup, so the tools exist but every one
      // of them refuses. What matters is that none of them acts.
      for (const name of ["assign_task", "team_status", "chat_post"]) {
        expect(
          (await call(name, { assigneeAgentId: "member-1", prompt: "x", body: "x" })).isError,
        ).toBe(true);
      }
    });

    test("registers nothing without a caller agent", async () => {
      install(undefined);

      expect(tools.size).toBe(0);
    });

    test("shuts out a member that has been removed", async () => {
      install("gone-1");

      // `gone-1` is still on the roster, as history. Membership is what the
      // entry says, not whether the id appears — otherwise leaving a team would
      // not take away access to its room.
      expect((await call("team_status", {})).isError).toBe(true);
      expect((await call("chat_read", {})).isError).toBe(true);
      expect((await call("chat_post", { body: "still here" })).isError).toBe(true);
      expect(chat.rooms.get("room-1")?.messages).toEqual([]);
    });
  });
});

describe("create_agent as team recruitment", () => {
  let roster: StubRoster;
  let recruited: Array<Record<string, unknown>>;
  let hook: ReturnType<typeof createTeamRecruitmentHook>;

  function install(callerAgentId: string | undefined): void {
    hook = createTeamRecruitmentHook({
      callerAgentId,
      roster,
      recruit: async (input) => {
        recruited.push(input as unknown as Record<string, unknown>);
        return { agentId: "recruit-1" };
      },
      describeAgent: async (agentId: string) => ({
        agentId,
        provider: "codex",
        status: "running",
        cwd: "/repo",
      }),
      logger,
    });
  }

  beforeEach(() => {
    roster = new StubRoster();
    recruited = [];
    install("lead-1");
  });

  test("recruits into the caller's team instead of creating a loose agent", async () => {
    const result = await hook.handleCreateAgent({
      provider: "codex",
      initialPrompt: "find the leak",
      teamRole: "server",
      title: "Server",
    });

    expect(recruited).toEqual([
      {
        teamId: "team-1",
        recruiterAgentId: "lead-1",
        teamRole: "server",
        provider: "codex",
        title: "Server",
        settings: null,
        initialPrompt: "find the leak",
      },
    ]);
    const created = result?.structuredContent as Record<string, unknown> | undefined;
    expect(created?.agentId).toBe("recruit-1");
  });

  test("refuses a team member that does not say what the recruit is for", async () => {
    const result = await hook.handleCreateAgent({ provider: "codex", initialPrompt: "help" });

    expect(result?.isError).toBe(true);
    expect(recruited).toEqual([]);
  });

  test("refuses to recruit a second lead", async () => {
    const result = await hook.handleCreateAgent({
      provider: "codex",
      initialPrompt: "help",
      teamRole: "Lead",
    });

    // Reserved, and case does not get around it — the lead role is granted by
    // the creation transaction and nothing else.
    expect(result?.isError).toBe(true);
    expect(recruited).toEqual([]);
  });

  test("lets a caller opt out and create a plain agent", async () => {
    const result = await hook.handleCreateAgent({
      provider: "codex",
      initialPrompt: "help",
      inheritTeam: false,
    });

    // Null means "not mine" — the normal create path runs.
    expect(result).toBeNull();
    expect(recruited).toEqual([]);
  });

  test("stays out of the way of an agent that is in no team", async () => {
    roster.team = null;
    install("stranger");

    expect(await hook.handleCreateAgent({ provider: "codex", initialPrompt: "help" })).toBeNull();
  });

  test("stays out of the way of a member that has been removed", async () => {
    install("gone-1");

    // Not a recruitment, and not a refusal either: an ex-member creating an
    // agent is doing the ordinary thing, and diverting it here would leave it
    // unable to create one at all.
    expect(await hook.handleCreateAgent({ provider: "codex", initialPrompt: "help" })).toBeNull();
    expect(recruited).toEqual([]);
  });

  test("stays out of the way outside an agent session", async () => {
    install(undefined);

    expect(await hook.handleCreateAgent({ provider: "codex", initialPrompt: "help" })).toBeNull();
  });
});
