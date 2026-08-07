import { z } from "zod";

/** DEC-3's dispatch contract, as a client sees it. */
export const TeamTaskStateSchema = z.enum(["queued", "dispatched", "settled"]);

export type TeamTaskState = z.infer<typeof TeamTaskStateSchema>;

/**
 * How a settled task ended. `unknown` is a real answer: the turn finished and
 * the daemon could not tell how, which is different from it still running.
 */
export const TeamTaskOutcomeSchema = z.enum(["completed", "failed", "canceled", "unknown"]);

export type TeamTaskOutcome = z.infer<typeof TeamTaskOutcomeSchema>;

export const TeamTaskSchema = z.object({
  taskId: z.string(),
  assigneeAgentId: z.string(),
  /** What the lead asked for, verbatim — the client has no other title for it. */
  prompt: z.string(),
  state: TeamTaskStateSchema,
  /** The turn the assignee accepted this as, so a client can open it. */
  acceptedTurnId: z.string().nullable(),
  outcome: TeamTaskOutcomeSchema.nullable(),
  createdAt: z.string(),
  dispatchedAt: z.string().nullable(),
  settledAt: z.string().nullable(),
});

export type TeamTask = z.infer<typeof TeamTaskSchema>;

export const TeamTaskListSchema = z.object({
  teamId: z.string(),
  /**
   * The ledger write this list was read at. Bumped once per write, so a client
   * holding a higher one has already seen everything in here and can drop it —
   * a list can arrive after a newer one when two writes land together.
   */
  revision: z.number().int(),
  tasks: z.array(TeamTaskSchema),
});

export type TeamTaskList = z.infer<typeof TeamTaskListSchema>;

/**
 * What the daemon's ledger holds for one task. Structural on purpose: the
 * ledger record lives in the server package and carries fields no client sees.
 */
export interface TeamTaskSource {
  taskId: string;
  assigneeAgentId: string;
  prompt: string;
  state: TeamTaskState;
  acceptedTurnId: string | null;
  outcome: TeamTaskOutcome | null;
  createdAt: string;
  dispatchedAt: string | null;
  settledAt: string | null;
}

/**
 * The wire projection of a ledger entry.
 *
 * Explicit like `toTeamSnapshot`, and for the same reason: the ledger also holds
 * `clientMessageId` and `completionEventId`, which are the daemon's own handles
 * on a prompt and a delivery. Spreading would publish both, and every field
 * added to the ledger afterwards.
 */
export function toTeamTask(source: TeamTaskSource): TeamTask {
  return {
    taskId: source.taskId,
    assigneeAgentId: source.assigneeAgentId,
    prompt: source.prompt,
    state: source.state,
    acceptedTurnId: source.acceptedTurnId,
    outcome: source.outcome,
    createdAt: source.createdAt,
    dispatchedAt: source.dispatchedAt,
    settledAt: source.settledAt,
  };
}
