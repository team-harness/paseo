import type { Logger } from "pino";

/**
 * How long the sweep waits before looking again.
 *
 * The pump is driven by events; this is only the floor under them. Long enough
 * that an idle-ish team costs nothing, short enough that a dropped event is a
 * delay rather than a stall.
 */
export const TEAM_SWEEP_INTERVAL_MS = 60_000;

export interface TeamSweepTarget {
  id: string;
  leadAgentId: string;
}

export interface TeamSchedulerOptions {
  /** Every team that could still have work; read fresh at startup. */
  listActiveTeams(): Promise<ReadonlyArray<TeamSweepTarget>>;
  /** One pump pass. Returns whether the team still has outstanding work. */
  runPass(input: { teamId: string; leadAgentId: string }): Promise<boolean>;
  logger: Logger;
}

/**
 * Keeps a team's pump running until its ledger is empty.
 *
 * Events are how the pump normally learns something changed. This is what
 * happens when one does not arrive: as long as a pass reports outstanding work,
 * another is scheduled, so a lost event costs a minute rather than requiring a
 * restart. A team with nothing pending holds no timer at all.
 */
export class TeamScheduler {
  private readonly options: TeamSchedulerOptions;
  private readonly logger: Logger;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(options: TeamSchedulerOptions) {
    this.options = options;
    this.logger = options.logger.child({ module: "team", component: "team-scheduler" });
  }

  /**
   * Sweeps every team once.
   *
   * Whatever was in flight when the daemon stopped is picked up here rather
   * than waiting for an event that has already happened.
   */
  async start(): Promise<void> {
    if (this.stopped) return;
    const teams = await this.options.listActiveTeams();
    await Promise.all(
      teams.map((team) => this.kick({ teamId: team.id, leadAgentId: team.leadAgentId })),
    );
  }

  /**
   * Runs a pass now, and keeps sweeping while the team still has work.
   *
   * Coalescing triggers is the pump's job, not this one's: it owns the ledger
   * and knows that a pass which started before a trigger cannot be assumed to
   * have seen it. Here the only question is whether to come back.
   */
  async kick(input: { teamId: string; leadAgentId: string }): Promise<void> {
    if (this.stopped) return;

    let outstanding: boolean;
    try {
      outstanding = await this.options.runPass(input);
    } catch (error) {
      // A pass that blew up says nothing about whether work remains. Assuming
      // it drained would strand that work until an unrelated event woke the
      // team, so the sweep keeps its appointment.
      this.logger.warn({ err: error, teamId: input.teamId }, "Team pump pass failed");
      outstanding = true;
    }

    if (!outstanding || this.stopped) return;
    this.schedule(input);
  }

  private schedule(input: { teamId: string; leadAgentId: string }): void {
    const existing = this.timers.get(input.teamId);
    if (existing) return;

    const timer = setTimeout(() => {
      this.timers.delete(input.teamId);
      void this.kick(input);
    }, TEAM_SWEEP_INTERVAL_MS);
    // The daemon should not be held open by a team waiting to be swept.
    timer.unref?.();
    this.timers.set(input.teamId, timer);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
