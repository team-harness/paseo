import { describe, expect, it, vi } from "vitest";

import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

import {
  RoomSubscription,
  type RoomSubscriptionClient,
  type RoomSubscriptionState,
} from "./room-subscription";

function message(id: string): TeamRoomMessage {
  return {
    id,
    missionId: "mission-1",
    roomId: "room-1",
    authorAgentId: "agent-1",
    author: { kind: "agent", id: "agent-1" },
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
        missionId: string;
        messages: TeamRoomMessage[];
        cursor: number;
        hasMore: boolean;
        error: string | null;
        requestId: string;
      }) => void)
    | null = null;

  const client: RoomSubscriptionClient & {
    emit: (id: string, cursor: number, missionId?: string) => void;
    answer: (page: { messages: TeamRoomMessage[]; cursor: number; hasMore?: boolean }) => void;
    fail: (error: string) => void;
    unsubscribeTeamMissionRoom: ReturnType<typeof vi.fn>;
    calls: Array<{ missionId: string; afterCursor?: number; limit?: number }>;
  } = {
    on: (_type, handler) => {
      handlers.push(handler as (message: unknown) => void);
      return () => {
        const index = handlers.indexOf(handler as (message: unknown) => void);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    calls: [],
    subscribeTeamMissionRoom: vi.fn((options) => {
      client.calls.push(options);
      return new Promise<{
        missionId: string;
        messages: TeamRoomMessage[];
        cursor: number;
        hasMore: boolean;
        error: string | null;
        requestId: string;
      }>((resolve) => {
        settle = resolve;
      });
    }),
    unsubscribeTeamMissionRoom: vi.fn(async () => ({
      missionId: "mission-1",
      error: null,
      requestId: "r",
    })),
    emit: (id, cursor, missionId = "mission-1") => {
      for (const handler of handlers.slice()) {
        handler({
          type: "team.mission.message.posted",
          payload: { missionId, message: message(id), cursor },
        });
      }
    },
    answer: (page) => {
      settle?.({
        missionId: "mission-1",
        messages: page.messages,
        cursor: page.cursor,
        hasMore: page.hasMore ?? false,
        error: null,
        requestId: "r",
      });
    },
    fail: (error) => {
      settle?.({
        missionId: "mission-1",
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
  const states: RoomSubscriptionState[] = [];
  return {
    states,
    onState: (state: RoomSubscriptionState) => {
      states.push(state);
    },
  };
}

describe("following one Mission room over a socket", () => {
  it("shows the first page the subscription returned", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

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
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.emit("b", 5);
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("drops a held message the page already carried", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.emit("a", 4);
    client.answer({ messages: [message("a")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((m) => m.id)).toEqual(["a"]);
  });

  it("ignores traffic from another Mission on the same socket", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [], cursor: 0 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));
    client.emit("x", 9, "mission-2");

    expect(sink.states.at(-1)?.timeline.messages).toEqual([]);
  });

  it("reports a refused subscription instead of showing an empty room", async () => {
    // An empty timeline and a room the daemon would not open look identical,
    // and one of them is a room with a conversation in it.
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.fail("No such room");
    await vi.waitFor(() => expect(sink.states.at(-1)?.error).toBe("No such room"));

    expect(sink.states.at(-1)?.loading).toBe(false);
  });

  it("stops listening and tells the daemon when it is disposed", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [], cursor: 1 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));
    subscription.dispose();
    const before = sink.states.length;
    client.emit("late", 99);

    expect(sink.states).toHaveLength(before);
    expect(client.unsubscribeTeamMissionRoom).toHaveBeenCalledWith({ missionId: "mission-1" });
  });

  it("can be opened again after it failed", async () => {
    // The effect that built this only re-runs on a new socket, so without a
    // retry a transient failure costs the room until the tab is closed.
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

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
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

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
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    subscription.dispose();
    client.answer({ messages: [message("a")], cursor: 4 });
    await Promise.resolve();

    expect(sink.states.every((state) => state.timeline.messages.length === 0)).toBe(true);
  });

  it("loads the exact older range while live messages keep arriving", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [message("c"), message("d")], cursor: 4 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    subscription.loadOlder(20);
    expect(client.calls.at(-1)).toEqual({ missionId: "mission-1", afterCursor: 0, limit: 2 });
    client.emit("e", 5);
    client.answer({ messages: [message("a"), message("b")], cursor: 2 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loadingOlder).toBe(false));

    expect(sink.states.at(-1)?.timeline.messages.map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("keeps the live subscription after an older page fails and can retry", async () => {
    const client = fakeClient();
    const sink = collect();
    const subscription = new RoomSubscription("mission-1", client, sink.onState);

    subscription.start();
    client.answer({ messages: [message("c")], cursor: 3 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.loading).toBe(false));

    subscription.loadOlder(1);
    client.fail("History is unavailable");
    await vi.waitFor(() => expect(sink.states.at(-1)?.historyError).toBe("History is unavailable"));
    client.emit("d", 4);
    expect(sink.states.at(-1)?.timeline.messages.map((entry) => entry.id)).toEqual(["c", "d"]);
    expect(client.unsubscribeTeamMissionRoom).not.toHaveBeenCalled();

    subscription.loadOlder(1);
    client.answer({ messages: [message("b")], cursor: 2 });
    await vi.waitFor(() => expect(sink.states.at(-1)?.historyError).toBeNull());
    expect(sink.states.at(-1)?.timeline.messages.map((entry) => entry.id)).toEqual(["b", "c", "d"]);
  });
});
