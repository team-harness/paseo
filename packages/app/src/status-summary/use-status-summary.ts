import { useMemo } from "react";
import { useHostFeature } from "@/runtime/host-features";
import { useHostStatusSummary } from "./query";
import { buildStatusSummaryViewModel, type StatusSummaryViewModel } from "./view-model";

export { useHostStatusSummary };

export function useGlobalStatusBarView(
  serverId: string | null | undefined,
): StatusSummaryViewModel {
  const { state } = useHostStatusSummary(serverId);
  // COMPAT(statusBarSessionPins): added in v0.1.105, drop the gate when floor >= v0.1.105.
  const canUseStatusBarSessionPins = useHostFeature(serverId, "statusBarSessionPins");
  return useMemo(
    () => buildStatusSummaryViewModel(state, { canUseStatusBarSessionPins }),
    [canUseStatusBarSessionPins, state],
  );
}
