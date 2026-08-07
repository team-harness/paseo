import { describe, expect, test } from "vitest";

import {
  resolveRoomMentionTokens,
  type RoomMentionLookups,
  type RoomRosterEntry,
} from "./room-mention-roster.js";

const TEAM_ROOM = "room-team-1";

function seat(entry: Partial<RoomRosterEntry> & { agentId: string }): RoomRosterEntry {
  return { role: "member", state: "active", ...entry };
}

function roster(...entries: Array<Partial<RoomRosterEntry> & { agentId: string }>) {
  return entries.map(seat);
}

function lookups(input: {
  owner?: { kind: "team"; id: string } | null;
  members?: RoomRosterEntry[] | null;
  humans?: string[];
}): RoomMentionLookups {
  return {
    getRoomOwner: async () => input.owner ?? null,
    getTeamRoster: async () => input.members ?? null,
    listHumanAuthorIds: async () => input.humans ?? [],
  };
}

/** The team room case, with a lead and two members holding distinct roles. */
function teamRoom(overrides: { humans?: string[] } = {}): RoomMentionLookups {
  return lookups({
    owner: { kind: "team", id: "team-1" },
    members: roster(
      { agentId: "lead-1", role: "lead" },
      { agentId: "docs-1", role: "docs" },
      { agentId: "code-1", role: "Code-Reviewer" },
    ),
    ...overrides,
  });
}

async function resolve(tokens: string[], deps: RoomMentionLookups): Promise<string[]> {
  return resolveRoomMentionTokens({ roomId: TEAM_ROOM, tokens, lookups: deps });
}

describe("room mention roster", () => {
  test("resolves a role to the agent holding it", async () => {
    expect(await resolve(["docs"], teamRoom())).toEqual(["docs-1"]);
  });

  test("matches a role without regard to case", async () => {
    expect(await resolve(["code-reviewer"], teamRoom())).toEqual(["code-1"]);
  });

  test("leaves a bare agent id alone", async () => {
    expect(await resolve(["docs-1"], teamRoom())).toEqual(["docs-1"]);
  });

  test("leaves a token that matches no role alone", async () => {
    expect(await resolve(["someone-else"], teamRoom())).toEqual(["someone-else"]);
  });

  test("passes @everyone through untouched", async () => {
    expect(await resolve(["everyone", "docs"], teamRoom())).toEqual(["everyone", "docs-1"]);
  });

  test("collapses a role and its agent id into one target", async () => {
    expect(await resolve(["docs", "docs-1"], teamRoom())).toEqual(["docs-1"]);
  });

  test("resolves no roles in a room no team owns", async () => {
    expect(await resolve(["docs"], lookups({ owner: null }))).toEqual(["docs"]);
  });

  test("resolves no roles when the team behind the room is gone", async () => {
    const deps = lookups({ owner: { kind: "team", id: "team-1" }, members: null });
    expect(await resolve(["docs"], deps)).toEqual(["docs"]);
  });

  test("ignores a seat that is no longer active", async () => {
    const deps = lookups({
      owner: { kind: "team", id: "team-1" },
      members: roster(
        { agentId: "docs-old", role: "docs", state: "removed" },
        { agentId: "docs-archived", role: "writer", state: "archived" },
      ),
    });

    expect(await resolve(["docs", "writer"], deps)).toEqual(["docs", "writer"]);
  });

  test("drops a human the room has heard from", async () => {
    const deps = teamRoom({ humans: ["client-abc"] });
    expect(await resolve(["client-abc", "docs"], deps)).toEqual(["docs-1"]);
  });

  test("keeps @everyone even when a human somehow shares the word", async () => {
    const deps = teamRoom({ humans: ["everyone"] });
    expect(await resolve(["everyone"], deps)).toEqual(["everyone"]);
  });

  test("asks nothing of the daemon when there is nothing to resolve", async () => {
    const deps: RoomMentionLookups = {
      getRoomOwner: () => Promise.reject(new Error("should not be asked")),
      getTeamRoster: () => Promise.reject(new Error("should not be asked")),
      listHumanAuthorIds: () => Promise.reject(new Error("should not be asked")),
    };

    expect(await resolve([], deps)).toEqual([]);
  });
});
