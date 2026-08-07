import { describe, expect, it } from "vitest";

import type { TeamTask, TeamTaskList } from "@getpaseo/protocol/team/task-types";

import { applyTeamTasks } from "./team-task-replica";

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

function ledger(overrides: Partial<TeamTaskList> = {}): TeamTaskList {
  return { teamId: "team-1", revision: 1, tasks: [task()], ...overrides };
}

describe("folding a task ledger into what is held", () => {
  it("takes a newer revision", () => {
    const held = new Map([["team-1", ledger({ revision: 1 })]]);

    const next = applyTeamTasks(held, ledger({ revision: 2, tasks: [task({ state: "settled" })] }));

    expect(next.get("team-1")?.tasks[0]?.state).toBe("settled");
  });

  it("drops one that is not newer", () => {
    const held = new Map([["team-1", ledger({ revision: 5 })]]);

    // The broadcast and the list response race, and the reply can describe a
    // ledger older than the broadcast that overtook it.
    const older = applyTeamTasks(held, ledger({ revision: 4, tasks: [] }));
    const same = applyTeamTasks(held, ledger({ revision: 5, tasks: [] }));

    expect(older.get("team-1")?.tasks).toHaveLength(1);
    expect(same).toBe(held);
  });

  it("keeps every team's ledger apart", () => {
    const held = new Map([["team-1", ledger({ revision: 9 })]]);

    // Revision is per team. A team on revision 1 must not be judged against a
    // busier team's count.
    const next = applyTeamTasks(held, ledger({ teamId: "team-2", revision: 1 }));

    expect([...next.keys()].toSorted()).toEqual(["team-1", "team-2"]);
  });

  it("takes an emptied ledger when the revision says so", () => {
    const held = new Map([["team-1", ledger({ revision: 1 })]]);

    const next = applyTeamTasks(held, ledger({ revision: 2, tasks: [] }));

    expect(next.get("team-1")?.tasks).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const held = new Map([["team-1", ledger({ revision: 1 })]]);

    applyTeamTasks(held, ledger({ revision: 2 }));

    expect(held.get("team-1")?.revision).toBe(1);
  });
});
