import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@getpaseo/protocol/chat/types";

import { RoomSubscription, type RoomSubscriptionClient } from "./room-subscription";
import type { RoomTimeline } from "./room-timeline";

function message(id: string): ChatMessage {
  return {
    id,
    roomId: "room-1",
    authorAgentId: "agent-1",
    body: `body ${id}`,
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-08-06T10:00:00.000Z",
  };
}

function fakeClient() {
  const handlers: Array<(message: unknown) => void> = [];
  let settle:
    | ((value: {
        roomId: string;
        messages: ChatMessage[];
        cursor: number;
        hasMore: boolean;
        error: string | null;
        requestId: string;
      }) => void)
    | null = null;

  const client: RoomSubscriptionClient & {
    emit: (id: string, cursor: number, roomId?: string) => void;
    answer: (page: { messages: ChatMessage[]; cursor: number; hasMore?: boolean }) => void;
    fail: (error: string) => void;
    unsubscribeChatRoom: ReturnType<typeof vi.fn>;
  } = {
    on: (_type, handler) => {
      handlers.push(handler as (message: unknown) => void);
      return () => {
        const index = handlers.indexOf(handler as (message: unknown) => void);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    subscribeChatRoom: vi.fn(
      () =>
        new Promise<{
          roomId: string;
          messages: ChatMessage[];
          cursor: number;
          hasMore: boolean;
          error: string | null;
          requestId: string;
        }>((resolve) => {
          settle = resolve;
        }),
    ),
    unsubscribeChatRoom: vi.fn(async () => ({ roomId: "room-1", error: null, requestId: "r" })),
    emit: (id, cursor, roomId = "room-1") => {
      for (const handler of handlers.slice()) {
        handler({
          type: "chat.room.message_posted",
          payload: { roomId, message: message(id), cursor },
        });
      }
    },
    answer: (page) => {
      settle?.({
        roomId: "room-1",
        messages: page.messages,
        cursor: page.cursor,
        hasMore: page.hasMore ?? false,
        error: null,
        requestId: "r",
      });
    },
    fail: (error) => {
      settle?.({
        roomId: "room-1",
        messages: [],
        cursor: 0,
        hasMore: false,
        error,
        requestId: "r",
      });
    },
  };
  return client;
}

function collect() {
  const states: Array<{ timeline: RoomTimeline; error: string | null; loading: boolean }> = [];
  return {
    states,
    onState: (state: { timeline: RoomTimeline; error: string | null; loading: boolean }) => {
      states.push(state);
    },
  };
}

describe("following one room over a socket", () => {
  it("shows the first page the subscription returned", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a"]);
  });

  it("keeps a message that arrives before the first page does", async () => {
    // The listener has to be installed before the request is sent. A broadcast
    // that lands in between has nowhere else to go, and the client cannot
    // detect the hole it leaves.
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.emit("b", 5);
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("drops a held message the page already carried", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.emit("a", 4);
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a"]);
  });

  it("ignores traffic from another room on the same socket", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [], cursor: 0 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));
    client.emit("x", 9, "room-2");

    expect(sink.states.at(-1)?.timeline.messages).toEqual([]);
  });

  it("reports a refused subscription instead of showing an empty room", async () => {
    // An empty timeline and a room the daemon would not open look identical,
    // and one of them is a room with a conversation in it.
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.fail("No such room");
    await vi.waitFor(() => expect(sink.states.at(-1)?.error).toBe("No such room"));

    expect(sink.states.at(-1)?.loading).toBe(false);
  });

  it("stops listening and tells the daemon when it is disposed", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [], cursor: 1 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));
    subscription.dispose();
    const before = sink.states.length;
    client.emit("late", 99);

    expect(sink.states).toHaveLength(before);
    expect(client.unsubscribeChatRoom).toHaveBeenCalledWith({ room: "room-1" });
  });

  it("can be opened again after it failed", async () => {
    // The effect that built this only re-runs on a new socket, so without a
    // retry a transient failure costs the room until the tab is closed.
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.fail("Room is loading");
    await vi.waitFor(() => expect(sink.states.at(-1)?.error).toBe("Room is loading"));

    subscription.retry();
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)).toMatchObject({ error: null });
    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a"]);
  });

  it("still holds what arrives during a retry", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    client.fail("Room is loading");
    await vi.waitFor(() => expect(sink.states.at(-1)?.error).toBe("Room is loading"));

    subscription.retry();
    client.emit("b", 5);
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not answer for a subscription that was disposed mid-flight", async () => {
    // The panel closed while the page was in the air. Committing it writes to
    // a screen that is gone and leaves the room subscribed on the daemon.
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("room-1", client, sink.onState);

    subscription.start();
    subscription.dispose();
    client.answer({ messages: [message("a")], cursor: 4 });
    await Promise.resolve();

    expect(sink.states.every((state) => state.timeline.messages.length === 0)).toBe(true);
  });
});
