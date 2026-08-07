import { z } from "zod";

export const ChatRoomOwnerKindSchema = z.enum(["team"]);

export type ChatRoomOwnerKind = z.infer<typeof ChatRoomOwnerKindSchema>;

export const ChatRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // An owned room follows its owner's lifecycle, so generic chat/delete refuses
  // it. `name` stays globally unique and internal (team-{id}); `displayName` is
  // what a human reads. Optional forever: a room predating ownership has none,
  // and the protocol never flips an optional field to required.
  ownerKind: ChatRoomOwnerKindSchema.optional(),
  ownerId: z.string().optional(),
  displayName: z.string().optional(),
});

export type ChatRoom = z.infer<typeof ChatRoomSchema>;

export const ChatAuthorSchema = z.object({
  kind: z.enum(["agent", "human"]),
  id: z.string(),
});

export type ChatAuthor = z.infer<typeof ChatAuthorSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  authorAgentId: z.string(),
  body: z.string(),
  replyToMessageId: z.string().nullable(),
  mentionAgentIds: z.array(z.string()),
  createdAt: z.string(),
  // `authorAgentId` predates human participants and carries a client id for
  // them, which nothing can tell apart from an agent id. `author` says which it
  // is. Both stay: the field can never be removed and this one can never become
  // required. The shim that ends is the daemon writing both, tagged where it
  // lives rather than here.
  author: ChatAuthorSchema.optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRoomDetailSchema = ChatRoomSchema.extend({
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().nullable(),
});

export type ChatRoomDetail = z.infer<typeof ChatRoomDetailSchema>;
