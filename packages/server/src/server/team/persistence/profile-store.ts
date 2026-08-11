import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Logger } from "pino";

import type { MissionRosterSnapshot, TeamV2 } from "@getpaseo/protocol/team/v2-types";
import { isTeamMentionToken } from "@getpaseo/protocol/team/mention-handles";

import { writeJsonFileAtomic } from "../../atomic-file.js";
import {
  StoredTeamProfileSchema,
  TeamArchiveIntentSchema,
  TeamMissionStartIntentSchema,
  type StoredTeamProfile,
  type TeamPersistenceAttentionCode,
  type TeamArchiveIntent,
  type TeamArchiveStage,
  type TeamMissionStartIntent,
  type TeamMissionStartStage,
} from "./schemas.js";

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_UPDATE_RECEIPTS = 100;

export interface CreateTeamProfileRecordInput {
  idempotencyKey: string;
  requestFingerprint: string;
  profile: Omit<TeamV2, "revision" | "createdAt" | "updatedAt">;
}

export interface UpdateTeamProfileRecordInput {
  idempotencyKey?: string;
  requestFingerprint?: string;
  teamId: string;
  expectedRevision: number;
  update: (
    profile: TeamV2,
    context: TeamProfileUpdateContext,
  ) => TeamProfileUpdateResult | Promise<TeamProfileUpdateResult>;
}

export interface TeamProfileUpdateContext {
  startIntent: TeamMissionStartIntent | null;
  archiveIntent: TeamArchiveIntent | null;
  retiredMentionHandles: readonly string[];
}

export interface TeamProfileUpdateMutation {
  profile: TeamV2;
  retireMentionHandles?: readonly string[];
}

export type TeamProfileUpdateResult = TeamV2 | TeamProfileUpdateMutation;

export interface BeginTeamMissionStartInput {
  teamId: string;
  intent: TeamMissionStartIntent;
}

export interface AdvanceTeamMissionStartInput {
  teamId: string;
  intentId: string;
  from: TeamMissionStartStage;
  to: TeamMissionStartStage;
}

export interface AlignTeamMissionStartLeadInput {
  teamId: string;
  missionId: string;
  missionStartIntentId: string | null;
  previousLeadMemberId: string;
  replacementAgentId: string;
  bindingEpoch: number;
  rosterSnapshot: MissionRosterSnapshot;
}

export interface ActivateTeamMissionInput {
  teamId: string;
  intentId: string;
  missionId: string;
}

export interface ClearActiveTeamMissionInput {
  teamId: string;
  missionId: string;
}

export interface BeginTeamArchiveInput {
  teamId: string;
  intent: TeamArchiveIntent;
  abandonActiveMissionId?: string;
}

export interface AdvanceTeamArchiveInput {
  teamId: string;
  intentId: string;
  from: TeamArchiveStage;
  to: TeamArchiveStage;
}

export interface FinalizeTeamArchiveInput {
  teamId: string;
  intentId: string;
}

export interface SyncTeamPersistenceAttentionsInput {
  teamId: string;
  attentions: Array<{ missionId: string; code: TeamPersistenceAttentionCode }>;
}

interface TeamProfileStoreOptions {
  directory: string;
  logger: Logger;
  now: () => string;
}

interface TeamProfileReadSuccess {
  kind: "success";
  record: StoredTeamProfile;
}

interface TeamProfileReadAbsent {
  kind: "absent";
}

interface TeamProfileReadUnreadable {
  kind: "unreadable";
  error: unknown;
}

type TeamProfileReadState =
  | TeamProfileReadSuccess
  | TeamProfileReadAbsent
  | TeamProfileReadUnreadable;

export class TeamProfileUnreadableError extends Error {
  constructor(readonly teamId: string) {
    super(`Team profile ${teamId} is unreadable`);
    this.name = "TeamProfileUnreadableError";
  }
}

export class TeamProfileCreateConflictError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly existingTeamId: string,
  ) {
    super(`Team create key ${idempotencyKey} already belongs to ${existingTeamId}`);
    this.name = "TeamProfileCreateConflictError";
  }
}

