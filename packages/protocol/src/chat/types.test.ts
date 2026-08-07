import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ChatRoomSchema } from "./types.js";

const legacyMessage = {
  id: "msg-1",
  roomId: "room-1",
  authorAgentId: "agent-lead",
  body: "Assigned the server work to @implementer.",
  replyToMessageId: null,
  mentionAgentIds: ["agent-impl"],
  createdAt: "2026-08-06T10:00:00.000Z",
};

const legacyRoom = {
  id: "room-1",
  name: "team-team-1",
  purpose: "Coordination for Disk usage",
  createdAt: "2026-08-06T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
};

describe("chat message author", () => {
  it("still parses a message from a daemon that predates the author model", () => {
    expect(ChatMessageSchema.parse(legacyMessage)).toEqual(legacyMessage);
  });

  it("carries an explicit agent author", () => {
    const message = {
      ...legacyMessage,
      author: { kind: "agent" as const, id: "agent-lead" },
    };
    expect(ChatMessageSchema.parse(message)).toEqual(message);
  });

  it("carries an explicit human author whose id is not an agent id", () => {
    const message = {
      ...legacyMessage,
      authorAgentId: "client-42",
      author: { kind: "human" as const, id: "client-42" },
    };
    expect(ChatMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects an unknown author kind", () => {
    expect(
      ChatMessageSchema.safeParse({
        ...legacyMessage,
        author: { kind: "robot", id: "x" },
      }).success,
    ).toBe(false);
  });
});

describe("chat room ownership", () => {
  it("still parses a room from a daemon that predates ownership", () => {
    expect(ChatRoomSchema.parse(legacyRoom)).toEqual(legacyRoom);
  });

  it("carries a team owner so generic delete can refuse", () => {
    const room = {
      ...legacyRoom,
      ownerKind: "team" as const,
      ownerId: "team-1",
      displayName: "Disk usage",
    };
    expect(ChatRoomSchema.parse(room)).toEqual(room);
  });
});
