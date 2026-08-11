import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { RoomSubscription, type RoomSubscriptionState } from "./room-subscription";
import { emptyRoomTimeline } from "./room-timeline";

const WAITING: RoomSubscriptionState = {
  timeline: emptyRoomTimeline(),
  error: null,
  loading: true,
};

export interface RoomSubscriptionHandle extends RoomSubscriptionState {
  retry(): void;
}

/**
 * Follows a room for as long as this component is mounted.
 *
 * A subscription belongs to one socket and dies with it, so the client
 * identity is a dependency: a reconnect has to resubscribe, or the room goes
 * quiet with no sign that it has.
 */
export function useRoomSubscription(
  serverId: string,
  missionId: string | null,
): RoomSubscriptionHandle {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [state, setState] = useState<RoomSubscriptionState>(WAITING);
  const subscriptionRef = useRef<RoomSubscription | null>(null);

  useEffect(() => {
    if (!client || !missionId) {
      subscriptionRef.current = null;
      setState(WAITING);
      return;
    }
    // Resubscribing starts from the newest page. State from the previous socket
    // describes a room this client is no longer following.
    setState(WAITING);
    const subscription = new RoomSubscription(
      missionId,
      client,
      setState,
      t("teams.room.unopenable"),
    );
    subscriptionRef.current = subscription;
    subscription.start();
    return () => {
      subscriptionRef.current = null;
      subscription.dispose();
    };
  }, [client, missionId, t]);

  const retry = useCallback(() => subscriptionRef.current?.retry(), []);

  return { ...state, retry };
}
