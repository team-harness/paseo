// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoomSubscriptionClient } from "./room-subscription";

const mocked = vi.hoisted(() => ({
  snapshot: null as {
    client: unknown;
    connectionEpoch: number;
    connectionStatus: "online" | "offline" | "connecting";
  } | null,
  t: (key: string) => key,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mocked.snapshot?.client ?? null,
  useHostRuntimeSnapshot: () => mocked.snapshot,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocked.t }),
}));

import { useRoomSubscription } from "./use-room-subscription";

function createClient(): RoomSubscriptionClient {
  return {
    on: vi.fn(() => () => undefined),
    subscribeTeamMissionRoom: vi.fn(async ({ missionId }) => ({
      requestId: "subscribe-room",
      missionId,
      messages: [],
      cursor: 0,
      hasMore: false,
      error: null,
    })),
    unsubscribeTeamMissionRoom: vi.fn(async () => undefined),
  };
}

describe("useRoomSubscription", () => {
  afterEach(() => {
    cleanup();
    mocked.snapshot = null;
  });

  it("resubscribes when the same client reconnects on a new physical source", async () => {
    const client = createClient();
    mocked.snapshot = { client, connectionEpoch: 1, connectionStatus: "online" };
    const { rerender } = renderHook(() => useRoomSubscription("server-a", "mission-a"));

    await waitFor(() => expect(client.subscribeTeamMissionRoom).toHaveBeenCalledOnce());

    mocked.snapshot = { client, connectionEpoch: 2, connectionStatus: "online" };
    rerender();

    await waitFor(() => expect(client.unsubscribeTeamMissionRoom).toHaveBeenCalledOnce());
    await waitFor(() => expect(client.subscribeTeamMissionRoom).toHaveBeenCalledTimes(2));
  });
});
