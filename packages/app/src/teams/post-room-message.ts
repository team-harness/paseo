import type { ChatMessage } from "@getpaseo/protocol/chat/types";

export type PostRoomMessageState =
  | { status: "pending" }
  | { status: "idle" }
  | { status: "failure"; message: string };

export interface PostRoomMessageGateway {
  postChatMessage(options: {
    room: string;
    body: string;
  }): Promise<{ message: ChatMessage | null; error: string | null }>;
}

export interface PostRoomMessageLabels {
  /** The daemon refused and said nothing about why. */
  refused: string;
  /** There is no host to send to. */
  offline: string;
}

/**
 * Says something in a team's room, as a person.
 *
 * There is no local "sent" state and no optimistic message: the daemon
 * broadcasts the post back over the room subscription, so the timeline learns
 * about it the same way it learns about everyone else's. A locally-appended
 * copy would sit next to the real one when it arrived.
 */
export async function postRoomMessage(
  input: { roomId: string; body: string; client: PostRoomMessageGateway | null },
  labels: PostRoomMessageLabels,
  onState: (state: PostRoomMessageState) => void,
): Promise<void> {
  const body = input.body.trim();
  // Whitespace is not a message. Reporting a failure for it would be noise.
  if (!body) return;

  if (!input.client) {
    // Clearing the composer over a post that went nowhere loses what was typed.
    onState({ status: "failure", message: labels.offline });
    return;
  }

  onState({ status: "pending" });
  try {
    const answer = await input.client.postChatMessage({ room: input.roomId, body });
    if (!answer.message) {
      onState({ status: "failure", message: answer.error ?? labels.refused });
      return;
    }
    onState({ status: "idle" });
  } catch (cause) {
    onState({
      status: "failure",
      message: cause instanceof Error ? cause.message : labels.refused,
    });
  }
}
