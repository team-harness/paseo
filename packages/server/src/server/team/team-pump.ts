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

export interface TeamPumpGateway {
  /** DEC-10's rule: not archived and not mid-turn, live state first. */
  isWakeable(agentId: string): boolean;
  /**
   * Submits an assignment without replacing anything in flight. Returns the
   * turn it was accepted as, or null when the provider would not take it.
   */
  dispatchAssignment(input: {
    agentId: string;
    prompt: string;
    clientMessageId: string;
  }): Promise<string | null>;
  /** Returns whether the lead accepted the delivery. */
  deliverCompletions(input: {
    agentId: string;
    deliveryId: string;
    body: string;
  }): Promise<boolean>;
  lookUpTurnOutcome(input: { agentId: string; turnId: string }): TurnLookup;
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
export class TeamPump {
  private readonly inbox: TeamInbox;
  private readonly gateway: TeamPumpGateway;
  private readonly logger: Logger;
  private readonly runs = new Map<string, Promise<boolean>>();

  constructor(options: TeamPumpOptions) {
    this.inbox = options.inbox;
    this.gateway = options.gateway;
    this.logger = options.logger.child({ module: "team", component: "team-pump" });
  }

  /** Returns whether the team still has work the pump should come back for. */
  async run(input: { teamId: string; leadAgentId: string }): Promise<boolean> {
    // One pass per team. A second caller joins the pass already running rather
    // than reading the same ledger and dispatching the same assignment twice.
    const running = this.runs.get(input.teamId);
    if (running) {
      await running;
      // That pass may have looked at everything before this caller's trigger
      // existed, and nothing here can tell whether it did. So a joiner always
      // gets "come back": a wasted sweep costs nothing, while a scheduler
      // dropping the team on a stale "nothing left" strands the work until
      // some unrelated event happens to wake it.
      return true;
    }
    const pass = this.runPass(input).finally(() => {
      this.runs.delete(input.teamId);
    });
    this.runs.set(input.teamId, pass);
    return await pass;
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

      const lookup = this.gateway.lookUpTurnOutcome({
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
      if (!this.gateway.isWakeable(assigneeAgentId)) continue;

      const next = await this.inbox.nextDispatchable(teamId, assigneeAgentId);
      if (!next) continue;

      const turnId = await this.gateway.dispatchAssignment({
        agentId: assigneeAgentId,
        prompt: next.prompt,
        clientMessageId: next.clientMessageId,
      });
      if (turnId === null) {
        // Recording a dispatch that did not happen would bind the assignment to
        // a turn that does not exist, and nothing would ever settle it.
        this.logger.info(
          { teamId, taskId: next.taskId, assigneeAgentId },
          "Assignment stays queued: the provider did not accept it",
        );
        continue;
      }
      await this.inbox.markDispatched({ teamId, taskId: next.taskId, turnId });
    }
  }

  private async deliverToLead(input: { teamId: string; leadAgentId: string }): Promise<void> {
    if (!this.gateway.isWakeable(input.leadAgentId)) {
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
