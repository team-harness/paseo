import { useEffect, useRef, useState } from "react";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export interface UseAgentTimelinePromptIndexInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  enabled: boolean;
  refreshKey?: number;
}

export function useAgentTimelinePromptIndex({
  agentId,
  serverId,
  timelineEpoch,
  enabled,
  refreshKey,
}: UseAgentTimelinePromptIndexInput): AgentTimelinePromptIndexPayload | null {
  const [index, setIndex] = useState<AgentTimelinePromptIndexPayload | null>(null);
  const nextRequestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setIndex(null);
      return;
    }
    setIndex(null);
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    let active = true;
    const refresh = () => {
      const requestId = ++nextRequestIdRef.current;
      void client
        .listAgentTimelinePrompts(agentId)
        .then((payload) => {
          if (
            active &&
            requestId === nextRequestIdRef.current &&
            (timelineEpoch === null || timelineEpoch === payload.epoch)
          ) {
            setIndex(payload);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe =
      typeof client.on === "function"
        ? client.on("agent_stream", (message) => {
            if (
              message.type === "agent_stream" &&
              message.payload.agentId === agentId &&
              message.payload.event.type === "timeline" &&
              message.payload.event.item.type === "user_message"
            ) {
              refresh();
            }
          })
        : () => undefined;
    return () => {
      active = false;
      unsubscribe();
    };
  }, [agentId, enabled, refreshKey, serverId, timelineEpoch]);

  return index;
}
