import { describe, expect, it } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { selectTeamsLoadState } from "./teams-load-state";

function team(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    members: [],
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof selectTeamsLoadState>[0]> = {}) {
  return {
    supported: true,
    online: true,
    hydrated: true,
    error: null,
    teams: new Map(),
    ...overrides,
  };
}

describe("what a caller may conclude about a daemon's teams", () => {
  it("says nothing at all for a daemon that does not have them", () => {
    const state = selectTeamsLoadState(input({ supported: false }));

    // Not "no teams" — an older daemon has no answer to give, and every entry
    // point should be hidden rather than showing an empty list.
    expect(state.status).toBe("unsupported");
  });

  it("does not call it empty before a list has landed", () => {
    // An empty state here tells the user something the client does not know.
    expect(selectTeamsLoadState(input({ hydrated: false, online: true })).status).toBe("loading");
    // And waiting for a socket is not the same as waiting for a reply.
    expect(selectTeamsLoadState(input({ hydrated: false, online: false })).status).toBe(
      "connecting",
    );
  });

  it("hides teams on an older daemon whatever else is true", () => {
    // The order of these two guards is the whole behaviour: an older daemon is
    // never hydrated, so checking hydration first would show it a spinner
    // forever instead of hiding the feature.
    expect(selectTeamsLoadState(input({ supported: false, hydrated: false })).status).toBe(
      "unsupported",
    );
  });

  it("keeps showing what it holds when the last read failed", () => {
    const teams = new Map([["a", team({ id: "a" })]]);

    const state = selectTeamsLoadState(input({ teams, error: "could not read" }));

    // A failed read is not an empty list, and what was held is still the best
    // answer there is.
    expect(state).toEqual({
      status: "failed",
      message: "could not read",
      teams: [team({ id: "a" })],
    });
  });

  it("is empty only once a list has landed", () => {
    const state = selectTeamsLoadState(input({}));

    expect(state).toEqual({ status: "loaded", teams: [] });
  });

  it("leaves out teams that are over", () => {
    const teams = new Map([
      ["a", team({ id: "a", lifecycle: "active" })],
      ["b", team({ id: "b", lifecycle: "archived" })],
      ["c", team({ id: "c", lifecycle: "failed" })],
      // Still being archived, and the user asked for it. Hiding it before it
      // finishes reads as the request having been lost.
      ["d", team({ id: "d", lifecycle: "archiving" })],
    ]);

    const state = selectTeamsLoadState(input({ teams }));

    expect(state.status === "loaded" && state.teams.map((row) => row.id).toSorted()).toEqual([
      "a",
      "d",
    ]);
  });

  it("puts the newest first", () => {
    const teams = new Map([
      ["old", team({ id: "old", createdAt: "2026-08-01T10:00:00.000Z" })],
      ["new", team({ id: "new", createdAt: "2026-08-06T10:00:00.000Z" })],
    ]);

    const state = selectTeamsLoadState(input({ teams }));

    expect(state.status === "loaded" && state.teams.map((row) => row.id)).toEqual(["new", "old"]);
  });
});
