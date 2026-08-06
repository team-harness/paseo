import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

export type TeamSnapshotMap = Map<string, TeamSnapshot>;

/**
 * Folds a `team.update` broadcast into a set of teams.
 *
 * Ordering is decided per team, by `revision`. Broadcasts and list responses
 * race — a client can be told about a change and then read a list assembled
 * before it — so an update whose revision is not newer than what is already
 * held is dropped rather than applied. Equal counts as not newer: the same
 * revision is the same state, and rewriting it would only churn.
 */
export function applyTeamUpdate(teams: TeamSnapshotMap, team: TeamSnapshot): TeamSnapshotMap {
  const known = teams.get(team.id);
  if (known && known.revision >= team.revision) return teams;
  const next = new Map(teams);
  next.set(team.id, team);
  return next;
}

/**
 * Replaces the whole set with what a list response says, then replays whatever
 * arrived while it was in flight.
 *
 * Replacement rather than merge, because absence is information: a team
 * archived while the client was away is missing from a list that excludes
 * archived teams, and merging would keep showing it forever. The replay is the
 * other half — a team created during the read is in no list yet, and dropping
 * it would leave the client blind to it until something else happened.
 *
 * The replay goes through the same per-revision rule, so an update older than
 * the list it is replayed onto still loses.
 */
export function replaceTeams(
  listed: readonly TeamSnapshot[],
  replay: readonly TeamSnapshot[] = [],
): TeamSnapshotMap {
  let next: TeamSnapshotMap = new Map(listed.map((team) => [team.id, team]));
  for (const team of replay) {
    next = applyTeamUpdate(next, team);
  }
  return next;
}

/**
 * Whether this team should be shown in a list that does not include archived
 * ones.
 *
 * `archiving` is still on: the archive is under way and the user asked for it,
 * so hiding it before it finishes looks like the request was lost.
 */
export function isLiveTeam(team: TeamSnapshot): boolean {
  return team.lifecycle !== "archived" && team.lifecycle !== "failed";
}
