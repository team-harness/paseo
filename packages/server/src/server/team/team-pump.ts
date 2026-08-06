import type { Logger } from "pino";

import { buildCompletionDelivery } from "./team-prompts.js";
import type { AssignmentOutcome, TeamInbox } from "./team-inbox.js";

/**
 * What a turn the ledger is waiting on turned out to be.
 *
 * `running` is the state that must not be collapsed into `unknown`: a turn
 * still going is not a turn whose result was lost, and settling it early would
 * free the assignee's queue while it is still working.
 */
export type TurnLookup =
  | { kind: "settled"; outcome: Exclude<AssignmentOutcome, "unknown"> }
  | { kind: "running" }
  | { kind: "unknown" };

/**
 * What became of a dispatch.
 *
 * `accepted_untracked` is the one that is easy to miss: some prompts are taken
 * out of band and open no turn at all. Reading that as a refusal leaves the
 * assignment queued and re-sends it for the life of the team.
 */
export type DispatchResult =
  | { kind: "accepted"; turnId: string }
  | { kind: "accepted_untracked" }
  | { kind: "refused" };

export interface TeamPumpGateway {
  /**
   * DEC-10's rule: not archived and not mid-turn, live state first.
   *
   * Async because the fallback is storage: an agent the daemon has not loaded
   * is still a member, and answering "not wakeable" for it would strand its
   * work until something happened to load it.
   */
  isWakeable(agentId: string): Promise<boolean>;
  /**
   * Whether this agent's roster entry is anything other than `removed`.
   *
   * Work for someone who has left has to end somewhere. Leaving it queued
   * keeps the team sweeping forever and never tells the lead what became of a
   * task it assigned. Answers `true` when the team cannot be read — silence is
   * not a departure.
   */
  isStillOnTheTeam(input: { teamId: string; agentId: string }): Promise<boolean>;
  /** Submits an assignment without replacing anything in flight. */
  dispatchAssignment(input: {
    agentId: string;
    prompt: string;
    clientMessageId: string;
  }): Promise<DispatchResult>;
  /** Returns whether the lead accepted the delivery. */
  deliverCompletions(input: {
    agentId: string;
    deliveryId: string;
    body: string;
  }): Promise<boolean>;
  lookUpTurnOutcome(input: { agentId: string; turnId: string }): Promise<TurnLookup>;
}

/** A pass in flight, and whether a trigger has asked for another round. */
interface PumpRun {
  rerun: boolean;
  result: Promise<boolean>;
}

export interface TeamPumpOptions {
  inbox: TeamInbox;
  gateway: TeamPumpGateway;
  logger: Logger;
}

/**
 * Moves a team's ledger forward one pass at a time: settle what has finished,
 * dispatch what can go out, tell the lead what it does not know yet.
 *
 * Every pass is a fresh read of persisted state, so it does not matter whether
 * this pass was triggered by an event or by a sweep. That is deliberate —
 * events are how the pump usually learns something changed, but an event that
 * never arrives must not strand the work. A pass reports whether anything is
 * still outstanding, which is what a periodic sweep hangs off.
 */
/** Stands in for a turn id when the prompt was taken without opening one. */
const OUT_OF_BAND_TURN = "out-of-band";

export class TeamPump {
  private readonly inbox: TeamInbox;
  private readonly gateway: TeamPumpGateway;
  private readonly logger: Logger;
  private readonly runs = new Map<string, PumpRun>();

  constructor(options: TeamPumpOptions) {
    this.inbox = options.inbox;
    this.gateway = options.gateway;
    this.logger = options.logger.child({ module: "team", component: "team-pump" });
  }

  /**
   * Runs passes for this team until one has seen everything the callers asked
   * about, and reports whether work is still outstanding.
   *
   * One pass per team at a time, so two triggers never read the same ledger and
   * dispatch the same assignment twice. But a trigger that arrives during a
   * pass cannot simply join it: a pass reads the ledger at a point in time, and
   * whatever the trigger is about may have landed after that read. So it asks
   * for another round instead, and every caller comes back knowing a pass ran
   * that could have seen its work.
   */
  async run(input: { teamId: string; leadAgentId: string }): Promise<boolean> {
    const running = this.runs.get(input.teamId);
    if (running) {
      running.rerun = true;
      return await running.result;
    }

    const entry: PumpRun = { rerun: false, result: Promise.resolve(false) };
    entry.result = this.runUntilQuiet(input, entry).finally(() => {
      this.runs.delete(input.teamId);
    });
    this.runs.set(input.teamId, entry);
    return await entry.result;
  }

  private async runUntilQuiet(
    input: { teamId: string; leadAgentId: string },
    entry: PumpRun,
  ): Promise<boolean> {
    let outstanding = false;
    do {
      entry.rerun = false;
      outstanding = await this.runPass(input);
    } while (entry.rerun);
    return outstanding;
  }

  private async runPass(input: { teamId: string; leadAgentId: string }): Promise<boolean> {
    try {
      return await this.attemptPass(input);
    } catch (error) {
      // Any read of an unreadable ledger throws, wherever in the pass it
      // happens, and so does a write that would have overwritten one. The pass
      // is over either way; what matters is that the team is not reported as
      // quiet and dropped from the sweep.
      this.logger.error({ err: error, teamId: input.teamId }, "A team pump pass failed");
      return true;
    }
  }

