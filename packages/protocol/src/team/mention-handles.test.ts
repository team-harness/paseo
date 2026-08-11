import { describe, expect, it } from "vitest";

import {
  assignTeamMentionHandles,
  buildTeamMentionHandles,
  isTeamMentionToken,
} from "./mention-handles.js";

describe("team mention handles", () => {
  it("gives duplicate and non-token roles distinct readable addresses", () => {
    const handles = buildTeamMentionHandles([
      { agentId: "3ac70643-11a4-4c1b-9f0e-5f0b0c9d1e22", role: "server" },
      { agentId: "9f2c1b77-4d5e-4a3f-8b21-0c7d6e5f4a39", role: "server" },
      { agentId: "0b8b35df-59de-4004-9135-26736e5ed2d4", role: "Tech Lead" },
    ]);

    expect(handles).toEqual([
      {
        agentId: "3ac70643-11a4-4c1b-9f0e-5f0b0c9d1e22",
        role: "server",
        handle: "server",
      },
      {
        agentId: "9f2c1b77-4d5e-4a3f-8b21-0c7d6e5f4a39",
        role: "server",
        handle: "server-2",
      },
      {
        agentId: "0b8b35df-59de-4004-9135-26736e5ed2d4",
        role: "Tech Lead",
        handle: "tech-lead",
      },
    ]);
  });

  it("does not change an existing address when a colliding member joins", () => {
    const existing = {
      agentId: "3ac70643-aaaa-4c1b-9f0e-5f0b0c9d1e22",
      role: "server",
    };
    const before = buildTeamMentionHandles([existing]);
    const after = buildTeamMentionHandles([
      existing,
      { agentId: "3ac70643-bbbb-4a3f-8b21-0c7d6e5f4a39", role: "server" },
    ]);

    expect(after[0]?.handle).toBe(before[0]?.handle);
    expect(after.map((entry) => entry.handle)).toEqual(["server", "server-2"]);
  });

  it("keeps generated suffixes unique when a role already claims one", () => {
    const handles = buildTeamMentionHandles([
      { agentId: "a1", role: "server-2" },
      { agentId: "a2", role: "server" },
      { agentId: "a3", role: "server" },
      { agentId: "a4", role: "everyone" },
    ]);

    expect(handles.map((entry) => entry.handle)).toEqual([
      "server-2",
      "server",
      "server-3",
      "everyone-2",
    ]);
  });

  it("never allocates another member's exact agent id as a handle", () => {
    const handles = buildTeamMentionHandles([
      { agentId: "member-a", role: "reviewer" },
      { agentId: "member-b", role: "member-a" },
    ]);

    expect(handles.map((entry) => entry.handle)).toEqual(["reviewer", "member-a-2"]);
  });

  it("does not renumber an existing generated suffix when a colliding role joins", () => {
    const existing = [
      { agentId: "member-a", role: "server" },
      { agentId: "member-b", role: "server" },
    ];
    const before = buildTeamMentionHandles(existing);
    const after = buildTeamMentionHandles([...existing, { agentId: "member-c", role: "server-2" }]);

    expect(after.slice(0, 2).map((entry) => entry.handle)).toEqual(
      before.map((entry) => entry.handle),
    );
    expect(after[2]?.handle).toBe("server-2-2");
  });

  it("does not renumber persisted handles when a later role matches one", () => {
    const existing = assignTeamMentionHandles([
      { agentId: "member-a", role: "server" },
      { agentId: "member-b", role: "server" },
    ]);
    const after = buildTeamMentionHandles([...existing, { agentId: "member-c", role: "server-2" }]);

    expect(after.slice(0, 2).map((entry) => entry.handle)).toEqual(
      existing.map((entry) => entry.mentionHandle),
    );
    expect(after[2]?.handle).toBe("server-2-2");
  });

  it("does not reuse a retired canonical handle", () => {
    const members = assignTeamMentionHandles([{ agentId: "member-new", role: "server" }], {
      reservedHandles: ["server"],
    });

    expect(members[0]?.mentionHandle).toBe("server-2");
  });

  it("excludes sentence punctuation from tokens", () => {
    expect(isTeamMentionToken("qa.one")).toBe(true);
    expect(isTeamMentionToken("qa.one.")).toBe(false);
  });
});