export class TeamProfileUpdateConflictError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly teamId: string,
  ) {
    super(`Team update key ${idempotencyKey} already belongs to another update for ${teamId}`);
    this.name = "TeamProfileUpdateConflictError";
  }
}

export class TeamProfileIdConflictError extends Error {
  constructor(readonly teamId: string) {
    super(`Team profile id ${teamId} already exists`);
    this.name = "TeamProfileIdConflictError";
  }
}

export class TeamProfileNotFoundError extends Error {
  constructor(readonly teamId: string) {
    super(`Team profile ${teamId} does not exist`);
    this.name = "TeamProfileNotFoundError";
  }
}

export class TeamProfileRevisionConflictError extends Error {
  constructor(
    readonly teamId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Team profile ${teamId} revision ${actualRevision} does not match ${expectedRevision}`);
    this.name = "TeamProfileRevisionConflictError";
  }
}

export class TeamProfileIdentityConflictError extends Error {
  constructor(readonly teamId: string) {
    super(`Team profile update cannot change the identity of ${teamId}`);
    this.name = "TeamProfileIdentityConflictError";
  }
}

export class TeamProfileTransactionFieldConflictError extends Error {
  constructor(readonly teamId: string) {
    super(`Team profile ${teamId} active Mission can only change through its start/finish saga`);
    this.name = "TeamProfileTransactionFieldConflictError";
  }
}

export class TeamMissionStartConflictError extends Error {
  constructor(
    readonly teamId: string,
    readonly currentMissionId: string | null,
  ) {
    super(`Team ${teamId} already has a Mission start in progress or active`);
    this.name = "TeamMissionStartConflictError";
  }
}

export class TeamMissionStartStageConflictError extends Error {
  constructor(
    readonly teamId: string,
    readonly intentId: string,
    readonly actualStage: TeamMissionStartStage | null,
    readonly requestedStage: TeamMissionStartStage,
  ) {
    super(
      `Team ${teamId} start ${intentId} cannot move from ${String(actualStage)} to ${requestedStage}`,
    );
    this.name = "TeamMissionStartStageConflictError";
  }
}

export class TeamActiveMissionConflictError extends Error {
  constructor(
    readonly teamId: string,
    readonly expectedMissionId: string,
    readonly actualMissionId: string,
  ) {
    super(`Team ${teamId} active Mission ${actualMissionId} does not match ${expectedMissionId}`);
    this.name = "TeamActiveMissionConflictError";
  }
}

export class TeamArchiveConflictError extends Error {
  constructor(readonly teamId: string) {
    super(`Team ${teamId} already has a different archive in progress`);
    this.name = "TeamArchiveConflictError";
  }
}

export class TeamArchiveStageConflictError extends Error {
  constructor(
    readonly teamId: string,
    readonly intentId: string,
    readonly actualStage: TeamArchiveStage | null,
    readonly requestedStage: TeamArchiveStage,
  ) {
    super(
      `Team ${teamId} archive ${intentId} cannot move from ${String(actualStage)} to ${requestedStage}`,
    );
    this.name = "TeamArchiveStageConflictError";
  }
}

export class TeamArchiveMissionConflictError extends Error {
  constructor(
    readonly teamId: string,
    readonly expectedMissionId: string | null,
    readonly actualMissionId: string | null,
  ) {
    super(
      `Team ${teamId} archive expected Mission ${String(expectedMissionId)}, found ${String(actualMissionId)}`,
    );
    this.name = "TeamArchiveMissionConflictError";
  }
}

export class TeamProfileStore {
  private readonly directory: string;
  private readonly logger: Logger;
  private readonly now: () => string;
  private readonly mutations = new Map<string, Promise<unknown>>();
  private createIndex: Map<string, string> | null = null;
  private createIndexInitialization: Promise<Map<string, string>> | null = null;

  constructor(options: TeamProfileStoreOptions) {
    this.directory = options.directory;
    this.logger = options.logger.child({ module: "team", component: "v2-profile-store" });
    this.now = options.now;
  }

  async list(): Promise<StoredTeamProfile[]> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const records: StoredTeamProfile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const state = await this.readPath(join(this.directory, entry.name));
      if (state.kind === "success") {
        records.push(state.record);
      }
    }
    return records.toSorted((left, right) => {
      const byCreatedAt = left.profile.createdAt.localeCompare(right.profile.createdAt);
      return byCreatedAt || left.profile.id.localeCompare(right.profile.id);
    });
  }

  async get(teamId: string): Promise<StoredTeamProfile | null> {
    const state = await this.read(teamId);
    if (state.kind === "unreadable") {
      throw new TeamProfileUnreadableError(teamId);
    }
    return state.kind === "success" ? state.record : null;
  }

  async createIfAbsent(input: CreateTeamProfileRecordInput): Promise<StoredTeamProfile> {
    assertRecordId(input.profile.id);
    return this.serialize(`create:${input.idempotencyKey}`, async () => {
      const existing = await this.findByCreateKey(input.idempotencyKey);
      if (existing) {
        if (existing.createRequestFingerprint !== input.requestFingerprint) {
          throw new TeamProfileCreateConflictError(input.idempotencyKey, existing.profile.id);
        }
        return existing;
      }

      return this.serialize(`team:${input.profile.id}`, async () => {
        const idState = await this.read(input.profile.id);
        if (idState.kind === "unreadable") {
          throw new TeamProfileUnreadableError(input.profile.id);
        }
        if (idState.kind === "success") {
          throw new TeamProfileIdConflictError(input.profile.id);
        }

        const now = this.now();
        const created = StoredTeamProfileSchema.parse({
          storageRevision: 1,
          profile: {
            ...input.profile,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
          createIdempotencyKey: input.idempotencyKey,
          createRequestFingerprint: input.requestFingerprint,
          updateReceipts: [],
          retiredMentionHandles: [],
          persistenceAttentions: [],
          startIntent: null,
          archiveIntent: null,
        });
        await this.write(created);
        this.createIndex?.set(input.idempotencyKey, created.profile.id);
        return created;
      });
    });
  }

  async update(input: UpdateTeamProfileRecordInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.get(input.teamId);
      if (!current) {
        throw new TeamProfileNotFoundError(input.teamId);
      }
      const existingReceipt = input.idempotencyKey
        ? current.updateReceipts?.find((receipt) => receipt.idempotencyKey === input.idempotencyKey)
        : undefined;
      if (existingReceipt) {
        if (existingReceipt.requestFingerprint !== input.requestFingerprint) {
          throw new TeamProfileUpdateConflictError(input.idempotencyKey!, input.teamId);
        }
        return current;
      }
      if (current.profile.revision !== input.expectedRevision) {
        throw new TeamProfileRevisionConflictError(
          input.teamId,
          input.expectedRevision,
          current.profile.revision,
        );
      }

      const result = await input.update(structuredClone(current.profile), {
        startIntent: structuredClone(current.startIntent),
        archiveIntent: structuredClone(current.archiveIntent),
        retiredMentionHandles: [...current.retiredMentionHandles],
      });
      const mutation = isTeamProfileUpdateMutation(result)
        ? result
        : { profile: result, retireMentionHandles: [] };
      const nextProfile = mutation.profile;
      const retiredMentionHandles = appendRetiredMentionHandles(
        current.retiredMentionHandles,
        mutation.retireMentionHandles ?? [],
      );
      const profileChanged = !(
        isDeepStrictEqual(nextProfile, current.profile) &&
        isDeepStrictEqual(retiredMentionHandles, current.retiredMentionHandles)
      );
      const updateReceipts = appendUpdateReceipt(
        current,
        input,
        current.profile.revision + (profileChanged ? 1 : 0),
      );
      if (!profileChanged) {
        if (isDeepStrictEqual(updateReceipts, current.updateReceipts ?? [])) return current;
        const updated = StoredTeamProfileSchema.parse({
          ...current,
          storageRevision: current.storageRevision + 1,
          updateReceipts,
        });
        await this.write(updated);
        return updated;
      }
      if (nextProfile.activeMissionId !== current.profile.activeMissionId) {
        throw new TeamProfileTransactionFieldConflictError(input.teamId);
      }
      const changedIdentity =
        nextProfile.id !== current.profile.id ||
        nextProfile.workspaceId !== current.profile.workspaceId ||
        nextProfile.createdAt !== current.profile.createdAt;
      if (changedIdentity) {
        throw new TeamProfileIdentityConflictError(input.teamId);
      }

      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        profile: {
          ...nextProfile,
          revision: current.profile.revision + 1,
          updatedAt: this.now(),
        },
        updateReceipts,
        retiredMentionHandles,
      });
      await this.write(updated);
      return updated;
    });
  }

  async syncPersistenceAttentions(
    input: SyncTeamPersistenceAttentionsInput,
  ): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      const existingById = new Map(
        current.persistenceAttentions.map((attention) => [attention.attentionId, attention]),
      );
      const persistenceAttentions = input.attentions
        .map((attention) => {
          const attentionId = persistenceAttentionId(attention.missionId, attention.code);
          return (
            existingById.get(attentionId) ?? {
              attentionId,
              missionId: attention.missionId,
              code: attention.code,
              detectedAt: this.now(),
            }
          );
        })
        .toSorted((left, right) => left.attentionId.localeCompare(right.attentionId));
      if (isDeepStrictEqual(persistenceAttentions, current.persistenceAttentions)) return current;
      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        persistenceAttentions,
      });
      await this.write(updated);
      return updated;
    });
  }

  async beginMissionStart(input: BeginTeamMissionStartInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    const intent = TeamMissionStartIntentSchema.parse(input.intent);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      if (current.archiveIntent || current.profile.lifecycle === "archived") {
        throw new TeamMissionStartConflictError(
          input.teamId,
          current.profile.activeMissionId ?? current.archiveIntent?.missionId ?? null,
        );
      }
      if (current.startIntent) {
        const isReplay =
          current.startIntent.idempotencyKey === intent.idempotencyKey &&
          current.startIntent.requestFingerprint === intent.requestFingerprint;
        if (isReplay) {
          return current;
        }
        throw new TeamMissionStartConflictError(input.teamId, current.startIntent.missionId);
      }
      if (current.profile.activeMissionId) {
        throw new TeamMissionStartConflictError(input.teamId, current.profile.activeMissionId);
      }
      if (current.profile.revision !== intent.expectedTeamRevision) {
        throw new TeamProfileRevisionConflictError(
          input.teamId,
          intent.expectedTeamRevision,
          current.profile.revision,
        );
      }
      if (intent.stage !== "reserved") {
        throw new TeamMissionStartStageConflictError(
          input.teamId,
          intent.intentId,
          null,
          intent.stage,
        );
      }

      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        startIntent: intent,
      });
      await this.write(updated);
      return updated;
    });
  }

  async advanceMissionStart(input: AdvanceTeamMissionStartInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      const intent = current.startIntent;
      if (!intent || intent.intentId !== input.intentId) {
        throw new TeamMissionStartStageConflictError(
          input.teamId,
          input.intentId,
          intent?.stage ?? null,
          input.to,
        );
      }
      if (intent.stage === input.to) {
        return current;
      }
      const isExpectedStage = intent.stage === input.from;
      const isNextStage = NEXT_START_STAGE[input.from] === input.to;
      if (!isExpectedStage || !isNextStage) {
        throw new TeamMissionStartStageConflictError(
          input.teamId,
          input.intentId,
          intent.stage,
          input.to,
        );
      }

      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        startIntent: {
          ...intent,
          stage: input.to,
          updatedAt: this.now(),
        },
      });
      await this.write(updated);
      return updated;
    });
  }

  async alignMissionStartLead(input: AlignTeamMissionStartLeadInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    assertRecordId(input.missionId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      const intent = current.startIntent;
      if (!intent) {
        if (
          input.missionStartIntentId === null ||
          current.profile.activeMissionId === input.missionId
        ) {
          return current;
        }
        throw new TeamMissionStartConflictError(input.teamId, current.profile.activeMissionId);
      }
      const identityMatches =
        intent.missionId === input.missionId &&
        (input.missionStartIntentId === null || intent.intentId === input.missionStartIntentId);
      if (!identityMatches) {
        throw new TeamMissionStartConflictError(input.teamId, intent.missionId);
      }
      const isReplay =
        intent.leadAgentId === input.replacementAgentId &&
        intent.bindingEpoch === input.bindingEpoch &&
        isDeepStrictEqual(intent.rosterSnapshot, input.rosterSnapshot);
      if (isReplay) return current;
      if (intent.rosterSnapshot.leadMemberId !== input.previousLeadMemberId) {
        throw new TeamMissionStartConflictError(input.teamId, intent.missionId);
      }

      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        startIntent: {
          ...intent,
          leadAgentId: input.replacementAgentId,
          bindingEpoch: input.bindingEpoch,
          rosterSnapshot: structuredClone(input.rosterSnapshot),
          updatedAt: this.now(),
        },
      });
      await this.write(updated);
      return updated;
    });
  }

  async activateMission(input: ActivateTeamMissionInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    assertRecordId(input.missionId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      const intent = current.startIntent;
      if (!intent) {
        if (current.profile.activeMissionId === input.missionId) {
          return current;
        }
        throw new TeamMissionStartConflictError(input.teamId, current.profile.activeMissionId);
      }
      const identityMatches =
        intent.intentId === input.intentId && intent.missionId === input.missionId;
      if (!identityMatches) {
        throw new TeamMissionStartConflictError(input.teamId, intent.missionId);
      }
      if (intent.stage !== "lead_created") {
        throw new TeamMissionStartStageConflictError(
          input.teamId,
          input.intentId,
          intent.stage,
          "lead_created",
        );
      }

      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        profile: {
          ...current.profile,
          activeMissionId: input.missionId,
          revision: current.profile.revision + 1,
          updatedAt: this.now(),
        },
        startIntent: null,
      });
      await this.write(updated);
      return updated;
    });
  }

  async clearActiveMission(input: ClearActiveTeamMissionInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    assertRecordId(input.missionId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      if (current.profile.activeMissionId === null) {
        if (current.startIntent?.missionId !== input.missionId) {
          return current;
        }
        const updated = StoredTeamProfileSchema.parse({
          ...current,
          storageRevision: current.storageRevision + 1,
          startIntent: null,
        });
        await this.write(updated);
        return updated;
      }
      if (current.profile.activeMissionId !== input.missionId) {
        throw new TeamActiveMissionConflictError(
          input.teamId,
          input.missionId,
          current.profile.activeMissionId,
        );
      }

      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        profile: {
          ...current.profile,
          activeMissionId: null,
          revision: current.profile.revision + 1,
          updatedAt: this.now(),
        },
        startIntent:
          current.startIntent?.missionId === input.missionId ? null : current.startIntent,
      });
      await this.write(updated);
      return updated;
    });
  }

  async beginArchive(input: BeginTeamArchiveInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    const intent = TeamArchiveIntentSchema.parse(input.intent);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      if (current.profile.lifecycle === "archived") return current;
      if (current.archiveIntent) {
        const isReplay =
          current.archiveIntent.idempotencyKey === intent.idempotencyKey &&
          current.archiveIntent.requestFingerprint === intent.requestFingerprint;
        if (isReplay) return current;
        throw new TeamArchiveConflictError(input.teamId);
      }
      if (current.profile.revision !== intent.expectedTeamRevision) {
        throw new TeamProfileRevisionConflictError(
          input.teamId,
          intent.expectedTeamRevision,
          current.profile.revision,
        );
      }
      if (intent.stage !== "requested") {
        throw new TeamArchiveStageConflictError(input.teamId, intent.intentId, null, intent.stage);
      }
      if ((intent.missionId === null) !== (intent.missionFinishIntent === null)) {
        throw new TeamArchiveMissionConflictError(input.teamId, intent.missionId, null);
      }
      const abandonActiveMission = resolveArchiveMissionState(current, input, intent);

      const now = this.now();
      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        profile: abandonActiveMission
          ? {
              ...current.profile,
              activeMissionId: null,
              revision: current.profile.revision + 1,
              updatedAt: now,
            }
          : current.profile,
        startIntent:
          abandonActiveMission && current.startIntent?.missionId === input.abandonActiveMissionId
            ? null
            : current.startIntent,
        persistenceAttentions: abandonActiveMission
          ? current.persistenceAttentions.filter(
              (attention) => attention.missionId !== input.abandonActiveMissionId,
            )
          : current.persistenceAttentions,
        archiveIntent: intent,
      });
      await this.write(updated);
      return updated;
    });
  }

  async advanceArchive(input: AdvanceTeamArchiveInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      const intent = current.archiveIntent;
      if (!intent || intent.intentId !== input.intentId) {
        throw new TeamArchiveStageConflictError(
          input.teamId,
          input.intentId,
          intent?.stage ?? null,
          input.to,
        );
      }
      if (intent.stage === input.to) return current;
      if (intent.stage !== input.from || NEXT_ARCHIVE_STAGE[input.from] !== input.to) {
        throw new TeamArchiveStageConflictError(
          input.teamId,
          input.intentId,
          intent.stage,
          input.to,
        );
      }
      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        archiveIntent: { ...intent, stage: input.to, updatedAt: this.now() },
      });
      await this.write(updated);
      return updated;
    });
  }

  async finalizeArchive(input: FinalizeTeamArchiveInput): Promise<StoredTeamProfile> {
    assertRecordId(input.teamId);
    return this.serialize(`team:${input.teamId}`, async () => {
      const current = await this.require(input.teamId);
      if (current.profile.lifecycle === "archived" && current.archiveIntent === null) {
        return current;
      }
      const intent = current.archiveIntent;
      if (!intent || intent.intentId !== input.intentId || intent.stage !== "mission_finished") {
        throw new TeamArchiveStageConflictError(
          input.teamId,
          input.intentId,
          intent?.stage ?? null,
          "mission_finished",
        );
      }
      if (current.profile.activeMissionId || current.startIntent) {
        throw new TeamArchiveMissionConflictError(
          input.teamId,
          null,
          current.profile.activeMissionId ?? current.startIntent?.missionId ?? null,
        );
      }
      const now = this.now();
      const updated = StoredTeamProfileSchema.parse({
        ...current,
        storageRevision: current.storageRevision + 1,
        profile: {
          ...current.profile,
          lifecycle: "archived",
          activeMissionId: null,
          lifecycleRecoveryFailure: null,
          archivedAt: now,
          revision: current.profile.revision + 1,
          updatedAt: now,
        },
        persistenceAttentions: [],
        archiveIntent: null,
      });
      await this.write(updated);
      return updated;
    });
  }

  private async findByCreateKey(idempotencyKey: string): Promise<StoredTeamProfile | null> {
    const index = await this.getCreateIndex();
    const teamId = index.get(idempotencyKey);
    return teamId ? this.get(teamId) : null;
  }

  private async getCreateIndex(): Promise<Map<string, string>> {
    if (this.createIndex) return this.createIndex;
    if (!this.createIndexInitialization) {
      const initialization = this.loadCreateIndex().catch((error: unknown) => {
        if (this.createIndexInitialization === initialization) {
          this.createIndexInitialization = null;
        }
        throw error;
      });
      this.createIndexInitialization = initialization;
    }
    return this.createIndexInitialization;
  }

  private async loadCreateIndex(): Promise<Map<string, string>> {
    const records = await this.list();
    const index = new Map(
      records.map((record) => [record.createIdempotencyKey, record.profile.id]),
    );
    this.createIndex = index;
    return index;
  }

  private async require(teamId: string): Promise<StoredTeamProfile> {
    const current = await this.get(teamId);
    if (!current) {
      throw new TeamProfileNotFoundError(teamId);
    }
    return current;
  }

  private async read(teamId: string): Promise<TeamProfileReadState> {
    assertRecordId(teamId);
    return this.readPath(this.filePath(teamId));
  }

  private async readPath(filePath: string): Promise<TeamProfileReadState> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { kind: "absent" };
      }
      this.logger.warn({ err: error, filePath }, "failed to read Team profile");
      return { kind: "unreadable", error };
    }

    try {
      const parsed = StoredTeamProfileSchema.parse(JSON.parse(raw));
      if (parsed.profile.id !== basename(filePath, ".json")) {
        throw new Error(`Team profile id ${parsed.profile.id} does not match its file name`);
      }
      return { kind: "success", record: parsed };
    } catch (error) {
      this.logger.warn({ err: error, filePath }, "skipping unreadable Team profile");
      return { kind: "unreadable", error };
    }
  }

  private async write(record: StoredTeamProfile): Promise<void> {
    await writeJsonFileAtomic(this.filePath(record.profile.id), record);
  }

  private filePath(teamId: string): string {
    return join(this.directory, `${teamId}.json`);
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

function isTeamProfileUpdateMutation(
  result: TeamProfileUpdateResult,
): result is TeamProfileUpdateMutation {
  return "profile" in result;
}

function appendRetiredMentionHandles(
  current: readonly string[],
  additions: readonly string[],
): string[] {
  const handles = new Set(current);
  for (const addition of additions) {
    const handle = addition.trim().toLowerCase();
    if (isTeamMentionToken(handle)) handles.add(handle);
  }
  return [...handles];
}

function appendUpdateReceipt(
  current: StoredTeamProfile,
  input: UpdateTeamProfileRecordInput,
  resultingRevision: number,
): NonNullable<StoredTeamProfile["updateReceipts"]> {
  const receipts = current.updateReceipts ?? [];
  if (!input.idempotencyKey || !input.requestFingerprint) return receipts;
  return [
    ...receipts,
    {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      resultingRevision,
    },
  ].slice(-MAX_UPDATE_RECEIPTS);
}

const NEXT_START_STAGE: Partial<Record<TeamMissionStartStage, TeamMissionStartStage>> = {
  reserved: "mission_written",
  mission_written: "room_created",
  room_created: "lead_created",
};

const NEXT_ARCHIVE_STAGE: Partial<Record<TeamArchiveStage, TeamArchiveStage>> = {
  requested: "mission_finished",
};

function assertRecordId(id: string): void {
  if (!RECORD_ID_PATTERN.test(id)) {
    throw new Error(`Invalid Team profile id: ${id}`);
  }
}

function persistenceAttentionId(missionId: string, code: TeamPersistenceAttentionCode): string {
  return `${missionId}:${code}`;
}

function isAbandonableActiveMissionAttention(code: TeamPersistenceAttentionCode): boolean {
  return (
    code === "active_mission_missing" ||
    code === "active_mission_team_mismatch" ||
    code === "active_mission_workspace_mismatch"
  );
}

function resolveArchiveMissionState(
  current: StoredTeamProfile,
  input: BeginTeamArchiveInput,
  intent: TeamArchiveIntent,
): boolean {
  const currentMissionId =
    current.profile.activeMissionId ?? current.startIntent?.missionId ?? null;
  if (input.abandonActiveMissionId === undefined) {
    if (currentMissionId !== intent.missionId) {
      throw new TeamArchiveMissionConflictError(input.teamId, intent.missionId, currentMissionId);
    }
    return false;
  }
  const hasAbandonableAttention = current.persistenceAttentions.some(
    (attention) =>
      attention.missionId === input.abandonActiveMissionId &&
      isAbandonableActiveMissionAttention(attention.code),
  );
  if (
    intent.missionId !== null ||
    currentMissionId !== input.abandonActiveMissionId ||
    !hasAbandonableAttention
  ) {
    throw new TeamArchiveMissionConflictError(input.teamId, intent.missionId, currentMissionId);
  }
  return true;
}
