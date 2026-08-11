import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  MissionScopeLeaseSchema,
  type MissionMutableScope,
  type MissionScopeLease,
} from "@getpaseo/protocol/team/v2-types";

import { writeJsonFileAtomic } from "../../atomic-file.js";

const ReportHoldTransferSchema = z.object({
  sourceAssignmentId: z.string().min(1),
  replacementAssignmentId: z.string().min(1),
});

const WorkspaceScopeLeaseRecordSchema = MissionScopeLeaseSchema.extend({
  workspaceIdentity: z.string().min(1),
  teamId: z.string().min(1),
  missionId: z.string().min(1),
  priority: z.number().int().nonnegative(),
  assignmentCreatedAt: z.string().datetime({ offset: true }),
  lastReportHoldTransfer: ReportHoldTransferSchema.nullable().default(null),
  reportHoldTransfers: z.array(ReportHoldTransferSchema).default([]),
});
type WorkspaceScopeLeaseRecord = z.infer<typeof WorkspaceScopeLeaseRecordSchema>;

const HistoricalWorkspaceScopeLeaseRecordSchema = WorkspaceScopeLeaseRecordSchema.extend({
  releasedAt: z.string().datetime({ offset: true }),
});
type HistoricalWorkspaceScopeLeaseRecord = z.infer<
  typeof HistoricalWorkspaceScopeLeaseRecordSchema
>;

const QueuedWorkspaceScopeLeaseAssignmentSchema = z.object({
  workspaceId: z.string().min(1),
  assignmentId: z.string().min(1),
  scope: MissionScopeLeaseSchema.shape.scope,
  workspaceIdentity: z.string().min(1),
  teamId: z.string().min(1),
  missionId: z.string().min(1),
  priority: z.number().int().nonnegative(),
  assignmentCreatedAt: z.string().datetime({ offset: true }),
});
type QueuedWorkspaceScopeLeaseAssignment = z.infer<
  typeof QueuedWorkspaceScopeLeaseAssignmentSchema
>;

const WorkspaceScopeLeaseFileSchema = z.object({
  revision: z.number().int().nonnegative(),
  leases: z.array(WorkspaceScopeLeaseRecordSchema),
  historicalIntervals: z.array(HistoricalWorkspaceScopeLeaseRecordSchema).default([]),
  pendingAssignments: z.array(QueuedWorkspaceScopeLeaseAssignmentSchema).default([]),
});
type WorkspaceScopeLeaseFile = z.infer<typeof WorkspaceScopeLeaseFileSchema>;

interface WorkspaceScopeLeaseStoreOptions {
  filePath: string;
  resolveWorkspaceIdentity(workspaceId: string): Promise<string>;
  clock: { now(): string };
  ids: { next(kind: "lease"): string };
}

export type WorkspacePathOwnership = "current" | "external" | "unowned" | "ambiguous";

interface AcquireWorkspaceScopeLeaseInput {
  teamId: string;
  missionId: string;
  workspaceId: string;
  assignmentId: string;
  scope: MissionMutableScope;
  priority: number;
  createdAt: string;
}

interface TransitionToReportHoldInput {
  lease: MissionScopeLease;
  transitionedAt: string;
  capturedDelta: MissionScopeLease["capturedDelta"];
}

export interface TransferReportHoldInput {
  leaseId: string;
  teamId: string;
  missionId: string;
  workspaceId: string;
  sourceAssignmentId: string;
  replacementAssignmentId: string;
}

export class WorkspaceScopeLeaseStore {
  private mutation: Promise<void> = Promise.resolve();

  constructor(private readonly options: WorkspaceScopeLeaseStoreOptions) {}

