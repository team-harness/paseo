import { describe, expect, it } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { applyTeamUpdate, isLiveTeam, replaceTeams } from "./team-replica";

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

describe("folding a team update into what is held", () => {
  it("takes a newer revision", () => {
    const held = new Map([["team-1", team({ revision: 1 })]]);

    const next = applyTeamUpdate(held, team({ revision: 2, name: "Renamed" }));

    expect(next.get("team-1")?.name).toBe("Renamed");
  });

  it("drops one that is not newer", () => {
    const held = new Map([["team-1", team({ revision: 5, name: "Current" })]]);

    // Broadcasts and list responses race: a client can be told about a change
    // and then read a list assembled before it.
    const older = applyTeamUpdate(held, team({ revision: 4, name: "Stale" }));
    const same = applyTeamUpdate(held, team({ revision: 5, name: "Also stale" }));

    expect(older.get("team-1")?.name).toBe("Current");
    expect(same).toBe(held);
  });

  it("adds a team it has never seen", () => {
    const next = applyTeamUpdate(new Map(), team({ id: "team-2" }));

    expect([...next.keys()]).toEqual(["team-2"]);
  });

  it("does not mutate what it was given", () => {
    const held = new Map([["team-1", team({ revision: 1 })]]);

    applyTeamUpdate(held, team({ revision: 2 }));

    expect(held.get("team-1")?.revision).toBe(1);
  });
});

describe("replacing the set from a list response", () => {
  it("drops a team the list no longer names", () => {
    // Archived while the client was away. A merge would keep showing it for as
    // long as the app stayed open.
    const next = replaceTeams([team({ id: "team-2" })]);

    expect([...next.keys()]).toEqual(["team-2"]);
  });

  it("keeps a team that arrived while the list was in flight", () => {
    const created = team({ id: "team-3", revision: 1 });

    // The list was assembled before this team existed, so it names only the
    // older one. Dropping the replay would leave the client blind to a team it
    // has already been told about.
    const next = replaceTeams([team({ id: "team-1" })], [created]);

    expect([...next.keys()].toSorted()).toEqual(["team-1", "team-3"]);
  });

  it("lets the list win over a replayed update that is older", () => {
    const next = replaceTeams(
      [team({ revision: 7, name: "From the list" })],
      [team({ revision: 6, name: "From the broadcast" })],
    );

    expect(next.get("team-1")?.name).toBe("From the list");
  });

  it("lets a replayed update win over the list when it is newer", () => {
    const next = replaceTeams(
      [team({ revision: 7, name: "From the list" })],
      [team({ revision: 8, name: "From the broadcast" })],
    );

    expect(next.get("team-1")?.name).toBe("From the broadcast");
  });

  it("applies replayed updates in order", () => {
    const next = replaceTeams(
      [],
      [team({ revision: 2, name: "Second" }), team({ revision: 3, name: "Third" })],
    );

    expect(next.get("team-1")?.name).toBe("Third");
  });
});

describe("deciding what belongs in a list of live teams", () => {
  it("keeps one that is still being archived", () => {
    // The user asked for the archive and it is under way. Hiding it before it
    // finishes reads as the request having been lost.
    expect(isLiveTeam(team({ lifecycle: "archiving" }))).toBe(true);
    expect(isLiveTeam(team({ lifecycle: "creating" }))).toBe(true);
  });

  it("drops one that is over", () => {
    expect(isLiveTeam(team({ lifecycle: "archived" }))).toBe(false);
    expect(isLiveTeam(team({ lifecycle: "failed" }))).toBe(false);
  });
});
