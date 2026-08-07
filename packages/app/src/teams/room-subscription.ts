import type { ChatMessage } from "@getpaseo/protocol/chat/types";

import {
  applyStreamedRoomMessage,
  emptyRoomTimeline,
  seedRoomTimeline,
  type RoomTimeline,
} from "./room-timeline";

export interface RoomSubscriptionClient {
  on(type: "chat.room.message_posted", handler: (message: unknown) => void): () => void;
  subscribeChatRoom(options: { room: string; limit?: number }): Promise<{
    roomId: string;
    messages: ChatMessage[];
    cursor: number;
    hasMore: boolean;
    error: string | null;
    requestId: string;
  }>;
  unsubscribeChatRoom(options: { room: string }): Promise<unknown>;
}

export interface RoomSubscriptionState {
  timeline: RoomTimeline;
  error: string | null;
  loading: boolean;
}

interface StreamedMessage {
  message: ChatMessage;
  cursor: number;
}

/**
 * One room, followed over one socket.
 *
 * The listener goes on before the request goes out, because a message posted
 * in between arrives on the socket and nowhere else. Those are held and
 * replayed onto the first page, where the timeline's cursor rule drops
 * whatever the page already carried.
 */
export class RoomSubscription {
  private timeline: RoomTimeline = emptyRoomTimeline();
  private held: StreamedMessage[] | null = [];
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private error: string | null = null;
  private loading = true;

  constructor(
    private readonly roomId: string,
    private readonly client: RoomSubscriptionClient,
    private readonly onState: (state: RoomSubscriptionState) => void,
    /** What to say when the daemon fails without saying why. */
    private readonly unopenableLabel = "The room could not be opened.",
  ) {}

  start(): void {
    if (this.disposed) return;
    this.unsubscribe = this.client.on("chat.room.message_posted", (raw) => {
      const streamed = readStreamedMessage(raw, this.roomId);
      if (!streamed) return;
      if (this.held) {
        this.held.push(streamed);
        return;
      }
      this.apply(streamed);
    });
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const page = await this.client.subscribeChatRoom({ room: this.roomId });
      // The panel closed while the page was in the air. Committing it writes to
      // a screen that is gone.
      if (this.disposed) return;
      if (page.error) {
        // An empty timeline and a room the daemon would not open look the same
        // on screen, and one of them has a conversation in it.
        this.held = null;
        this.error = page.error;
        this.loading = false;
        this.emit();
        return;
      }
      this.timeline = seedRoomTimeline(page);
      const held = this.held ?? [];
      this.held = null;
      for (const streamed of held) {
        this.timeline = applyStreamedRoomMessage(this.timeline, streamed.message, streamed.cursor);
      }
      this.error = null;
      this.loading = false;
      this.emit();
    } catch (cause) {
      if (this.disposed) return;
      this.held = null;
      this.error = cause instanceof Error ? cause.message : this.unopenableLabel;
      this.loading = false;
      this.emit();
    }
  }

  /**
   * Tries again after a failed open.
   *
   * A room that failed once stays failed forever otherwise — the effect that
   * built this only re-runs on a new socket, so a transient failure costs the
   * user the room until they close the tab and come back.
   */
  retry(): void {
    if (this.disposed || this.loading) return;
    this.held = [];
    this.error = null;
    this.loading = true;
    this.emit();
    void this.load();
  }

  private apply(streamed: StreamedMessage): void {
    const next = applyStreamedRoomMessage(this.timeline, streamed.message, streamed.cursor);
    if (next === this.timeline) return;
    this.timeline = next;
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    this.onState({ timeline: this.timeline, error: this.error, loading: this.loading });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // The socket may well outlive this panel. Leaving the subscription open
    // keeps the daemon fanning a room out to a client that stopped reading it.
    void this.client.unsubscribeChatRoom({ room: this.roomId }).catch(() => {});
  }
}

function readStreamedMessage(raw: unknown, roomId: string): StreamedMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const envelope = raw as { type?: unknown; payload?: unknown };
  if (envelope.type !== "chat.room.message_posted") return null;
  const payload = envelope.payload as
    | { roomId?: unknown; message?: ChatMessage; cursor?: unknown }
    | undefined;
  // One socket carries every room this client follows.
  if (!payload || payload.roomId !== roomId) return null;
  if (typeof payload.cursor !== "number" || !payload.message) return null;
  return { message: payload.message, cursor: payload.cursor };
}
