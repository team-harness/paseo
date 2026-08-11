import { useEffect } from "react";

import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";

import type { TeamProfileFormModel, TeamProfileFormState } from "./team-profile-form-model";

/** Pipes one identity-fenced host/cwd provider snapshot into the plain form model. */
export function useTeamProfileFormProviderSnapshot(
  model: TeamProfileFormModel,
  state: TeamProfileFormState,
) {
  const scope = state.providerScope;
  const enabled = Boolean(scope);
  const snapshot = useProvidersSnapshot(scope?.serverId ?? null, {
    cwd: scope?.cwd ?? null,
    enabled,
  });

  useEffect(() => {
    if (!scope || !snapshot.entries) return;
    model.applyProviderSnapshot({ ...scope, entries: snapshot.entries });
  }, [model, scope, snapshot.entries]);

  return snapshot;
}
