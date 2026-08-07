import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { TeamScheduler, TEAM_SWEEP_INTERVAL_MS } from "./team-scheduler.js";

const logger = createTestLogger();

describe("the fallback sweep", () => {
  /** Teams the scheduler is told about, and whether a pass still finds work. */
  let outstanding: Map<string, number>;
  let passes: string[];
  let scheduler: TeamScheduler;

  function build(options?: { listTeams?: () => Promise<Array<{ id: string }>> }): TeamScheduler {
    return new TeamScheduler({
      logger,
      listActiveTeams:
        options?.listTeams ??
        (async () => [...outstanding.keys()].map((id) => ({ id, leadAgentId: `${id}-lead` }))),
      runPass: async (input) => {
        passes.push(input.teamId);
        const left = (outstanding.get(input.teamId) ?? 0) - 1;
        outstanding.set(input.teamId, left);
        return left > 0;
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    outstanding = new Map();
    passes = [];
  });

  afterEach(() => {
    scheduler?.stop();
    vi.useRealTimers();
  });

  test("comes back while a team still has outstanding work", async () => {
    outstanding.set("team-1", 3);
    scheduler = build();

    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    expect(passes).toEqual(["team-1"]);

    await vi.advanceTimersByTimeAsync(TEAM_SWEEP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(TEAM_SWEEP_INTERVAL_MS);

    // Three passes, then nothing left to do. The sweep is what makes a dropped
    // event survivable without restarting the daemon.
    expect(passes).toEqual(["team-1", "team-1", "team-1"]);
  });

  test("stops sweeping once nothing is outstanding", async () => {
    outstanding.set("team-1", 1);
    scheduler = build();

    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    await vi.advanceTimersByTimeAsync(TEAM_SWEEP_INTERVAL_MS * 5);

    // A team with an empty ledger costs nothing. Idle daemons do not tick.
    expect(passes).toEqual(["team-1"]);
  });

  test("keeps one timer per team however often it is kicked", async () => {
    outstanding.set("team-1", 10);
    scheduler = build();

    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    const before = passes.length;

    await vi.advanceTimersByTimeAsync(TEAM_SWEEP_INTERVAL_MS);

    // One sweep fired, not three. Stacked timers would multiply every kick.
    expect(passes.length).toBe(before + 1);
  });

  test("runs again for a trigger that arrived while a pass was running", async () => {
    let releasePass = () => {};
    const passStarted = new Promise<void>((resolve) => {
      scheduler = new TeamScheduler({
        logger,
        listActiveTeams: async () => [],
        runPass: async (input) => {
          passes.push(input.teamId);
          if (passes.length === 1) {
            resolve();
            await new Promise<void>((release) => {
              releasePass = release;
            });
          }
          // The work this pass reported on is done; the second trigger is about
          // something it never saw.
          return false;
        },
      });
    });

    const first = scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    await passStarted;
    const second = scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    releasePass();
    await Promise.all([first, second]);

    // A pass reads the ledger at a point in time. Work recorded after that read
    // is invisible to it, so a trigger it did not see has to produce its own
    // pass — otherwise the assignment sits queued with nothing coming for it.
    expect(passes).toEqual(["team-1", "team-1"]);
  });

  test("sweeps every team at startup", async () => {
    outstanding.set("team-1", 1);
    outstanding.set("team-2", 1);
    scheduler = build();

    await scheduler.start();

    // Whatever was in flight when the daemon died is picked up without waiting
    // for an event that already happened.
    expect(passes.toSorted()).toEqual(["team-1", "team-2"]);
  });

  test("keeps sweeping the teams it can reach when one pass fails", async () => {
    outstanding.set("team-1", 2);
    scheduler = new TeamScheduler({
      logger,
      listActiveTeams: async () => [{ id: "team-1", leadAgentId: "lead-1" }],
      runPass: async (input) => {
        passes.push(input.teamId);
        if (passes.length === 1) throw new Error("storage blipped");
        return false;
      },
    });

    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });
    await vi.advanceTimersByTimeAsync(TEAM_SWEEP_INTERVAL_MS);

    // A failed pass cannot be read as "nothing left" — that would strand the
    // work until something unrelated happened to wake the team.
    expect(passes).toEqual(["team-1", "team-1"]);
  });

  test("stops cleanly", async () => {
    outstanding.set("team-1", 10);
    scheduler = build();
    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(TEAM_SWEEP_INTERVAL_MS * 5);

    expect(passes).toEqual(["team-1"]);
  });

  test("ignores a kick after it has stopped", async () => {
    scheduler = build();
    scheduler.stop();

    await scheduler.kick({ teamId: "team-1", leadAgentId: "lead-1" });

    // Shutdown is a barrier: a late event must not start work the daemon is
    // no longer in a position to finish.
    expect(passes).toEqual([]);
  });
});
