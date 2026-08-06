import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import type { PaseoToolDefinition, PaseoToolResult } from "./agent/tools/types.js";

/**
 * A team over a real daemon, two provider adapters, and a real WebSocket.
 *
 * Everything under `team/` tests one piece against fakes. This is the whole
 * thing at once: the RPCs, the broadcast, the chat room, the agents each
 * provider builds, and the reconciler — over the wire a client actually uses.
 */
const idOf = (team: TeamSnapshot): string => team.id;

describe("a team, end to end", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let updates: TeamSnapshot[];
  // Per test: each one gets a fresh daemon, so a workspace id from the last one
  // names nothing here.
  let cachedWorkspaceId: string | null;

  beforeEach(async () => {
    daemon = await createTestPaseoDaemon({ agentClients: createTestAgentClients() });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.3.0",
      capabilities: { [CLIENT_CAPS.teams]: true },
    });
    await client.connect();
    updates = [];
    cachedWorkspaceId = null;
    client.on("team.update", (event) => {
      updates.push((event as { payload: { team: TeamSnapshot } }).payload.team);
    });
  });

  afterEach(async () => {
    await client.close().catch(() => {});
    await daemon.close();
  });

  async function createTeam(overrides: { idempotencyKey?: string; name?: string } = {}) {
    return client.createTeam({
      idempotencyKey: overrides.idempotencyKey ?? "e2e-1",
      name: overrides.name ?? "Disk usage",
      workspaceId: await workspaceId(),
      task: "find what is eating the disk",
      // Two different provider adapters, because a team is allowed to mix them
      // and the daemon resolves each member's provider on its own.
      lead: { role: "lead", provider: "claude" },
      members: [
        { role: "server", provider: "codex" },
        { role: "app", provider: "claude" },
      ],
    });
  }

  /**
   * The turns this agent has finished, oldest first.
   *
   * Read from the record because that is where a turn's end is a fact rather
   * than a status that happens to be true at the moment it is asked. An agent
   * that has just been created is `initializing`, which is not `running` — so
   * "wait until not running" answers before the first turn has even started.
   */
  async function turnOutcomesOf(agentId: string): Promise<string[]> {
    const record = await daemon.daemon.agentStorage.get(agentId);
    return (record?.turnOutcomes ?? []).map((outcome) => outcome.turnId);
  }

  /** Waits until this agent has finished `count` turns, and returns their ids. */
  async function settledTurns(agentId: string, count: number): Promise<string[]> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const turns = await turnOutcomesOf(agentId);
      if (turns.length >= count) return turns;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${agentId} never finished ${count} turns`);
  }

  async function pendingPermission(agentId: string) {
    const snapshot = await client.waitForAgentUpsert(
      agentId,
      (agent) => agent.pendingPermissions.length > 0,
      15_000,
    );
    return snapshot.pendingPermissions[0]!;
  }

  async function waitForGone(file: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (!existsSync(file)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${file} was never removed`);
  }

  /**
   * Calls one of the lead's own tools, registered the way the daemon registers
   * it for that agent.
   *
   * The fake providers cannot reach MCP, so this stands in for the lead typing
   * the call — everything on the other side of the registration is real.
   */
  async function callLeadTool(
    leadAgentId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<PaseoToolResult> {
    const tools = new Map<string, PaseoToolDefinition>();
    daemon.daemon.teamRuntime.registerToolsFor({
      callerAgentId: leadAgentId,
      registerTool: (toolName, config, handler) => {
        tools.set(toolName, {
          name: toolName,
          description: config.description ?? toolName,
          handler,
        });
      },
    });
    const tool = tools.get(name);
    if (!tool) throw new Error(`${name} was not registered for ${leadAgentId}`);
    return tool.handler(input, {});
  }

  async function waitForSettledAssignment(teamId: string) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [assignment] = await daemon.daemon.teamRuntime.inbox.listAssignments(teamId);
      if (assignment?.state === "settled") return assignment;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No assignment settled for ${teamId}`);
  }

  async function connectClient(capabilities: Record<string, boolean> = {}): Promise<DaemonClient> {
    const extra = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.3.0",
      capabilities,
    });
    await extra.connect();
    return extra;
  }

  function collectTeamUpdates(target: DaemonClient): TeamSnapshot[] {
    const seen: TeamSnapshot[] = [];
    target.on("team.update", (event) => {
      seen.push((event as { payload: { team: TeamSnapshot } }).payload.team);
    });
    return seen;
  }

  async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Condition never held");
  }

  async function workspaceId(): Promise<string> {
    if (cachedWorkspaceId) return cachedWorkspaceId;
    const created = await client.createWorkspace({
      source: { kind: "directory", path: daemon.paseoHome },
    });
    cachedWorkspaceId = created.workspace!.id;
    return cachedWorkspaceId;
  }

  test("creates a team, its room, and one agent per member", async () => {
    const payload = await createTeam();

    expect(payload.error).toBeNull();
    const team = payload.team!;
    expect(team.lifecycle).toBe("active");
    expect(team.members).toHaveLength(3);

    // Each member is a real agent the daemon can list, and each carries the
    // provider its spec asked for.
    const agents = await client.fetchAgents({ filter: { includeArchived: true } });
    const byId = new Map(agents.entries.map((entry) => [entry.agent.id, entry.agent]));
    for (const member of team.members) {
      expect(byId.get(member.agentId)).toBeDefined();
    }
    expect(byId.get(team.leadAgentId)?.provider).toBe("claude");
    const server = team.members.find((member) => member.role === "server");
    expect(byId.get(server!.agentId)?.provider).toBe("codex");

    const rooms = await client.listChatRooms();
    expect(rooms.rooms.map((room) => room.id)).toContain(team.chatRoomId);
  });

  test("hands the same team back to a retry of the same request", async () => {
    const first = await createTeam();
    const second = await createTeam();

    // The key is what makes a client that lost its answer safe to ask again.
    expect(second.team?.id).toBe(first.team?.id);
    expect((await client.listTeams()).teams).toHaveLength(1);
  });

  test("refuses a key that was used for different work", async () => {
    await createTeam();

    const conflicting = await createTeam({ name: "Something else" });

    expect(conflicting.team).toBeNull();
    expect(conflicting.errorCode).toBe("idempotency_conflict");
  });

  test("broadcasts the team to every client that understands them, and no others", async () => {
    const watcher = await connectClient();
    const watcherUpdates = collectTeamUpdates(watcher);
    // A socket from before teams existed says nothing about them, and the
    // client library's defaults have to be turned off to model one.
    const older = await connectClient({ [CLIENT_CAPS.teams]: false });
    const olderUpdates = collectTeamUpdates(older);

    const created = await createTeam();

    // The client that asked gets a correlated response; this is the separate
    // broadcast every other client relies on to stay current.
    const sawCreated = () => watcherUpdates.map(idOf).includes(created.team!.id);
    await waitFor(sawCreated);
    expect(updates.map((team) => team.id)).toContain(created.team!.id);
    // And a socket that never said it understands teams is not sent one. Two
    // sockets of different ages can share a session, so the gate is per socket.
    expect(olderUpdates).toEqual([]);

    await watcher.close();
    await older.close();
  });

  test("lists a team, and hides it once archived unless asked", async () => {
    const created = await createTeam();

    expect((await client.listTeams()).teams.map((team) => team.id)).toEqual([created.team!.id]);

    const archived = await client.archiveTeam({ teamId: created.team!.id });
    expect(archived.team?.lifecycle).toBe("archived");

    expect((await client.listTeams()).teams).toEqual([]);
    expect(
      (await client.listTeams({ includeArchived: true })).teams.map((team) => team.lifecycle),
    ).toEqual(["archived"]);
  });

  test("archives every member with the team", async () => {
    const created = await createTeam();

    await client.archiveTeam({ teamId: created.team!.id });

    const agents = await client.fetchAgents({ filter: { includeArchived: true } });
    const byId = new Map(agents.entries.map((entry) => [entry.agent.id, entry.agent]));
    for (const member of created.team!.members) {
      expect(byId.get(member.agentId)?.archivedAt).toBeTruthy();
    }
  });

  test("takes a member off a team without ending its agent", async () => {
    const created = await createTeam();
    const member = created.team!.members.find((entry) => entry.role === "server")!;

    const payload = await client.removeTeamMember({
      teamId: created.team!.id,
      agentId: member.agentId,
    });

    const entry = payload.team?.members.find((row) => row.agentId === member.agentId);
    expect(entry?.state).toBe("removed");
    expect(entry?.removalReason).toBe("removed_by_user");

    const agents = await client.fetchAgents({ filter: { includeArchived: true } });
    const stillRunning = agents.entries.find((row) => row.agent.id === member.agentId);
    expect(stillRunning?.agent.archivedAt).toBeFalsy();
  });

  test("refuses to remove the lead", async () => {
    const created = await createTeam();

    const payload = await client.removeTeamMember({
      teamId: created.team!.id,
      agentId: created.team!.leadAgentId,
    });

    // A team without its lead has nobody to assign work or receive results.
    // Ending the team is `archive`, and it is a different decision.
    expect(payload.team).toBeNull();
    expect(payload.error).toMatch(/lead/i);
  });

  test("answers a team that is not there rather than going quiet", async () => {
    const payload = await client.inspectTeam({ teamId: "nope" });

    expect(payload.team).toBeNull();
    expect(payload.error).toMatch(/not found/i);
  });

  test("a human posting in the room wakes the member it named", async () => {
    const created = await createTeam();
    const member = created.team!.members.find((entry) => entry.role === "server")!;
    const other = created.team!.members.find((entry) => entry.role === "app")!;
    // `initializing` is not `running`, so "not running" would be satisfied
    // before the briefing had even started. Wait for the turn it opens and for
    // that turn to end — a mention does not interrupt one.
    const briefing = await settledTurns(member.agentId, 1);
    await settledTurns(other.agentId, 1);

    await client.postChatMessage({
      room: created.team!.chatRoomId,
      body: `@${member.agentId} what did you find?`,
    });

    // A second turn, not the briefing's. Asserting only "it ran" would pass
    // with mentions doing nothing at all.
    const afterMention = await settledTurns(member.agentId, 2);
    expect(afterMention[1]).not.toBe(briefing[0]);
    // And only the member that was named.
    expect((await turnOutcomesOf(other.agentId)).length).toBe(1);

    const messages = await client.readChatMessages({ room: created.team!.chatRoomId });
    expect(messages.messages.at(-1)?.mentionAgentIds).toEqual([member.agentId]);
  });

  test("answers two members' permission requests independently", async () => {
    const created = await createTeam();
    const allowed = created.team!.members.find((entry) => entry.role === "app")!;
    const denied = created.team!.members.find((entry) => entry.role === "server")!;
    await settledTurns(allowed.agentId, 1);
    await settledTurns(denied.agentId, 1);

    // Both ask at once, and each provider is given a command its own adapter
    // understands. A daemon that keyed pending permissions by anything coarser
    // than the agent would answer the wrong one.
    const allowedFile = join(daemon.paseoHome, "permission.txt");
    const deniedFile = join(daemon.paseoHome, "denied.txt");
    await writeFile(allowedFile, "still here", "utf8");
    await client.sendMessage(allowed.agentId, "rm -f permission.txt");
    await client.sendMessage(denied.agentId, 'printf "ok" > denied.txt');
    const [allowedRequest, deniedRequest] = await Promise.all([
      pendingPermission(allowed.agentId),
      pendingPermission(denied.agentId),
    ]);

    const [allowResolution, denyResolution] = await Promise.all([
      client.respondToPermissionAndWait(allowed.agentId, allowedRequest.id, { behavior: "allow" }),
      client.respondToPermissionAndWait(denied.agentId, deniedRequest.id, {
        behavior: "deny",
        message: "not this time",
      }),
    ]);

    expect(allowResolution.resolution.behavior).toBe("allow");
    expect(denyResolution.resolution.behavior).toBe("deny");
    // What the answers meant, not just that they arrived: the allowed tool ran
    // and the denied one did not.
    await waitForGone(allowedFile);
    // The denied one never ran, so its file was never written.
    await settledTurns(denied.agentId, 2);
    expect(existsSync(deniedFile)).toBe(false);

    // A team member's permission is the ordinary agent flow; a team does not
    // get its own, and neither answer touches the team.
    expect((await client.listTeams()).teams[0]?.lifecycle).toBe("active");
  });

  test("carries the lead's assignment through to a result it is told about", async () => {
    const created = await createTeam();
    const team = created.team!;
    const member = team.members.find((entry) => entry.role === "server")!;
    // Both have to be past their briefings: dispatch never interrupts a turn,
    // and neither does the delivery back to the lead.
    await settledTurns(member.agentId, 1);
    await settledTurns(team.leadAgentId, 1);

    // The lead's own tool, registered the way the daemon registers it.
    const assigned = await callLeadTool(team.leadAgentId, "assign_task", {
      assigneeAgentId: member.agentId,
      prompt: "measure the cache",
    });
    expect(assigned.isError).toBeFalsy();

    // From here nothing in the test drives the pump: the member's turn ending
    // is what tells the daemon to settle the assignment and tell the lead.
    await settledTurns(member.agentId, 2);
    const settled = await waitForSettledAssignment(team.id);
    expect(settled.assigneeAgentId).toBe(member.agentId);
    expect(settled.outcome).toBe("completed");

    // And the lead heard about it — a second turn, opened by the delivery.
    await settledTurns(team.leadAgentId, 2);
    expect(await daemon.daemon.teamRuntime.inbox.hasNewsForLead(team.id)).toBe(false);
  });

  test("reports open work per member", async () => {
    const created = await createTeam();
    const team = created.team!;
    const member = team.members.find((entry) => entry.role === "server")!;
    await settledTurns(member.agentId, 1);
    await settledTurns(team.leadAgentId, 1);

    const status = await callLeadTool(team.leadAgentId, "team_status", {});
    const members = (status.structuredContent as { members: Array<Record<string, unknown>> })
      .members;

    expect(members.map((row) => row.agentId).sort()).toEqual(
      team.members.map((entry) => entry.agentId).sort(),
    );
    expect(members.every((row) => row.openTasks === 0)).toBe(true);
  });

  test("keeps the daemon's own notes off the wire", async () => {
    const created = await createTeam();

    const team = (await client.inspectTeam({ teamId: created.team!.id })).team as unknown as Record<
      string,
      unknown
    >;

    for (const field of [
      "idempotencyKey",
      "requestFingerprint",
      "creationPlan",
      "creationStage",
      "failedCleanupAt",
      "pendingRecruitments",
    ]) {
      expect(team[field]).toBeUndefined();
    }
  });
});
