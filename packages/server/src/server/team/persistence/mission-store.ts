import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Logger } from "pino";

import type { TeamMission } from "@getpaseo/protocol/team/v2-types";

import { writeJsonFileAtomic } from "../../atomic-file.js";
import {
  MissionAcceptedTurnFactSchema,
  StoredMissionSchema,
  TeamLeadReplacementIntentSchema,
  TeamMissionFinishIntentSchema,
  type StoredMission,
  type TeamLeadReplacementIntent,
  type TeamLeadReplacementStage,
  type TeamMissionFinishIntent,
  type TeamMissionFinishStage,
} from "./schemas.js";

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CreateMissionRecordInput {
  idempotencyKey: string;
  requestFingerprint: string;
  mission: Omit<TeamMission, "revision" | "createdAt" | "updatedAt" | "completedAt">;
}

export interface UpdateMissionRecordInput {
  missionId: string;
  expectedRevision: number;
  expectedStorageRevision?: number;
  update: (mission: TeamMission) => TeamMission | Promise<TeamMission>;
}

export interface FindMissionStartInput {
  teamId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface MissionRecoveryState {
  ownershipIntervals: StoredMission["ownershipIntervals"];
  acceptedTurnFacts: StoredMission["acceptedTurnFacts"];
  assignmentDeltaHandoffs: StoredMission["assignmentDeltaHandoffs"];
  assignmentDispatchIntents: StoredMission["assignmentDispatchIntents"];
  assignmentReportRecoveryOutbox: StoredMission["assignmentReportRecoveryOutbox"];
  recipientChatCursors: StoredMission["recipientChatCursors"];
  recipientAttentionOutbox: StoredMission["recipientAttentionOutbox"];
  completionOutbox: StoredMission["completionOutbox"];
}

export interface RecordMissionAcceptedTurnFactsInput {
  missionId: string;
  facts: StoredMission["acceptedTurnFacts"];
}

export interface UpdateMissionRecoveryStateInput {
  missionId: string;
  expectedStorageRevision: number;
  update: (state: MissionRecoveryState) => MissionRecoveryState | Promise<MissionRecoveryState>;
}

export interface UpdateMissionAggregateInput {
  missionId: string;
  expectedRevision: number;
  update: (input: {
    mission: TeamMission;
    recovery: MissionRecoveryState;
  }) =>
    | { mission: TeamMission; recovery: MissionRecoveryState }
    | Promise<{ mission: TeamMission; recovery: MissionRecoveryState }>;
}

export interface BeginMissionFinishInput {
  missionId: string;
  expectedRevision: number;
  intent: TeamMissionFinishIntent;
  update?: (mission: TeamMission) => TeamMission | Promise<TeamMission>;
}

export interface BeginLeadReplacementInput {
  missionId: string;
  expectedRevision: number;
  intent: TeamLeadReplacementIntent;
  update: (mission: TeamMission) => TeamMission | Promise<TeamMission>;
}

export interface CompleteLeadReplacementInput {
  missionId: string;
  intentId: string;
}

export interface AdvanceLeadReplacementInput {
  missionId: string;
  intentId: string;
  from: TeamLeadReplacementStage;
  to: TeamLeadReplacementStage;
}

export interface AdvanceMissionFinishInput {
  missionId: string;
  intentId: string;
  from: TeamMissionFinishStage;
  to: TeamMissionFinishStage;
}

export interface PrepareMissionFinishEvidenceInput {
  missionId: string;
  intentId: string;
}

export interface FinalizeMissionInput {
  missionId: string;
  intentId: string;
}

interface MissionStoreOptions {
  directory: string;
  logger: Logger;
  now: () => string;
}

interface MissionReadSuccess {
  kind: "success";
  record: StoredMission;
}

interface MissionReadAbsent {
  kind: "absent";
}

interface MissionReadUnreadable {
  kind: "unreadable";
}

type MissionReadState = MissionReadSuccess | MissionReadAbsent | MissionReadUnreadable;

export class MissionUnreadableError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission ${missionId} is unreadable`);
    this.name = "MissionUnreadableError";
  }
}

export class MissionStartConflictError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly existingMissionId: string,
  ) {
    super(`Mission start key ${idempotencyKey} already belongs to ${existingMissionId}`);
    this.name = "MissionStartConflictError";
  }
}

export class MissionIdConflictError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission id ${missionId} already exists`);
    this.name = "MissionIdConflictError";
  }
}

