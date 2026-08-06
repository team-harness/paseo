/** How much of a message the room shows before folding it. */
export const ROOM_MESSAGE_FOLD_LINES = 12;
const ROOM_MESSAGE_FOLD_CHARS = 1200;

export interface FoldedRoomMessage {
  text: string;
  folded: boolean;
  /** Lines cut off, or 0 when the cut was by length rather than by line. */
  hidden: number;
}

/**
 * Trims a room message down to something a timeline can hold.
 *
 * Agents post transcripts, diffs, and stack traces. One of those unfolded
 * pushes every other message off the screen, and the room reads as if only one
 * member ever said anything.
 */
export function foldRoomMessage(body: string): FoldedRoomMessage {
  const lines = body.split("\n");

  if (lines.length > ROOM_MESSAGE_FOLD_LINES) {
    return {
      text: lines.slice(0, ROOM_MESSAGE_FOLD_LINES).join("\n"),
      folded: true,
      hidden: lines.length - ROOM_MESSAGE_FOLD_LINES,
    };
  }

  if (body.length > ROOM_MESSAGE_FOLD_CHARS) {
    // One 40k-character line is one line and still enough to bury the room.
    // `hidden` stays 0: "5 more lines" under a sentence cut in half describes
    // something that did not happen.
    return { text: body.slice(0, ROOM_MESSAGE_FOLD_CHARS), folded: true, hidden: 0 };
  }

  return { text: body, folded: false, hidden: 0 };
}
