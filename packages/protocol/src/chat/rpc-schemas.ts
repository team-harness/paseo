import { z } from "zod";
import { ChatMessageSchema, ChatRoomDetailSchema } from "./types.js";

/**
 * Live room subscription. `chat/read` + `chat/wait` cannot express "start
 * following this room" without a gap or a duplicate between the two calls, so
 * subscribe returns the first page and its cursor atomically and every later
 * message arrives on `chat.room.message_posted` with the next cursor.
 *
 * A subscription belongs to one physical socket and dies with it.
 *
 * Without `afterCursor` the response holds the newest `limit` messages, which is
 * what a freshly opened room wants. A client that was disconnected passes the
 * cursor it last saw and gets that gap in ascending order instead; when the gap
 * is longer than one page the response sets `hasMore` and the client repeats
 * with the cursor it just received. Dropping `afterCursor` would silently lose
 * every message between the last seen cursor and the newest page.
 */
export const ChatRoomSubscribeRequestSchema = z.object({
  type: z.literal("chat.room.subscribe.request"),
  requestId: z.string(),
  room: z.string(),
  afterCursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().nonnegative().optional(),
});

export const ChatRoomUnsubscribeRequestSchema = z.object({
  type: z.literal("chat.room.unsubscribe.request"),
  requestId: z.string(),
  room: z.string(),
});

export const ChatRoomSubscribeResponseSchema = z.object({
  type: z.literal("chat.room.subscribe.response"),
  payload: z.object({
    requestId: z.string(),
    roomId: z.string(),
    messages: z.array(ChatMessageSchema),
    /** Cursor of the last message in `messages`; the subscription starts here. */
    cursor: z.number().int().nonnegative(),
    /** More history sits between `cursor` and the newest message. */
    hasMore: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const ChatRoomUnsubscribeResponseSchema = z.object({
  type: z.literal("chat.room.unsubscribe.response"),
  payload: z.object({
    requestId: z.string(),
    roomId: z.string(),
    error: z.string().nullable(),
  }),
});

/** Broadcast to every socket subscribed to the room. */
export const ChatRoomMessagePostedSchema = z.object({
  type: z.literal("chat.room.message_posted"),
  payload: z.object({
    roomId: z.string(),
    message: ChatMessageSchema,
    cursor: z.number().int().nonnegative(),
  }),
});

export const ChatCreateRequestSchema = z.object({
  type: z.literal("chat/create"),
  requestId: z.string(),
  name: z.string(),
  purpose: z.string().optional(),
});

export const ChatListRequestSchema = z.object({
  type: z.literal("chat/list"),
  requestId: z.string(),
});

export const ChatInspectRequestSchema = z.object({
  type: z.literal("chat/inspect"),
  requestId: z.string(),
  room: z.string(),
});

export const ChatDeleteRequestSchema = z.object({
  type: z.literal("chat/delete"),
  requestId: z.string(),
  room: z.string(),
});

export const ChatPostRequestSchema = z.object({
  type: z.literal("chat/post"),
  requestId: z.string(),
  room: z.string(),
  body: z.string(),
  authorAgentId: z.string().optional(),
  replyToMessageId: z.string().optional(),
});

export const ChatReadRequestSchema = z.object({
  type: z.literal("chat/read"),
  requestId: z.string(),
  room: z.string(),
  limit: z.number().int().nonnegative().optional(),
  since: z.string().optional(),
  authorAgentId: z.string().optional(),
});

export const ChatWaitRequestSchema = z.object({
  type: z.literal("chat/wait"),
  requestId: z.string(),
  room: z.string(),
  afterMessageId: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
});

export const ChatCreateResponseSchema = z.object({
  type: z.literal("chat/create/response"),
  payload: z.object({
    requestId: z.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatListResponseSchema = z.object({
  type: z.literal("chat/list/response"),
  payload: z.object({
    requestId: z.string(),
    rooms: z.array(ChatRoomDetailSchema),
    error: z.string().nullable(),
  }),
});

export const ChatInspectResponseSchema = z.object({
  type: z.literal("chat/inspect/response"),
  payload: z.object({
    requestId: z.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatDeleteResponseSchema = z.object({
  type: z.literal("chat/delete/response"),
  payload: z.object({
    requestId: z.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatPostResponseSchema = z.object({
  type: z.literal("chat/post/response"),
  payload: z.object({
    requestId: z.string(),
    message: ChatMessageSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatReadResponseSchema = z.object({
  type: z.literal("chat/read/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(ChatMessageSchema),
    error: z.string().nullable(),
  }),
});

export const ChatWaitResponseSchema = z.object({
  type: z.literal("chat/wait/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(ChatMessageSchema),
    timedOut: z.boolean(),
    error: z.string().nullable(),
  }),
});