  async acquire(input: AcquireWorkspaceScopeLeaseInput): Promise<MissionScopeLease | null> {
    if (input.scope.kind === "read_only") {
      throw new Error("Read-only Assignments do not acquire workspace scope leases");
    }
    return this.serialize(async () => {
      const workspaceIdentity = await this.options.resolveWorkspaceIdentity(input.workspaceId);
      if (!workspaceIdentity.trim()) {
        throw new Error(`Workspace ${input.workspaceId} has no canonical identity`);
      }
      const current = await this.read();
      const existing = current.leases.find((lease) => lease.assignmentId === input.assignmentId);
      if (existing) {
        assertReplayMatches(existing, input, workspaceIdentity);
        if (
          existing.state === "report_hold" &&
          existing.lastReportHoldTransfer?.replacementAssignmentId === input.assignmentId
        ) {
          const claimed = WorkspaceScopeLeaseRecordSchema.parse({
            ...existing,
            state: "execution",
            transitionedAt: null,
            capturedDelta: [],
            recoveryAttempts: 0,
          });
          await this.write({
            ...current,
            revision: current.revision + 1,
            leases: current.leases.map((lease) =>
              lease.leaseId === claimed.leaseId ? claimed : lease,
            ),
          });
          return toScopeLease(claimed);
        }
        return toScopeLease(existing);
      }

      const queued = current.pendingAssignments.find(
        (candidate) => candidate.assignmentId === input.assignmentId,
      );
      if (queued) {
        assertQueuedReplayMatches(queued, input, workspaceIdentity);
      }

      const candidate = queued ?? toQueuedAssignment(input, workspaceIdentity);
      const activeConflict = current.leases.some((lease) => conflictsWith(lease, candidate));
      const contenders = current.pendingAssignments
        .filter((pending) => conflictsWith(pending, candidate))
        .concat(queued ? [] : [candidate])
        .toSorted(compareAssignmentPriority);
      if (activeConflict || contenders[0]?.assignmentId !== candidate.assignmentId) {
        if (queued) return null;
        await this.write({
          ...current,
          revision: current.revision + 1,
          pendingAssignments: [...current.pendingAssignments, candidate],
        });
        return null;
      }

      const acquiredAt = this.options.clock.now();
      const record = WorkspaceScopeLeaseRecordSchema.parse({
        leaseId: this.options.ids.next("lease"),
        workspaceId: input.workspaceId,
        assignmentId: input.assignmentId,
        scope: input.scope,
        state: "execution",
        acquiredAt,
        transitionedAt: null,
        capturedDelta: [],
        recoveryAttempts: 0,
        workspaceIdentity,
        teamId: input.teamId,
        missionId: input.missionId,
        priority: input.priority,
        assignmentCreatedAt: input.createdAt,
      });
      await this.write({
        ...current,
        revision: current.revision + 1,
        leases: [...current.leases, record],
        pendingAssignments: current.pendingAssignments.filter(
          (pending) => pending.assignmentId !== input.assignmentId,
        ),
      });
      return toScopeLease(record);
    });
  }

  async release(lease: MissionScopeLease): Promise<void> {
    await this.serialize(async () => {
      const current = await this.read();
      const released = current.leases.filter(
        (candidate) =>
          candidate.leaseId === lease.leaseId && candidate.assignmentId === lease.assignmentId,
      );
      if (released.length === 0) return;
      const remaining = current.leases.filter(
        (candidate) =>
          candidate.leaseId !== lease.leaseId || candidate.assignmentId !== lease.assignmentId,
      );
      await this.write({
        ...current,
        revision: current.revision + 1,
        leases: remaining,
        historicalIntervals: appendHistoricalIntervals(
          current.historicalIntervals,
          released,
          this.options.clock.now(),
        ),
      });
    });
  }

