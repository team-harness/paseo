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
  | { status: "loading" }
  | { status: "failed"; message: string; teams: TeamSnapshot[] }
  | { status: "loaded"; teams: TeamSnapshot[] };

export interface TeamsLoadInput {
  supported: boolean;
  online: boolean;
  hydrated: boolean;
  /** Set when the last read failed. What is held is still worth showing. */
  error: string | null;
  teams: ReadonlyMap<string, TeamSnapshot>;
}

export function selectTeamsLoadState(input: TeamsLoadInput): TeamsLoadState {
  if (!input.supported) return { status: "unsupported" };
  const teams = [...input.teams.values()].filter(isLiveTeam).sort(byNewest);
  // A read that failed is not an empty list. What was held last is still the
  // best answer there is, and saying so beats an empty state that is a lie.
  if (input.error !== null) return { status: "failed", message: input.error, teams };
  if (input.hydrated) return { status: "loaded", teams };
  // Not the same answer: one is waiting for a socket, the other for a reply.
  return input.online ? { status: "loading" } : { status: "connecting" };
}

function byNewest(left: TeamSnapshot, right: TeamSnapshot): number {
  return right.createdAt.localeCompare(left.createdAt);
}
