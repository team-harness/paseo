import type { TeamTask } from "@getpaseo/protocol/team/task-types";

/** How loud a task's badge should be. Matches `StatusBadge`'s variants. */
export type TeamTaskTone = "muted" | "success" | "error";

export interface TeamTaskRowView {
  /** i18n key for the badge. */
  statusKey: string;
  tone: TeamTaskTone;
  /** Set once the task has settled. Until then the elapsed time is still moving. */
  durationMs: number | null;
  /** When the assignee picked it up, for a label that ticks. Null while queued. */
  startedAt: Date | null;
}

/**
 * One row of the task tab.
 *
 * Duration is split in two on purpose. A settled task has a real one and it
 * never changes again; an unsettled task does not have a duration at all, it
 * has a start, and the difference is what stops a row from freezing on
 * whatever the elapsed time happened to be when it last rendered.
 */
export function describeTeamTaskRow(task: TeamTask): TeamTaskRowView {
  const startedAt = parseInstant(task.dispatchedAt);

  if (task.state === "queued") {
    // Waiting on the assignee to be wakeable. Nothing has elapsed that is the
    // task's to own.
    return { statusKey: "teams.tasks.state.queued", tone: "muted", durationMs: null, startedAt };
  }

  if (task.state === "dispatched") {
    return {
      statusKey: "teams.tasks.state.dispatched",
      tone: "muted",
      durationMs: null,
      startedAt,
    };
  }

  const settledAt = parseInstant(task.settledAt);
  const outcome = task.outcome ?? "unknown";
  return {
    statusKey: `teams.tasks.outcome.${outcome}`,
    tone: TONE[outcome],
    // A task the daemon never saw dispatched has no span to report, and zero
    // would read as one that finished instantly.
    durationMs:
      startedAt && settledAt ? Math.max(0, settledAt.getTime() - startedAt.getTime()) : null,
    startedAt,
  };
}

const TONE: Record<"completed" | "failed" | "canceled" | "unknown", TeamTaskTone> = {
  completed: "success",
  failed: "error",
  canceled: "muted",
  // The turn ended and the daemon could not tell how. Painting that green
  // claims something nobody knows.
  unknown: "muted",
};

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
