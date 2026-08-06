import type { ChatMessage } from "@getpaseo/protocol/chat/types";

export interface RoomTimeline {
  /** Oldest first, the order a room is read in. */
  messages: ChatMessage[];
  /** The newest cursor this timeline has applied. */
  cursor: number;
  /** Older history sits before `messages[0]`. */
  hasMore: boolean;
}

export function emptyRoomTimeline(): RoomTimeline {
  return { messages: [], cursor: 0, hasMore: false };
}

export function seedRoomTimeline(page: {
  messages: readonly ChatMessage[];
  cursor: number;
  hasMore: boolean;
}): RoomTimeline {
  return { messages: [...page.messages], cursor: page.cursor, hasMore: page.hasMore };
}

/**
 * Applies one `chat.room.message_posted`.
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
  message: ChatMessage,
  cursor: number,
): RoomTimeline {
  if (cursor <= timeline.cursor) return timeline;

  // A resumed subscription can re-send a message under a fresh cursor. Cursor
  // is the protocol's rule and id is the backstop: two copies of one message is
  // a visible bug, and skipping a duplicate is not.
  if (timeline.messages.some((existing) => existing.id === message.id)) {
    return { ...timeline, cursor };
  }

  return { ...timeline, messages: [...timeline.messages, message], cursor };
}

/**
 * Puts a page of older history in front of what is here.
 *
 * The cursor does not move: older pages carry older cursors, and taking one
 * would re-admit every message the timeline already holds the next time a
 * streamed update arrived.
 */
export function prependOlderRoomPage(
  timeline: RoomTimeline,
  page: { messages: readonly ChatMessage[]; hasMore: boolean },
): RoomTimeline {
  const seen = new Set(timeline.messages.map((message) => message.id));
  const older = page.messages.filter((message) => !seen.has(message.id));
  return {
    messages: [...older, ...timeline.messages],
    cursor: timeline.cursor,
    hasMore: page.hasMore,
  };
}
