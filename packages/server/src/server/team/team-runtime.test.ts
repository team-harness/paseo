import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TEAM_ID_LABEL, TEAM_ROLE_LABEL } from "@getpaseo/protocol/agent-labels";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "../agent/agent-manager.js";
import { AgentStorage } from "../agent/agent-storage.js";
import { FileBackedChatService } from "../chat/chat-service.js";
import { createTeamRuntime, type TeamRuntime } from "./team-runtime.js";
import type {
  AgentClient,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../agent/agent-sdk-types.js";

const logger = createTestLogger();

const CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

/** A provider that accepts turns and finishes them immediately. */
class StubSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id: string;
  private subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turns = 0;

  constructor(private readonly config: AgentSessionConfig) {
    this.id = `session-${config.cwd}-${Math.trunc(config.cwd.length)}`;
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    // A real provider does not accept a turn in the same tick it is asked. The
    // delay is what makes "read the turn id straight after the send" wrong.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const turnId = `turn-${++this.turns}`;
    setTimeout(() => {
      this.push({ type: "turn_started", provider: this.provider, turnId });
      this.push({ type: "turn_completed", provider: this.provider, turnId });
    }, 0);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private push(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: null,
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence() {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class StubClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    return new StubSession(config);
  }

  /** Loading a stored-only agent goes through here, which the replay path does. */
  async resumeSession(
    _handle: unknown,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    return new StubSession({ provider: "codex", cwd: config?.cwd ?? "/", ...config });
  }

  async fetchCatalog() {
    return {
      models: [{ provider: this.provider, id: "gpt-5.4", label: "GPT-5.4", isDefault: true }],
      modes: [],
      features: [],
      thinkingOptions: [],
    };
  }
}

/**
 * The runtime over the real AgentManager, AgentStorage and chat store.
 *
 * Everything else in this directory tests a unit against a fake gateway. This
 * file is the opposite: the gateways themselves, against the runtime they claim
 * to speak for. That is where the two contracts actually meet, and where a
 * mismatch between what an interface promises and what the method does is
 * invisible to every other test here.
 */
describe("teams over the real agent runtime", () => {
  let home: string;
  let agentManager: AgentManager;
  let agentStorage: AgentStorage;
  let chatService: FileBackedChatService;
  let runtime: TeamRuntime;
  let published: string[];
  /** Which agent build to fail, counting from 1. A failed workspace lookup is how. */
  let failAgentBuildNumber: number | null = null;
  let agentBuilds = 0;

  async function build(): Promise<void> {
    runtime?.stop();
    agentStorage = new AgentStorage(join(home, "agents"), logger);
    await agentStorage.initialize();
    agentManager = new AgentManager({
      clients: { codex: new StubClient() },
      registry: agentStorage,
      logger,
    });
    chatService = new FileBackedChatService({ paseoHome: home, logger });
    await chatService.initialize();
    runtime = await createTeamRuntime({
      paseoHome: home,
      agentManager,
      agentStorage,
      chatService,
      resolveWorkspaceCwd: async () => {
        agentBuilds += 1;
        return agentBuilds === failAgentBuildNumber ? null : home;
      },
      publishTeamUpdate: (team) => published.push(team.lifecycle),
      logger,
    });
  }

  /** Waits until the agent is not mid-turn, so a dispatch will be accepted. */
  async function waitUntilIdle(agentId: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (agentManager.getAgent(agentId)?.lifecycle !== "running") return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`${agentId} never stopped running`);
  }

  /** Waits for one specific turn to have ended and been recorded. */
  async function waitForTurnOutcome(agentId: string, turnId: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await agentStorage.getTurnOutcome(agentId, turnId)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Turn ${turnId} never ended for ${agentId}`);
  }

  async function createTeam() {
    return runtime.service.create({
      idempotencyKey: "idem-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "find what is eating the disk",
      lead: { role: "lead", provider: "codex", title: null, briefing: null, settings: null },
      members: [{ role: "server", provider: "codex", title: null, briefing: null, settings: null }],
      templateId: null,
    });
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-runtime-"));
    published = [];
    agentBuilds = 0;
    failAgentBuildNumber = null;
    await build();
  });

  afterEach(async () => {
    runtime.stop();
    // Detached listeners can still be writing when the test ends; retrying is
    // cheaper than draining them.
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  test("builds a team with a room, its agents, and their briefings", async () => {
    const team = await createTeam();

    expect(team.lifecycle).toBe("active");
    expect(team.members).toHaveLength(2);
    for (const member of team.members) {
      const record = await agentStorage.get(member.agentId);
      expect(record?.labels[TEAM_ID_LABEL]).toBe(team.id);
      expect(record?.labels[TEAM_ROLE_LABEL]).toBe(member.role);
    }
    expect((await chatService.listRooms()).map((room) => room.id)).toContain(team.chatRoomId);
  });

  test("replays a creation that stopped part-way, without building anything twice", async () => {
    // The lead is built, the second member is not: the plan is on disk with
    // some of what it describes already in the world.
    failAgentBuildNumber = 2;
    await expect(createTeam()).rejects.toThrow();
    const [halfBuilt] = await runtime.store.list();
    expect(halfBuilt?.lifecycle).toBe("failed");
    const leadId = halfBuilt!.leadAgentId;
    expect((await agentStorage.list()).map((record) => record.id)).toEqual([leadId]);

    // A kill leaves it `creating`; the service only writes `failed` because it
    // got to decide. The plan survives either way, which is what makes the
    // replay possible.
    await runtime.store.update(halfBuilt!.id, (current) => ({
      ...current,
      lifecycle: "creating" as const,
    }));
    // Rebuilt, so the lead is stored-only the way it is after a restart. That
    // is the branch that matters: creation by id has to recognise a record it
    // owns rather than refuse the id.
    await build();
    await runtime.service.reconcile();

    const replayed = await runtime.store.get(halfBuilt!.id);
    expect(replayed?.lifecycle).toBe("active");
    // The lead is the same agent, not a second one under a new id: creation by
    // id has to find what it built last time rather than refuse the id or
    // replace what is behind it.
    expect(replayed?.leadAgentId).toBe(leadId);
    expect(await agentStorage.list()).toHaveLength(2);
  });

  test("archives a team whose members the daemon has not loaded", async () => {
    const team = await createTeam();

    // Members are loaded lazily, so after a restart this is the normal case,
    // not an edge one.
    await build();
    await runtime.service.archive(team.id);

    const archived = await runtime.store.get(team.id);
    expect(archived?.lifecycle).toBe("archived");
    for (const member of team.members) {
      expect((await agentStorage.get(member.agentId))?.archivedAt).toBeTruthy();
    }
  });

  test("does not record a team archived when archiving a member failed", async () => {
    const team = await createTeam();
    const member = team.members.find((entry) => entry.role === "server");
    // The window this closes: the agent was live when the archive started and
    // was unloaded before the call landed. What comes back says "unknown
    // agent", which is also what a hard-deleted one says — and the record is
    // the only thing that can tell them apart.
    agentManager.archiveAgent = async (agentId: string) => {
      if (agentId === member!.agentId) throw new Error(`Unknown agent '${agentId}'`);
    };

    await expect(runtime.service.archive(team.id)).rejects.toThrow();

    expect((await runtime.store.get(team.id))?.lifecycle).toBe("archiving");
    expect((await agentStorage.get(member!.agentId))?.archivedAt).toBeFalsy();
  });

  test("takes the team labels off a member that leaves", async () => {
    const team = await createTeam();
    const member = team.members.find((entry) => entry.role === "server");

    await runtime.service.removeMember({ teamId: team.id, agentId: member!.agentId });

    // Removing a label is not the same as writing a smaller set of them: the
    // write is a patch, so a subset merges and takes nothing away.
    const record = await agentStorage.get(member!.agentId);
    expect(record?.labels[TEAM_ID_LABEL]).toBeUndefined();
    expect(record?.labels[TEAM_ROLE_LABEL]).toBeUndefined();
    // Leaving a team is not the same as ending the agent.
    expect(record?.archivedAt).toBeFalsy();
  });

  test("refuses to delete an agent while its team is still being created", async () => {
    const team = await createTeam();
    await runtime.store.update(team.id, (current) => ({
      ...current,
      lifecycle: "creating" as const,
    }));

    await expect(agentManager.assertAgentDeletable(team.leadAgentId)).rejects.toThrow(
      /still being created/i,
    );
  });

  test("carries an assignment through to a result the lead is told about", async () => {
    const team = await createTeam();
    const member = team.members.find((entry) => entry.role === "server");
    await runtime.start();

    await runtime.inbox.enqueueAssignment({
      teamId: team.id,
      assigneeAgentId: member!.agentId,
      prompt: "measure the cache",
    });
    // The first pass dispatches and binds the turn; the turn then has to
    // actually end before a pass can settle it. Waiting for the outcome to
    // reach the record is what makes the second pass deterministic.
    // The member is still working through its briefing when the team goes
    // active, and the dispatch contract says a busy member is left alone.
    await waitUntilIdle(member!.agentId);
    await runtime.pumpOnce(team.id);
    const [dispatched] = await runtime.inbox.listAssignments(team.id);
    // The member's second turn: its first was the briefing. Binding to that one
    // would settle the assignment on a result that has nothing to do with it.
    expect(dispatched?.acceptedTurnId).toBe("turn-2");
    await waitForTurnOutcome(member!.agentId, dispatched!.acceptedTurnId!);
    await runtime.pumpOnce(team.id);

    const [assignment] = await runtime.inbox.listAssignments(team.id);
    expect(assignment?.state).toBe("settled");
    // Not `unknown`: the assignment was bound to the turn the provider really
    // opened, so its outcome is the turn's own.
    expect(assignment?.outcome).toBe("completed");
    // And the lead has been told. A delivery that is never acknowledged is
    // resent forever and no later completion ever reaches the lead.
    expect(await runtime.inbox.hasNewsForLead(team.id)).toBe(false);
  });
});
