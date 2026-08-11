import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

export interface RoomTimeline {
  /** Oldest first, the order a room is read in. */
  messages: TeamRoomMessage[];
  /** The newest cursor this timeline has applied. */
  cursor: number;
  /**
   * The daemon says more history exists before `messages[0]`.
   *
   * Nothing reads it yet: paging backwards needs `afterCursor`, and the panel
   * always opens on the newest page. It is here because the subscribe response
   * carries it, and dropping it would make the gap invisible when that is built.
   */
  hasMore: boolean;
}

export function emptyRoomTimeline(): RoomTimeline {
  return { messages: [], cursor: 0, hasMore: false };
}

export function seedRoomTimeline(page: {
  messages: readonly TeamRoomMessage[];
  cursor: number;
  hasMore: boolean;
}): RoomTimeline {
  return { messages: [...page.messages], cursor: page.cursor, hasMore: page.hasMore };
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
  if (cursor <= timeline.cursor) return timeline;

  // A resumed subscription can re-send a message under a fresh cursor. Cursor
  // is the protocol's rule and id is the backstop: two copies of one message is
  // a visible bug, and skipping a duplicate is not.
  if (timeline.messages.some((existing) => existing.id === message.id)) {
    return { ...timeline, cursor };
  }

  return { ...timeline, messages: [...timeline.messages, message], cursor };
}
