import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

import {
  applyStreamedRoomMessage,
  emptyRoomTimeline,
  seedRoomTimeline,
  type RoomTimeline,
} from "./room-timeline";

export interface RoomSubscriptionClient {
  on(type: "team.mission.message.posted", handler: (message: unknown) => void): () => void;
  subscribeTeamMissionRoom(options: { missionId: string; limit?: number }): Promise<{
    missionId: string;
    messages: TeamRoomMessage[];
    cursor: number;
    hasMore: boolean;
    error: string | null;
    requestId: string;
  }>;
  unsubscribeTeamMissionRoom(options: { missionId: string }): Promise<unknown>;
}

export interface RoomSubscriptionState {
  timeline: RoomTimeline;
  error: string | null;
  loading: boolean;
}

interface StreamedMessage {
  message: TeamRoomMessage;
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
    private readonly missionId: string,
    private readonly client: RoomSubscriptionClient,
    private readonly onState: (state: RoomSubscriptionState) => void,
    /** What to say when the daemon fails without saying why. */
    private readonly unopenableLabel = "The room could not be opened.",
  ) {}

  start(): void {
    if (this.disposed) return;
    this.unsubscribe = this.client.on("team.mission.message.posted", (raw) => {
      const streamed = readStreamedMessage(raw, this.missionId);
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
      const page = await this.client.subscribeTeamMissionRoom({ missionId: this.missionId });
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
    void this.client.unsubscribeTeamMissionRoom({ missionId: this.missionId }).catch(() => {});
  }
}

function readStreamedMessage(raw: unknown, missionId: string): StreamedMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const envelope = raw as { type?: unknown; payload?: unknown };
  if (envelope.type !== "team.mission.message.posted") return null;
  const payload = envelope.payload as
    | { missionId?: unknown; message?: TeamRoomMessage; cursor?: unknown }
    | undefined;
  // One socket carries every Mission room this client follows.
  if (!payload || payload.missionId !== missionId) return null;
  if (typeof payload.cursor !== "number" || !payload.message) return null;
  return { message: payload.message, cursor: payload.cursor };
}