  async releaseAssignment(input: { workspaceId: string; assignmentId: string }): Promise<void> {
    await this.serialize(async () => {
      const current = await this.read();
      const released = current.leases.filter(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.assignmentId === input.assignmentId,
      );
      const remaining = current.leases.filter(
        (candidate) =>
          candidate.workspaceId !== input.workspaceId ||
          candidate.assignmentId !== input.assignmentId,
      );
      const pendingAssignments = current.pendingAssignments.filter(
        (candidate) =>
          candidate.workspaceId !== input.workspaceId ||
          candidate.assignmentId !== input.assignmentId,
      );
      if (released.length === 0 && pendingAssignments.length === current.pendingAssignments.length)
        return;
      await this.write({
        ...current,
        revision: current.revision + 1,
        leases: remaining,
        pendingAssignments,
        historicalIntervals: appendHistoricalIntervals(
          current.historicalIntervals,
          released,
          this.options.clock.now(),
        ),
      });
    });
  }

  async releaseMission(input: { missionId: string }): Promise<void> {
    await this.serialize(async () => {
      const current = await this.read();
      const released = current.leases.filter(
        (candidate) => candidate.missionId === input.missionId,
      );
      const pendingAssignments = current.pendingAssignments.filter(
        (candidate) => candidate.missionId !== input.missionId,
      );
      if (released.length === 0 && pendingAssignments.length === current.pendingAssignments.length)
        return;
      await this.write({
        ...current,
        revision: current.revision + 1,
        leases: current.leases.filter((candidate) => candidate.missionId !== input.missionId),
        pendingAssignments,
        historicalIntervals: appendHistoricalIntervals(
          current.historicalIntervals,
          released,
          this.options.clock.now(),
        ),
      });
    });
  }

  async classifyPathOwnership(input: {
    workspaceId: string;
    assignmentId: string;
    path: string;
    intervalStartedAt: string;
    intervalEndedAt: string;
  }): Promise<WorkspacePathOwnership> {
    return this.serialize(async () => {
      const workspaceIdentity = await this.options.resolveWorkspaceIdentity(input.workspaceId);
      const current = await this.read();
      const interval = parseOwnershipInterval(input.intervalStartedAt, input.intervalEndedAt);
      const ownerAssignmentIds = new Set(
        current.leases
          .filter(
            (lease) =>
              lease.workspaceIdentity === workspaceIdentity &&
              timestampMillis(lease.acquiredAt) <= interval.endedAt &&
              scopeContainsPath(lease.scope, input.path),
          )
          .map((lease) => lease.assignmentId),
      );
      for (const historical of current.historicalIntervals) {
        if (
          historical.workspaceIdentity === workspaceIdentity &&
          ownershipIntervalsOverlap(historical, interval) &&
          scopeContainsPath(historical.scope, input.path)
        ) {
          ownerAssignmentIds.add(historical.assignmentId);
        }
      }
      if (ownerAssignmentIds.size === 0) return "unowned";
      if (ownerAssignmentIds.size > 1) return "ambiguous";
      return ownerAssignmentIds.has(input.assignmentId) ? "current" : "external";
    });
  }

  async transitionToReportHold(input: TransitionToReportHoldInput): Promise<MissionScopeLease> {
    return this.serialize(async () => {
      const current = await this.read();
      const index = current.leases.findIndex(
        (candidate) =>
          candidate.leaseId === input.lease.leaseId &&
          candidate.assignmentId === input.lease.assignmentId,
      );
      if (index < 0) {
        throw new Error(`Scope lease ${input.lease.leaseId} does not exist`);
      }
      const existing = current.leases[index];
      if (!existing) throw new Error(`Scope lease ${input.lease.leaseId} disappeared`);
      if (
        existing.workspaceId !== input.lease.workspaceId ||
        !isDeepStrictEqual(existing.scope, input.lease.scope)
      ) {
        throw new Error(`Scope lease ${input.lease.leaseId} no longer matches its Assignment`);
      }
      if (existing.state === "report_hold") {
        if (
          existing.transitionedAt !== input.transitionedAt ||
          !isDeepStrictEqual(existing.capturedDelta, input.capturedDelta)
        ) {
          throw new Error(`Scope lease ${input.lease.leaseId} has different report-hold evidence`);
        }
        if (input.lease.recoveryAttempts <= existing.recoveryAttempts) {
          return toScopeLease(existing);
        }
        const advanced = WorkspaceScopeLeaseRecordSchema.parse({
          ...existing,
          recoveryAttempts: input.lease.recoveryAttempts,
        });
        const leases = [...current.leases];
        leases[index] = advanced;
        await this.write({ ...current, revision: current.revision + 1, leases });
        return toScopeLease(advanced);
      }
      const held = WorkspaceScopeLeaseRecordSchema.parse({
        ...existing,
        state: "report_hold",
        transitionedAt: input.transitionedAt,
        capturedDelta: input.capturedDelta,
      });
      const leases = [...current.leases];
      leases[index] = held;
      await this.write({ ...current, revision: current.revision + 1, leases });
      return toScopeLease(held);
    });
  }

