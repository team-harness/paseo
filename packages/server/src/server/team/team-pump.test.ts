import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamInbox } from "./team-inbox.js";
import { TeamPump, type TeamPumpGateway } from "./team-pump.js";

const logger = createTestLogger();

const agentIdOf = (entry: { agentId: string }): string => entry.agentId;
const stateOf = (entry: { state: string }): string => entry.state;
const outcomeOf = (entry: { outcome: string | null }): string | null => entry.outcome;
const assignedTo =
  (agentId: string) =>
  (entry: { assigneeAgentId: string }): boolean =>
    entry.assigneeAgentId === agentId;

/**
 * DEC-3's dispatch contract, frozen: no preemption. An assignment goes out only
 * when its assignee can be woken, and never replaces a turn in flight. A busy
 * assignee simply keeps its assignment queued until it is not.
 */
describe("TeamPump", () => {
  let home: string;
  let inbox: TeamInbox;
  let gateway: FakeGateway;
  let pump: TeamPump;

  class FakeGateway implements TeamPumpGateway {
    /** Agents that are mid-turn and must not be interrupted. */
    busy = new Set<string>();
    /** Agents the daemon no longer has, or that are archived. */
    unwakeable = new Set<string>();
    readonly dispatched: Array<{ agentId: string; prompt: string; clientMessageId: string }> = [];
    readonly delivered: Array<{ agentId: string; deliveryId: string }> = [];
    readonly bodies: string[] = [];
    /** Turn ids to hand back, one per dispatch. */
    turnIds: string[] = [];
    /** Turn outcomes the ledger can look up, by turn id. */
    outcomes = new Map<string, "completed" | "failed" | "canceled">();
    /** Turns that are still running. */
    activeTurns = new Set<string>();

    /** Agents that have left the team. */
    departed = new Set<string>();

    async isWakeable(agentId: string): Promise<boolean> {
      return !this.busy.has(agentId) && !this.unwakeable.has(agentId);
    }

    async isStillOnTheTeam(input: { teamId: string; agentId: string }): Promise<boolean> {
      return !this.departed.has(input.agentId);
    }

    async dispatchAssignment(input: {
      agentId: string;
      prompt: string;
      clientMessageId: string;
    }): Promise<string | null> {
      this.dispatched.push(input);
      return this.turnIds.shift() ?? `turn-${this.dispatched.length}`;
    }

    async deliverCompletions(input: {
      agentId: string;
      deliveryId: string;
      body: string;
    }): Promise<boolean> {
      this.delivered.push({ agentId: input.agentId, deliveryId: input.deliveryId });
      this.bodies.push(input.body);
      return true;
    }

    async lookUpTurnOutcome(input: { agentId: string; turnId: string }) {
      const outcome = this.outcomes.get(input.turnId);
      if (outcome) return { kind: "settled" as const, outcome };
      if (this.activeTurns.has(input.turnId)) return { kind: "running" as const };
      return { kind: "unknown" as const };
    }
  }

  function promptOf(entry: { prompt: string }): string {
    return entry.prompt;
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-pump-"));
    inbox = new TeamInbox(home, logger);
    gateway = new FakeGateway();
    pump = new TeamPump({ inbox, gateway, logger });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function assign(assigneeAgentId: string, prompt: string) {
    return await inbox.enqueueAssignment({ teamId: "team-1", assigneeAgentId, prompt });
  }

  describe("dispatching", () => {
    test("sends an assignment to an assignee that can be woken", async () => {
      const assignment = await assign("agent-a", "measure the cache");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched).toHaveLength(1);
      expect(gateway.dispatched[0]?.clientMessageId).toBe(assignment.clientMessageId);
      const [stored] = await inbox.listAssignments("team-1");
      expect(stored?.state).toBe("dispatched");
    });

    test("cancels queued work for an assignee that has left the team", async () => {
      await assign("agent-a", "measure the cache");
      await assign("agent-b", "check the logs");
      gateway.departed.add("agent-a");

      const outstanding = await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      // Left queued it would never be sent and never settled: the team would
      // sweep every minute forever, and the lead would never learn what became
      // of a task it assigned.
      const assignments = await inbox.listAssignments("team-1");
      const cancelled = assignments.filter(assignedTo("agent-a"));
      expect(cancelled.map(stateOf)).toEqual(["settled"]);
      expect(cancelled.map(outcomeOf)).toEqual(["canceled"]);
      expect(gateway.dispatched.map(agentIdOf)).toEqual(["agent-b"]);
      // The cancellation is news for the lead, so there is still work to do.
      expect(outstanding).toBe(true);
    });

    // The whole point of the contract: a busy member is left to finish.
    test("leaves a busy assignee alone and keeps the assignment queued", async () => {
      await assign("agent-a", "measure the cache");
      gateway.busy.add("agent-a");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched).toEqual([]);
      expect((await inbox.listAssignments("team-1"))[0]?.state).toBe("queued");
    });

    test("sends it once the assignee is free again", async () => {
      await assign("agent-a", "measure the cache");
      gateway.busy.add("agent-a");
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      gateway.busy.delete("agent-a");
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched).toHaveLength(1);
    });

    test("sends only one at a time to the same assignee", async () => {
      await assign("agent-a", "first");
      await assign("agent-a", "second");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched).toHaveLength(1);
      expect(gateway.dispatched[0]?.prompt).toBe("first");
    });

    test("sends to several assignees in the same pass", async () => {
      await assign("agent-a", "for a");
      await assign("agent-b", "for b");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched).toHaveLength(2);
    });

    // A provider that refuses leaves the assignment queued to try again, rather
    // than recording a dispatch that never happened.
    test("keeps the assignment queued when the provider will not take it", async () => {
      await assign("agent-a", "work");
      gateway.dispatchAssignment = async () => null;

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect((await inbox.listAssignments("team-1"))[0]?.state).toBe("queued");
    });
  });

  // The three-state rule: a turn with a recorded outcome settles on it; a turn
  // still running is left alone; anything else settles as unknown rather than
  // hanging forever.
  describe("settling what was dispatched", () => {
    test("settles on the outcome the turn recorded", async () => {
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-7"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.outcomes.set("turn-7", "completed");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      const [stored] = await inbox.listAssignments("team-1");
      expect(stored?.state).toBe("settled");
      expect(stored?.outcome).toBe("completed");
    });

    test("waits while the turn it was accepted for is still running", async () => {
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-7"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.activeTurns.add("turn-7");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect((await inbox.listAssignments("team-1"))[0]?.state).toBe("dispatched");
    });

    // The daemon died mid-turn, or the outcome rolled out of the history. The
    // lead is told the result is not known rather than never told at all.
    test("settles as unknown when the turn left no trace", async () => {
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-7"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      const [stored] = await inbox.listAssignments("team-1");
      expect(stored?.state).toBe("settled");
      expect(stored?.outcome).toBe("unknown");
    });

    test("frees the assignee's queue once the first one settles", async () => {
      await assign("agent-a", "first");
      await assign("agent-a", "second");
      gateway.turnIds = ["turn-1", "turn-2"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.outcomes.set("turn-1", "completed");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched.map(promptOf)).toEqual(["first", "second"]);
    });
  });

  describe("telling the lead", () => {
    async function settleOne(prompt: string, turnId: string) {
      await assign("agent-a", prompt);
      gateway.turnIds = [turnId];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.outcomes.set(turnId, "completed");
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
    }

    test("delivers what settled", async () => {
      await settleOne("work", "turn-1");

      expect(gateway.delivered).toHaveLength(1);
      expect(gateway.delivered[0]?.agentId).toBe("lead");
    });

    test("holds the news while the lead is busy and delivers it after", async () => {
      gateway.busy.add("lead");
      await settleOne("work", "turn-1");
      expect(gateway.delivered).toEqual([]);

      gateway.busy.delete("lead");
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.delivered).toHaveLength(1);
    });

    // Two completions that happened while the lead was busy arrive as one
    // message rather than two.
    test("merges what piled up into a single delivery", async () => {
      gateway.busy.add("lead");
      await settleOne("first", "turn-1");
      await settleOne("second", "turn-2");

      gateway.busy.delete("lead");
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.delivered).toHaveLength(1);
      // Both, not just whichever settled first: a pass that only checked
      // whether there was news must not have closed the batch around it.
      expect(gateway.bodies[0]).toContain("first");
      expect(gateway.bodies[0]).toContain("second");
    });

    test("does not deliver the same batch twice", async () => {
      await settleOne("work", "turn-1");

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.delivered).toHaveLength(1);
    });

    // Delivery is acknowledged by the send succeeding. A refusal leaves the
    // batch to be sent again, under the same id, so the lead can skip it if it
    // did arrive.
    test("keeps the batch when the lead will not take it", async () => {
      gateway.deliverCompletions = async () => false;
      await settleOne("work", "turn-1");

      gateway.deliverCompletions = async (input) => {
        gateway.delivered.push({ agentId: input.agentId, deliveryId: input.deliveryId });
        return true;
      };
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.delivered).toHaveLength(1);
    });
  });

  // The pump is driven by events, but events can be dropped. A pass that finds
  // outstanding work says so, which is what a periodic sweep hangs off.
  describe("knowing whether to come back", () => {
    test("reports work outstanding while something is queued", async () => {
      await assign("agent-a", "work");
      gateway.busy.add("agent-a");

      expect(await pump.run({ teamId: "team-1", leadAgentId: "lead" })).toBe(true);
    });

    test("reports work outstanding while something is in flight", async () => {
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-7"];
      gateway.activeTurns.add("turn-7");

      expect(await pump.run({ teamId: "team-1", leadAgentId: "lead" })).toBe(true);
    });

    test("reports nothing outstanding once everything has been told", async () => {
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-1"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.outcomes.set("turn-1", "completed");

      expect(await pump.run({ teamId: "team-1", leadAgentId: "lead" })).toBe(false);
    });

    // A pass that is already running may have looked at everything before the
    // caller's trigger existed, and there is no way from outside to tell. So a
    // joiner always gets "come back" — a wasted sweep costs nothing, while a
    // scheduler dropping the team on a stale `false` strands the work until
    // some unrelated event happens to wake it.
    test("runs another round for a trigger that arrived during a pass", async () => {
      let joined: Promise<boolean> | null = null;
      // Every pass asks whether the lead can be woken, so this counts passes.
      let passes = 0;
      const isWakeable = gateway.isWakeable.bind(gateway);
      gateway.isWakeable = async (agentId: string) => {
        if (agentId === "lead") passes += 1;
        return isWakeable(agentId);
      };
      gateway.deliverCompletions = async () => {
        joined ??= pump.run({ teamId: "team-1", leadAgentId: "lead" });
        return true;
      };
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-1"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.outcomes.set("turn-1", "completed");
      passes = 0;

      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      await joined;

      // The trigger arrived after that pass had read the ledger, so joining it
      // would have answered about work it never looked at. Another round runs
      // instead, and both callers come back knowing a pass could have seen
      // theirs.
      expect(passes).toBe(2);
    });

    // A ledger that cannot be read looks empty, and empty means "nothing to
    // do". Reporting that would retire the team, and repairing the file would
    // not bring it back.
    test("keeps watching a team whose ledger cannot be read", async () => {
      await assign("agent-a", "work");
      await writeFile(join(home, "team-1.inbox.json"), "{ not json", "utf8");

      expect(await pump.run({ teamId: "team-1", leadAgentId: "lead" })).toBe(true);
    });

    // The check at the top of a pass says nothing about the rest of it. A file
    // that goes bad halfway through makes every later read look empty, and
    // empty at the end means "retire this team".
    test("keeps watching when the ledger goes bad mid-pass", async () => {
      await assign("agent-a", "work");
      gateway.turnIds = ["turn-1"];
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });
      gateway.outcomes.set("turn-1", "completed");
      gateway.deliverCompletions = async () => {
        await writeFile(join(home, "team-1.inbox.json"), "{ not json", "utf8");
        return true;
      };

      expect(await pump.run({ teamId: "team-1", leadAgentId: "lead" })).toBe(true);
    });

    // Losing the event that says an agent went idle must not strand the work:
    // the next sweep picks it up without anything having to restart.
    test("recovers a dropped wake-up on the next pass", async () => {
      await assign("agent-a", "work");
      gateway.busy.add("agent-a");
      await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      // The agent went idle and nobody was told.
      gateway.busy.delete("agent-a");
      const outstanding = await pump.run({ teamId: "team-1", leadAgentId: "lead" });

      expect(gateway.dispatched).toHaveLength(1);
      expect(outstanding).toBe(true);
    });
  });
});
