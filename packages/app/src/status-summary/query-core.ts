import type { QueryClient } from "@tanstack/react-query";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";

export const STATUS_SUMMARY_STALE_TIME_MS = Infinity;

export interface StatusSummaryClient {
  getStatusSummary(): Promise<{
    requestId: string;
    summary: HostStatusSummaryPayload;
  }>;
}

export type StatusSummaryQueryState =
  | {
      kind: "disabled";
      reason: "no-host" | "offline" | "unsupported";
      previousSummary?: HostStatusSummaryPayload;
    }
  | { kind: "loading"; previousSummary?: HostStatusSummaryPayload }
  | { kind: "error"; message: string; previousSummary?: HostStatusSummaryPayload }
  | { kind: "ready"; summary: HostStatusSummaryPayload; isRefreshing: boolean };

export function statusSummaryQueryKey(serverId: string | null | undefined) {
  return ["statusSummary", serverId ?? ""] as const;
}

export function canFetchStatusSummary(input: {
  serverId: string | null | undefined;
  client: StatusSummaryClient | null | undefined;
  isConnected: boolean;
  supportsStatusSummary: boolean;
}): boolean {
  return Boolean(
    input.serverId && input.client && input.isConnected && input.supportsStatusSummary,
  );
}

export async function fetchStatusSummary(
  client: StatusSummaryClient,
): Promise<HostStatusSummaryPayload> {
  const response = await client.getStatusSummary();
  return response.summary;
}

export async function refreshStatusSummary(input: {
  queryClient: QueryClient;
  serverId: string;
  client: StatusSummaryClient;
}): Promise<HostStatusSummaryPayload> {
  await input.queryClient.invalidateQueries({
    queryKey: statusSummaryQueryKey(input.serverId),
    exact: true,
  });
  return input.queryClient.fetchQuery({
    queryKey: statusSummaryQueryKey(input.serverId),
    queryFn: () => fetchStatusSummary(input.client),
    staleTime: STATUS_SUMMARY_STALE_TIME_MS,
  });
}

export function shouldRefreshStatusSummary(input: {
  serverId: string | null | undefined;
  client: StatusSummaryClient | null | undefined;
  isConnected: boolean;
  supportsStatusSummary: boolean;
}): input is {
  serverId: string;
  client: StatusSummaryClient;
  isConnected: true;
  supportsStatusSummary: true;
} {
  return canFetchStatusSummary(input);
}

export function buildStatusSummaryQueryState(input: {
  serverId: string | null | undefined;
  client: StatusSummaryClient | null | undefined;
  isConnected: boolean;
  supportsStatusSummary: boolean;
  data: HostStatusSummaryPayload | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}): StatusSummaryQueryState {
  if (!input.serverId) {
    return { kind: "disabled", reason: "no-host" };
  }
  if (!input.client || !input.isConnected) {
    return { kind: "disabled", reason: "offline", previousSummary: input.data };
  }
  if (!input.supportsStatusSummary) {
    return { kind: "disabled", reason: "unsupported", previousSummary: input.data };
  }
  if (input.data) {
    return {
      kind: "ready",
      summary: input.data,
      isRefreshing: input.isFetching,
    };
  }
  if (input.isError) {
    return {
      kind: "error",
      message: input.error instanceof Error ? input.error.message : String(input.error),
    };
  }
  return { kind: "loading" };
}
