import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";

/**
 * A team over a real daemon, two provider adapters, and a real WebSocket.
 *
 * Everything under `team/` tests one piece against fakes. This is the whole
 * thing at once: the RPCs, the broadcast, the chat room, the agents each
 * provider builds, and the reconciler — over the wire a client actually uses.
 */
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
      capabilities: [CLIENT_CAPS.teams],
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

  test("broadcasts the team to every client that understands them", async () => {
    const created = await createTeam();

    // The client that asked gets a correlated response; this is the separate
    // broadcast every other client relies on to stay current.
    expect(updates.map((team) => team.id)).toContain(created.team!.id);
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
    // Its briefing has to finish first — a mention does not interrupt a turn.
    await client.waitForAgentUpsert(member.agentId, (agent) => agent.status !== "running");

    await client.postChatMessage({
      room: created.team!.chatRoomId,
      body: `@${member.agentId} what did you find?`,
    });

    // The wake goes through the same path as any other prompt, so the member
    // runs.
    const woken = await client.waitForAgentUpsert(
      member.agentId,
      (agent) => agent.status === "running",
      15_000,
    );
    expect(woken.id).toBe(member.agentId);

    const messages = await client.readChatMessages({ room: created.team!.chatRoomId });
    expect(messages.messages.at(-1)?.mentionAgentIds).toEqual([member.agentId]);
  });

  test("answers a member's permission request over the wire", async () => {
    const created = await createTeam();
    const member = created.team!.members.find((entry) => entry.role === "app")!;
    await client.waitForAgentUpsert(member.agentId, (agent) => agent.status !== "running");

    // The fake provider asks before running this one, the way a real one does.
    await client.sendMessage(member.agentId, "rm -f permission.txt");
    const waiting = await client.waitForAgentUpsert(
      member.agentId,
      (agent) => agent.pendingPermissions.length > 0,
      15_000,
    );

    const resolved = await client.respondToPermissionAndWait(
      member.agentId,
      waiting.pendingPermissions[0]!.id,
      { behavior: "deny", message: "not this time" },
    );

    // A team member's permission is the ordinary agent permission flow; a team
    // does not get its own, and denying one does not touch the team.
    expect(resolved.requestId).toBe(waiting.pendingPermissions[0]!.id);
    expect((await client.listTeams()).teams[0]?.lifecycle).toBe("active");
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
