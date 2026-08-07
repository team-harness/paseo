import type { TeamTaskList } from "@getpaseo/protocol/team/task-types";

export type TeamTaskMap = Map<string, TeamTaskList>;

/**
 * Folds a team's task ledger into what is held for a daemon.
 *
 * Ordering is by `revision`, per team, for the same reason teams are: a
 * `team.tasks.update` broadcast and a `team.tasks.list.response` race, and the
 * reply can describe a ledger older than the broadcast that overtook it. Equal
 * counts as not newer — the same revision is the same ledger.
 *
 * Unlike teams there is no replace-plus-replay half. That exists because a team
 * missing from a list is information; a ledger is read one team at a time and
 * never goes missing, so the revision rule settles the race on its own.
 */
export function applyTeamTasks(held: TeamTaskMap, tasks: TeamTaskList): TeamTaskMap {
  const known = held.get(tasks.teamId);
  if (known && known.revision >= tasks.revision) return held;
  const next = new Map(held);
  next.set(tasks.teamId, tasks);
  return next;
}
