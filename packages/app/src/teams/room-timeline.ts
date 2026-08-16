import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

export interface RoomTimeline {
  /** Oldest first, the order a room is read in. */
  messages: TeamRoomMessage[];
  /** The newest streamed cursor this timeline has applied. */
  liveCursor: number;
  /** Absolute cursor immediately before the oldest loaded message. */
  oldestCursor: number;
  /** Derived from the absolute history boundary, never from wire `hasMore`. */
  hasOlder: boolean;
}

export function emptyRoomTimeline(): RoomTimeline {
  return { messages: [], liveCursor: 0, oldestCursor: 0, hasOlder: false };
}

export function seedRoomTimeline(page: {
  messages: readonly TeamRoomMessage[];
  cursor: number;
  hasMore: boolean;
}): RoomTimeline {
  const oldestCursor = Math.max(0, page.cursor - page.messages.length);
  return {
    messages: [...page.messages],
    liveCursor: page.cursor,
    oldestCursor,
    hasOlder: oldestCursor > 0,
  };
}

export function applyHistoricalRoomPage(
  timeline: RoomTimeline,
  page: {
    messages: readonly TeamRoomMessage[];
    cursor: number;
    startCursor: number;
    expectedCursor: number;
  },
): RoomTimeline {
  if (page.cursor !== page.expectedCursor) {
    throw new Error("Room history cursor changed while loading.");
  }

  const seen = new Set<string>();
  const messages: TeamRoomMessage[] = [];
  for (const message of [...page.messages, ...timeline.messages]) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    messages.push(message);
  }
  return {
    ...timeline,
    messages,
    oldestCursor: page.startCursor,
    hasOlder: page.startCursor > 0,
  };
}

/**
 * Applies one `team.mission.message.posted`.
 *
 * The daemon starts following a room before it reads the first page, so a
 * message posted mid-assembly arrives twice. The protocol's rule is to drop the
 * streamed copy when its cursor is at or below the subscription's — the other
 * order loses the message, and a client cannot detect a hole it was never told
 * about.
 *
 * Returns the same object when nothing changed, so a store can skip the render.
 */
export function applyStreamedRoomMessage(
  timeline: RoomTimeline,
  message: TeamRoomMessage,
  cursor: number,
): RoomTimeline {
  if (cursor <= timeline.liveCursor) return timeline;

  // A resumed subscription can re-send a message under a fresh cursor. Cursor
  // is the protocol's rule and id is the backstop: two copies of one message is
  // a visible bug, and skipping a duplicate is not.
  if (timeline.messages.some((existing) => existing.id === message.id)) {
    return { ...timeline, liveCursor: cursor };
  }

  return { ...timeline, messages: [...timeline.messages, message], liveCursor: cursor };
}
