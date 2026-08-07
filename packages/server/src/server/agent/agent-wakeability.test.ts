import { describe, expect, test } from "vitest";

import { isAgentWakeable } from "./agent-wakeability.js";

type Record = Parameters<typeof isAgentWakeable>[0]["record"];

function stored(overrides: Partial<NonNullable<Record>> = {}): Record {
  return {
    archivedAt: null,
    activeTurn: null,
    lastStatus: "idle",
    ...overrides,
  } as Record;
}

describe("deciding whether an agent can be woken", () => {
  test("goes by live state when there is any", () => {
    expect(isAgentWakeable({ live: { lifecycle: "idle" }, record: stored() })).toBe(true);
    expect(isAgentWakeable({ live: { lifecycle: "running" }, record: stored() })).toBe(false);
    // Busy too: a prompt sent here races the agent's own first turn.
    expect(isAgentWakeable({ live: { lifecycle: "initializing" }, record: stored() })).toBe(false);
  });

  test("refuses an archived agent whatever its live state says", () => {
    expect(
      isAgentWakeable({
        live: { lifecycle: "idle" },
        record: stored({ archivedAt: "2026-08-06T10:00:00.000Z" }),
      }),
    ).toBe(false);
  });

  test("goes by the record when the agent is not loaded", () => {
    expect(isAgentWakeable({ live: null, record: stored({ lastStatus: "idle" }) })).toBe(true);
    expect(isAgentWakeable({ live: null, record: stored({ lastStatus: "closed" }) })).toBe(true);
    expect(isAgentWakeable({ live: null, record: stored({ lastStatus: "error" }) })).toBe(true);
  });

  test("leaves an agent that a live turn belongs to alone", () => {
    expect(
      isAgentWakeable({
        live: null,
        record: stored({
          lastStatus: "running",
          activeTurn: { turnId: "turn-1", startedAt: "2026-08-06T10:00:00.000Z", daemonRunId: "r" },
        }),
      }),
    ).toBe(false);
  });

  test("rescues a record left saying running by a daemon that died", () => {
    // Startup clears the marker for turns that belonged to an earlier run. What
    // is left is a status nobody updated, and reading it literally would make
    // the agent unreachable for good.
    expect(
      isAgentWakeable({ live: null, record: stored({ lastStatus: "running", activeTurn: null }) }),
    ).toBe(true);
  });

  test("does not read a leftover marker as a turn in flight", () => {
    // Closing an agent mid-turn clears the marker in memory and not on disk, so
    // its presence alone proves nothing. `lastStatus` is what says the agent is
    // free.
    expect(
      isAgentWakeable({
        live: null,
        record: stored({
          lastStatus: "closed",
          activeTurn: { turnId: "turn-1", startedAt: "2026-08-06T10:00:00.000Z", daemonRunId: "r" },
        }),
      }),
    ).toBe(true);
  });

  test("treats an agent it has never heard of as reachable", () => {
    expect(isAgentWakeable({ live: null, record: null })).toBe(true);
  });
});
