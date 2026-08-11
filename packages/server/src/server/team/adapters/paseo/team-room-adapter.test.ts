import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { MissionRoomStore } from "../../persistence/mission-room-store.js";
import { PaseoTeamRoomAdapter } from "./team-room-adapter.js";

describe("PaseoTeamRoomAdapter", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-room-adapter-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("creates an owned Mission room idempotently and leaves deletion outside the port", async () => {
    const store = new MissionRoomStore(rootDirectory, () => "2026-08-11T01:00:00.000Z");
    const rooms = new PaseoTeamRoomAdapter(store);
    const input = {
      roomId: "room-1",
      teamId: "team-1",
      missionId: "mission-1",
      teamName: "Compiler team",
      objective: "Implement the parser",
    };

    await rooms.createMissionRoom(input);
    await rooms.createMissionRoom(input);

    expect(await store.read({ missionId: "mission-1" })).toMatchObject({
      roomId: "room-1",
      messages: [],
    });
    expect("discardRoom" in rooms).toBe(false);
  });

  test("posts a deterministic Agent message through the Mission-owned store", async () => {
    const store = new MissionRoomStore(rootDirectory, () => "2026-08-11T01:00:00.000Z");
    const rooms = new PaseoTeamRoomAdapter(store);
    await rooms.createMissionRoom({
      roomId: "room-message",
      teamId: "team-1",
      missionId: "mission-1",
      teamName: "Compiler team",
      objective: "Implement the parser",
    });

    const posted = await rooms.post({
      messageId: "message-1",
      missionId: "mission-1",
      roomId: "room-message",
      senderAgentId: "agent-lead",
      body: "@software-engineer implement the parser",
    });
    await rooms.post({
      messageId: "message-1",
      missionId: "mission-1",
      roomId: "room-message",
      senderAgentId: "agent-lead",
      body: "@software-engineer implement the parser",
    });

    expect((await store.read({ missionId: "mission-1" })).messages).toMatchObject([
      {
        id: "message-1",
        author: { kind: "agent", id: "agent-lead" },
        body: "@software-engineer implement the parser",
      },
    ]);
    expect(posted).toEqual({ messageId: "message-1", cursor: 1 });
    await expect(
      rooms.read({ missionId: "mission-1", roomId: "room-message", afterCursor: 0, limit: 20 }),
    ).resolves.toMatchObject({ cursor: 1, hasMore: false, messages: [{ id: "message-1" }] });
  });
});
