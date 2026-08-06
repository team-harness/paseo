import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import {
  type ChatRoomMessageEvent,
  type ChatServiceError,
  FileBackedChatService,
  parseMentionAgentIds,
  type PostChatMessageInput,
} from "./chat-service.js";

describe("FileBackedChatService", () => {
  let paseoHome: string;
  let service: FileBackedChatService;

  async function sendChatMessage(input: PostChatMessageInput) {
    return await service.post({
      actor: { kind: "agent", id: input.authorAgentId },
      room: input.room,
      body: input.body,
      replyToMessageId: input.replyToMessageId,
    });
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

    // `@everyone` expands to the agents that spoke in the room. A message from
    // before the author model cannot say whether it was one, and counting it as
    // an agent both inflates that list against its cap and risks waking a real
    // agent whose id happens to match some old client id.
    test("keeps messages of unknown authorship out of the poster list", async () => {
      const room = await service.createRoom({ name: "mixed-authors" });
      await service.post({
        actor: { kind: "agent", id: "agent-lead" },
        room: room.name,
        body: "ready",
      });
      await writeFile(
        path.join(paseoHome, "chat", "rooms", `${room.id}.json`),
        JSON.stringify({
          room: { ...room, messageCount: undefined, lastMessageAt: undefined },
          messages: [
            {
              id: "msg-legacy",
              roomId: room.id,
              authorAgentId: "client-42",
              body: "posted the old way",
              replyToMessageId: null,
              mentionAgentIds: [],
              createdAt: "2026-08-06T10:00:00.000Z",
            },
            {
              id: "msg-known",
              roomId: room.id,
              authorAgentId: "agent-lead",
              body: "ready",
              replyToMessageId: null,
              mentionAgentIds: [],
              createdAt: "2026-08-06T10:01:00.000Z",
              author: { kind: "agent", id: "agent-lead" },
            },
          ],
        }),
        "utf8",
      );

      const reloaded = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
      });
      await reloaded.initialize();

      await expect(reloaded.listRoomPosterAgentIds({ room: room.id })).resolves.toEqual([
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

    // Messages stored before the author model have no `author`, and nothing can
    // recover it: a human posting back then had their client id written to
    // `authorAgentId`, which reads exactly like an agent id. Guessing "agent"
    // would turn a client id into an agent that mention fanout goes looking for,
    // and the guess becomes permanent the next time the room is written.
    test("leaves the author unknown on a message written before the author model", async () => {
      const room = await service.createRoom({ name: "legacy-author" });
      await writeFile(
        path.join(paseoHome, "chat", "rooms", `${room.id}.json`),
        JSON.stringify({
          room: { ...room, messageCount: undefined, lastMessageAt: undefined },
          messages: [
            {
              id: "msg-legacy",
              roomId: room.id,
              authorAgentId: "client-42",
              body: "posted the old way",
              replyToMessageId: null,
              mentionAgentIds: [],
              createdAt: "2026-08-06T10:00:00.000Z",
            },
          ],
        }),
        "utf8",
      );

      const reloaded = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
      });
      await reloaded.initialize();

      const [message] = await reloaded.readMessages({ room: room.id });
      expect(message?.body).toBe("posted the old way");
      expect(message?.authorAgentId).toBe("client-42");
      expect(message?.author).toBeUndefined();

      // Reading does not rewrite the guess into the file either.
      const raw = await readFile(path.join(paseoHome, "chat", "rooms", `${room.id}.json`), "utf8");
      expect(raw).not.toContain('"author"');
    });
  });

  // A team's room follows the team's lifecycle, so it cannot be a room anyone
  // may delete, and replaying a team's creation must find the room it made
  // rather than make a second one.
  // One file per room buys blast-radius containment, which only holds if a
  // damaged file is skipped rather than allowed to fail the whole load.
  describe("damaged room files", () => {
    async function reload(): Promise<FileBackedChatService> {
      const reloaded = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
      });
      await reloaded.initialize();
      return reloaded;
    }

    function roomName(room: { name: string }): string {
      return room.name;
    }

    async function damage(roomId: string, contents: string): Promise<void> {
      await writeFile(path.join(paseoHome, "chat", "rooms", `${roomId}.json`), contents, "utf8");
    }

    test("skips a room whose file is not valid JSON and keeps the rest", async () => {
      const healthy = await service.createRoom({ name: "healthy", purpose: "keeps working" });
      const damaged = await service.createRoom({ name: "damaged", purpose: "gets corrupted" });
      await sendChatMessage({ room: healthy.id, authorAgentId: "agent-a", body: "still here" });
      await damage(damaged.id, "{ this is not json");

      const reloaded = await reload();

      expect((await reloaded.listRooms()).map(roomName)).toEqual(["healthy"]);
      expect((await reloaded.readRoomPage({ room: healthy.id })).messages).toHaveLength(1);
    });

    test("skips a room whose file is JSON but not a room and keeps the rest", async () => {
      await service.createRoom({ name: "healthy", purpose: "keeps working" });
      const damaged = await service.createRoom({ name: "damaged", purpose: "gets truncated" });
      await damage(damaged.id, JSON.stringify({ room: { id: damaged.id } }));

      const reloaded = await reload();

      expect((await reloaded.listRooms()).map(roomName)).toEqual(["healthy"]);
    });

    // A skipped room is gone, not half-present: its name has to be free again,
    // or the room is unusable and unrecreatable.
    test("frees the name of a room that was skipped", async () => {
      const damaged = await service.createRoom({ name: "damaged", purpose: "gets corrupted" });
      await damage(damaged.id, "{ this is not json");

      const reloaded = await reload();
      const recreated = await reloaded.createRoom({ name: "damaged", purpose: "fresh start" });

      expect(recreated.name).toBe("damaged");
      expect(await reloaded.listRooms()).toHaveLength(1);
    });
  });

  describe("owned rooms", () => {
    const owner = { ownerKind: "team" as const, ownerId: "team-1" };

    test("creates a room under a caller-supplied id and owner", async () => {
      const room = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        displayName: "Disk usage",
        ...owner,
      });

      expect(room.id).toBe("room-team-1");
      expect(room.ownerKind).toBe("team");
      expect(room.ownerId).toBe("team-1");
      // The internal name stays unique; the display name is what a human reads.
      expect(room.name).toBe("team-team-1");
      expect(room.displayName).toBe("Disk usage");
    });

    test("returns the existing room when the same owner asks again", async () => {
      const first = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });
      const second = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });

      expect(second.id).toBe(first.id);
      expect(await service.listRooms()).toHaveLength(1);
    });

    test("refuses an id that belongs to a different owner", async () => {
      await service.createRoom({ roomId: "room-team-1", name: "team-team-1", ...owner });

      await expect(
        service.createRoom({
          roomId: "room-team-1",
          name: "team-team-1",
          ownerKind: "team",
          ownerId: "team-2",
        }),
      ).rejects.toMatchObject<Partial<ChatServiceError>>({ code: "chat_room_owner_conflict" });
    });

    // A replay repeats the request. A request that differs is a different
    // request against a taken id, and quietly handing back the old room would
    // leave the caller believing settings it never got.
    test("refuses a second create that asks for the same id with a different name", async () => {
      await service.createRoom({ roomId: "room-team-1", name: "team-team-1", ...owner });

      await expect(
        service.createRoom({ roomId: "room-team-1", name: "team-team-1-renamed", ...owner }),
      ).rejects.toMatchObject<Partial<ChatServiceError>>({
        code: "chat_room_config_conflict",
      });
    });

    // An owner half-specified is an owner nobody can be: generic delete refuses
    // the room because it is owned, and no discard call can match the owner.
    // The id becomes a filename. A caller that can pick it can otherwise pick
    // where in the filesystem the room is written, and deleted.
    test("refuses a room id that is not a single safe path segment", async () => {
      for (const roomId of ["../../teams/victim", "nested/room", "..", ".", ""]) {
        await expect(
          service.createRoom({ roomId, name: `room-${roomId || "empty"}`, ...owner }),
        ).rejects.toMatchObject<Partial<ChatServiceError>>({
          code: "invalid_chat_room_id",
        });
      }
    });

    test("refuses an owner kind with no owner id", async () => {
      await expect(
        service.createRoom({ roomId: "room-team-1", name: "team-team-1", ownerKind: "team" }),
      ).rejects.toMatchObject<Partial<ChatServiceError>>({
        code: "invalid_chat_room_owner",
      });
    });

    test("refuses a taken id that has no owner at all", async () => {
      const plain = await service.createRoom({ name: "free-for-all" });

      await expect(
        service.createRoom({ roomId: plain.id, name: "team-team-1", ...owner }),
      ).rejects.toMatchObject<Partial<ChatServiceError>>({ code: "chat_room_owner_conflict" });
    });

    test("refuses a generic delete of an owned room", async () => {
      const room = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });

      await expect(service.deleteRoom({ room: room.id })).rejects.toMatchObject<
        Partial<ChatServiceError>
      >({ code: "chat_room_owned" });
      await expect(service.inspectRoom({ room: room.id })).resolves.toBeTruthy();
    });

    test("lets the owner discard its own room", async () => {
      const room = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });

      await service.discardOwnedRoom({ roomId: room.id, ...owner });

      await expect(service.inspectRoom({ room: room.id })).rejects.toMatchObject<
        Partial<ChatServiceError>
      >({ code: "chat_room_not_found" });
    });

    test("refuses to discard a room owned by someone else", async () => {
      const room = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });

      await expect(
        service.discardOwnedRoom({ roomId: room.id, ownerKind: "team", ownerId: "team-2" }),
      ).rejects.toMatchObject<Partial<ChatServiceError>>({ code: "chat_room_owner_conflict" });
    });

    test("discarding a room that is already gone is not an error", async () => {
      // The team reconciler reruns cleanup after a crash; a second pass must not
      // fail just because the first one finished.
      await expect(
        service.discardOwnedRoom({ roomId: "never-existed", ...owner }),
      ).resolves.toBeUndefined();
    });

    // The post appends in memory, then awaits. If the room goes away in that
    // window, its persist finds nothing to write and treats that as the room
    // having been deleted — so the post reports success and broadcasts a
    // message that is on no disk anywhere.
    test("a post that loses the race with a discard fails instead of vanishing", async () => {
      const room = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });
      const delivered: string[] = [];
      function recordDelivery(event: ChatRoomMessageEvent): void {
        delivered.push(event.message.id);
      }
      service.onRoomMessage(recordDelivery);

      const posted = service.post({
        actor: { kind: "agent", id: "agent-a" },
        room: room.id,
        body: "into the void",
      });
      // Let the post get past its own append and onto the persist queue, which
      // is the window where the room can still disappear underneath it.
      for (let step = 0; step < 4; step += 1) {
        await Promise.resolve();
      }
      const discarded = service.discardOwnedRoom({ roomId: room.id, ...owner });

      await expect(posted).rejects.toMatchObject<Partial<ChatServiceError>>({
        code: "chat_room_not_found",
      });
      await expect(discarded).resolves.toBeUndefined();
      expect(delivered).toEqual([]);
      expect(await service.listRooms()).toEqual([]);
    });

    // Ids are chosen by the caller and get reused — a team room is named after
    // its team. A room that takes over an id inherits nothing from the one it
    // replaced.
    test("a room that reuses an id starts empty", async () => {
      const room = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1",
        ...owner,
      });
      await service.post({
        actor: { kind: "agent", id: "agent-a" },
        room: room.id,
        body: "belongs to the first room",
      });
      await service.discardOwnedRoom({ roomId: room.id, ...owner });

      const replacement = await service.createRoom({
        roomId: "room-team-1",
        name: "team-team-1-again",
        ownerKind: "team",
        ownerId: "team-2",
      });

      expect(replacement.messageCount).toBe(0);
      const page = await service.readRoomPage({ room: "room-team-1" });
      expect(page.messages).toEqual([]);
      expect(page.cursor).toBe(0);
    });
  });

  // Reading and then waiting cannot start following a room without a gap or a
  // duplicate between the two calls, so a page and its cursor come back together
  // and every later message arrives with the next cursor.
  describe("room pages and live subscription", () => {
    async function seed(room: string, count: number) {
      for (let index = 0; index < count; index += 1) {
        await service.post({
          actor: { kind: "agent", id: "agent-a" },
          room,
          body: `message ${index}`,
        });
      }
    }

    // Hoisted out of the tests: an inline listener inside an async test body
    // nests one callback deeper than the lint budget allows.
    function collectBodies(sink: string[]) {
      return (event: ChatRoomMessageEvent) => {
        sink.push(event.message.body);
      };
    }

    function collectCursors(sink: number[]) {
      return (event: ChatRoomMessageEvent) => {
        sink.push(event.cursor);
      };
    }

    function collectEvents(sink: Array<{ roomId: string; body: string; cursor: number }>) {
      return (event: ChatRoomMessageEvent) => {
        sink.push({ roomId: event.roomId, body: event.message.body, cursor: event.cursor });
      };
    }

    function throwingSubscriber(): never {
      throw new Error("subscriber blew up");
    }

    function cursorOf(event: { cursor: number }): number {
      return event.cursor;
    }

    function bodiesOf(messages: Array<{ body: string }>): string[] {
      return messages.map((message) => message.body);
    }

    test("returns the newest page and its cursor when no cursor is given", async () => {
      const room = await service.createRoom({ name: "paged" });
      await seed(room.name, 5);

      const page = await service.readRoomPage({ room: room.name, limit: 2 });

      expect(bodiesOf(page.messages)).toEqual(["message 3", "message 4"]);
      expect(page.cursor).toBe(5);
      expect(page.hasMore).toBe(false);
    });

    test("resumes after a cursor in ascending order", async () => {
      const room = await service.createRoom({ name: "resumed" });
      await seed(room.name, 5);

      const page = await service.readRoomPage({ room: room.name, afterCursor: 1, limit: 2 });

      expect(bodiesOf(page.messages)).toEqual(["message 1", "message 2"]);
      expect(page.cursor).toBe(3);
      // Two more messages sit between this page and the newest one.
      expect(page.hasMore).toBe(true);
    });

    test("reports the backlog as drained on the last catch-up page", async () => {
      const room = await service.createRoom({ name: "drained" });
      await seed(room.name, 3);

      const page = await service.readRoomPage({ room: room.name, afterCursor: 1, limit: 10 });

      expect(bodiesOf(page.messages)).toEqual(["message 1", "message 2"]);
      expect(page.cursor).toBe(3);
      expect(page.hasMore).toBe(false);
    });

    test("an empty room pages to an empty result at cursor zero", async () => {
      const room = await service.createRoom({ name: "empty" });

      const page = await service.readRoomPage({ room: room.name });

      expect(page.messages).toEqual([]);
      expect(page.cursor).toBe(0);
      expect(page.hasMore).toBe(false);
    });

    // The cursor is what a client dedupes and resumes on, so two messages
    // sharing one is worse than a wrong number: the client keeps the first and
    // discards the rest as replays it has already seen.
    test("gives concurrent posts distinct, ascending cursors", async () => {
      const room = await service.createRoom({ name: "concurrent" });
      const seen: Array<{ roomId: string; body: string; cursor: number }> = [];
      service.onRoomMessage(collectEvents(seen));

      await Promise.all([
        service.post({ actor: { kind: "agent", id: "agent-a" }, room: room.name, body: "one" }),
        service.post({ actor: { kind: "agent", id: "agent-b" }, room: room.name, body: "two" }),
        service.post({ actor: { kind: "agent", id: "agent-c" }, room: room.name, body: "three" }),
      ]);

      expect(seen.map(cursorOf).sort()).toEqual([1, 2, 3]);
    });

    // A cursor past the end would have the client discard everything up to it.
    test("clamps a cursor past the end of the room", async () => {
      const room = await service.createRoom({ name: "overshot" });
      await seed(room.name, 3);

      const page = await service.readRoomPage({ room: room.name, afterCursor: 100 });

      expect(page.messages).toEqual([]);
      expect(page.cursor).toBe(3);
      expect(page.hasMore).toBe(false);
    });

    test("hands every new message to subscribers with its cursor", async () => {
      const room = await service.createRoom({ name: "live" });
      const seen: Array<{ roomId: string; body: string; cursor: number }> = [];
      service.onRoomMessage(collectEvents(seen));

      await seed(room.name, 2);

      expect(seen).toEqual([
        { roomId: room.id, body: "message 0", cursor: 1 },
        { roomId: room.id, body: "message 1", cursor: 2 },
      ]);
    });

    test("stops delivering once a subscriber unsubscribes", async () => {
      const room = await service.createRoom({ name: "unsubscribed" });
      const seen: string[] = [];
      const unsubscribe = service.onRoomMessage(collectBodies(seen));

      await seed(room.name, 1);
      unsubscribe();
      await seed(room.name, 1);

      expect(seen).toEqual(["message 0"]);
    });

    test("a throwing subscriber neither loses the message nor blocks the others", async () => {
      const room = await service.createRoom({ name: "faulty-subscriber" });
      const seen: string[] = [];
      service.onRoomMessage(throwingSubscriber);
      service.onRoomMessage(collectBodies(seen));

      await service.post({
        actor: { kind: "agent", id: "agent-a" },
        room: room.name,
        body: "still delivered",
      });

      expect(seen).toEqual(["still delivered"]);
      expect(await service.readMessages({ room: room.name })).toHaveLength(1);
    });

    test("a page taken now lines up with the cursors that follow it", async () => {
      const room = await service.createRoom({ name: "handover" });
      await seed(room.name, 3);

      const page = await service.readRoomPage({ room: room.name, limit: 10 });
      const live: number[] = [];
      service.onRoomMessage(collectCursors(live));
      await seed(room.name, 2);

      // No gap, no repeat: the subscription picks up exactly where the page ended.
      expect(page.cursor).toBe(3);
      expect(live).toEqual([4, 5]);
    });
  });

  describe("mention fanout", () => {
    test("notifies mentioned agents through the service, not the caller", async () => {
      const notified: Array<{ room: string; mentionAgentIds: string[]; authorId: string }> = [];
      const withNotifier = new FileBackedChatService({
        paseoHome,
        logger: pino({ level: "silent" }),
        mentionHandler: {
          notify: async (input) => {
            notified.push({
              room: input.roomId,
              mentionAgentIds: input.mentionAgentIds,
              authorId: input.actor.id,
            });
          },
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
        mentionHandler: {
          notify: async () => {
            throw new Error("waking the agent blew up");
          },
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
