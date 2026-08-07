import { describe, expect, it } from "vitest";
import {
  ChatRoomMessagePostedSchema,
  ChatRoomSubscribeRequestSchema,
  ChatRoomSubscribeResponseSchema,
  ChatRoomUnsubscribeRequestSchema,
  ChatRoomUnsubscribeResponseSchema,
} from "./rpc-schemas.js";

const message = {
  id: "msg-1",
  roomId: "room-1",
  authorAgentId: "agent-lead",
  body: "Assigned the server work.",
  replyToMessageId: null,
  mentionAgentIds: [],
  createdAt: "2026-08-06T10:00:00.000Z",
  author: { kind: "agent" as const, id: "agent-lead" },
};

describe("chat.room.subscribe", () => {
  it("round-trips a subscribe request", () => {
    const request = {
      type: "chat.room.subscribe.request" as const,
      requestId: "req-1",
      room: "room-1",
      limit: 50,
    };
    expect(ChatRoomSubscribeRequestSchema.parse(request)).toEqual(request);
  });

  it("round-trips a subscribe request without a page size", () => {
    const request = {
      type: "chat.room.subscribe.request" as const,
      requestId: "req-1",
      room: "room-1",
    };
    expect(ChatRoomSubscribeRequestSchema.parse(request)).toEqual(request);
  });

  it("resumes from the client's last seen cursor after a disconnect", () => {
    const request = {
      type: "chat.room.subscribe.request" as const,
      requestId: "req-1",
      room: "room-1",
      afterCursor: 10,
      limit: 50,
    };
    expect(ChatRoomSubscribeRequestSchema.parse(request)).toEqual(request);
  });

  it("returns the first page and its cursor in one atomic response", () => {
    const response = {
      type: "chat.room.subscribe.response" as const,
      payload: {
        requestId: "req-1",
        roomId: "room-1",
        messages: [message],
        cursor: 12,
        hasMore: false,
        error: null,
      },
    };
    expect(ChatRoomSubscribeResponseSchema.parse(response)).toEqual(response);
  });

  it("flags a backlog larger than one page so the client keeps catching up", () => {
    const response = {
      type: "chat.room.subscribe.response" as const,
      payload: {
        requestId: "req-1",
        roomId: "room-1",
        messages: [message],
        cursor: 60,
        hasMore: true,
        error: null,
      },
    };
    expect(ChatRoomSubscribeResponseSchema.parse(response)).toEqual(response);
  });

  it("reports a failed subscribe with an empty page", () => {
    const response = {
      type: "chat.room.subscribe.response" as const,
      payload: {
        requestId: "req-1",
        roomId: "room-1",
        messages: [],
        cursor: 0,
        hasMore: false,
        error: "Room not found",
      },
    };
    expect(ChatRoomSubscribeResponseSchema.parse(response)).toEqual(response);
  });
});

describe("chat.room.unsubscribe", () => {
  it("round-trips the request and response", () => {
    const request = {
      type: "chat.room.unsubscribe.request" as const,
      requestId: "req-1",
      room: "room-1",
    };
    expect(ChatRoomUnsubscribeRequestSchema.parse(request)).toEqual(request);
    const response = {
      type: "chat.room.unsubscribe.response" as const,
      payload: { requestId: "req-1", roomId: "room-1", error: null },
    };
    expect(ChatRoomUnsubscribeResponseSchema.parse(response)).toEqual(response);
  });
});

describe("chat.room.message_posted", () => {
  it("carries the cursor so a reconnecting client can dedupe and catch up", () => {
    const broadcast = {
      type: "chat.room.message_posted" as const,
      payload: { roomId: "room-1", message, cursor: 13 },
    };
    expect(ChatRoomMessagePostedSchema.parse(broadcast)).toEqual(broadcast);
  });
});
