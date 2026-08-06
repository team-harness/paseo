import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "../atomic-file.js";

export const AssignmentOutcomeSchema = z.enum(["completed", "failed", "canceled", "unknown"]);
export type AssignmentOutcome = z.infer<typeof AssignmentOutcomeSchema>;

const AssignmentSchema = z.object({
  taskId: z.string(),
  assigneeAgentId: z.string(),
  /** Persisted so a crash between recording and sending can resend it. */
  prompt: z.string(),
  clientMessageId: z.string(),
  state: z.enum(["queued", "dispatched", "settled"]),
  /** The turn the provider accepted this assignment as. Settles it, and only it. */
  acceptedTurnId: z.string().nullable(),
  outcome: AssignmentOutcomeSchema.nullable(),
  completionEventId: z.string().nullable(),
  createdAt: z.string(),
  dispatchedAt: z.string().nullable(),
  settledAt: z.string().nullable(),
});

export type Assignment = z.infer<typeof AssignmentSchema>;

const PendingCompletionSchema = z.object({
  completionEventId: z.string(),
  taskId: z.string(),
  assigneeAgentId: z.string(),
  prompt: z.string(),
  outcome: AssignmentOutcomeSchema,
  settledAt: z.string(),
});

export type PendingCompletion = z.infer<typeof PendingCompletionSchema>;

const InboxFileSchema = z.object({
  assignments: z.array(AssignmentSchema),
  /** Settled work the lead has not been told about yet. */
  pendingCompletions: z.array(PendingCompletionSchema),
  /** The batch currently out for delivery, kept until the lead acknowledges it. */
  inFlightDelivery: z
    .object({
      deliveryId: z.string(),
      completions: z.array(PendingCompletionSchema),
      preparedAt: z.string(),
    })
    .nullable(),
});

type InboxFile = z.infer<typeof InboxFileSchema>;

export interface Delivery {
  deliveryId: string;
  completions: PendingCompletion[];
}

const EMPTY: InboxFile = { assignments: [], pendingCompletions: [], inFlightDelivery: null };

/**
 * A ledger that is there and could not be understood.
 *
 * Every read throws this rather than reporting an empty ledger, because empty
 * is a real answer meaning "nothing to do", and a caller cannot tell the two
 * apart afterwards. Probing first does not help: the read after the probe can
 * fail on its own.
 */
export class TeamLedgerUnreadableError extends Error {
  constructor(readonly teamId: string) {
    super(`Team ${teamId} has an unreadable ledger`);
    this.name = "TeamLedgerUnreadableError";
  }
}

/**
 * A team's task ledger: an outbox of assignments and of the news about them.
 *
 * It does not understand what a task is. What it guarantees is that nothing
 * gets lost — every state change is on disk before the side effect it
 * describes, so a crash leaves work to redo rather than work that vanished.
 * Redoing means at-least-once: a member can see the same assignment twice, and
 * the lead the same news twice.
 *
 * One file per team, serialized per team, and tolerant of a damaged one: a team
 * that cannot read its ledger starts empty rather than stopping every other
 * team from running.
 */
export class TeamInbox {
  private readonly dir: string;
  private readonly logger: Logger;
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(dir: string, logger: Logger) {
    this.dir = dir;
    this.logger = logger.child({ module: "team", component: "team-inbox" });
  }

  async listAssignments(teamId: string): Promise<Assignment[]> {
    return (await this.read(teamId)).assignments;
  }

  async enqueueAssignment(input: {
    teamId: string;
    assigneeAgentId: string;
    prompt: string;
  }): Promise<Assignment> {
    const taskId = randomUUID();
    const assignment: Assignment = {
      taskId,
      assigneeAgentId: input.assigneeAgentId,
      prompt: input.prompt,
      // Deterministic, so a resend is recognisable as the same instruction.
      clientMessageId: `team-${input.teamId}-task-${taskId}`,
      state: "queued",
      acceptedTurnId: null,
      outcome: null,
      completionEventId: null,
      createdAt: new Date().toISOString(),
      dispatchedAt: null,
      settledAt: null,
    };

    await this.mutate(input.teamId, (file) => ({
      ...file,
      assignments: [...file.assignments, assignment],
    }));
    return assignment;
  }

  /**
   * The oldest queued assignment for this assignee, or null while one is
   * already in flight.
   *
   * One at a time per assignee is what makes `acceptedTurnId` mean something:
   * with two in flight, a turn ending could not say which of them it was.
   */
  async nextDispatchable(teamId: string, assigneeAgentId: string): Promise<Assignment | null> {
    const file = await this.read(teamId);
    const mine = file.assignments.filter(
      (assignment) => assignment.assigneeAgentId === assigneeAgentId,
    );
    if (mine.some((assignment) => assignment.state === "dispatched")) {
      return null;
    }
    return mine.find((assignment) => assignment.state === "queued") ?? null;
  }

  /** Every assignee with something waiting, in the order the work was recorded. */
  async assigneesWithWork(teamId: string): Promise<string[]> {
    const file = await this.read(teamId);
    const assignees: string[] = [];
    for (const assignment of file.assignments) {
      if (assignment.state === "settled") continue;
      if (!assignees.includes(assignment.assigneeAgentId)) {
        assignees.push(assignment.assigneeAgentId);
      }
    }
    return assignees;
  }

