import { useCallback } from "react";
import { useAgentProfiles } from "@/agent-profiles/internal/use-agent-profiles";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export function useTeamCreateOptions(serverId: string) {
  const methodologies = useSessionStore(
    (state) => state.sessions[serverId]?.methodologyCatalogReplica.methodologies,
  );
  const catalogStatus = useSessionStore(
    (state) => state.sessions[serverId]?.methodologyCatalogReplica.status ?? "checking_host",
  );
  const catalogError = useSessionStore(
    (state) => state.sessions[serverId]?.methodologyCatalogReplica.error ?? null,
  );
  const { profiles } = useAgentProfiles(serverId);
  const retryCatalog = useCallback(
    () => getHostRuntimeStore().refreshMethodologyCatalog(serverId),
    [serverId],
  );
  return {
    methodologies: methodologies ?? [],
    agentProfiles: profiles ?? [],
    catalogStatus,
    catalogError,
    retryCatalog,
  };
}
