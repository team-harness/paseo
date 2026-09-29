import { useEffect, useRef, useState } from "react";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { shouldAcceptPromptIndexEpoch } from "@/agent-stream/chat-outline/model";

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
    if (!isWeb || !enabled || timelineEpoch === null) {
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
            shouldAcceptPromptIndexEpoch(timelineEpoch, payload.epoch)
          ) {
            setIndex(payload);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
    refresh();
    return () => {
      active = false;
    };
  }, [agentId, enabled, refreshKey, serverId, timelineEpoch]);

  return index;
}
