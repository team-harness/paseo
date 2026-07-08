import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  STATUS_SUMMARY_STALE_TIME_MS,
  buildStatusSummaryQueryState,
  canFetchStatusSummary,
  fetchStatusSummary,
  refreshStatusSummary,
  statusSummaryQueryKey,
  type StatusSummaryQueryState,
} from "./query-core";

export {
  STATUS_SUMMARY_STALE_TIME_MS,
  buildStatusSummaryQueryState,
  canFetchStatusSummary,
  fetchStatusSummary,
  refreshStatusSummary,
  shouldRefreshStatusSummary,
  statusSummaryQueryKey,
  type StatusSummaryClient,
  type StatusSummaryQueryState,
} from "./query-core";

export function useHostStatusSummary(serverId: string | null | undefined): {
  state: StatusSummaryQueryState;
  refresh: () => Promise<void>;
  canFetch: boolean;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supportsStatusSummary = useHostFeature(serverId, "statusSummary");
  const queryKey = useMemo(() => statusSummaryQueryKey(serverId), [serverId]);
  const canFetch = canFetchStatusSummary({
    serverId,
    client,
    isConnected,
    supportsStatusSummary,
  });

  const queryFn = useCallback(async () => {
    if (!client) {
      throw new Error("Status summary client unavailable");
    }
    return fetchStatusSummary(client);
  }, [client]);

  const query = useReplicaQuery({
    queryKey,
    queryFn,
    enabled: canFetch,
    pushEvent: "status.summary.updated",
  });

  const refresh = useCallback(async () => {
    if (!canFetch || !client || !serverId) {
      return;
    }
    await refreshStatusSummary({ queryClient, serverId, client });
  }, [canFetch, client, queryClient, serverId]);

  const state = buildStatusSummaryQueryState({
    serverId,
    client,
    isConnected,
    supportsStatusSummary,
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  });

  return { state, refresh, canFetch };
}
