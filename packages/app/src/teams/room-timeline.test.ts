import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@getpaseo/protocol/chat/types";

import {
  applyStreamedRoomMessage,
  emptyRoomTimeline,
  prependOlderRoomPage,
  seedRoomTimeline,
} from "./room-timeline";

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    roomId: "room-1",
    authorAgentId: "agent-1",
    body: `body ${id}`,
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-08-06T10:00:00.000Z",
    ...overrides,
  };
}

describe("following a team's room", () => {
  it("starts from the page the subscription returned", () => {
    const timeline = seedRoomTimeline({
      messages: [message("a"), message("b")],
      cursor: 12,
      hasMore: true,
    });

    expect(timeline.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(timeline).toMatchObject({ cursor: 12, hasMore: true });
  });

  it("appends what arrives after the page", () => {
    const timeline = applyStreamedRoomMessage(
      seedRoomTimeline({ messages: [message("a")], cursor: 5, hasMore: false }),
      message("b"),
      6,
    );

    expect(timeline.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(timeline.cursor).toBe(6);
  });

  it("drops a streamed message the page already carried", () => {
    // The daemon follows the room before it reads the page, so anything posted
    // mid-assembly arrives twice. The protocol says to drop by cursor; the
    // other order would lose the message, and a client cannot detect a hole it
    // was never told about.
    const seeded = seedRoomTimeline({ messages: [message("a")], cursor: 5, hasMore: false });
    const timeline = applyStreamedRoomMessage(seeded, message("a"), 5);

    expect(timeline).toBe(seeded);
  });

  it("drops a message whose cursor moved backwards", () => {
    const seeded = seedRoomTimeline({ messages: [message("b")], cursor: 5, hasMore: false });

    expect(applyStreamedRoomMessage(seeded, message("a"), 4)).toBe(seeded);
  });

  it("refuses a duplicate id even when its cursor looks new", () => {
    // Cursor is the protocol's dedup rule, but a resumed subscription can hand
    // back a message the timeline already holds under a fresh cursor. Two
    // copies of one message is a visible bug; skipping one is not.
    const seeded = seedRoomTimeline({ messages: [message("a")], cursor: 5, hasMore: false });
    const timeline = applyStreamedRoomMessage(seeded, message("a"), 9);

    expect(timeline.messages.map((m) => m.id)).toEqual(["a"]);
    expect(timeline.cursor).toBe(9);
  });

  it("puts an older page in front, without repeating what is already here", () => {
    const seeded = seedRoomTimeline({ messages: [message("c")], cursor: 9, hasMore: true });
    const timeline = prependOlderRoomPage(seeded, {
      messages: [message("a"), message("b"), message("c")],
      hasMore: false,
    });

    expect(timeline.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(timeline).toMatchObject({ cursor: 9, hasMore: false });
  });

  it("keeps the live cursor when older history lands", () => {
    // Older pages carry older cursors. Taking one would re-admit every message
    // the timeline already holds on the next streamed update.
    const seeded = seedRoomTimeline({ messages: [message("c")], cursor: 9, hasMore: true });

    expect(prependOlderRoomPage(seeded, { messages: [message("a")], hasMore: true }).cursor).toBe(
      9,
    );
  });

  it("has an empty state that is not a loaded empty room", () => {
    expect(emptyRoomTimeline().cursor).toBe(0);
    expect(emptyRoomTimeline().messages).toEqual([]);
  });
});
