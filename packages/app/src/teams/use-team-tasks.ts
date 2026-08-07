import { useEffect, useMemo, useState } from "react";

import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { selectTeamTasksLoadState, type TeamTasksLoadState } from "./team-tasks-load-state";

export type { TeamTasksLoadState };

/**
 * Whether this daemon can serve the task ledger.
 *
 * Its own answer rather than `teams`: the betas that shipped teams have no
 * ledger RPCs, and a tab that asks one of them gets an error instead of a list.
 */
export function useTeamTasksSupported(serverId: string | null | undefined): boolean {
  return useHostFeature(serverId, "teamTasks");
}

/**
 * One team's task ledger, kept current.
 *
 * The read happens here rather than in the daemon-wide sync because a ledger is
 * only worth having while someone is looking at it. `team.tasks.update` lands
 * in the same store slot under the same revision rule, so a change that arrives
 * mid-read is not lost and cannot be overwritten by the older reply.
 */
export function useTeamTasks(
  serverId: string | null | undefined,
  teamId: string | null | undefined,
): TeamTasksLoadState {
  const normalized = serverId?.trim() ?? "";
  const id = teamId?.trim() ?? "";
  const supported = useTeamTasksSupported(normalized);
  const client = useSessionStore((state) => state.sessions[normalized]?.client ?? null);
  const ledger = useSessionStore((state) => state.sessions[normalized]?.teamTasks.get(id) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || !client || !id) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await client.listTeamTasks({ teamId: id });
        if (cancelled) return;
        setError(payload.error);
        if (payload.tasks) useSessionStore.getState().applyTeamTasks(normalized, payload.tasks);
      } catch (readError) {
        if (cancelled) return;
        setError(readError instanceof Error ? readError.message : "The tasks could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, client, id, normalized]);

  return useMemo(
    () => selectTeamTasksLoadState({ supported, error, ledger }),
    [supported, error, ledger],
  );
}
