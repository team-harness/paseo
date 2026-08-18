import { useMemo, useSyncExternalStore } from "react";
import { useReplicaQueries } from "@/data/query";
import {
  useHosts,
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRegistryLoaded,
} from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  buildMultiHostStatusSummaryViewModel,
  type StatusSummaryHostViewState,
  type StatusSummaryViewModel,
} from "./view-model";
import {
  buildStatusSummaryQueryState,
  canFetchStatusSummary,
  fetchStatusSummary,
  statusSummaryQueryKey,
} from "./query";
import { filterHostsByHostFilters } from "./host-filter";

export { useHostStatusSummary } from "./query";

export function useGlobalStatusBarView(
  _serverId: string | null | undefined,
): StatusSummaryViewModel {
  const hosts = useHosts();
  const hostRegistryLoaded = useHostRegistryLoaded();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const visibleHosts = useMemo(
    () => filterHostsByHostFilters(hosts, hostFilters, hostRegistryLoaded),
    [hostFilters, hostRegistryLoaded, hosts],
  );
  const serverIds = useMemo(() => visibleHosts.map((host) => host.serverId), [visibleHosts]);
  const statusSummaryFeatures = useHostFeatureMap(serverIds, "statusSummary");
  const queryInputs = useMemo(() => {
    void runtimeVersion;
    return visibleHosts.map((host) => {
      const client = runtime.getClient(host.serverId);
      const isConnected = isHostRuntimeConnected(runtime.getSnapshot(host.serverId));
      const supportsStatusSummary = statusSummaryFeatures.get(host.serverId) === true;
      return {
        host,
        client,
        isConnected,
        supportsStatusSummary,
        canFetch: canFetchStatusSummary({
          serverId: host.serverId,
          client,
          isConnected,
          supportsStatusSummary,
        }),
      };
    });
  }, [runtime, runtimeVersion, statusSummaryFeatures, visibleHosts]);
  const queries = useReplicaQueries(
    queryInputs.map((input) => ({
      queryKey: statusSummaryQueryKey(input.host.serverId),
      queryFn: async () => {
        if (!input.client) {
          throw new Error("Status summary client unavailable");
        }
        return fetchStatusSummary(input.client);
      },
      enabled: input.canFetch,
      pushEvent: "status.summary.updated",
    })),
  );
  const hostStates = useMemo<StatusSummaryHostViewState[]>(
    () =>
      queryInputs.map((input, index) => {
        const query = queries[index];
        return {
          serverId: input.host.serverId,
          serverLabel: input.host.label,
          state: buildStatusSummaryQueryState({
            serverId: input.host.serverId,
            client: input.client,
            isConnected: input.isConnected,
            supportsStatusSummary: input.supportsStatusSummary,
            data: query?.data,
            isLoading: query?.isLoading ?? false,
            isFetching: query?.isFetching ?? false,
            isError: query?.isError ?? false,
            error: query?.error,
          }),
        };
      }),
    [queries, queryInputs],
  );

  return useMemo(() => buildMultiHostStatusSummaryViewModel(hostStates), [hostStates]);
}