  async markDispatched(input: {
    teamId: string;
    taskId: string;
    turnId: string;
  }): Promise<Assignment | null> {
    const updated = await this.mutate(input.teamId, (file) => ({
      ...file,
      assignments: file.assignments.map((assignment) =>
        assignment.taskId === input.taskId && assignment.state === "queued"
          ? {
              ...assignment,
              state: "dispatched" as const,
              acceptedTurnId: input.turnId,
              dispatchedAt: new Date().toISOString(),
            }
          : assignment,
      ),
    }));
    return findAssignment(updated, input.taskId);
  }

  /**
   * Closes an assignment and queues the news of it in one write. Two writes
   * would leave a window where the work is done and nobody is ever told.
   */
  async settle(input: {
    teamId: string;
    taskId: string;
    outcome: AssignmentOutcome;
  }): Promise<Assignment | null> {
    const settledAt = new Date().toISOString();
    const updated = await this.mutate(input.teamId, (file) => {
      const assignment = findAssignment(file, input.taskId);
      if (!assignment || assignment.state === "settled") {
        return file;
      }
      const completionEventId = `${assignment.taskId}:${assignment.acceptedTurnId ?? "unknown"}`;
      return {
        ...file,
        assignments: file.assignments.map((candidate) =>
          candidate.taskId === input.taskId
            ? {
                ...candidate,
                state: "settled" as const,
                outcome: input.outcome,
                completionEventId,
                settledAt,
              }
            : candidate,
        ),
        pendingCompletions: [
          ...file.pendingCompletions,
          {
            completionEventId,
            taskId: assignment.taskId,
            assigneeAgentId: assignment.assigneeAgentId,
            prompt: assignment.prompt,
            outcome: input.outcome,
            settledAt,
          },
        ],
      };
    });
    return findAssignment(updated, input.taskId);
  }

  /**
   * The batch of news waiting for the lead, or null when there is none.
   *
   * The id is derived from what is in the batch, so a resend after a crash
   * carries the id the lead may already have seen and can skip. A batch stays
   * on disk until acknowledged; anything settling afterwards belongs to the
   * next one rather than to a batch the lead may already be reading.
   */
  async prepareDelivery(teamId: string): Promise<Delivery | null> {
    const updated = await this.mutate(teamId, (file) => {
      if (file.inFlightDelivery) {
        return file;
      }
      if (file.pendingCompletions.length === 0) {
        return file;
      }
      return {
        ...file,
        pendingCompletions: [],
        inFlightDelivery: {
          deliveryId: deriveDeliveryId(file.pendingCompletions),
          completions: file.pendingCompletions,
          preparedAt: new Date().toISOString(),
        },
      };
    });

    const delivery = updated.inFlightDelivery;
    return delivery ? { deliveryId: delivery.deliveryId, completions: delivery.completions } : null;
  }

  /**
   * Whether the lead has anything coming, without deciding what. Asking
   * `prepareDelivery` would close a batch around whatever has settled so far,
   * and anything settling afterwards would have to wait for that batch to be
   * acknowledged before it could go anywhere.
   */
  async hasNewsForLead(teamId: string): Promise<boolean> {
    const file = await this.read(teamId);
    return file.inFlightDelivery !== null || file.pendingCompletions.length > 0;
  }

  /** Acknowledging a batch that is already gone is a replay, not an error. */
  async acknowledgeDelivery(input: { teamId: string; deliveryId: string }): Promise<void> {
    await this.mutate(input.teamId, (file) =>
      file.inFlightDelivery?.deliveryId === input.deliveryId
        ? { ...file, inFlightDelivery: null }
        : file,
    );
  }

  private filePath(teamId: string): string {
    return join(this.dir, `${teamId}.inbox.json`);
  }

  /**
   * `absent` is a team that has never had a ledger; `unreadable` is one whose
   * ledger is there and could not be understood. Reading treats both as empty,
   * but only the first may be written over — a write derived from "nothing"
   * would replace whatever is actually in the file.
   */
  private async readFileState(
    teamId: string,
  ): Promise<{ kind: "ok" | "absent"; file: InboxFile } | { kind: "unreadable" }> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(teamId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { kind: "absent", file: EMPTY };
      }
      this.logger.error({ err: error, teamId }, "Team ledger could not be read");
      return { kind: "unreadable" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      this.logger.error({ err: error, teamId }, "Team ledger is not valid JSON");
      return { kind: "unreadable" };
    }

    const parsed = InboxFileSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error({ issues: parsed.error.issues, teamId }, "Team ledger does not parse");
      return { kind: "unreadable" };
    }
    return { kind: "ok", file: parsed.data };
  }

  private async read(teamId: string): Promise<InboxFile> {
    const state = await this.readFileState(teamId);
    if (state.kind === "unreadable") {
      throw new TeamLedgerUnreadableError(teamId);
    }
    return state.file;
  }

  /** Read-modify-write inside the team's own lock. */
  private async mutate(teamId: string, change: (file: InboxFile) => InboxFile): Promise<InboxFile> {
    const previous = this.writes.get(teamId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        // Fail closed by construction: an unreadable ledger throws here, so a
        // write is never built from having read nothing.
        const current = await this.read(teamId);
        const updated = change(current);
        if (updated !== current) {
          await mkdir(this.dir, { recursive: true });
          await writeJsonFileAtomic(this.filePath(teamId), updated);
        }
        return updated;
      });
    this.writes.set(
      teamId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return await next;
  }
}

function findAssignment(file: InboxFile, taskId: string): Assignment | null {
  return file.assignments.find((assignment) => assignment.taskId === taskId) ?? null;
}

/**
 * Derived from the batch's contents, so the same batch always gets the same id
 * however many times it is rebuilt after a crash.
 */
function deriveDeliveryId(completions: PendingCompletion[]): string {
  const ids = completions.map((completion) => completion.completionEventId).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 32);
}
