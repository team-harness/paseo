import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamInbox } from "./team-inbox.js";

const logger = createTestLogger();

/**
 * DEC-3. The ledger is an outbox, not an orchestrator: it does not know what a
 * task means, only that one was accepted for delivery and has not been settled
 * yet. Everything it records is on disk before the side effect it describes, so
 * a crash leaves work to redo rather than work that vanished.
 */
describe("TeamInbox", () => {
  let home: string;
  let inbox: TeamInbox;

  function promptOf(assignment: { prompt: string }): string {
    return assignment.prompt;
  }

  /** Narrows away the null a caller has already asserted is not there. */
  function requireDelivery<T>(delivery: T | null): T {
    if (delivery === null) throw new Error("expected a delivery");
    return delivery;
  }

  function inboxPath(teamId: string): string {
    return join(home, `${teamId}.inbox.json`);
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "team-inbox-"));
    inbox = new TeamInbox(home, logger);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  describe("recording an assignment", () => {
    test("stores the prompt so a crash can resend it", async () => {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "Measure the cache directory",
      });

      expect(assignment.state).toBe("queued");
      expect(assignment.prompt).toBe("Measure the cache directory");
      expect(assignment.clientMessageId).toBe(`team-team-1-task-${assignment.taskId}`);

      const raw = JSON.parse(await readFile(inboxPath("team-1"), "utf8"));
      expect(raw.assignments).toHaveLength(1);
      expect(raw.assignments[0].prompt).toBe("Measure the cache directory");
    });

    test("keeps assignments for one assignee in the order they were made", async () => {
      await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "first",
      });
      await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "second",
      });

      const queued = await inbox.listAssignments("team-1");
      expect(queued.map(promptOf)).toEqual(["first", "second"]);
    });
  });

  // The point of FIFO with one in flight: `acceptedTurnId` is what settles an
  // assignment, and two assignments in flight for one agent could not tell
  // whose turn had just ended.
  describe("what may be dispatched", () => {
    test("offers the oldest queued assignment for an assignee", async () => {
      const first = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "first",
      });
      await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "second",
      });

      const next = await inbox.nextDispatchable("team-1", "agent-a");

      expect(next?.taskId).toBe(first.taskId);
    });

    test("offers nothing while one is already in flight", async () => {
      const first = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "first",
      });
      await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "second",
      });
      await inbox.markDispatched({ teamId: "team-1", taskId: first.taskId, turnId: "turn-1" });

      expect(await inbox.nextDispatchable("team-1", "agent-a")).toBeNull();
    });

    test("offers the next one once the first settles", async () => {
      const first = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "first",
      });
      const second = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "second",
      });
      await inbox.markDispatched({ teamId: "team-1", taskId: first.taskId, turnId: "turn-1" });
      await inbox.settle({ teamId: "team-1", taskId: first.taskId, outcome: "completed" });

      expect((await inbox.nextDispatchable("team-1", "agent-a"))?.taskId).toBe(second.taskId);
    });

    // One busy assignee holds up only its own queue.
    test("keeps assignees independent of each other", async () => {
      const busy = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "for a",
      });
      const other = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-b",
        prompt: "for b",
      });
      await inbox.markDispatched({ teamId: "team-1", taskId: busy.taskId, turnId: "turn-1" });

      expect((await inbox.nextDispatchable("team-1", "agent-b"))?.taskId).toBe(other.taskId);
    });
  });

  // Causal binding: an assignment is settled by the turn it was accepted for
  // and by nothing else. A mention waking the same agent, or a human prompt,
  // ends a different turn and must not close this one.
  describe("settling", () => {
    test("records the outcome against the turn that was accepted", async () => {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "work",
      });
      await inbox.markDispatched({
        teamId: "team-1",
        taskId: assignment.taskId,
        turnId: "turn-7",
      });

      const settled = await inbox.settle({
        teamId: "team-1",
        taskId: assignment.taskId,
        outcome: "completed",
      });

      expect(settled?.state).toBe("settled");
      expect(settled?.outcome).toBe("completed");
      expect(settled?.acceptedTurnId).toBe("turn-7");
      expect(settled?.completionEventId).toBe(`${assignment.taskId}:turn-7`);
    });

    // A turn whose outcome cannot be recovered — rolled out of the history, or
    // interrupted by a crash — is settled as unknown rather than left in flight
    // forever. It still happened under a known turn, so the event still names
    // it; the lead is simply told the result is not known.
    test("settles as unknown while still naming the turn it ran under", async () => {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "work",
      });
      await inbox.markDispatched({
        teamId: "team-1",
        taskId: assignment.taskId,
        turnId: "turn-7",
      });

      const settled = await inbox.settle({
        teamId: "team-1",
        taskId: assignment.taskId,
        outcome: "unknown",
      });

      expect(settled?.outcome).toBe("unknown");
      expect(settled?.completionEventId).toBe(`${assignment.taskId}:turn-7`);
    });

    // Cancelled before it was ever accepted: there is no turn to name.
    test("names no turn when the assignment never reached one", async () => {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "work",
      });

      const settled = await inbox.settle({
        teamId: "team-1",
        taskId: assignment.taskId,
        outcome: "canceled",
      });

      expect(settled?.completionEventId).toBe(`${assignment.taskId}:unknown`);
    });

    // The write that closes the assignment is the write that queues the news of
    // it. Two writes would leave a window where the work is done and nobody is
    // ever told.
    test("queues the completion in the same write that settles it", async () => {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "work",
      });
      await inbox.markDispatched({
        teamId: "team-1",
        taskId: assignment.taskId,
        turnId: "turn-7",
      });
      await inbox.settle({ teamId: "team-1", taskId: assignment.taskId, outcome: "completed" });

      const raw = JSON.parse(await readFile(inboxPath("team-1"), "utf8"));
      expect(raw.assignments[0].state).toBe("settled");
      expect(raw.pendingCompletions).toHaveLength(1);
      expect(raw.pendingCompletions[0].completionEventId).toBe(`${assignment.taskId}:turn-7`);
    });

    test("settling twice does not queue the news twice", async () => {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "work",
      });
      await inbox.markDispatched({
        teamId: "team-1",
        taskId: assignment.taskId,
        turnId: "turn-7",
      });
      await inbox.settle({ teamId: "team-1", taskId: assignment.taskId, outcome: "completed" });
      await inbox.settle({ teamId: "team-1", taskId: assignment.taskId, outcome: "failed" });

      const raw = JSON.parse(await readFile(inboxPath("team-1"), "utf8"));
      expect(raw.assignments[0].outcome).toBe("completed");
      expect(raw.pendingCompletions).toHaveLength(1);
    });
  });

  // Completions are batched into one delivery so a lead that was busy for a
  // while gets one message rather than a burst. The id is derived from what is
  // in it, so a resend after a crash carries the same id the lead already saw.
  describe("delivering completions to the lead", () => {
    async function settleOne(taskPrompt: string, turnId: string): Promise<string> {
      const assignment = await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: taskPrompt,
      });
      await inbox.markDispatched({ teamId: "team-1", taskId: assignment.taskId, turnId });
      await inbox.settle({ teamId: "team-1", taskId: assignment.taskId, outcome: "completed" });
      return assignment.taskId;
    }

    test("batches everything outstanding into one delivery", async () => {
      await settleOne("first", "turn-1");
      await settleOne("second", "turn-2");

      const delivery = await inbox.prepareDelivery("team-1");

      expect(delivery?.completions).toHaveLength(2);
    });

    test("derives the same id for the same batch", async () => {
      await settleOne("first", "turn-1");
      await settleOne("second", "turn-2");

      const first = await inbox.prepareDelivery("team-1");
      const again = await inbox.prepareDelivery("team-1");

      expect(again?.deliveryId).toBe(first?.deliveryId);
    });

    test("has nothing to deliver when nothing has settled", async () => {
      await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "still running",
      });

      expect(await inbox.prepareDelivery("team-1")).toBeNull();
    });

    // Acknowledgement is what removes the completions. Until then a restart
    // finds them and sends again — losing the news is worse than repeating it.
    test("keeps the batch until it is acknowledged", async () => {
      await settleOne("first", "turn-1");
      const delivery = requireDelivery(await inbox.prepareDelivery("team-1"));

      const reloaded = new TeamInbox(home, logger);
      expect((await reloaded.prepareDelivery("team-1"))?.deliveryId).toBe(delivery.deliveryId);

      await reloaded.acknowledgeDelivery({ teamId: "team-1", deliveryId: delivery.deliveryId });
      expect(await reloaded.prepareDelivery("team-1")).toBeNull();
    });

    test("acknowledging a delivery that is already gone is not an error", async () => {
      await settleOne("first", "turn-1");
      const delivery = requireDelivery(await inbox.prepareDelivery("team-1"));
      await inbox.acknowledgeDelivery({ teamId: "team-1", deliveryId: delivery.deliveryId });

      await expect(
        inbox.acknowledgeDelivery({ teamId: "team-1", deliveryId: delivery.deliveryId }),
      ).resolves.toBeUndefined();
    });

    // A completion that settled after the batch was assembled belongs to the
    // next one, not to a batch the lead may already be reading.
    test("puts what settles later into the next delivery", async () => {
      await settleOne("first", "turn-1");
      const first = requireDelivery(await inbox.prepareDelivery("team-1"));
      await settleOne("second", "turn-2");
      await inbox.acknowledgeDelivery({ teamId: "team-1", deliveryId: first.deliveryId });

      const next = await inbox.prepareDelivery("team-1");

      expect(next?.completions).toHaveLength(1);
      expect(next?.deliveryId).not.toBe(first.deliveryId);
    });
  });

  // A ledger that cannot be read is not an empty ledger. Reading may report
  // nothing, but writing has to fail closed: a write derived from "nothing"
  // would replace whatever is actually in the file, and no-loss is the one
  // guarantee this thing makes.
  describe("a damaged inbox file", () => {
    // Not "empty": empty is a real answer meaning nothing to do, and a caller
    // that got it from a failed read would act on it.
    test("refuses to answer rather than reporting an empty ledger", async () => {
      await writeFile(inboxPath("team-1"), "{ not json", "utf8");

      await expect(inbox.listAssignments("team-1")).rejects.toThrow(/unreadable/i);
    });

    test("refuses to write over a ledger it could not read", async () => {
      await inbox.enqueueAssignment({
        teamId: "team-1",
        assigneeAgentId: "agent-a",
        prompt: "already recorded",
      });
      const before = await readFile(inboxPath("team-1"), "utf8");
      // Something the schema rejects, holding real data.
      await writeFile(inboxPath("team-1"), JSON.stringify({ assignments: "not an array" }), "utf8");

      const reloaded = new TeamInbox(home, logger);
      await expect(
        reloaded.enqueueAssignment({
          teamId: "team-1",
          assigneeAgentId: "agent-b",
          prompt: "would overwrite",
        }),
      ).rejects.toThrow(/unreadable/i);

      // Untouched, so a repaired file still has everything it had.
      expect(await readFile(inboxPath("team-1"), "utf8")).not.toBe(before);
      expect(JSON.parse(await readFile(inboxPath("team-1"), "utf8")).assignments).toBe(
        "not an array",
      );
    });

    test("does not take the other teams down with it", async () => {
      await inbox.enqueueAssignment({
        teamId: "team-2",
        assigneeAgentId: "agent-a",
        prompt: "healthy",
      });
      await writeFile(inboxPath("team-1"), "{ not json", "utf8");

      const reloaded = new TeamInbox(home, logger);
      await expect(reloaded.listAssignments("team-1")).rejects.toThrow(/unreadable/i);
      expect(await reloaded.listAssignments("team-2")).toHaveLength(1);
      await expect(
        reloaded.enqueueAssignment({
          teamId: "team-2",
          assigneeAgentId: "agent-b",
          prompt: "still works",
        }),
      ).resolves.toBeDefined();
    });
  });
});
