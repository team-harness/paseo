import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { FileBackedChatService } from "./chat-service.js";

const logger = createTestLogger();

/**
 * DEC-9. The invariant that makes this safe: nothing writes the new layout
 * before the marker lands. While the legacy file is still in place it is the
 * only authority, so every room file is rewritten from it and no newer-wins
 * comparison is needed — the legacy copy is always the newer one.
 */
describe("chat store migration", () => {
  let home: string;
  let chatDir: string;

  const legacyPayload = {
    rooms: [
      {
        id: "room-1",
        name: "team-1",
        purpose: "Coordination",
        createdAt: "2026-08-06T10:00:00.000Z",
        updatedAt: "2026-08-06T10:05:00.000Z",
      },
      {
        id: "room-2",
        name: "standup",
        purpose: null,
        createdAt: "2026-08-06T09:00:00.000Z",
        updatedAt: "2026-08-06T09:30:00.000Z",
      },
    ],
    messages: [
      {
        id: "msg-1",
        roomId: "room-1",
        authorAgentId: "agent-lead",
        body: "first",
        replyToMessageId: null,
        mentionAgentIds: [],
        createdAt: "2026-08-06T10:01:00.000Z",
      },
      {
        id: "msg-2",
        roomId: "room-1",
        authorAgentId: "agent-impl",
        body: "second",
        replyToMessageId: "msg-1",
        mentionAgentIds: [],
        createdAt: "2026-08-06T10:02:00.000Z",
      },
      {
        id: "msg-3",
        roomId: "room-2",
        authorAgentId: "agent-lead",
        body: "standup note",
        replyToMessageId: null,
        mentionAgentIds: [],
        createdAt: "2026-08-06T09:10:00.000Z",
      },
    ],
  };

  async function writeLegacy(payload: unknown = legacyPayload): Promise<void> {
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "rooms.json"), JSON.stringify(payload), "utf8");
  }

  async function listRoomFiles(): Promise<string[]> {
    try {
      return (await readdir(join(chatDir, "rooms"))).sort();
    } catch {
      return [];
    }
  }

  async function exists(relative: string): Promise<boolean> {
    try {
      await readFile(join(chatDir, relative));
      return true;
    } catch {
      return false;
    }
  }

  function createService(): FileBackedChatService {
    return new FileBackedChatService({ paseoHome: home, logger });
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "chat-migration-"));
    chatDir = join(home, "chat");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("moves an existing store to per-room files, preserving ids, order and timestamps", async () => {
    await writeLegacy();

    const service = createService();
    await service.initialize();

    expect(await listRoomFiles()).toEqual(["room-1.json", "room-2.json"]);
    expect(await exists(".migrated")).toBe(true);
    // The original is kept, renamed, and never read again.
    expect(await exists("rooms.json.bak")).toBe(true);
    expect(await exists("rooms.json")).toBe(false);

    const messages = await service.readMessages({ room: "room-1" });
    expect(messages.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
    expect(messages[0].createdAt).toBe("2026-08-06T10:01:00.000Z");
    expect(messages[1].replyToMessageId).toBe("msg-1");

    const rooms = await service.listRooms();
    expect(rooms.map((room) => room.id).sort()).toEqual(["room-1", "room-2"]);
    expect(rooms.find((room) => room.id === "room-1")?.createdAt).toBe("2026-08-06T10:00:00.000Z");
  });

  test("starts clean when there is nothing to migrate", async () => {
    const service = createService();
    await service.initialize();

    expect(await service.listRooms()).toEqual([]);
    expect(await exists(".migrated")).toBe(true);
  });

  test("finishes a migration interrupted after some room files were written", async () => {
    await writeLegacy();
    await mkdir(join(chatDir, "rooms"), { recursive: true });
    // room-1 already landed; the process died before room-2.
    await writeFile(
      join(chatDir, "rooms", "room-1.json"),
      JSON.stringify({
        room: legacyPayload.rooms[0],
        messages: legacyPayload.messages.slice(0, 2),
      }),
      "utf8",
    );

    const service = createService();
    await service.initialize();

    expect(await listRoomFiles()).toEqual(["room-1.json", "room-2.json"]);
    expect(await exists(".migrated")).toBe(true);
    expect((await service.readMessages({ room: "room-1" })).map((m) => m.id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
    expect((await service.readMessages({ room: "room-2" })).map((m) => m.id)).toEqual(["msg-3"]);
  });

  // The partial room file is this migration's own earlier attempt, but the
  // legacy file it was made from has moved on: the user downgraded to a daemon
  // that still writes the legacy layout, chatted, then upgraded again. Before
  // the marker, the legacy file is the only authority.
  test("picks up messages the legacy file gained since a partial migration", async () => {
    const laterMessage = {
      id: "msg-4",
      roomId: "room-1",
      authorAgentId: "agent-lead",
      body: "written while downgraded",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-08-06T11:00:00.000Z",
    };
    await writeLegacy({
      ...legacyPayload,
      messages: [...legacyPayload.messages, laterMessage],
    });
    await mkdir(join(chatDir, "rooms"), { recursive: true });
    await writeFile(
      join(chatDir, "rooms", "room-1.json"),
      JSON.stringify({
        room: legacyPayload.rooms[0],
        messages: legacyPayload.messages.slice(0, 2),
      }),
      "utf8",
    );

    const service = createService();
    await service.initialize();

    expect((await service.readMessages({ room: "room-1" })).map((m) => m.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-4",
    ]);
  });

  test("finishes a migration interrupted after the rename but before the marker", async () => {
    await mkdir(join(chatDir, "rooms"), { recursive: true });
    await writeFile(
      join(chatDir, "rooms", "room-1.json"),
      JSON.stringify({
        room: legacyPayload.rooms[0],
        messages: legacyPayload.messages.slice(0, 2),
      }),
      "utf8",
    );
    await writeFile(join(chatDir, "rooms.json.bak"), JSON.stringify(legacyPayload), "utf8");

    const service = createService();
    await service.initialize();

    // The rename already happened, so the per-room files are complete by
    // definition; only the marker is missing.
    expect(await exists(".migrated")).toBe(true);
    expect((await service.readMessages({ room: "room-1" })).map((m) => m.id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
  });

  test("is a no-op once the marker exists, even if a legacy file reappears", async () => {
    await writeLegacy();
    await (await Promise.resolve(createService())).initialize();

    // Something drops an old file back in; the marker means it is not ours.
    await writeFile(
      join(chatDir, "rooms.json"),
      JSON.stringify({ rooms: [], messages: [] }),
      "utf8",
    );

    const second = createService();
    await second.initialize();

    expect((await second.listRooms()).map((room) => room.id).sort()).toEqual(["room-1", "room-2"]);
    expect(await exists("rooms.json")).toBe(true);
  });

  test("repeated starts leave the store unchanged", async () => {
    await writeLegacy();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const service = createService();
      await service.initialize();
      expect((await service.listRooms()).map((room) => room.id).sort()).toEqual([
        "room-1",
        "room-2",
      ]);
    }
    expect(await listRoomFiles()).toEqual(["room-1.json", "room-2.json"]);
  });

  test("carries over what it can when the legacy file is damaged", async () => {
    await writeLegacy({
      rooms: legacyPayload.rooms,
      messages: [
        legacyPayload.messages[0],
        { id: "broken", roomId: "room-1" },
        legacyPayload.messages[2],
      ],
    });

    const service = createService();
    await service.initialize();

    // The unreadable entry is dropped; everything else still migrates, and the
    // original file is never edited.
    expect((await service.readMessages({ room: "room-1" })).map((m) => m.id)).toEqual(["msg-1"]);
    expect((await service.readMessages({ room: "room-2" })).map((m) => m.id)).toEqual(["msg-3"]);
    expect(await exists("rooms.json.bak")).toBe(true);
  });

  // One bad room used to fail the whole payload, and the marker went down
  // anyway — every healthy conversation in the file gone, silently, forever.
  test("carries over the healthy rooms when one room entry is damaged", async () => {
    await writeLegacy({
      rooms: [legacyPayload.rooms[0], { id: "room-broken" }, legacyPayload.rooms[1]],
      messages: legacyPayload.messages,
    });

    const service = createService();
    await service.initialize();

    expect(await listRoomFiles()).toEqual(["room-1.json", "room-2.json"]);
    expect((await service.readMessages({ room: "room-1" })).map((m) => m.id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
    expect((await service.readMessages({ room: "room-2" })).map((m) => m.id)).toEqual(["msg-3"]);
  });

  // Refusing to start is bad; starting with an empty chat store and a marker
  // that says "done" is worse, because the legacy file is then unreachable.
  test("starts with chat unavailable rather than declaring an unreadable store migrated", async () => {
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "rooms.json"), "{ not json at all", "utf8");

    const service = createService();
    await service.initialize();

    expect(await service.listRooms()).toEqual([]);
    // No marker and no rename: the legacy file is still there to be recovered,
    // and the next start will try again.
    expect(await exists(".migrated")).toBe(false);
    expect(await exists("rooms.json")).toBe(true);
    expect(await exists("rooms.json.bak")).toBe(false);
  });

  // Coming up empty is only safe if it also stays read-only. A room created
  // now would be overwritten the moment the legacy file is repaired and the
  // migration finally runs, because that migration rewrites every room from it.
  test("refuses to write while an unreadable legacy store is still unmigrated", async () => {
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "rooms.json"), "{ not json at all", "utf8");

    const service = createService();
    await service.initialize();

    await expect(service.createRoom({ name: "new-room" })).rejects.toMatchObject({
      code: "chat_store_unavailable",
    });
    expect(await listRoomFiles()).toEqual([]);
  });

  // The legacy file is the whole truth while it is in place, not just an
  // upper bound on it: a room deleted while downgraded must stay deleted.
  test("removes a room file the legacy store no longer has", async () => {
    await writeLegacy({
      rooms: [legacyPayload.rooms[0]],
      messages: legacyPayload.messages.slice(0, 2),
    });
    await mkdir(join(chatDir, "rooms"), { recursive: true });
    // A previous attempt wrote room-2; the legacy file has since lost it.
    await writeFile(
      join(chatDir, "rooms", "room-2.json"),
      JSON.stringify({
        room: legacyPayload.rooms[1],
        messages: [legacyPayload.messages[2]],
      }),
      "utf8",
    );

    const service = createService();
    await service.initialize();

    expect(await listRoomFiles()).toEqual(["room-1.json"]);
    expect((await service.listRooms()).map((room) => room.name)).toEqual(["team-1"]);
  });
});
