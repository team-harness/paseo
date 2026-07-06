import type { QueryClient } from "@tanstack/react-query";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";
import { statusSummaryQueryKey } from "./query-core";

export interface StatusSummaryUpdatedMessage {
  type: "status.summary.updated";
  payload: HostStatusSummaryPayload;
}

export function applyStatusSummaryUpdate(input: {
  serverId: string;
  queryClient: QueryClient;
  message: StatusSummaryUpdatedMessage;
}): void {
  if (input.message.type !== "status.summary.updated") {
    return;
  }
  input.queryClient.setQueryData(statusSummaryQueryKey(input.serverId), input.message.payload);
}
