import { describe, expect, it, vi } from "vitest";

import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

import { postRoomMessage, type PostRoomMessageState } from "./post-room-message";

const LABELS = { refused: "That message was not posted.", offline: "The host is not connected." };

function message(): TeamRoomMessage {
  return {
    id: "m-1",
    missionId: "mission-1",
    roomId: "room-1",
    authorAgentId: "client-1",
    author: { kind: "human", id: "client-1" },
    body: "hello",
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-08-06T10:00:00.000Z",
  };
}

function gateway(answer: { message: TeamRoomMessage | null; error: string | null } | Error) {
  return {
    postTeamMissionMessage: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}

describe("saying something in a team's room", () => {
  it("goes through pending and back to idle", async () => {
    const seen: PostRoomMessageState[] = [];

    await postRoomMessage(
      {
        missionId: "mission-1",
        body: "hello",
        client: gateway({ message: message(), error: null }),
      },
      LABELS,
      (state) => seen.push(state),
    );

    // The daemon broadcasts the message back, so the timeline learns about it
    // the same way it learns about everyone else's.
    expect(seen.map((state) => state.status)).toEqual(["pending", "idle"]);
  });

  it("sends the room and the body it was given", async () => {
    const client = gateway({ message: message(), error: null });

    await postRoomMessage({ missionId: "mission-1", body: "hello", client }, LABELS, () => {});

    expect(client.postTeamMissionMessage).toHaveBeenCalledWith({
      missionId: "mission-1",
      body: "hello",
    });
  });

  it("keeps the daemon's reason when it refuses", async () => {
    const seen: PostRoomMessageState[] = [];

    await postRoomMessage(
      {
        missionId: "mission-1",
        body: "hello",
        client: gateway({ message: null, error: "Room is gone" }),
      },
      LABELS,
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({ status: "failure", message: "Room is gone" });
  });

  it("says something when the daemon refuses without saying why", async () => {
    // A null message and no error is still a message that did not land. Going
    // back to idle would clear the composer over a post that never happened.
    const seen: PostRoomMessageState[] = [];

    await postRoomMessage(
      { missionId: "mission-1", body: "hello", client: gateway({ message: null, error: null }) },
      LABELS,
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({ status: "failure", message: LABELS.refused });
  });

  it("reports a request that never got an answer", async () => {
    const seen: PostRoomMessageState[] = [];

    await postRoomMessage(
      {
        missionId: "mission-1",
        body: "hello",
        client: gateway(new Error("The connection dropped")),
      },
      LABELS,
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({ status: "failure", message: "The connection dropped" });
  });

  it("refuses to send with no host rather than doing nothing", async () => {
    const seen: PostRoomMessageState[] = [];

    await postRoomMessage(
      { missionId: "mission-1", body: "hello", client: null },
      LABELS,
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({ status: "failure", message: LABELS.offline });
  });

  it("does not send an empty message", async () => {
    const client = gateway({ message: message(), error: null });
    const seen: PostRoomMessageState[] = [];

    await postRoomMessage({ missionId: "mission-1", body: "   ", client }, LABELS, (state) =>
      seen.push(state),
    );

    expect(client.postTeamMissionMessage).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it("trims what it sends", async () => {
    const client = gateway({ message: message(), error: null });

    await postRoomMessage({ missionId: "mission-1", body: "  hello  ", client }, LABELS, () => {});

    expect(client.postTeamMissionMessage).toHaveBeenCalledWith({
      missionId: "mission-1",
      body: "hello",
    });
  });
});