export class MissionNotFoundError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission ${missionId} does not exist`);
    this.name = "MissionNotFoundError";
  }
}

export class MissionRevisionConflictError extends Error {
  constructor(
    readonly missionId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Mission ${missionId} revision ${actualRevision} does not match ${expectedRevision}`);
    this.name = "MissionRevisionConflictError";
  }
}

export class MissionStorageRevisionConflictError extends Error {
  constructor(
    readonly missionId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Mission ${missionId} storage revision ${actualRevision} does not match ${expectedRevision}`,
    );
    this.name = "MissionStorageRevisionConflictError";
  }
}

export class MissionIdentityConflictError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission update cannot change the identity of ${missionId}`);
    this.name = "MissionIdentityConflictError";
  }
}

export class MissionTransactionFieldConflictError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission ${missionId} terminal state can only change through its finish saga`);
    this.name = "MissionTransactionFieldConflictError";
  }
}

export class MissionLeadReplacementConflictError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission ${missionId} already has a different Lead replacement in progress`);
    this.name = "MissionLeadReplacementConflictError";
  }
}

export class MissionFinishConflictError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission ${missionId} already has a finish intent or is terminal`);
    this.name = "MissionFinishConflictError";
  }
}

export class MissionFinishStageConflictError extends Error {
  constructor(
    readonly missionId: string,
    readonly intentId: string,
    readonly actualStage: TeamMissionFinishStage | null,
    readonly requestedStage: TeamMissionFinishStage,
  ) {
    super(
      `Mission ${missionId} finish ${intentId} cannot move from ${String(actualStage)} to ${requestedStage}`,
    );
    this.name = "MissionFinishStageConflictError";
  }
}

export class MissionFinishEvidencePendingError extends Error {
  constructor(
    readonly missionId: string,
    readonly assignmentIds: string[],
  ) {
    super(`Mission ${missionId} finish evidence is pending for ${assignmentIds.join(", ")}`);
    this.name = "MissionFinishEvidencePendingError";
  }
}

export class MissionFinishEvidenceConflictError extends Error {
  constructor(
    readonly missionId: string,
    readonly intentId: string,
  ) {
    super(`Mission ${missionId} finish ${intentId} has missing or mismatched durable evidence`);
    this.name = "MissionFinishEvidenceConflictError";
  }
}

export class MissionStore {
  private readonly directory: string;
  private readonly logger: Logger;
  private readonly now: () => string;
  private readonly mutations = new Map<string, Promise<unknown>>();
  private startIndex: Map<string, string> | null = null;
  private startIndexInitialization: Promise<Map<string, string>> | null = null;

  constructor(options: MissionStoreOptions) {
    this.directory = options.directory;
    this.logger = options.logger.child({ module: "team", component: "v2-mission-store" });
    this.now = options.now;
  }

  async list(teamId?: string): Promise<StoredMission[]> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const records: StoredMission[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const state = await this.readPath(join(this.directory, entry.name));
      if (state.kind === "success" && (!teamId || state.record.mission.teamId === teamId)) {
        records.push(state.record);
      }
    }
    return records.toSorted((left, right) => {
      const byCreatedAt = left.mission.createdAt.localeCompare(right.mission.createdAt);
      return byCreatedAt || left.mission.id.localeCompare(right.mission.id);
    });
  }

  async get(missionId: string): Promise<StoredMission | null> {
    const state = await this.read(missionId);
    if (state.kind === "unreadable") {
      throw new MissionUnreadableError(missionId);
    }
    return state.kind === "success" ? state.record : null;
  }

  async createIfAbsent(input: CreateMissionRecordInput): Promise<StoredMission> {
    assertRecordId(input.mission.id, "Mission");
    const startKey = missionStartKey(input.mission.teamId, input.idempotencyKey);
    return this.serialize(`start:${startKey}`, async () => {
      const existing = await this.findByStartKey(input.mission.teamId, input.idempotencyKey);
      if (existing) {
        if (existing.startRequestFingerprint !== input.requestFingerprint) {
          throw new MissionStartConflictError(input.idempotencyKey, existing.mission.id);
        }
        return existing;
      }

      return this.serialize(`mission:${input.mission.id}`, async () => {
        const idState = await this.read(input.mission.id);
        if (idState.kind === "unreadable") {
          throw new MissionUnreadableError(input.mission.id);
        }
        if (idState.kind === "success") {
          throw new MissionIdConflictError(input.mission.id);
        }

        const now = this.now();
        const created = StoredMissionSchema.parse({
          storageRevision: 1,
          mission: {
            ...input.mission,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          },
          startIdempotencyKey: input.idempotencyKey,
          startRequestFingerprint: input.requestFingerprint,
          leadReplacementIntent: null,
          finishIntent: null,
          finishEvidence: null,
          ownershipIntervals: [],
          acceptedTurnFacts: [],
          assignmentDeltaHandoffs: [],
          assignmentDispatchIntents: [],
          assignmentReportRecoveryOutbox: [],
          recipientChatCursors: [],
          recipientAttentionOutbox: [],
          completionOutbox: [],
        });
        await this.write(created);
        this.startIndex?.set(startKey, created.mission.id);
        return created;
      });
    });
  }

  async findStartedMission(input: FindMissionStartInput): Promise<StoredMission | null> {
    const existing = await this.findByStartKey(input.teamId, input.idempotencyKey);
    if (existing && existing.startRequestFingerprint !== input.requestFingerprint) {
      throw new MissionStartConflictError(input.idempotencyKey, existing.mission.id);
    }
    return existing;
  }

  async update(input: UpdateMissionRecordInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      if (
        input.expectedStorageRevision !== undefined &&
        current.storageRevision !== input.expectedStorageRevision
      ) {
        throw new MissionStorageRevisionConflictError(
          input.missionId,
          input.expectedStorageRevision,
          current.storageRevision,
        );
      }
      if (current.mission.revision !== input.expectedRevision) {
        throw new MissionRevisionConflictError(
          input.missionId,
          input.expectedRevision,
          current.mission.revision,
        );
      }

      const nextMission = await input.update(structuredClone(current.mission));
      if (isDeepStrictEqual(nextMission, current.mission)) {
        return current;
      }
      assertMissionUpdateAllowed(current.mission, nextMission, input.missionId);

      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        mission: {
          ...nextMission,
          revision: current.mission.revision + 1,
          updatedAt: this.now(),
        },
      });
      await this.write(updated);
      return updated;
    });
  }

  async updateRecoveryState(input: UpdateMissionRecoveryStateInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      if (current.storageRevision !== input.expectedStorageRevision) {
        throw new MissionStorageRevisionConflictError(
          input.missionId,
          input.expectedStorageRevision,
          current.storageRevision,
        );
      }

      const recoveryState: MissionRecoveryState = {
        ownershipIntervals: current.ownershipIntervals,
        acceptedTurnFacts: current.acceptedTurnFacts,
        assignmentDeltaHandoffs: current.assignmentDeltaHandoffs,
        assignmentDispatchIntents: current.assignmentDispatchIntents,
        assignmentReportRecoveryOutbox: current.assignmentReportRecoveryOutbox,
        recipientChatCursors: current.recipientChatCursors,
        recipientAttentionOutbox: current.recipientAttentionOutbox,
        completionOutbox: current.completionOutbox,
      };
      const nextState = await input.update(structuredClone(recoveryState));
      if (isDeepStrictEqual(nextState, recoveryState)) {
        return current;
      }

      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        ownershipIntervals: nextState.ownershipIntervals,
        acceptedTurnFacts: nextState.acceptedTurnFacts,
        assignmentDeltaHandoffs: nextState.assignmentDeltaHandoffs,
        assignmentDispatchIntents: nextState.assignmentDispatchIntents,
        assignmentReportRecoveryOutbox: nextState.assignmentReportRecoveryOutbox,
        recipientChatCursors: nextState.recipientChatCursors,
        recipientAttentionOutbox: nextState.recipientAttentionOutbox,
        completionOutbox: nextState.completionOutbox,
      });
      await this.write(updated);
      return updated;
    });
  }

  async recordAcceptedTurnFacts(
    input: RecordMissionAcceptedTurnFactsInput,
  ): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    const facts = input.facts.map((fact) => MissionAcceptedTurnFactSchema.parse(fact));
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      const acceptedTurnFacts = [...current.acceptedTurnFacts];
      let changed = false;
      for (const fact of facts) {
        const existing = acceptedTurnFacts.find((candidate) => candidate.turnId === fact.turnId);
        if (existing) {
          if (
            existing.assignmentId !== fact.assignmentId ||
            existing.runtimeAgentId !== fact.runtimeAgentId ||
            existing.outcome !== fact.outcome
          ) {
            throw new Error(`Accepted turn ${fact.turnId} has conflicting Mission facts`);
          }
          continue;
        }
        acceptedTurnFacts.push(fact);
        changed = true;
      }
      if (!changed) return current;
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        acceptedTurnFacts,
      });
      await this.write(updated);
      return updated;
    });
  }

  async updateAggregate(input: UpdateMissionAggregateInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      if (current.mission.revision !== input.expectedRevision) {
        throw new MissionRevisionConflictError(
          input.missionId,
          input.expectedRevision,
          current.mission.revision,
        );
      }
      const original = {
        mission: structuredClone(current.mission),
        recovery: {
          ownershipIntervals: structuredClone(current.ownershipIntervals),
          acceptedTurnFacts: structuredClone(current.acceptedTurnFacts),
          assignmentDeltaHandoffs: structuredClone(current.assignmentDeltaHandoffs),
          assignmentDispatchIntents: structuredClone(current.assignmentDispatchIntents),
          assignmentReportRecoveryOutbox: structuredClone(current.assignmentReportRecoveryOutbox),
          recipientChatCursors: structuredClone(current.recipientChatCursors),
          recipientAttentionOutbox: structuredClone(current.recipientAttentionOutbox),
          completionOutbox: structuredClone(current.completionOutbox),
        },
      };
      const next = await input.update(structuredClone(original));
      const missionChanged = !isDeepStrictEqual(next.mission, original.mission);
      const recoveryChanged = !isDeepStrictEqual(next.recovery, original.recovery);
      if (!missionChanged && !recoveryChanged) return current;
      assertMissionUpdateAllowed(current.mission, next.mission, input.missionId);

      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        mission: missionChanged
          ? {
              ...next.mission,
              revision: current.mission.revision + 1,
              updatedAt: this.now(),
            }
          : current.mission,
        ownershipIntervals: next.recovery.ownershipIntervals,
        acceptedTurnFacts: next.recovery.acceptedTurnFacts,
        assignmentDeltaHandoffs: next.recovery.assignmentDeltaHandoffs,
        assignmentDispatchIntents: next.recovery.assignmentDispatchIntents,
        assignmentReportRecoveryOutbox: next.recovery.assignmentReportRecoveryOutbox,
        recipientChatCursors: next.recovery.recipientChatCursors,
        recipientAttentionOutbox: next.recovery.recipientAttentionOutbox,
        completionOutbox: next.recovery.completionOutbox,
      });
      await this.write(updated);
      return updated;
    });
  }

  async beginLeadReplacement(input: BeginLeadReplacementInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    const intent = TeamLeadReplacementIntentSchema.parse(input.intent);
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      if (current.leadReplacementIntent) {
        const isReplay =
          current.leadReplacementIntent.idempotencyKey === intent.idempotencyKey &&
          current.leadReplacementIntent.requestFingerprint === intent.requestFingerprint;
        if (isReplay) return current;
        throw new MissionLeadReplacementConflictError(input.missionId);
      }
      if (current.mission.revision !== input.expectedRevision) {
        throw new MissionRevisionConflictError(
          input.missionId,
          input.expectedRevision,
          current.mission.revision,
        );
      }
      const nextMission = await input.update(structuredClone(current.mission));
      assertMissionUpdateAllowed(current.mission, nextMission, input.missionId);
      const now = this.now();
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        mission: {
          ...nextMission,
          revision: current.mission.revision + 1,
          updatedAt: now,
        },
        leadReplacementIntent: intent,
      });
      await this.write(updated);
      return updated;
    });
  }

  async completeLeadReplacement(input: CompleteLeadReplacementInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      const intent = current.leadReplacementIntent;
      if (!intent) return current;
      if (intent.intentId !== input.intentId) {
        throw new MissionLeadReplacementConflictError(input.missionId);
      }
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        leadReplacementIntent: null,
      });
      await this.write(updated);
      return updated;
    });
  }

  async advanceLeadReplacement(input: AdvanceLeadReplacementInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      const intent = current.leadReplacementIntent;
      if (!intent || intent.intentId !== input.intentId) {
        throw new MissionLeadReplacementConflictError(input.missionId);
      }
      if (intent.stage === input.to) return current;
      if (
        intent.stage !== input.from ||
        input.from !== "reserved" ||
        input.to !== "superseded_archived"
      ) {
        throw new MissionLeadReplacementConflictError(input.missionId);
      }
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        leadReplacementIntent: {
          ...intent,
          stage: input.to,
          updatedAt: this.now(),
        },
      });
      await this.write(updated);
      return updated;
    });
  }

  async beginFinish(input: BeginMissionFinishInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    const intent = TeamMissionFinishIntentSchema.parse(input.intent);
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      if (current.finishIntent) {
        const isReplay =
          current.finishIntent.idempotencyKey === intent.idempotencyKey &&
          current.finishIntent.requestFingerprint === intent.requestFingerprint;
        if (isReplay) {
          return current;
        }
        throw new MissionFinishConflictError(input.missionId);
      }
      if (isTerminalMission(current.mission.status)) {
        throw new MissionFinishConflictError(input.missionId);
      }
      if (current.mission.revision !== input.expectedRevision) {
        throw new MissionRevisionConflictError(
          input.missionId,
          input.expectedRevision,
          current.mission.revision,
        );
      }
      if (intent.stage !== "requested") {
        throw new MissionFinishStageConflictError(
          input.missionId,
          intent.intentId,
          null,
          intent.stage,
        );
      }

      const nextMission = input.update
        ? await input.update(structuredClone(current.mission))
        : current.mission;
      assertMissionUpdateAllowed(current.mission, nextMission, input.missionId);
      const now = this.now();
      const missionChanged = !isDeepStrictEqual(nextMission, current.mission);

      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        mission: missionChanged
          ? {
              ...nextMission,
              revision: current.mission.revision + 1,
              updatedAt: now,
            }
          : current.mission,
        finishIntent: intent,
      });
      await this.write(updated);
      return updated;
    });
  }

  async advanceFinish(input: AdvanceMissionFinishInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      const intent = current.finishIntent;
      if (!intent || intent.intentId !== input.intentId) {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          intent?.stage ?? null,
          input.to,
        );
      }
      if (intent.stage === input.to) {
        if (input.to === "evidence_prepared") {
          assertExactFinishEvidence(current, input.intentId);
        }
        return current;
      }
      const isExpectedStage = intent.stage === input.from;
      const isNextStage = NEXT_FINISH_STAGE[input.from] === input.to;
      if (!isExpectedStage || !isNextStage) {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          intent.stage,
          input.to,
        );
      }
      if (input.to === "evidence_prepared") {
        const pendingAssignmentIds = finishEvidencePendingAssignmentIds(current);
        if (pendingAssignmentIds.length > 0) {
          throw new MissionFinishEvidencePendingError(input.missionId, pendingAssignmentIds);
        }
      }

      const now = this.now();
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        leadReplacementIntent:
          input.to === "participants_archived" ? null : current.leadReplacementIntent,
        finishIntent: {
          ...intent,
          stage: input.to,
          updatedAt: now,
        },
        finishEvidence:
          input.to === "evidence_prepared"
            ? {
                intentId: input.intentId,
                preparedAt: now,
                assignments: buildFinishEvidenceAssignments(current),
              }
            : current.finishEvidence,
      });
      await this.write(updated);
      return updated;
    });
  }

  async prepareFinishEvidence(input: PrepareMissionFinishEvidenceInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      const intent = current.finishIntent;
      if (!intent || intent.intentId !== input.intentId) {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          intent?.stage ?? null,
          "evidence_prepared",
        );
      }
      if (intent.stage === "evidence_prepared" || intent.stage === "finalized") {
        assertExactFinishEvidence(current, input.intentId);
        return current;
      }
      if (intent.stage !== "participants_archived") {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          intent.stage,
          "evidence_prepared",
        );
      }
      const pendingAssignmentIds = finishEvidencePendingAssignmentIds(current);
      if (pendingAssignmentIds.length > 0) {
        throw new MissionFinishEvidencePendingError(input.missionId, pendingAssignmentIds);
      }
      const now = this.now();
      const assignments = buildFinishEvidenceAssignments(current);
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        finishIntent: { ...intent, stage: "evidence_prepared", updatedAt: now },
        finishEvidence: { intentId: input.intentId, preparedAt: now, assignments },
      });
      await this.write(updated);
      return updated;
    });
  }

  async finalize(input: FinalizeMissionInput): Promise<StoredMission> {
    assertRecordId(input.missionId, "Mission");
    return this.serialize(`mission:${input.missionId}`, async () => {
      const current = await this.require(input.missionId);
      const intent = current.finishIntent;
      if (!intent || intent.intentId !== input.intentId) {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          intent?.stage ?? null,
          "finalized",
        );
      }
      if (intent.stage === "finalized") {
        assertExactFinishEvidence(current, input.intentId);
        return current;
      }
      if (intent.stage !== "evidence_prepared") {
        throw new MissionFinishStageConflictError(
          input.missionId,
          input.intentId,
          intent.stage,
          "finalized",
        );
      }
      assertExactFinishEvidence(current, input.intentId);

      const now = this.now();
      const missionStatus = TERMINAL_STATUS_BY_FINISH_KIND[intent.kind];
      const terminalMission =
        intent.kind === "completed"
          ? current.mission
          : cancelUnresolvedAssignments(
              current.mission,
              now,
              intent.kind === "failed" ? "mission_failed" : "mission_canceled",
            );
      const resolvedMission = resolveOpenAttentionItems(terminalMission, intent, now);
      const updated = StoredMissionSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        mission: {
          ...resolvedMission,
          status: missionStatus,
          suspendedStatus: null,
          lifecycleRecoveryFailure: null,
          revision: current.mission.revision + 1,
          updatedAt: now,
          completedAt: now,
        },
        finishIntent: {
          ...intent,
          stage: "finalized",
          updatedAt: now,
        },
        ownershipIntervals: closeOwnershipIntervals(current.ownershipIntervals, now),
        assignmentDispatchIntents: [],
        assignmentReportRecoveryOutbox: [],
        recipientAttentionOutbox: current.recipientAttentionOutbox.map((delivery) => {
          if (delivery.state === "acknowledged" || delivery.state === "canceled") {
            return delivery;
          }
          return {
            ...delivery,
            state: "canceled",
            nextEligibleAt: null,
            acknowledgedAt: null,
            canceledAt: now,
            cancelReason: "mission_terminal",
          };
        }),
        completionOutbox: [
          ...current.completionOutbox,
          {
            eventId: intent.completionEventId,
            missionStatus,
            state: "pending",
            attempts: 0,
            createdAt: now,
            lastAttemptAt: null,
            acknowledgedAt: null,
          },
        ],
      });
      await this.write(updated);
      return updated;
    });
  }

  private async findByStartKey(
    teamId: string,
    idempotencyKey: string,
  ): Promise<StoredMission | null> {
    const index = await this.getStartIndex();
    const missionId = index.get(missionStartKey(teamId, idempotencyKey));
    return missionId ? this.get(missionId) : null;
  }

  private async getStartIndex(): Promise<Map<string, string>> {
    if (this.startIndex) return this.startIndex;
    if (!this.startIndexInitialization) {
      const initialization = this.loadStartIndex().catch((error: unknown) => {
        if (this.startIndexInitialization === initialization) {
          this.startIndexInitialization = null;
        }
        throw error;
      });
      this.startIndexInitialization = initialization;
    }
    return this.startIndexInitialization;
  }

  private async loadStartIndex(): Promise<Map<string, string>> {
    const records = await this.list();
    const index = new Map(
      records.map((record) => [
        missionStartKey(record.mission.teamId, record.startIdempotencyKey),
        record.mission.id,
      ]),
    );
    this.startIndex = index;
    return index;
  }

  private async require(missionId: string): Promise<StoredMission> {
    const current = await this.get(missionId);
    if (!current) {
      throw new MissionNotFoundError(missionId);
    }
    return current;
  }

  private async read(missionId: string): Promise<MissionReadState> {
    assertRecordId(missionId, "Mission");
    return this.readPath(this.filePath(missionId));
  }

  private async readPath(filePath: string): Promise<MissionReadState> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { kind: "absent" };
      }
      this.logger.warn({ err: error, filePath }, "failed to read Mission");
      return { kind: "unreadable" };
    }

    try {
      const parsed = StoredMissionSchema.parse(JSON.parse(raw));
      if (parsed.mission.id !== basename(filePath, ".json")) {
        throw new Error(`Mission id ${parsed.mission.id} does not match its file name`);
      }
      return { kind: "success", record: parsed };
    } catch (error) {
      this.logger.warn({ err: error, filePath }, "skipping unreadable Mission");
      return { kind: "unreadable" };
    }
  }

  private async write(record: StoredMission): Promise<void> {
    await writeJsonFileAtomic(this.filePath(record.mission.id), record);
  }

  private filePath(missionId: string): string {
    return join(this.directory, `${missionId}.json`);
  }

  private async serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.mutations.set(key, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(key) === next) {
        this.mutations.delete(key);
      }
    }
  }
}

function assertMissionUpdateAllowed(
  current: TeamMission,
  next: TeamMission,
  missionId: string,
): void {
  const changesTerminalState =
    next.completedAt !== current.completedAt ||
    (next.status !== current.status &&
      (isTerminalMission(next.status) || isTerminalMission(current.status)));
  if (changesTerminalState) {
    throw new MissionTransactionFieldConflictError(missionId);
  }
  const changedIdentity =
    next.id !== current.id ||
    next.teamId !== current.teamId ||
    next.workspaceId !== current.workspaceId ||
    next.createdAt !== current.createdAt;
  if (changedIdentity) {
    throw new MissionIdentityConflictError(missionId);
  }
}

const NEXT_FINISH_STAGE: Partial<Record<TeamMissionFinishStage, TeamMissionFinishStage>> = {
  requested: "dispatch_stopped",
  dispatch_stopped: "participants_archived",
  participants_archived: "evidence_prepared",
  evidence_prepared: "finalized",
};

const TERMINAL_STATUS_BY_FINISH_KIND: Record<
  TeamMissionFinishIntent["kind"],
  "completed" | "failed" | "canceled"
> = {
  completed: "completed",
  failed: "failed",
  canceled: "canceled",
};

function isTerminalMission(status: TeamMission["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function finishEvidencePendingAssignmentIds(record: StoredMission): string[] {
  const factsByTurnId = new Map(record.acceptedTurnFacts.map((fact) => [fact.turnId, fact]));
  const dispatchedRecoveryAssignmentIds = new Set(
    record.assignmentReportRecoveryOutbox
      .filter((delivery) => delivery.state === "dispatched")
      .map((delivery) => delivery.assignmentId),
  );
  return record.mission.assignments.flatMap((assignment) => {
    if (assignment.acceptedTurnId === null) return [];
    const fact = factsByTurnId.get(assignment.acceptedTurnId);
    const hasExactTerminalFact =
      fact?.assignmentId === assignment.assignmentId &&
      fact.runtimeAgentId === assignment.runtimeAgentId;
    const hasExactTerminalEvidence =
      assignment.terminalEvidence?.assignmentId === assignment.assignmentId &&
      assignment.terminalEvidence.acceptedTurn.turnId === assignment.acceptedTurnId &&
      assignment.terminalEvidence.acceptedTurn.runtimeAgentId === assignment.runtimeAgentId &&
      assignment.terminalEvidence.acceptedTurn.outcome === fact?.outcome &&
      assignment.terminalEvidence.acceptedTurn.recordedAt === fact?.recordedAt;
    const hasSettledDeltaState =
      assignment.semanticState !== "running" &&
      assignment.dispatchState === "settled" &&
      assignment.settledAt !== null;
    return hasExactTerminalFact &&
      hasExactTerminalEvidence &&
      hasSettledDeltaState &&
      !dispatchedRecoveryAssignmentIds.has(assignment.assignmentId)
      ? []
      : [assignment.assignmentId];
  });
}

function buildFinishEvidenceAssignments(record: StoredMission) {
  return record.mission.assignments.flatMap((assignment) => {
    const evidence = assignment.terminalEvidence;
    if (!evidence) return [];
    return [
      {
        ...structuredClone(evidence),
        report: structuredClone(assignment.report),
        handoffs: structuredClone(assignment.report?.handoffs ?? evidence.handoffs),
      },
    ];
  });
}

function assertExactFinishEvidence(record: StoredMission, intentId: string): void {
  const persisted = record.finishEvidence;
  const expectedAssignments = buildFinishEvidenceAssignments(record).toSorted(compareEvidence);
  const persistedAssignments = persisted?.assignments.toSorted(compareEvidence);
  if (
    !persisted ||
    persisted.intentId !== intentId ||
    !persistedAssignments ||
    !isDeepStrictEqual(persistedAssignments, expectedAssignments)
  ) {
    throw new MissionFinishEvidenceConflictError(record.mission.id, intentId);
  }
}

type FinishEvidenceAssignment = NonNullable<StoredMission["finishEvidence"]>["assignments"][number];

function compareEvidence(left: FinishEvidenceAssignment, right: FinishEvidenceAssignment): number {
  return left.assignmentId.localeCompare(right.assignmentId);
}

function cancelUnresolvedAssignments(
  mission: TeamMission,
  settledAt: string,
  terminationReason: "mission_canceled" | "mission_failed",
): TeamMission {
  return {
    ...mission,
    assignments: mission.assignments.map((assignment) => {
      if (["completed", "failed", "canceled"].includes(assignment.semanticState)) {
        return assignment;
      }
      return {
        ...assignment,
        revision: assignment.revision + 1,
        dispatchState:
          assignment.acceptedTurnId === null ? ("queued" as const) : ("settled" as const),
        semanticState: "canceled" as const,
        supersededBy: null,
        terminationReason,
        scopeLease: null,
        settledAt,
      };
    }),
  };
}

function resolveOpenAttentionItems(
  mission: TeamMission,
  intent: TeamMissionFinishIntent,
  resolvedAt: string,
): TeamMission {
  return {
    ...mission,
    attentionItems: mission.attentionItems.map((attention) =>
      attention.status === "open"
        ? {
            ...attention,
            status: "resolved" as const,
            resolution: {
              kind: "cancel_mission" as const,
              actorId: "team-runtime",
              reason: intent.reason,
              resolvedAt,
              ownerAssignmentId: null,
              recoveryAssignmentId: null,
            },
          }
        : attention,
    ),
  };
}

function closeOwnershipIntervals(
  intervals: StoredMission["ownershipIntervals"],
  endedAt: string,
): StoredMission["ownershipIntervals"] {
  return intervals.map((interval) =>
    interval.state === "open"
      ? { ...interval, state: "closed" as const, endedAt, closure: "canceled" as const }
      : interval,
  );
}

function missionStartKey(teamId: string, idempotencyKey: string): string {
  return `${teamId}\0${idempotencyKey}`;
}

function assertRecordId(id: string, entity: string): void {
  if (!RECORD_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${entity} id: ${id}`);
  }
}