  private async attemptPass(input: { teamId: string; leadAgentId: string }): Promise<boolean> {
    await this.settleDispatched(input.teamId);
    await this.dispatchQueued(input.teamId);
    await this.deliverToLead(input);

    return await this.hasOutstandingWork(input.teamId);
  }

  private async settleDispatched(teamId: string): Promise<void> {
    for (const assignment of await this.inbox.listAssignments(teamId)) {
      if (assignment.state !== "dispatched" || !assignment.acceptedTurnId) continue;

      const lookup = await this.gateway.lookUpTurnOutcome({
        agentId: assignment.assigneeAgentId,
        turnId: assignment.acceptedTurnId,
      });
      if (lookup.kind === "running") continue;

      // `unknown` covers a turn interrupted by a crash and one whose outcome
      // has rolled out of the history. Either way the assignment is over; the
      // lead is told the result is not known rather than never told at all.
      const outcome: AssignmentOutcome = lookup.kind === "settled" ? lookup.outcome : "unknown";
      await this.inbox.settle({ teamId, taskId: assignment.taskId, outcome });
    }
  }

  private async dispatchQueued(teamId: string): Promise<void> {
    for (const assigneeAgentId of await this.inbox.assigneesWithWork(teamId)) {
      if (!(await this.gateway.isStillOnTheTeam({ teamId, agentId: assigneeAgentId }))) {
        await this.cancelWorkFor(teamId, assigneeAgentId);
        continue;
      }
      if (!(await this.gateway.isWakeable(assigneeAgentId))) continue;

      const next = await this.inbox.nextDispatchable(teamId, assigneeAgentId);
      if (!next) continue;

      // Caught per assignee, because one that fails must not take the rest of
      // the pass with it: the assignees after it would be skipped and the lead
      // would not be told about work that has already settled.
      let dispatch: DispatchResult;
      try {
        dispatch = await this.gateway.dispatchAssignment({
          agentId: assigneeAgentId,
          prompt: next.prompt,
          clientMessageId: next.clientMessageId,
        });
      } catch (error) {
        this.logger.warn(
          { err: error, teamId, taskId: next.taskId, assigneeAgentId },
          "Assignment stays queued: dispatching it failed",
        );
        continue;
      }
      if (dispatch.kind === "refused") {
        // Recording a dispatch that did not happen would bind the assignment to
        // a turn that does not exist, and nothing would ever settle it.
        this.logger.info(
          { teamId, taskId: next.taskId, assigneeAgentId },
          "Assignment stays queued: the provider did not accept it",
        );
        continue;
      }
      if (dispatch.kind === "accepted_untracked") {
        // Taken, but with no turn to watch. Settling it as `unknown` tells the
        // lead the result cannot be known; leaving it queued would re-send the
        // same instruction every pass, forever.
        this.logger.info(
          { teamId, taskId: next.taskId, assigneeAgentId },
          "Assignment was accepted out of band, so its outcome cannot be tracked",
        );
        await this.inbox.markDispatched({ teamId, taskId: next.taskId, turnId: OUT_OF_BAND_TURN });
        await this.inbox.settle({ teamId, taskId: next.taskId, outcome: "unknown" });
        continue;
      }
      await this.inbox.markDispatched({ teamId, taskId: next.taskId, turnId: dispatch.turnId });
    }
  }

  /**
   * Settles everything still queued for someone who has left the team.
   *
   * A `dispatched` assignment is left alone — its turn is running or has
   * already ended, and the three-state rule is what closes it. This is only for
   * work that was never sent and now never will be.
   */
  private async cancelWorkFor(teamId: string, assigneeAgentId: string): Promise<void> {
    for (const assignment of await this.inbox.listAssignments(teamId)) {
      if (assignment.assigneeAgentId !== assigneeAgentId) continue;
      if (assignment.state !== "queued") continue;
      this.logger.info(
        { teamId, taskId: assignment.taskId, assigneeAgentId },
        "Cancelling an assignment for an agent that left the team",
      );
      await this.inbox.settle({ teamId, taskId: assignment.taskId, outcome: "canceled" });
    }
  }

  private async deliverToLead(input: { teamId: string; leadAgentId: string }): Promise<void> {
    if (!(await this.gateway.isWakeable(input.leadAgentId))) {
      // Whatever piled up in the meantime joins the next delivery.
      return;
    }
    const delivery = await this.inbox.prepareDelivery(input.teamId);
    if (!delivery) return;

    const accepted = await this.gateway.deliverCompletions({
      agentId: input.leadAgentId,
      deliveryId: delivery.deliveryId,
      body: buildCompletionDelivery(delivery.completions),
    });
    if (!accepted) {
      // Left on disk under the same id, so a resend is recognisable to a lead
      // that did receive it.
      return;
    }
    await this.inbox.acknowledgeDelivery({
      teamId: input.teamId,
      deliveryId: delivery.deliveryId,
    });
  }

  private async hasOutstandingWork(teamId: string): Promise<boolean> {
    const assignments = await this.inbox.listAssignments(teamId);
    if (assignments.some((assignment) => assignment.state !== "settled")) {
      return true;
    }
    // Read-only on purpose: asking `prepareDelivery` would close a batch around
    // what has settled so far, and a pass that only wanted to know whether to
    // come back would have split a delivery the lead should have got as one.
    return await this.inbox.hasNewsForLead(teamId);
  }
}
