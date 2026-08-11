import { describe, expect, it } from "vitest";

import {
  applyRoomMentionReplacement,
  buildRoomMentionTokens,
  findActiveRoomMention,
  rankRoomMentionCandidates,
  type RoomMentionCandidate,
} from "./room-mention-autocomplete";

const ROSTER: RoomMentionCandidate[] = [
  { agentId: "a1", role: "lead", title: "Disk usage lead" },
  { agentId: "a2", role: "docs", title: "Handbook writer" },
  { agentId: "a3", role: "doctor", title: null },
  { agentId: "a4", role: "tech lead", title: "Second opinion" },
];

describe("room mention addresses", () => {
  it("always inserts readable Team handles", () => {
    const current = buildRoomMentionTokens(ROSTER);
    expect(current.get("a2")).toBe("docs");
  });

  it("keeps a duplicate role's roster suffix when an earlier seat is inactive", () => {
    const current = buildRoomMentionTokens([
      { agentId: "retired", role: "server" },
      { agentId: "active", role: "server" },
    ]);

    expect(current.get("active")).toBe("server-2");
  });

  it("uses a persisted address after a later role collides with it", () => {
    const current = buildRoomMentionTokens([
      { agentId: "first", role: "server", mentionHandle: "server" },
      { agentId: "second", role: "server", mentionHandle: "server-2" },
      { agentId: "later", role: "server-2", mentionHandle: "server-2-2" },
    ]);

    expect(current.get("second")).toBe("server-2");
    expect(current.get("later")).toBe("server-2-2");
  });
});

describe("findActiveRoomMention", () => {
  it("finds a mention being typed at the end", () => {
    expect(findActiveRoomMention({ text: "ping @do", cursorIndex: 8 })).toEqual({
      start: 5,
      end: 8,
      query: "do",
    });
  });

  it("finds a bare @ with nothing typed yet", () => {
    expect(findActiveRoomMention({ text: "@", cursorIndex: 1 })).toEqual({
      start: 0,
      end: 1,
      query: "",
    });
  });

  it("reads the mention the cursor is in, not the one after it", () => {
    expect(findActiveRoomMention({ text: "@docs and @lead", cursorIndex: 5 })).toEqual({
      start: 0,
      end: 5,
      query: "docs",
    });
  });

  it("ignores an @ that does not start a word", () => {
    expect(findActiveRoomMention({ text: "mail me@example", cursorIndex: 15 })).toBeNull();
  });

  it("closes once the token ends", () => {
    expect(findActiveRoomMention({ text: "@docs please", cursorIndex: 12 })).toBeNull();
  });

  it("opens after a bracket, the way the daemon reads one", () => {
    expect(findActiveRoomMention({ text: "(@le", cursorIndex: 4 })).toEqual({
      start: 1,
      end: 4,
      query: "le",
    });
  });

  it("clamps a cursor past the end", () => {
    expect(findActiveRoomMention({ text: "@do", cursorIndex: 99 })).toEqual({
      start: 0,
      end: 3,
      query: "do",
    });
  });

  it("finds nothing without an @", () => {
    expect(findActiveRoomMention({ text: "no mention here", cursorIndex: 15 })).toBeNull();
  });
});

describe("rankRoomMentionCandidates", () => {
  it("offers everyone mentionable when nothing is typed", () => {
    const ranked = rankRoomMentionCandidates({ candidates: ROSTER, query: "" });
    expect(ranked.map((entry) => entry.role)).toEqual(["lead", "docs", "doctor", "tech lead"]);
  });

  it("offers a role whose generated handle is parseable", () => {
    const ranked = rankRoomMentionCandidates({ candidates: ROSTER, query: "lead" });
    expect(ranked.map((entry) => entry.role)).toEqual(["lead", "tech lead"]);
  });

  it("puts an exact role above one that merely starts with it", () => {
    const ranked = rankRoomMentionCandidates({ candidates: ROSTER, query: "doc" });
    expect(ranked.map((entry) => entry.role)).toEqual(["docs", "doctor"]);
    expect(
      rankRoomMentionCandidates({ candidates: ROSTER, query: "docs" }).map((entry) => entry.role),
    ).toEqual(["docs"]);
  });

  it("matches case-insensitively", () => {
    const ranked = rankRoomMentionCandidates({ candidates: ROSTER, query: "DOCS" });
    expect(ranked.map((entry) => entry.role)).toEqual(["docs"]);
  });

  it("finds a member by title and still offers the role", () => {
    const ranked = rankRoomMentionCandidates({ candidates: ROSTER, query: "handbook" });
    expect(ranked.map((entry) => entry.role)).toEqual(["docs"]);
  });

  it("keeps roster order between candidates that score the same", () => {
    const ranked = rankRoomMentionCandidates({
      candidates: [
        { agentId: "a2", role: "docs" },
        { agentId: "a1", role: "doctor" },
      ],
      query: "doc",
    });
    expect(ranked.map((entry) => entry.agentId)).toEqual(["a2", "a1"]);
  });

  it("offers nobody when the query matches nobody", () => {
    expect(rankRoomMentionCandidates({ candidates: ROSTER, query: "qa" })).toEqual([]);
  });
});

describe("applyRoomMentionReplacement", () => {
  it("writes the role and a space after it", () => {
    expect(
      applyRoomMentionReplacement({
        text: "ping @do",
        mention: { start: 5, end: 8, query: "do" },
        mentionToken: "docs",
      }),
    ).toEqual({ text: "ping @docs ", cursorIndex: 11 });
  });

  it("keeps what comes after the cursor", () => {
    expect(
      applyRoomMentionReplacement({
        text: "@do the outline",
        mention: { start: 0, end: 3, query: "do" },
        mentionToken: "docs",
      }),
    ).toEqual({ text: "@docs the outline", cursorIndex: 6 });
  });

  it("does not double a space that is already there", () => {
    expect(
      applyRoomMentionReplacement({
        text: "@do ok",
        mention: { start: 0, end: 3, query: "do" },
        mentionToken: "docs",
      }),
    ).toEqual({ text: "@docs ok", cursorIndex: 6 });
  });
});
