import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import {
  type ChatServiceError,
  FileBackedChatService,
  parseMentionAgentIds,
  type PostChatMessageInput,
} from "./chat-service.js";

describe("FileBackedChatService", () => {
  let paseoHome: string;
  let service: FileBackedChatService;

  async function sendChatMessage(input: PostChatMessageInput) {
    return await service.dispatchMessage(input);
  }

  beforeEach(async () => {
    paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-chat-service-"));
    service = new FileBackedChatService({
      paseoHome,
      logger: pino({ level: "silent" }),
    });
    await service.initialize();
  });

  afterEach(async () => {
    await rm(paseoHome, { recursive: true, force: true });
  });

  test("creates rooms, enforces unique names, and persists to disk", async () => {
    const created = await service.createRoom({
      name: "cli-features-epic",
      purpose: "Coordination room",
    });

    await expect(
      service.createRoom({
        name: "CLI-FEATURES-EPIC",
      }),
    ).rejects.toMatchObject<Partial<ChatServiceError>>({
      code: "chat_room_name_taken",
    });

    // One file per room, so a busy room no longer rewrites every other one.
    const raw = await readFile(path.join(paseoHome, "chat", "rooms", `${created.id}.json`), "utf8");
    expect(raw).toContain("cli-features-epic");
    expect(created.name).toBe("cli-features-epic");
    expect(created.purpose).toBe("Coordination room");
    expect(created.messageCount).toBe(0);
  });

  test("resolves rooms by name or ID, validates replies, and reads filtered messages", async () => {
    const room = await service.createRoom({ name: "auth-refactor" });
    const first = await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-a",
      body: "first message for @agent-b and @agent-c and again @agent-b",
    });
    await sendChatMessage({
      room: room.id,
      authorAgentId: "agent-b",
      body: "reply",
      replyToMessageId: first.id,
    });

    await expect(
      sendChatMessage({
        room: room.name,
        authorAgentId: "agent-b",
        body: "bad reply",
        replyToMessageId: "missing",
      }),
    ).rejects.toMatchObject<Partial<ChatServiceError>>({
      code: "chat_message_not_found",
    });

    const all = await service.readMessages({ room: room.name, limit: 10 });
    expect(all).toHaveLength(2);
    expect(all[0]?.mentionAgentIds).toEqual(["agent-b", "agent-c"]);

    const byAuthor = await service.readMessages({
      room: room.id,
      authorAgentId: "agent-b",
      limit: 10,
    });
    expect(byAuthor).toHaveLength(1);
    expect(byAuthor[0]?.body).toBe("reply");

    const detail = await service.inspectRoom({ room: room.name });
    expect(detail.room.messageCount).toBe(2);
    expect(detail.room.lastMessageAt).toBeTruthy();
  });

  test("lists unique agents who have posted to a room", async () => {
    const room = await service.createRoom({ name: "incident-room" });
    const otherRoom = await service.createRoom({ name: "other-room" });
    await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-a",
      body: "first",
    });
    await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-b",
      body: "second",
    });
    await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-a",
      body: "third",
    });
    await sendChatMessage({
      room: otherRoom.name,
      authorAgentId: "unrelated-agent",
      body: "different room",
    });

    await expect(service.listRoomPosterAgentIds({ room: room.name })).resolves.toEqual([
      "agent-a",
      "agent-b",
    ]);
  });

  test("waits for new messages after a cursor and times out with an empty result", async () => {
    const room = await service.createRoom({ name: "loop-status" });
    const first = await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-a",
      body: "ready",
    });

    const waitPromise = service.waitForMessages({
      room: room.name,
      afterMessageId: first.id,
      timeoutMs: 1000,
    });
    await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-b",
      body: "new work",
    });

    const waited = await waitPromise;
    expect(waited).toHaveLength(1);
    expect(waited[0]?.body).toBe("new work");

    const timedOut = await service.waitForMessages({
      room: room.name,
      afterMessageId: waited[0]?.id,
      timeoutMs: 10,
    });
    expect(timedOut).toEqual([]);
  });

  test("deletes rooms, removes messages, and rejects pending waiters", async () => {
    const room = await service.createRoom({ name: "schedule-jobs" });
    await sendChatMessage({
      room: room.name,
      authorAgentId: "agent-a",
      body: "hello",
    });

    const waitPromise = service.waitForMessages({
      room: room.name,
      timeoutMs: 1000,
    });
    const deleted = await service.deleteRoom({ room: room.id });
    expect(deleted.room.messageCount).toBe(1);

    await expect(waitPromise).rejects.toMatchObject<Partial<ChatServiceError>>({
      code: "chat_room_deleted",
    });
    await expect(service.inspectRoom({ room: room.name })).rejects.toMatchObject<
      Partial<ChatServiceError>
    >({
      code: "chat_room_not_found",
    });
  });

  // The room has to be able to say who spoke. `authorAgentId` carries a client
  // id for a human, which nothing downstream could tell apart from an agent id.
  describe("message authors", () => {
    test("records an agent author", async () => {
      const room = await service.createRoom({ name: "authored" });

      const message = await service.post({
        actor: { kind: "agent", id: "agent-lead" },
        room: room.name,
        body: "assigned the server work",
      });

      expect(message.author).toEqual({ kind: "agent", id: "agent-lead" });
      // Still written for clients that predate the author model.
      expect(message.authorAgentId).toBe("agent-lead");
    });

    test("records a human author and keeps them out of the poster list", async () => {
      const room = await service.createRoom({ name: "human-authored" });
      await service.post({
        actor: { kind: "agent", id: "agent-lead" },
        room: room.name,
        body: "ready",
      });

      const message = await service.post({
        actor: { kind: "human", id: "client-42" },
        room: room.name,
        body: "put it in the sidebar instead",
      });

      expect(message.author).toEqual({ kind: "human", id: "client-42" });
      expect(message.authorAgentId).toBe("client-42");
      // Mention fanout targets agents that spoke in the room; a human is not one.
      await expect(service.listRoomPosterAgentIds({ room: room.name })).resolves.toEqual([
        "agent-lead",
      ]);
    });

    test("reads back an author that was persisted", async () => {
      const room = await service.createRoom({ name: "reloaded" });
      await service.post({
        actor: { kind: "human", id: "client-42" },
        room: room.name,
        body: "hello",
      });

      const reloaded = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
      });
      const [message] = await reloaded.readMessages({ room: room.name });
      expect(message.author).toEqual({ kind: "human", id: "client-42" });
    });

    test("treats a message written before the author model as an agent", async () => {
      const room = await service.createRoom({ name: "legacy-author" });
      const message = await service.dispatchMessage({
        room: room.name,
        authorAgentId: "agent-a",
        body: "posted the old way",
      });

      expect(message.author).toEqual({ kind: "agent", id: "agent-a" });
    });
  });

  describe("mention fanout", () => {
    test("notifies mentioned agents through the service, not the caller", async () => {
      const notified: Array<{ room: string; mentionAgentIds: string[]; authorId: string }> = [];
      const withNotifier = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
        notifyMentions: async (input) => {
          notified.push({
            room: input.roomId,
            mentionAgentIds: input.mentionAgentIds,
            authorId: input.actor.id,
          });
        },
      });
      const room = await withNotifier.createRoom({ name: "fanout" });

      await withNotifier.post({
        actor: { kind: "human", id: "client-42" },
        room: room.name,
        body: "@agent-impl please pick this up",
      });

      expect(notified).toEqual([
        { room: room.id, mentionAgentIds: ["agent-impl"], authorId: "client-42" },
      ]);
    });

    test("a failing notifier does not lose the message", async () => {
      const withNotifier = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
        notifyMentions: async () => {
          throw new Error("waking the agent blew up");
        },
      });
      const room = await withNotifier.createRoom({ name: "fanout-failure" });

      const message = await withNotifier.post({
        actor: { kind: "agent", id: "agent-lead" },
        room: room.name,
        body: "@agent-impl heads up",
      });

      expect(message.body).toBe("@agent-impl heads up");
      expect(await withNotifier.readMessages({ room: room.name })).toHaveLength(1);
    });
  });

  test("extracts inline mentions from chat bodies", () => {
    expect(
      parseMentionAgentIds(
        "Checking with @agent-a, (@agent_b), @everyone, and duplicate @agent-a again.",
      ),
    ).toEqual(["agent-a", "agent_b", "everyone"]);
    expect(parseMentionAgentIds("email@example.com is not a mention")).toEqual([]);
  });
});
