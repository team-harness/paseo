import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { RoomSubscription, type RoomSubscriptionState } from "./room-subscription";
import { emptyRoomTimeline } from "./room-timeline";

const WAITING: RoomSubscriptionState = {
  timeline: emptyRoomTimeline(),
  error: null,
  historyError: null,
  loading: true,
  loadingOlder: false,
};

export interface RoomSubscriptionHandle extends RoomSubscriptionState {
  retry(): void;
  loadOlder(): void;
}

/**
 * Follows a room for as long as this component is mounted.
 *
 * A subscription belongs to one socket and dies with it, so the client
 * connection epoch is a dependency: the DaemonClient survives an internal
 * reconnect, but the server-side subscription belongs to the old socket.
 */
export function useRoomSubscription(
  serverId: string,
  missionId: string | null,
): RoomSubscriptionHandle {
  const { t } = useTranslation();
  const runtime = useHostRuntimeSnapshot(serverId);
  const client = runtime?.connectionStatus === "online" ? runtime.client : null;
  const connectionEpoch = runtime?.connectionEpoch ?? 0;
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
  }, [client, connectionEpoch, missionId, t]);

  const retry = useCallback(() => subscriptionRef.current?.retry(), []);
  const loadOlder = useCallback(() => subscriptionRef.current?.loadOlder(), []);

  return { ...state, retry, loadOlder };
}
