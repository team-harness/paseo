import { describe, expect, test } from "vitest";

import { lookUpTurnOutcome, type TurnFactSource } from "./team-turn-lookup.js";

function source(overrides: Partial<TurnFactSource> = {}): TurnFactSource {
  return {
    whenTurnStateSettled: async () => {},
    getTurnOutcome: async () => null,
    getActiveTurnId: async () => null,
    ...overrides,
  };
}

describe("deciding what happened to a turn", () => {
  test("reports the outcome a finished turn recorded", async () => {
    const lookup = await lookUpTurnOutcome(
      source({
        getTurnOutcome: async () => ({ turnId: "turn-1", outcome: "completed" as const }),
      }),
      { agentId: "agent-1", turnId: "turn-1" },
    );

    expect(lookup).toEqual({ kind: "settled", outcome: "completed" });
  });

  test("leaves a turn that is still marked active alone", async () => {
    const lookup = await lookUpTurnOutcome(source({ getActiveTurnId: async () => "turn-1" }), {
      agentId: "agent-1",
      turnId: "turn-1",
    });

    // Settling here would free the assignee's queue while it is still working.
    expect(lookup).toEqual({ kind: "running" });
  });

  test("calls a turn with neither an outcome nor a marker unknown", async () => {
    const lookup = await lookUpTurnOutcome(source(), { agentId: "agent-1", turnId: "turn-1" });

    // It died with a daemon, or its result rolled out of the bounded history.
    // Either way it is over, and the lead is told the result is not known
    // rather than never told at all.
    expect(lookup).toEqual({ kind: "unknown" });
  });

  test("waits for the turn's own writes before reading the record", async () => {
    const order: string[] = [];
    const lookup = await lookUpTurnOutcome(
      {
        whenTurnStateSettled: async () => {
          order.push("barrier");
        },
        getTurnOutcome: async () => {
          order.push("read");
          return null;
        },
        getActiveTurnId: async () => null,
      },
      { agentId: "agent-1", turnId: "turn-1" },
    );

    // A turn accepted a moment ago whose marker has not landed looks exactly
    // like a turn that died. Reading first would settle it as `unknown` and
    // tell the lead its member failed while the member is working on it.
    expect(order).toEqual(["barrier", "read"]);
    expect(lookup).toEqual({ kind: "unknown" });
  });

  test("does not settle a turn whose state could not be written", async () => {
    const lookup = await lookUpTurnOutcome(
      source({
        whenTurnStateSettled: async () => {
          throw new Error("the marker never landed");
        },
      }),
      { agentId: "agent-1", turnId: "turn-1" },
    );

    // The record cannot be trusted, so the assignment stays where it is and the
    // next pass asks again — rather than reporting a failure that never happened.
    expect(lookup).toEqual({ kind: "running" });
  });

  test("ignores an outcome recorded for a different turn", async () => {
    const lookup = await lookUpTurnOutcome(
      source({
        getTurnOutcome: async () => null,
        getActiveTurnId: async () => "turn-2",
      }),
      { agentId: "agent-1", turnId: "turn-1" },
    );

    // The agent is busy with something else. This assignment's turn is over.
    expect(lookup).toEqual({ kind: "unknown" });
  });
});
