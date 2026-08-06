import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { isLiveTeam } from "@/runtime/team-sync/team-replica";

/**
 * What the caller is allowed to conclude from an empty list.
 *
 * "No teams" is only sayable once a list has landed. Before that the answer is
 * that nobody has asked yet, and rendering an empty state there tells the user
 * something the client does not know. A daemon that has no teams at all is a
 * third answer again: every entry point is hidden rather than shown empty.
 */
export type TeamsLoadState =
  | { status: "unsupported" }
  | { status: "connecting" }
  | { status: "loaded"; teams: TeamSnapshot[] };

export function selectTeamsLoadState(input: {
  supported: boolean;
  hydrated: boolean;
  teams: ReadonlyMap<string, TeamSnapshot>;
}): TeamsLoadState {
  if (!input.supported) return { status: "unsupported" };
  if (!input.hydrated) return { status: "connecting" };
  return {
    status: "loaded",
    teams: [...input.teams.values()].filter(isLiveTeam).sort(byNewest),
  };
}

function byNewest(left: TeamSnapshot, right: TeamSnapshot): number {
  return right.createdAt.localeCompare(left.createdAt);
}