  async transferReportHold(input: TransferReportHoldInput): Promise<MissionScopeLease> {
    if (input.sourceAssignmentId === input.replacementAssignmentId) {
      throw new Error("A report hold must transfer to a different Assignment");
    }
    return this.serialize(async () => {
      const current = await this.read();
      const sourceIndex = current.leases.findIndex(
        (candidate) =>
          candidate.leaseId === input.leaseId &&
          candidate.assignmentId === input.sourceAssignmentId,
      );
      if (sourceIndex < 0) {
        const replay = [...current.leases, ...current.historicalIntervals].find(
          (candidate) =>
            candidate.leaseId === input.leaseId && hasReportHoldTransfer(candidate, input),
        );
        if (!replay) {
          throw new Error(
            `Report hold ${input.leaseId} is not owned by Assignment ${input.sourceAssignmentId}`,
          );
        }
        assertReportHoldTransferReplay(replay, input);
        return toScopeLease(replay);
      }

      const source = current.leases[sourceIndex];
      if (!source) throw new Error(`Scope lease ${input.leaseId} disappeared`);
      assertReportHoldTransferContext(source, input);
      if (source.state !== "report_hold") {
        throw new Error(`Scope lease ${input.leaseId} is not a report hold`);
      }
      if (
        current.leases.some((candidate) => candidate.assignmentId === input.replacementAssignmentId)
      ) {
        throw new Error(
          `Assignment ${input.replacementAssignmentId} already owns a workspace scope lease`,
        );
      }

      const queuedReplacement = current.pendingAssignments.find(
        (candidate) => candidate.assignmentId === input.replacementAssignmentId,
      );
      if (queuedReplacement) {
        assertQueuedReportHoldReplacementMatches(queuedReplacement, source, input);
      }

      const transferred = WorkspaceScopeLeaseRecordSchema.parse({
        ...source,
        assignmentId: input.replacementAssignmentId,
        reportHoldTransfers: appendReportHoldTransfer(source, input),
        lastReportHoldTransfer: {
          sourceAssignmentId: input.sourceAssignmentId,
          replacementAssignmentId: input.replacementAssignmentId,
        },
      });
      const leases = [...current.leases];
      leases[sourceIndex] = transferred;
      await this.write({
        ...current,
        revision: current.revision + 1,
        leases,
        pendingAssignments: current.pendingAssignments.filter(
          (candidate) => candidate.assignmentId !== input.replacementAssignmentId,
        ),
      });
      return toScopeLease(transferred);
    });
  }

  private async read(): Promise<WorkspaceScopeLeaseFile> {
    try {
      const body = await readFile(this.options.filePath, "utf8");
      return WorkspaceScopeLeaseFileSchema.parse(JSON.parse(body));
    } catch (error) {
      if (isMissingFile(error)) {
        return { revision: 0, leases: [], historicalIntervals: [], pendingAssignments: [] };
      }
      throw error;
    }
  }

