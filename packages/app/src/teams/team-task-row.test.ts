import { describe, expect, it } from "vitest";

import type { TeamTask } from "@getpaseo/protocol/team/task-types";

import { describeTeamTaskRow } from "./team-task-row";

function task(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    taskId: "task-1",
    assigneeAgentId: "agent-1",
    prompt: "Measure the cache directory",
    state: "queued",
    acceptedTurnId: null,
    outcome: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    dispatchedAt: null,
    settledAt: null,
    ...overrides,
  };
}

describe("describing one row of the task tab", () => {
  it("gives a queued task no elapsed time", () => {
    // It is waiting on the assignee to be wakeable. A clock on that would be
    // counting something the task has not started.
    expect(describeTeamTaskRow(task())).toEqual({
      statusKey: "teams.tasks.state.queued",
      tone: "muted",
      durationMs: null,
      startedAt: null,
    });
  });

  it("gives a working task a start rather than a duration", () => {
    const view = describeTeamTaskRow(
      task({ state: "dispatched", dispatchedAt: "2026-08-06T10:01:00.000Z" }),
    );

    expect(view.statusKey).toBe("teams.tasks.state.dispatched");
    expect(view.durationMs).toBeNull();
    expect(view.startedAt?.toISOString()).toBe("2026-08-06T10:01:00.000Z");
  });

  it("measures a settled task from pickup to finish", () => {
    const view = describeTeamTaskRow(
      task({
        state: "settled",
        outcome: "completed",
        dispatchedAt: "2026-08-06T10:01:00.000Z",
        settledAt: "2026-08-06T10:03:30.000Z",
      }),
    );

    expect(view.statusKey).toBe("teams.tasks.outcome.completed");
    expect(view.tone).toBe("success");
    expect(view.durationMs).toBe(150_000);
  });

  it("calls a failed task out", () => {
    const view = describeTeamTaskRow(task({ state: "settled", outcome: "failed" }));

    expect(view.statusKey).toBe("teams.tasks.outcome.failed");
    expect(view.tone).toBe("error");
  });

  it("does not paint an unknown outcome as a success", () => {
    // The turn ended and the daemon could not tell how. Green would claim
    // something nobody knows.
    const view = describeTeamTaskRow(task({ state: "settled", outcome: null }));

    expect(view.statusKey).toBe("teams.tasks.outcome.unknown");
    expect(view.tone).toBe("muted");
  });

  it("keeps a cancelled task quiet", () => {
    expect(describeTeamTaskRow(task({ state: "settled", outcome: "canceled" })).tone).toBe("muted");
  });

  it("reports no duration for a task that settled without ever being dispatched", () => {
    // Cancelled out of the queue. Zero would read as one that finished
    // instantly.
    const view = describeTeamTaskRow(
      task({ state: "settled", outcome: "canceled", settledAt: "2026-08-06T10:03:00.000Z" }),
    );

    expect(view.durationMs).toBeNull();
  });

  it("does not turn an unparseable timestamp into a date", () => {
    const view = describeTeamTaskRow(task({ state: "dispatched", dispatchedAt: "not a date" }));

    expect(view.startedAt).toBeNull();
  });
});
