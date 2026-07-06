import { useMemo } from "react";
import { useHostStatusSummary } from "./query";
import { buildStatusSummaryViewModel, type StatusSummaryViewModel } from "./view-model";

export { useHostStatusSummary };

export function useGlobalStatusBarView(
  serverId: string | null | undefined,
): StatusSummaryViewModel {
  const { state } = useHostStatusSummary(serverId);
  return useMemo(() => buildStatusSummaryViewModel(state), [state]);
}
