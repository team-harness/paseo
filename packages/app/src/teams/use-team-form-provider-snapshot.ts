import { useEffect } from "react";

import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";

import type { TeamFormModel, TeamFormState } from "./team-form-model";

/**
 * Pipes the daemon's provider list into the model.
 *
 * Input plumbing only — the model owns what to do with it, and the sheet owns
 * neither. The model is told the request went out so it can say it is waiting;
 * without that, a picker rendered before the answer lands has no way to tell an
 * empty list from an unanswered one.
 */
export function useTeamFormProviderSnapshot(
  model: TeamFormModel,
  state: TeamFormState,
  cwd: string,
): ReturnType<typeof useProvidersSnapshot> {
  const serverId = state.serverId;
  const enabled = Boolean(serverId && cwd.trim());
  const snapshot = useProvidersSnapshot(serverId ?? null, { cwd, enabled });

  useEffect(() => {
    if (!enabled || !serverId) return;
    model.providerSnapshotRequested(serverId);
  }, [enabled, model, serverId]);

  useEffect(() => {
    if (!enabled || !serverId || !snapshot.entries) return;
    model.applyProviderSnapshot(serverId, snapshot.entries);
  }, [enabled, model, serverId, snapshot.entries]);

  return snapshot;
}
