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

describe("what a caller may conclude about a daemon's teams", () => {
  it("says nothing at all for a daemon that does not have them", () => {
    const state = selectTeamsLoadState({ supported: false, hydrated: true, teams: new Map() });

    // Not "no teams" — an older daemon has no answer to give, and every entry
    // point should be hidden rather than showing an empty list.
    expect(state.status).toBe("unsupported");
  });

  it("does not call it empty before a list has landed", () => {
    const state = selectTeamsLoadState({ supported: true, hydrated: false, teams: new Map() });

    // An empty state here tells the user something the client does not know.
    expect(state.status).toBe("connecting");
  });

  it("is empty only once a list has landed", () => {
    const state = selectTeamsLoadState({ supported: true, hydrated: true, teams: new Map() });

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

    const state = selectTeamsLoadState({ supported: true, hydrated: true, teams });

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

    const state = selectTeamsLoadState({ supported: true, hydrated: true, teams });

    expect(state.status === "loaded" && state.teams.map((row) => row.id)).toEqual(["new", "old"]);
  });
});
