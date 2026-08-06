import { useEffect, useState } from "react";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  RoomSubscription,
  type RoomSubscriptionClient,
  type RoomSubscriptionState,
} from "./room-subscription";
import { emptyRoomTimeline } from "./room-timeline";

const WAITING: RoomSubscriptionState = {
  timeline: emptyRoomTimeline(),
  error: null,
  loading: true,
};

/**
 * Follows a room for as long as this component is mounted.
 *
 * A subscription belongs to one socket and dies with it, so the client
 * identity is a dependency: a reconnect has to resubscribe, or the room goes
 * quiet with no sign that it has.
 */
export function useRoomSubscription(
  serverId: string,
  roomId: string | null,
): RoomSubscriptionState {
  const client = useHostRuntimeClient(serverId);
  const [state, setState] = useState<RoomSubscriptionState>(WAITING);

  useEffect(() => {
    if (!client || !roomId) {
      setState(WAITING);
      return;
    }
    // Resubscribing starts from the newest page. State from the previous socket
    // describes a room this client is no longer following.
    setState(WAITING);
    const subscription = new RoomSubscription(
      roomId,
      client as unknown as RoomSubscriptionClient,
      setState,
    );
    subscription.start();
    return () => subscription.dispose();
  }, [client, roomId]);

  return state;
}
