import type { TeamTask, TeamTaskList } from "@getpaseo/protocol/team/task-types";

/**
 * What the caller is allowed to conclude from an empty ledger.
 *
 * "No tasks yet" is only sayable once a read has landed. Before that the client
 * holds nothing because nobody has asked, which is a different thing to show.
 * A daemon too old to serve the ledger is a third answer: hide the tab rather
 * than show it permanently empty.
 */
export type TeamTasksLoadState =
  | { status: "unsupported" }
  | { status: "loading" }
  | { status: "failed"; message: string; tasks: TeamTask[] }
  | { status: "loaded"; tasks: TeamTask[] };

export interface TeamTasksLoadInput {
  supported: boolean;
  /** Set when the last read failed. What is held is still worth showing. */
  error: string | null;
  ledger: TeamTaskList | null;
}

export function selectTeamTasksLoadState(input: TeamTasksLoadInput): TeamTasksLoadState {
  if (!input.supported) return { status: "unsupported" };
  const tasks = input.ledger ? [...input.ledger.tasks].sort(byNewest) : [];
  if (input.error !== null) return { status: "failed", message: input.error, tasks };
  // A broadcast can land before the read it raced does. Holding a ledger is
  // proof enough that the client knows what this team's tasks are.
  if (input.ledger) return { status: "loaded", tasks };
  return { status: "loading" };
}

function byNewest(left: TeamTask, right: TeamTask): number {
  return right.createdAt.localeCompare(left.createdAt);
}