  private async write(file: WorkspaceScopeLeaseFile): Promise<void> {
    await writeJsonFileAtomic(this.options.filePath, WorkspaceScopeLeaseFileSchema.parse(file));
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.catch(() => undefined).then(operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function scopesOverlap(left: MissionMutableScope, right: MissionMutableScope): boolean {
  if (left.kind === "read_only" || right.kind === "read_only") return false;
  if (left.kind === "workspace" || right.kind === "workspace") return true;
  return left.pathPrefixes.some((leftPrefix) =>
    right.pathPrefixes.some((rightPrefix) => pathPrefixesOverlap(leftPrefix, rightPrefix)),
  );
}

function pathPrefixesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function scopeContainsPath(scope: MissionMutableScope, candidatePath: string): boolean {
  if (scope.kind === "workspace") return true;
  if (scope.kind === "read_only") return false;
  return scope.pathPrefixes.some(
    (prefix) => candidatePath === prefix || candidatePath.startsWith(`${prefix}/`),
  );
}

function conflictsWith(
  left: Pick<WorkspaceScopeLeaseRecord, "workspaceIdentity" | "scope">,
  right: Pick<QueuedWorkspaceScopeLeaseAssignment, "workspaceIdentity" | "scope">,
): boolean {
  return (
    left.workspaceIdentity === right.workspaceIdentity && scopesOverlap(left.scope, right.scope)
  );
}

function toQueuedAssignment(
  input: AcquireWorkspaceScopeLeaseInput,
  workspaceIdentity: string,
): QueuedWorkspaceScopeLeaseAssignment {
  return QueuedWorkspaceScopeLeaseAssignmentSchema.parse({
    workspaceId: input.workspaceId,
    assignmentId: input.assignmentId,
    scope: input.scope,
    workspaceIdentity,
    teamId: input.teamId,
    missionId: input.missionId,
    priority: input.priority,
    assignmentCreatedAt: input.createdAt,
  });
}

function compareAssignmentPriority(
  left: Pick<
    QueuedWorkspaceScopeLeaseAssignment,
    "priority" | "assignmentCreatedAt" | "assignmentId"
  >,
  right: Pick<
    QueuedWorkspaceScopeLeaseAssignment,
    "priority" | "assignmentCreatedAt" | "assignmentId"
  >,
): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const createdAt = left.assignmentCreatedAt.localeCompare(right.assignmentCreatedAt);
  if (createdAt !== 0) return createdAt;
  return left.assignmentId.localeCompare(right.assignmentId);
}

function appendHistoricalIntervals(
  intervals: HistoricalWorkspaceScopeLeaseRecord[],
  released: WorkspaceScopeLeaseRecord[],
  releasedAt: string,
): HistoricalWorkspaceScopeLeaseRecord[] {
  return [
    ...intervals,
    ...released.map((lease) =>
      HistoricalWorkspaceScopeLeaseRecordSchema.parse({ ...lease, releasedAt }),
    ),
  ];
}

function parseOwnershipInterval(
  intervalStartedAt: string,
  intervalEndedAt: string,
): { startedAt: number; endedAt: number } {
  const startedAt = timestampMillis(intervalStartedAt);
  const endedAt = timestampMillis(intervalEndedAt);
  if (endedAt < startedAt) {
    throw new Error("Workspace ownership interval ends before it starts");
  }
  return { startedAt, endedAt };
}

function ownershipIntervalsOverlap(
  historical: HistoricalWorkspaceScopeLeaseRecord,
  interval: { startedAt: number; endedAt: number },
): boolean {
  return (
    timestampMillis(historical.acquiredAt) <= interval.endedAt &&
    timestampMillis(historical.releasedAt) >= interval.startedAt
  );
}

function timestampMillis(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid workspace lease timestamp: ${value}`);
  return parsed;
}

function assertReplayMatches(
  existing: WorkspaceScopeLeaseRecord,
  input: AcquireWorkspaceScopeLeaseInput,
  workspaceIdentity: string,
): void {
  const sameOwner =
    existing.teamId === input.teamId &&
    existing.missionId === input.missionId &&
    existing.workspaceIdentity === workspaceIdentity;
  if (!sameOwner || JSON.stringify(existing.scope) !== JSON.stringify(input.scope)) {
    throw new Error(`Assignment ${input.assignmentId} already owns a different scope lease`);
  }
}

function assertQueuedReplayMatches(
  existing: QueuedWorkspaceScopeLeaseAssignment,
  input: AcquireWorkspaceScopeLeaseInput,
  workspaceIdentity: string,
): void {
  const replay = toQueuedAssignment(input, workspaceIdentity);
  if (!isDeepStrictEqual(existing, replay)) {
    throw new Error(`Assignment ${input.assignmentId} already queues for a different scope lease`);
  }
}

function assertReportHoldTransferContext(
  lease: WorkspaceScopeLeaseRecord,
  input: TransferReportHoldInput,
): void {
  if (
    lease.teamId !== input.teamId ||
    lease.missionId !== input.missionId ||
    lease.workspaceId !== input.workspaceId
  ) {
    throw new Error(`Report hold ${input.leaseId} belongs to a different Team Mission workspace`);
  }
}

function assertReportHoldTransferReplay(
  lease: WorkspaceScopeLeaseRecord,
  input: TransferReportHoldInput,
): void {
  assertReportHoldTransferContext(lease, input);
  if (lease.state !== "report_hold" && lease.state !== "execution") {
    throw new Error(`Scope lease ${input.leaseId} is not a report hold`);
  }
  if (!hasReportHoldTransfer(lease, input)) {
    throw new Error(`Report hold ${input.leaseId} was transferred by a different request`);
  }
}

function hasReportHoldTransfer(
  lease: WorkspaceScopeLeaseRecord,
  input: TransferReportHoldInput,
): boolean {
  return reportHoldTransfers(lease).some(
    (transfer) =>
      transfer.sourceAssignmentId === input.sourceAssignmentId &&
      transfer.replacementAssignmentId === input.replacementAssignmentId,
  );
}

function reportHoldTransfers(
  lease: WorkspaceScopeLeaseRecord,
): Array<z.infer<typeof ReportHoldTransferSchema>> {
  const transfers = [...lease.reportHoldTransfers];
  if (
    lease.lastReportHoldTransfer &&
    !transfers.some((transfer) => isDeepStrictEqual(transfer, lease.lastReportHoldTransfer))
  ) {
    transfers.push(lease.lastReportHoldTransfer);
  }
  return transfers;
}

function appendReportHoldTransfer(
  lease: WorkspaceScopeLeaseRecord,
  input: TransferReportHoldInput,
): Array<z.infer<typeof ReportHoldTransferSchema>> {
  const transfers = reportHoldTransfers(lease);
  const next = {
    sourceAssignmentId: input.sourceAssignmentId,
    replacementAssignmentId: input.replacementAssignmentId,
  };
  return transfers.some((transfer) => isDeepStrictEqual(transfer, next))
    ? transfers
    : [...transfers, next];
}

function assertQueuedReportHoldReplacementMatches(
  queued: QueuedWorkspaceScopeLeaseAssignment,
  source: WorkspaceScopeLeaseRecord,
  input: TransferReportHoldInput,
): void {
  if (
    queued.teamId !== input.teamId ||
    queued.missionId !== input.missionId ||
    queued.workspaceId !== input.workspaceId ||
    queued.workspaceIdentity !== source.workspaceIdentity ||
    !isDeepStrictEqual(queued.scope, source.scope)
  ) {
    throw new Error(
      `Assignment ${input.replacementAssignmentId} queues for a different Team Mission workspace`,
    );
  }
}

function toScopeLease(record: WorkspaceScopeLeaseRecord): MissionScopeLease {
  return MissionScopeLeaseSchema.parse(record);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
