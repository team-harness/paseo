import { describe, expect, it } from "vitest";

import type { TeamTask, TeamTaskList } from "@getpaseo/protocol/team/task-types";

import { selectTeamTasksLoadState } from "./team-tasks-load-state";

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

function ledger(tasks: TeamTask[]): TeamTaskList {
  return { teamId: "team-1", revision: 1, tasks };
}

describe("deciding what a team's task tab may say", () => {
  it("hides itself on a daemon that cannot serve the ledger", () => {
    expect(selectTeamTasksLoadState({ supported: false, error: null, ledger: null })).toEqual({
      status: "unsupported",
    });
  });

  it("does not call an unread ledger empty", () => {
    // Nobody has asked yet. "No tasks" would be telling the user something the
    // client does not know.
    expect(selectTeamTasksLoadState({ supported: true, error: null, ledger: null })).toEqual({
      status: "loading",
    });
  });

  it("says a team with no tasks has none", () => {
    const state = selectTeamTasksLoadState({ supported: true, error: null, ledger: ledger([]) });

    expect(state).toEqual({ status: "loaded", tasks: [] });
  });

  it("keeps showing what is held when a read fails", () => {
    const state = selectTeamTasksLoadState({
      supported: true,
      error: "Team not found: team-1",
      ledger: ledger([task()]),
    });

    expect(state.status).toBe("failed");
    expect(state.status === "failed" ? state.tasks : []).toHaveLength(1);
  });

  it("puts the newest task first", () => {
    const state = selectTeamTasksLoadState({
      supported: true,
      error: null,
      ledger: ledger([
        task({ taskId: "older", createdAt: "2026-08-06T10:00:00.000Z" }),
        task({ taskId: "newer", createdAt: "2026-08-06T11:00:00.000Z" }),
      ]),
    });

    expect(state.status === "loaded" ? state.tasks.map((entry) => entry.taskId) : []).toEqual([
      "newer",
      "older",
    ]);
  });

  it("does not reorder the ledger it was handed", () => {
    const held = ledger([
      task({ taskId: "older", createdAt: "2026-08-06T10:00:00.000Z" }),
      task({ taskId: "newer", createdAt: "2026-08-06T11:00:00.000Z" }),
    ]);

    selectTeamTasksLoadState({ supported: true, error: null, ledger: held });

    expect(held.tasks.map((entry) => entry.taskId)).toEqual(["older", "newer"]);
  });
});
