import { describe, expect, it } from "vitest";
import { TeamTaskListSchema, TeamTaskSchema, toTeamTask } from "./task-types.js";

/** What the daemon's ledger holds, extra fields and all. */
const assignment = {
  taskId: "task-1",
  assigneeAgentId: "agent-impl",
  prompt: "Add a disk usage indicator",
  clientMessageId: "team-team-1-task-task-1",
  state: "dispatched" as const,
  acceptedTurnId: "turn-9",
  outcome: null,
  completionEventId: "evt-secret",
  createdAt: "2026-08-06T10:00:00.000Z",
  dispatchedAt: "2026-08-06T10:00:04.000Z",
  settledAt: null,
};

describe("team task", () => {
  it("round-trips a queued task that has never been dispatched", () => {
    const queued = {
      taskId: "task-2",
      assigneeAgentId: "agent-impl",
      prompt: "Write the changelog",
      state: "queued" as const,
      acceptedTurnId: null,
      outcome: null,
      createdAt: "2026-08-06T10:00:00.000Z",
      dispatchedAt: null,
      settledAt: null,
    };
    expect(TeamTaskSchema.parse(queued)).toEqual(queued);
  });

  it("round-trips every outcome a settled task can carry", () => {
    for (const outcome of ["completed", "failed", "canceled", "unknown"] as const) {
      const settled = {
        ...toTeamTask(assignment),
        state: "settled" as const,
        outcome,
        settledAt: "2026-08-06T10:04:00.000Z",
      };
      expect(TeamTaskSchema.parse(settled)).toEqual(settled);
    }
  });

  it("rejects an unknown state", () => {
    expect(TeamTaskSchema.safeParse({ ...toTeamTask(assignment), state: "pending" }).success).toBe(
      false,
    );
  });
});

describe("team task projection", () => {
  // The daemon's own handles on a prompt and on a delivery. Publishing either
  // would tell a client about plumbing it can neither use nor act on.
  const SERVER_ONLY_FIELDS = new Set(["clientMessageId", "completionEventId"]);

  it("omits every server-only field", () => {
    const wireFields = Object.keys(TeamTaskSchema.shape);
    expect(wireFields.filter((field) => SERVER_ONLY_FIELDS.has(field))).toEqual([]);
  });

  it("projects a ledger entry by dropping server-only fields", () => {
    expect(toTeamTask(assignment)).toEqual({
      taskId: "task-1",
      assigneeAgentId: "agent-impl",
      prompt: "Add a disk usage indicator",
      state: "dispatched",
      acceptedTurnId: "turn-9",
      outcome: null,
      createdAt: "2026-08-06T10:00:00.000Z",
      dispatchedAt: "2026-08-06T10:00:04.000Z",
      settledAt: null,
    });
    expect(JSON.stringify(toTeamTask(assignment))).not.toContain("secret");
  });
});

describe("team task list", () => {
  it("carries the ledger revision the list was read at", () => {
    const list = { teamId: "team-1", revision: 7, tasks: [toTeamTask(assignment)] };
    expect(TeamTaskListSchema.parse(list)).toEqual(list);
  });

  it("round-trips an empty ledger", () => {
    const list = { teamId: "team-1", revision: 0, tasks: [] };
    expect(TeamTaskListSchema.parse(list)).toEqual(list);
  });
});
