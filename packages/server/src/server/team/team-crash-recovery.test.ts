import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamInbox } from "./team-inbox.js";
import { TeamPump, type TeamPumpGateway } from "./team-pump.js";
import { TeamStore } from "./team-store.js";
import { TeamService, type TeamAgentGateway, type TeamRoomGateway } from "./team-service.js";

const logger = createTestLogger();

/** Thrown at an injected crash point; caught by the test, never handled. */
class SimulatedCrash extends Error {
  constructor() {
    super("simulated crash");
    this.name = "SimulatedCrash";
  }
}

/**
 * The contract names the windows where a daemon can die with real resources
 * already built and nothing recorded about them. What matters after a restart
 * is that recovery neither leaves a resource stranded nor makes a second one.
 *
 * Each test drops the whole service and store and builds fresh ones, which is
 * what a restart is: nothing survives but the files.
 */
describe("recovering from a crash mid-creation", () => {
  let home: string;

  /** Survives the "restart", because the daemon it stands for is external. */
  class World {
    readonly rooms = new Set<string>();
    readonly agents = new Map<string, { archived: boolean }>();
    readonly prompts: string[] = [];
    /**
     * Runs once a side effect has really happened, before whatever records it.
     * Throwing here is the crash — and it has to be after, because the window
     * that matters is "the world moved and the record did not".
     */
    afterEffect: (effect: string) => void = () => {};

    roomGateway(): TeamRoomGateway {
      return {
        createRoom: async (input) => {
          this.rooms.add(input.roomId);
          this.afterEffect(`room:${input.roomId}`);
        },
        discardRoom: async (input) => {
          this.rooms.delete(input.roomId);
        },
      };
    }

    agentGateway(): TeamAgentGateway {
      return {
        createAgent: async (input) => {
          this.agents.set(input.agentId, { archived: false });
          this.afterEffect(`agent:${input.agentId}`);
        },
        sendPrompt: async (input) => {
          // Deduplicated the way the prompt layer deduplicates: the same
          // client message id twice is one delivery.
          if (!this.prompts.includes(input.clientMessageId)) {
            this.prompts.push(input.clientMessageId);
          }
          this.afterEffect(`prompt:${input.clientMessageId}`);
        },
        archiveAgent: async (agentId) => {
          const agent = this.agents.get(agentId);
          if (!agent) return { kind: "not_found" as const };
          agent.archived = true;
          return { kind: "archived" as const };
        },
        clearTeamLabels: async () => {},
        restoreTeamLabels: async () => {},
        getAgentState: async (agentId) => {
          const agent = this.agents.get(agentId);
          if (!agent) return { kind: "missing" as const };
          return agent.archived
            ? { kind: "archived" as const }
            : { kind: "active" as const, teamLabel: null };
        },
      };
    }
  }

  let world: World;

  /** A service over the files as they are now, as a restart would build. */
  async function restart(): Promise<{ store: TeamStore; service: TeamService }> {
    const store = new TeamStore(join(home, "teams"), logger);
    await store.initialize();
    return {
      store,
      service: new TeamService({
        store,
        rooms: world.roomGateway(),
        agents: world.agentGateway(),
        logger,
      }),
    };
  }

  const request = {
    idempotencyKey: "key-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    task: "Find what is eating the disk",
    lead: { role: "lead", provider: "claude", title: null, briefing: null, settings: null },
    members: [
      { role: "server", provider: "codex", title: null, briefing: null, settings: null },
      { role: "app", provider: "claude", title: null, briefing: null, settings: null },
    ],
    templateId: null,
  };

  /**
   * Stops at the nth side effect the way a killed process would, then restarts
   * and reconciles.
   *
   * A thrown error is not a crash: the service catches it and records the team
   * as failed, which is a decision the daemon never got to make. So the record
   * is put back the way a kill would have left it — still `creating`, with
   * whatever stage had been committed — before the restart looks at it.
   */
  async function crashAtEffect(index: number): Promise<void> {
    let seen = 0;
    world.afterEffect = () => {
      seen += 1;
      if (seen === index) throw new SimulatedCrash();
    };

    const first = await restart();
    await first.service.create(request).catch((error) => {
      if (!(error instanceof SimulatedCrash)) throw error;
    });
    const [dying] = await first.store.list();
    await first.store.update(dying!.id, (current) => ({
      ...current,
      lifecycle: "creating" as const,
    }));

    world.afterEffect = () => {};
    const second = await restart();
    await second.service.reconcile();
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-crash-"));
    world = new World();
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // Seven side effects: the room, three agents, three briefings. Crashing just
  // after each one covers every point where the world has moved and the record
  // has not — including the three that matter most, where the last effect of a
  // stage happened and the stage was never written.
  for (let effect = 1; effect <= 7; effect += 1) {
    test(`ends with exactly one of everything after a crash at effect ${effect}`, async () => {
      await crashAtEffect(effect);

      const { store } = await restart();
      const [team] = await store.list();
      expect(team?.lifecycle).toBe("active");
      // One room, one agent per member, one briefing each — no duplicates from
      // the replay, and nothing missing from the crash.
      expect(world.rooms.size).toBe(1);
      expect(world.agents.size).toBe(3);
      expect(world.prompts).toHaveLength(3);
      expect(team?.members).toHaveLength(3);
    });
  }
});

/**
 * DEC-3's three windows. Each is a moment where the world has moved and the
 * ledger has not: the assignment is recorded but unsent, the provider has taken
 * it but nothing says so, or the turn has finished and nothing has settled it.
 */
describe("recovering from a crash mid-assignment", () => {
  let home: string;
  let inbox: TeamInbox;
  let gateway: RecordingGateway;

  class RecordingGateway implements TeamPumpGateway {
    readonly dispatched: string[] = [];
    /** Every attempt, in order — a resend is a second entry, not a no-op. */
    readonly delivered: string[] = [];
    outcomes = new Map<string, "completed" | "failed" | "canceled">();
    /** Turn to hand back, or null to refuse. */
    nextTurnId: string | null = "turn-1";

    isWakeable(): boolean {
      return true;
    }

    async dispatchAssignment(input: { clientMessageId: string }): Promise<string | null> {
      // The prompt layer deduplicates, so a resend of the same assignment is
      // one delivery however many times the pump tries.
      if (!this.dispatched.includes(input.clientMessageId)) {
        this.dispatched.push(input.clientMessageId);
      }
      return this.nextTurnId;
    }

    async deliverCompletions(input: { deliveryId: string }): Promise<boolean> {
      this.delivered.push(input.deliveryId);
      return true;
    }

    lookUpTurnOutcome(input: { turnId: string }) {
      const outcome = this.outcomes.get(input.turnId);
      return outcome ? { kind: "settled" as const, outcome } : { kind: "unknown" as const };
    }
  }

  function pumpOver(ledger: TeamInbox): TeamPump {
    return new TeamPump({ inbox: ledger, gateway, logger });
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-ledger-crash-"));
    inbox = new TeamInbox(home, logger);
    gateway = new RecordingGateway();
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // Recorded and not yet sent. The prompt is on disk, so a restart sends it.
  test("sends an assignment that was recorded before the crash", async () => {
    await inbox.enqueueAssignment({
      teamId: "team-1",
      assigneeAgentId: "agent-a",
      prompt: "work",
    });

    const restarted = new TeamInbox(home, logger);
    await pumpOver(restarted).run({ teamId: "team-1", leadAgentId: "lead" });

    expect(gateway.dispatched).toHaveLength(1);
  });

  // The provider took it and the ledger never learned the turn id. The resend
  // is deduplicated at the prompt layer, and the assignment binds to a turn.
  test("resends an assignment the provider had accepted but nothing recorded", async () => {
    const assignment = await inbox.enqueueAssignment({
      teamId: "team-1",
      assigneeAgentId: "agent-a",
      prompt: "work",
    });
    // The crash: dispatched for real, `markDispatched` never ran.
    await gateway.dispatchAssignment({ clientMessageId: assignment.clientMessageId });

    const restarted = new TeamInbox(home, logger);
    await pumpOver(restarted).run({ teamId: "team-1", leadAgentId: "lead" });

    expect(gateway.dispatched).toHaveLength(1);
    const [stored] = await restarted.listAssignments("team-1");
    expect(stored?.state).toBe("dispatched");
    expect(stored?.acceptedTurnId).toBe("turn-1");
  });

  // The turn finished and nothing settled it. The outcome is still on the turn,
  // so the restart reads it and tells the lead.
  test("settles a turn that finished before the crash", async () => {
    const assignment = await inbox.enqueueAssignment({
      teamId: "team-1",
      assigneeAgentId: "agent-a",
      prompt: "work",
    });
    await inbox.markDispatched({ teamId: "team-1", taskId: assignment.taskId, turnId: "turn-1" });
    gateway.outcomes.set("turn-1", "completed");

    const restarted = new TeamInbox(home, logger);
    await pumpOver(restarted).run({ teamId: "team-1", leadAgentId: "lead" });

    const [stored] = await restarted.listAssignments("team-1");
    expect(stored?.state).toBe("settled");
    expect(stored?.outcome).toBe("completed");
    expect(gateway.delivered).toHaveLength(1);
  });

  // The lead was told and the acknowledgement never landed. The batch is sent
  // again under the id the lead already saw, which is what lets it skip.
  test("resends an unacknowledged delivery under the same id", async () => {
    const assignment = await inbox.enqueueAssignment({
      teamId: "team-1",
      assigneeAgentId: "agent-a",
      prompt: "work",
    });
    await inbox.markDispatched({ teamId: "team-1", taskId: assignment.taskId, turnId: "turn-1" });
    await inbox.settle({ teamId: "team-1", taskId: assignment.taskId, outcome: "completed" });
    const delivery = await inbox.prepareDelivery("team-1");
    // Actually delivered, then the crash: the lead has it, and nothing on disk
    // says so. Otherwise this would only test prepared-but-never-sent.
    await gateway.deliverCompletions({ deliveryId: delivery!.deliveryId });

    const restarted = new TeamInbox(home, logger);
    await pumpOver(restarted).run({ teamId: "team-1", leadAgentId: "lead" });

    // Two attempts, one id: the resend is real, and it carries what the lead
    // has already seen so it can recognise the repeat rather than read it as
    // more news.
    expect(gateway.delivered).toEqual([delivery?.deliveryId, delivery?.deliveryId]);
  });
});
