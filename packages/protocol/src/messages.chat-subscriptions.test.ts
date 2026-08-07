import { describe, expect, it } from "vitest";
import { CLIENT_CAPS } from "./client-capabilities.js";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const message = {
  id: "msg-1",
  roomId: "room-1",
  authorAgentId: "agent-lead",
  body: "Ready.",
  replyToMessageId: null,
  mentionAgentIds: [],
  createdAt: "2026-08-06T10:00:00.000Z",
  author: { kind: "agent", id: "agent-lead" },
};

describe("chat room subscription messages", () => {
  it("accepts subscribe and unsubscribe on the inbound union", () => {
    for (const request of [
      { type: "chat.room.subscribe.request", requestId: "req-1", room: "room-1", limit: 50 },
      {
        type: "chat.room.subscribe.request",
        requestId: "req-2",
        room: "room-1",
        afterCursor: 10,
        limit: 50,
      },
      { type: "chat.room.unsubscribe.request", requestId: "req-3", room: "room-1" },
    ]) {
      expect(SessionInboundMessageSchema.safeParse(request).success).toBe(true);
    }
  });

  it("accepts subscribe and unsubscribe responses on the outbound union", () => {
    for (const response of [
      {
        type: "chat.room.subscribe.response",
        payload: {
          requestId: "req-1",
          roomId: "room-1",
          messages: [message],
          cursor: 7,
          hasMore: false,
          error: null,
        },
      },
      {
        type: "chat.room.unsubscribe.response",
        payload: { requestId: "req-2", roomId: "room-1", error: null },
      },
    ]) {
      expect(SessionOutboundMessageSchema.safeParse(response).success).toBe(true);
    }
  });

  it("accepts the room message broadcast", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "chat.room.message_posted",
        payload: { roomId: "room-1", message, cursor: 8 },
      }).success,
    ).toBe(true);
  });
});

describe("chat room subscription gating", () => {
  it("advertises the capability separately from teams", () => {
    const payload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_test",
      features: { chatRoomSubscriptions: true },
    });
    expect(payload.features?.chatRoomSubscriptions).toBe(true);
    expect(payload.features?.teams).toBeUndefined();
  });

  it("exposes a client capability distinct from teams", () => {
    expect(CLIENT_CAPS.chatRoomSubscriptions).toBe("chat_room_subscriptions");
    expect(CLIENT_CAPS.chatRoomSubscriptions).not.toBe(CLIENT_CAPS.teams);
  });
});
