import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MissionRoomMessageConflictError, MissionRoomStore } from "./mission-room-store.js";

describe("MissionRoomStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "mission-room-store-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("persists one Mission-owned room and replays a deterministic message once", async () => {
    const now = vi
      .fn<() => string>()
      .mockReturnValueOnce("2026-08-11T01:00:00.000Z")
      .mockReturnValueOnce("2026-08-11T01:01:00.000Z")
      .mockReturnValue("2026-08-11T01:02:00.000Z");
    const store = new MissionRoomStore(directory, now);
    await store.create({ missionId: "mission-1", roomId: "room-1", teamId: "team-1" });
    await store.create({ missionId: "mission-1", roomId: "room-1", teamId: "team-1" });

    const events: unknown[] = [];
    store.onMessage((event) => events.push(event));
    const input = {
      missionId: "mission-1",
      roomId: "room-1",
      messageId: "message-1",
      author: { kind: "agent" as const, id: "agent-1" },
      body: "Build the parser",
    };
    const first = await store.post(input);
    const replay = await store.post(input);

    expect(first).toEqual(replay);
    expect(events).toEqual([first]);
    await expect(
      new MissionRoomStore(directory, now).read({ missionId: "mission-1" }),
    ).resolves.toMatchObject({
      roomId: "room-1",
      cursor: 1,
      hasMore: false,
      messages: [
        { id: "message-1", missionId: "mission-1", author: { kind: "agent", id: "agent-1" } },
      ],
    });
  });

  test("pages forward by cursor and rejects a conflicting message replay", async () => {
    const store = new MissionRoomStore(directory, () => "2026-08-11T01:00:00.000Z");
    await store.create({ missionId: "mission-1", roomId: "room-1", teamId: "team-1" });
    for (const index of [1, 2, 3]) {
      await store.post({
        missionId: "mission-1",
        roomId: "room-1",
        messageId: `message-${index}`,
        author: { kind: "human", id: "client-1" },
        body: `Message ${index}`,
      });
    }

    await expect(
      store.read({ missionId: "mission-1", afterCursor: 1, limit: 1 }),
    ).resolves.toMatchObject({ cursor: 2, hasMore: true, messages: [{ id: "message-2" }] });
    await expect(
      store.post({
        missionId: "mission-1",
        roomId: "room-1",
        messageId: "message-1",
        author: { kind: "human", id: "client-1" },
        body: "Changed body",
      }),
    ).rejects.toBeInstanceOf(MissionRoomMessageConflictError);
  });
});
