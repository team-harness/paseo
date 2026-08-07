import { useMemo } from "react";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { selectTeamsLoadState, type TeamsLoadState } from "./teams-load-state";

export type { TeamsLoadState };

const EMPTY: ReadonlyMap<string, TeamSnapshot> = new Map();

/** Whether this daemon can do teams at all. An older one hides every entry point. */
export function useTeamsSupported(serverId: string | null | undefined): boolean {
  return useHostFeature(serverId, "teams");
}

export function useTeams(serverId: string | null | undefined): TeamsLoadState {
  const normalized = serverId?.trim() ?? "";
  const supported = useTeamsSupported(normalized);
  const hydrated = useSessionStore(
    (state) => state.sessions[normalized]?.hasHydratedTeams === true,
  );
  const online = useSessionStore((state) => state.sessions[normalized]?.client != null);
  const error = useSessionStore((state) => state.sessions[normalized]?.teamsError ?? null);
  const teams = useSessionStore((state) => state.sessions[normalized]?.teams ?? EMPTY);

  return useMemo(
    () => selectTeamsLoadState({ supported, online, hydrated, error, teams }),
    [supported, online, hydrated, error, teams],
  );
}

export function useTeam(
  serverId: string | null | undefined,
  teamId: string | null | undefined,
): TeamSnapshot | null {
  const normalized = serverId?.trim() ?? "";
  const id = teamId?.trim() ?? "";
  return useSessionStore((state) => state.sessions[normalized]?.teams.get(id) ?? null);
}
