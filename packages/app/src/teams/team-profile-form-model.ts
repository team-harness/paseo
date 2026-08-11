import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import type {
  TeamProfileMemberInput,
  TeamProfileMemberPatch,
} from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { TeamExecutionProfile, TeamSkill, TeamV2 } from "@getpaseo/protocol/team/v2-types";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { filterSelectableModels, findModelByReference } from "@/provider-selection/model-catalog";
import {
  INITIAL_USER_MODIFIED,
  resolveAgentForm,
  type AgentFormAction,
  type AgentFormReducerState,
} from "@/provider-selection/resolve-agent-form";
import { buildProviderDefinitions } from "@/utils/provider-definitions";

export interface TeamProfileFormHostSnapshot {
  workspaceId: string;
  serverId: string | null;
  cwd: string | null;
}

export interface TeamProfileProviderSnapshotRequest {
  workspaceId: string;
  serverId: string;
  cwd: string;
}

export interface TeamProfileFormProviderSnapshot extends TeamProfileProviderSnapshotRequest {
  entries: readonly ProviderSnapshotEntry[];
}

export interface TeamProfileFormCreateSnapshot {
  mode: "create";
  workspaceId: string;
  hostSnapshot?: TeamProfileFormHostSnapshot;
  newRowKey: () => string;
  newIdempotencyKey: () => string;
}

export interface TeamProfileFormEditSnapshot {
  mode: "edit";
  profile: TeamV2;
  hostSnapshot?: TeamProfileFormHostSnapshot;
  newRowKey: () => string;
  newIdempotencyKey: () => string;
}

export type TeamProfileFormSnapshot = TeamProfileFormCreateSnapshot | TeamProfileFormEditSnapshot;

export interface TeamProfileSkillRow {
  key: string;
  skillId: string;
  name: string;
  description: string;
}

export interface TeamProfileMemberRow {
  key: string;
  memberId: string | null;
  role: string;
  level: number;
  skillIds: string[];
  executionProfile: TeamExecutionProfileDraft;
  executionProfileDisplay: TeamExecutionProfileDisplay;
  executionProfileModified: boolean;
  executionProfileAvailability: "unresolved" | "available" | "unavailable" | "retained";
  modeOptions: AgentMode[];
  availableThinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
}

export interface TeamExecutionProfileDisplay {
  provider: string | null;
  model: string | null;
  mode: string | null;
  thinking: string | null;
}

export interface TeamExecutionProfileDraft {
  provider: AgentProvider | null;
  model: string | null;
  modeId: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown>;
}

export type TeamProfileFormValidationIssue =
  | { kind: "name_required" }
  | { kind: "workspace_required" }
  | { kind: "skill_required" }
  | { kind: "skill_id_required"; rowKey: string }
  | { kind: "skill_name_required"; rowKey: string }
  | { kind: "duplicate_skill_id"; skillId: string }
  | { kind: "duplicate_skill_name"; name: string }
  | { kind: "member_required" }
  | { kind: "member_role_required"; rowKey: string }
  | { kind: "member_level_invalid"; rowKey: string }
  | { kind: "member_skill_required"; rowKey: string }
  | { kind: "unknown_member_skill"; rowKey: string; skillId: string }
  | { kind: "member_execution_profile_required"; rowKey: string }
  | { kind: "member_execution_profile_unavailable"; rowKey: string }
  | { kind: "lead_required" };

export interface TeamProfileCreatePayload {
  idempotencyKey: string;
  name: string;
  workspaceId: string;
  skills: TeamSkill[];
  lead: TeamProfileMemberInput;
  members: TeamProfileMemberInput[];
}

export interface TeamProfileUpdatePayload {
  idempotencyKey: string;
  teamId: string;
  expectedRevision: number;
  name?: string;
  skills?: TeamSkill[];
  leadMemberId?: string;
  memberAdds?: TeamProfileMemberInput[];
  memberUpdates?: TeamProfileMemberPatch[];
  memberRemovals?: string[];
}

export type TeamProfileSubmitIntent =
  | {
      mode: "create";
      attemptKey: string;
      payload: TeamProfileCreatePayload;
    }
  | {
      mode: "edit";
      attemptKey: string;
      payload: TeamProfileUpdatePayload;
    };

export interface TeamProfileTabDescriptor {
  kind: "team";
  teamId: string;
}

export type TeamProfileFormSubmission =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failure"; message: string; outcome: "unknown" | "definite" }
  | { status: "success"; tab: TeamProfileTabDescriptor };

export interface TeamProfileFormState {
  mode: "create" | "edit";
  teamId: string | null;
  expectedRevision: number | null;
  name: string;
  workspaceId: string;
  skills: TeamProfileSkillRow[];
  members: TeamProfileMemberRow[];
  leadRowKey: string | null;
  idempotencyKey: string;
  providerResolution: "idle" | "pending" | "complete";
  providerScope: TeamProfileProviderSnapshotRequest | null;
  providerSnapshotRequest: TeamProfileProviderSnapshotRequest | null;
  modelSelectorProviders: ProviderSelectorProvider[];
  validationIssues: TeamProfileFormValidationIssue[];
  isDirty: boolean;
  submission: TeamProfileFormSubmission;
  canSubmit: boolean;
}

export interface TeamProfileFormModel {
  getState: () => TeamProfileFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  setName: (value: string) => void;
  applyHostSnapshot: (snapshot: TeamProfileFormHostSnapshot) => void;
  applyProviderSnapshot: (snapshot: TeamProfileFormProviderSnapshot) => void;
  addSkill: () => void;
  removeSkill: (key: string) => void;
  setSkillId: (key: string, value: string) => void;
  setSkillName: (key: string, value: string) => void;
  setSkillDescription: (key: string, value: string) => void;
  addMember: () => void;
  removeMember: (key: string) => void;
  setMemberRole: (key: string, value: string) => void;
  setMemberLevel: (key: string, value: number) => void;
  setMemberSkillIds: (key: string, skillIds: readonly string[]) => void;
  setMemberExecutionProfile: (key: string, profile: TeamExecutionProfile) => void;
  setMemberModel: (key: string, provider: AgentProvider, modelId: string) => void;
  setMemberMode: (key: string, modeId: string | null) => void;
  setMemberThinking: (key: string, thinkingOptionId: string | null) => void;
  setMemberFeatureValues: (key: string, featureValues: Record<string, unknown>) => void;
  setLead: (key: string) => void;
  submitStarted: () => TeamProfileSubmitIntent | null;
  submitFailed: (failure: { message: string; outcome: "unknown" | "definite" }) => void;
  submitSucceeded: (teamId: string) => TeamProfileTabDescriptor | null;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
    } else if (!reported.has(value)) {
      reported.add(value);
      result.push(value);
    }
  }
  return result;
}

function validateSkills(skills: readonly TeamProfileSkillRow[]): TeamProfileFormValidationIssue[] {
  const issues: TeamProfileFormValidationIssue[] = [];
  if (skills.length === 0) issues.push({ kind: "skill_required" });
  for (const skill of skills) {
    if (!skill.skillId.trim()) issues.push({ kind: "skill_id_required", rowKey: skill.key });
    if (!skill.name.trim()) issues.push({ kind: "skill_name_required", rowKey: skill.key });
  }
  for (const skillId of duplicates(skills.map((skill) => skill.skillId.trim()).filter(Boolean))) {
    issues.push({ kind: "duplicate_skill_id", skillId });
  }
  const skillNameByCanonical = new Map<string, string>();
  const skillNames: string[] = [];
  for (const skill of skills) {
    const name = skill.name.trim();
    if (!name) continue;
    const canonical = name.toLowerCase();
    skillNames.push(canonical);
    skillNameByCanonical.set(canonical, name);
  }
  for (const canonical of duplicates(skillNames)) {
    issues.push({ kind: "duplicate_skill_name", name: skillNameByCanonical.get(canonical)! });
  }
  return issues;
}

function validateMembers(
  members: readonly TeamProfileMemberRow[],
  knownSkillIds: ReadonlySet<string>,
): TeamProfileFormValidationIssue[] {
  const issues: TeamProfileFormValidationIssue[] = [];
  if (members.length === 0) issues.push({ kind: "member_required" });
  for (const member of members) {
    if (!member.role.trim()) issues.push({ kind: "member_role_required", rowKey: member.key });
    if (!Number.isInteger(member.level) || member.level < 1 || member.level > 5) {
      issues.push({ kind: "member_level_invalid", rowKey: member.key });
    }
    const normalizedMemberSkillIds = member.skillIds.map((value) => value.trim()).filter(Boolean);
    if (normalizedMemberSkillIds.length === 0) {
      issues.push({ kind: "member_skill_required", rowKey: member.key });
    }
    for (const skillId of new Set(normalizedMemberSkillIds)) {
      if (!knownSkillIds.has(skillId)) {
        issues.push({ kind: "unknown_member_skill", rowKey: member.key, skillId });
      }
    }
    if (!member.executionProfile.provider) {
      issues.push({ kind: "member_execution_profile_required", rowKey: member.key });
    } else if (
      member.executionProfileAvailability === "unavailable" ||
      member.executionProfileAvailability === "unresolved"
    ) {
      issues.push({ kind: "member_execution_profile_unavailable", rowKey: member.key });
    }
  }
  return issues;
}

function validate(state: TeamProfileFormState): TeamProfileFormValidationIssue[] {
  const issues: TeamProfileFormValidationIssue[] = [];
  if (!state.name.trim()) issues.push({ kind: "name_required" });
  if (!state.workspaceId.trim()) issues.push({ kind: "workspace_required" });
  issues.push(...validateSkills(state.skills));
  const knownSkillIds = new Set(state.skills.map((skill) => skill.skillId.trim()).filter(Boolean));
  issues.push(...validateMembers(state.members, knownSkillIds));
  if (!state.leadRowKey || !state.members.some((member) => member.key === state.leadRowKey)) {
    issues.push({ kind: "lead_required" });
  }
  return issues;
}

function resolveExecutionProfileAvailability(input: {
  available: boolean;
  mayRetain: boolean;
  providerResolution: TeamProfileFormState["providerResolution"];
}): TeamProfileMemberRow["executionProfileAvailability"] {
  if (input.available) return "available";
  if (input.mayRetain) return "retained";
  return input.providerResolution === "complete" ? "unavailable" : "unresolved";
}

function isExecutionProfileAvailable(input: {
  entry: ProviderSnapshotEntry | undefined;
  profile: TeamExecutionProfileDraft;
  models: AgentModelDefinition[] | null;
  effectiveModel: AgentModelDefinition | null;
}): boolean {
  if (!input.entry?.enabled || input.entry.status !== "ready") return false;
  if (input.profile.model && !findModelByReference(input.models, input.profile.model)) return false;
  if (
    input.profile.modeId &&
    !input.entry.modes?.some((mode) => mode.id === input.profile.modeId)
  ) {
    return false;
  }
  if (
    input.profile.thinkingOptionId &&
    !input.effectiveModel?.thinkingOptions?.some(
      (option) => option.id === input.profile.thinkingOptionId,
    )
  ) {
    return false;
  }
  return true;
}

function resolveMemberExecutionState(
  member: TeamProfileMemberRow,
  providerEntries: readonly ProviderSnapshotEntry[],
  providerResolution: TeamProfileFormState["providerResolution"],
): TeamProfileMemberRow {
  const provider = member.executionProfile.provider;
  const entry = provider
    ? providerEntries.find((candidate) => candidate.provider === provider)
    : undefined;
  const models = filterSelectableModels(entry?.models ?? null);
  const selectedModel = member.executionProfile.model
    ? findModelByReference(models, member.executionProfile.model)
    : null;
  const effectiveModel =
    selectedModel ?? models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
  const mayRetain = member.memberId !== null && !member.executionProfileModified;
  const executionProfileAvailability = resolveExecutionProfileAvailability({
    available: isExecutionProfileAvailable({
      entry,
      profile: member.executionProfile,
      models,
      effectiveModel,
    }),
    mayRetain,
    providerResolution,
  });
  return {
    ...member,
    executionProfileAvailability,
    modeOptions: entry?.modes ?? [],
    availableThinkingOptions: effectiveModel?.thinkingOptions ?? [],
  };
}

function derive(
  state: TeamProfileFormState,
  providerEntries: readonly ProviderSnapshotEntry[],
  originalProfile: TeamV2 | null,
): TeamProfileFormState {
  const nextState = {
    ...state,
    members: state.members.map((member) =>
      resolveMemberExecutionState(member, providerEntries, state.providerResolution),
    ),
  };
  const validationIssues = validate(nextState);
  const isDirty =
    nextState.mode === "create" ||
    Boolean(originalProfile && hasUpdateChanges(buildUpdatePayload(nextState, originalProfile)));
  const retryingUnknown =
    nextState.submission.status === "failure" && nextState.submission.outcome === "unknown";
  const submissionAllowsSubmit =
    nextState.submission.status !== "pending" && nextState.submission.status !== "success";
  return {
    ...nextState,
    validationIssues,
    isDirty,
    canSubmit:
      submissionAllowsSubmit && (retryingUnknown || (validationIssues.length === 0 && isDirty)),
  };
}

function normalizeSkillIds(skillIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of skillIds) {
    const skillId = value.trim();
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    normalized.push(skillId);
  }
  return normalized;
}

function toSkill(row: TeamProfileSkillRow): TeamSkill {
  const description = row.description.trim();
  return {
    skillId: row.skillId.trim(),
    name: row.name.trim(),
    description: description || null,
  };
}

function toMemberInput(row: TeamProfileMemberRow): TeamProfileMemberInput {
  return {
    role: row.role.trim(),
    level: row.level,
    skillIds: normalizeSkillIds(row.skillIds),
    executionProfile: {
      provider: row.executionProfile.provider ?? "",
      model: row.executionProfile.model?.trim() || null,
      modeId: row.executionProfile.modeId?.trim() || null,
      thinkingOptionId: row.executionProfile.thinkingOptionId?.trim() || null,
      featureValues: structuredClone(row.executionProfile.featureValues),
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function memberPatch(
  row: TeamProfileMemberRow,
  original: TeamV2["members"][number],
): TeamProfileMemberPatch | null {
  const current = toMemberInput(row);
  const patch: TeamProfileMemberPatch = { memberId: original.memberId };
  if (current.role !== original.role) patch.role = current.role;
  if (current.level !== original.level) patch.level = current.level;
  if (!valuesEqual(current.skillIds, original.skillIds)) patch.skillIds = current.skillIds;
  if (!valuesEqual(current.executionProfile, original.executionProfile)) {
    patch.executionProfile = current.executionProfile;
  }
  return Object.keys(patch).length > 1 ? patch : null;
}

function buildUpdatePayload(
  state: TeamProfileFormState,
  original: TeamV2,
): TeamProfileUpdatePayload {
  const payload: TeamProfileUpdatePayload = {
    idempotencyKey: state.idempotencyKey,
    teamId: original.id,
    expectedRevision: original.revision,
  };
  const name = state.name.trim();
  if (name !== original.name) payload.name = name;
  const skills = state.skills.map(toSkill);
  if (!valuesEqual(skills, original.skills)) payload.skills = skills;

  const currentExisting = new Map(
    state.members.flatMap((member) =>
      member.memberId ? [[member.memberId, member] as const] : [],
    ),
  );
  const memberRemovals = original.members
    .filter((member) => !currentExisting.has(member.memberId))
    .map((member) => member.memberId);
  if (memberRemovals.length > 0) payload.memberRemovals = memberRemovals;

  const memberUpdates = original.members.flatMap((originalMember) => {
    const row = currentExisting.get(originalMember.memberId);
    if (!row) return [];
    const patch = memberPatch(row, originalMember);
    return patch ? [patch] : [];
  });
  if (memberUpdates.length > 0) payload.memberUpdates = memberUpdates;

  const memberAdds = state.members.filter((member) => member.memberId === null).map(toMemberInput);
  if (memberAdds.length > 0) payload.memberAdds = memberAdds;

  const leadMemberId = state.members.find((member) => member.key === state.leadRowKey)?.memberId;
  if (leadMemberId && leadMemberId !== original.leadMemberId) {
    payload.leadMemberId = leadMemberId;
  }
  return payload;
}

function hasUpdateChanges(payload: TeamProfileUpdatePayload): boolean {
  return Object.keys(payload).some(
    (key) => key !== "idempotencyKey" && key !== "teamId" && key !== "expectedRevision",
  );
}

function buildSubmitIntent(
  state: TeamProfileFormState,
  originalProfile: TeamV2 | null,
): TeamProfileSubmitIntent {
  if (state.mode === "edit") {
    if (!originalProfile) throw new Error("Edit Team profile form is missing its profile snapshot");
    return {
      mode: "edit",
      attemptKey: state.idempotencyKey,
      payload: buildUpdatePayload(state, originalProfile),
    };
  }
  const lead = state.members.find((member) => member.key === state.leadRowKey);
  if (!lead) throw new Error("Create Team profile form is missing its lead");
  return {
    mode: "create",
    attemptKey: state.idempotencyKey,
    payload: {
      idempotencyKey: state.idempotencyKey,
      name: state.name.trim(),
      workspaceId: state.workspaceId.trim(),
      skills: state.skills.map(toSkill),
      lead: toMemberInput(lead),
      members: state.members.filter((member) => member.key !== lead.key).map(toMemberInput),
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function toProviderSnapshotRequest(
  workspaceId: string,
  snapshot: TeamProfileFormHostSnapshot | undefined,
): TeamProfileProviderSnapshotRequest | null {
  const serverId = snapshot?.serverId?.trim() ?? "";
  const cwd = snapshot?.cwd?.trim() ?? "";
  if (snapshot?.workspaceId.trim() !== workspaceId.trim() || !serverId || !cwd) return null;
  return { workspaceId: workspaceId.trim(), serverId, cwd };
}

function sameProviderScope(
  left: TeamProfileProviderSnapshotRequest | null,
  right: TeamProfileProviderSnapshotRequest | null,
): boolean {
  return (
    left?.workspaceId === right?.workspaceId &&
    left?.serverId === right?.serverId &&
    left?.cwd === right?.cwd
  );
}

function toAgentFormReducerState(
  member: TeamProfileMemberRow,
  scope: TeamProfileProviderSnapshotRequest | null,
): AgentFormReducerState {
  return {
    form: {
      serverId: scope?.serverId ?? null,
      provider: member.executionProfile.provider,
      modeId: member.executionProfile.modeId ?? "",
      model: member.executionProfile.model ?? "",
      thinkingOptionId: member.executionProfile.thinkingOptionId ?? "",
      workingDir: scope?.cwd ?? "",
    },
    userModified: member.executionProfileModified
      ? {
          ...INITIAL_USER_MODIFIED,
          provider: true,
          model: true,
          modeId: true,
          thinkingOptionId: true,
        }
      : INITIAL_USER_MODIFIED,
    resolution: { status: "completed" },
  };
}

function captureSelectedLabel(value: string | null, label: string | undefined): string | null {
  if (!value) return null;
  return label ?? value;
}

function captureExecutionProfileDisplay(
  profile: TeamExecutionProfileDraft,
  providerEntries: readonly ProviderSnapshotEntry[],
): TeamExecutionProfileDisplay {
  const entry = profile.provider
    ? providerEntries.find((candidate) => candidate.provider === profile.provider)
    : undefined;
  const models = filterSelectableModels(entry?.models ?? null);
  const model = profile.model ? findModelByReference(models, profile.model) : null;
  const effectiveModel =
    model ?? models?.find((candidate) => candidate.isDefault) ?? models?.[0] ?? null;
  const modeLabel = entry?.modes?.find((mode) => mode.id === profile.modeId)?.label;
  const thinkingLabel = effectiveModel?.thinkingOptions?.find(
    (option) => option.id === profile.thinkingOptionId,
  )?.label;
  return {
    provider: captureSelectedLabel(profile.provider, entry?.label),
    model: captureSelectedLabel(profile.model, model?.label),
    mode: captureSelectedLabel(profile.modeId, modeLabel),
    thinking: captureSelectedLabel(profile.thinkingOptionId, thinkingLabel),
  };
}

function applyAgentFormAction(
  member: TeamProfileMemberRow,
  scope: TeamProfileProviderSnapshotRequest | null,
  action: AgentFormAction,
  providerEntries: readonly ProviderSnapshotEntry[],
): TeamProfileMemberRow {
  const next = resolveAgentForm(toAgentFormReducerState(member, scope), action).form;
  const providerChanged = next.provider !== member.executionProfile.provider;
  const executionProfile: TeamExecutionProfileDraft = {
    provider: next.provider,
    model: next.model.trim() || null,
    modeId: next.modeId.trim() || null,
    thinkingOptionId: next.thinkingOptionId.trim() || null,
    featureValues: providerChanged ? {} : member.executionProfile.featureValues,
  };
  return {
    ...member,
    executionProfile,
    executionProfileDisplay: captureExecutionProfileDisplay(executionProfile, providerEntries),
    executionProfileModified: true,
  };
}

export function openTeamProfileForm(snapshot: TeamProfileFormSnapshot): TeamProfileFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  const profile = snapshot.mode === "edit" ? snapshot.profile : null;
  const originalProfile = profile ? structuredClone(profile) : null;
  const workspaceId =
    snapshot.mode === "edit" ? snapshot.profile.workspaceId : snapshot.workspaceId;
  const skills: TeamProfileSkillRow[] = profile
    ? profile.skills.map((skill) => ({
        key: snapshot.newRowKey(),
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description ?? "",
      }))
    : [{ key: snapshot.newRowKey(), skillId: "", name: "", description: "" }];
  const members: TeamProfileMemberRow[] = profile
    ? profile.members.map((member) => ({
        key: snapshot.newRowKey(),
        memberId: member.memberId,
        role: member.role,
        level: member.level,
        skillIds: [...member.skillIds],
        executionProfile: structuredClone(member.executionProfile),
        executionProfileDisplay: captureExecutionProfileDisplay(member.executionProfile, []),
        executionProfileModified: false,
        executionProfileAvailability: "retained",
        modeOptions: [],
        availableThinkingOptions: [],
      }))
    : [
        {
          key: snapshot.newRowKey(),
          memberId: null,
          role: "",
          level: 3,
          skillIds: [],
          executionProfile: {
            provider: null,
            model: null,
            modeId: null,
            thinkingOptionId: null,
            featureValues: {},
          },
          executionProfileDisplay: {
            provider: null,
            model: null,
            mode: null,
            thinking: null,
          },
          executionProfileModified: true,
          executionProfileAvailability: "unresolved",
          modeOptions: [],
          availableThinkingOptions: [],
        },
      ];
  const leadRowKey = profile
    ? (members.find((member) => member.memberId === profile.leadMemberId)?.key ?? null)
    : (members[0]?.key ?? null);
  const providerSnapshotRequest = toProviderSnapshotRequest(workspaceId, snapshot.hostSnapshot);
  let providerScope = providerSnapshotRequest;
  let providerEntries: readonly ProviderSnapshotEntry[] = [];
  let frozenIntent: TeamProfileSubmitIntent | null = null;
  let state: TeamProfileFormState = derive(
    {
      mode: snapshot.mode,
      teamId: profile?.id ?? null,
      expectedRevision: profile?.revision ?? null,
      name: profile?.name ?? "",
      workspaceId,
      skills,
      members,
      leadRowKey,
      idempotencyKey: snapshot.newIdempotencyKey(),
      providerResolution: providerSnapshotRequest ? "pending" : "idle",
      providerScope: providerSnapshotRequest,
      providerSnapshotRequest,
      modelSelectorProviders: [],
      validationIssues: [],
      isDirty: snapshot.mode === "create",
      submission: { status: "idle" },
      canSubmit: false,
    },
    providerEntries,
    originalProfile,
  );

  function publish(next: TeamProfileFormState): void {
    if (closed) return;
    state = derive(next, providerEntries, originalProfile);
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setName(value) {
      publish({ ...state, name: value });
    },
    applyHostSnapshot(hostSnapshot) {
      if (hostSnapshot.workspaceId.trim() !== state.workspaceId.trim()) return;
      const request = toProviderSnapshotRequest(state.workspaceId, hostSnapshot);
      if (sameProviderScope(providerScope, request)) return;
      providerScope = request;
      providerEntries = [];
      publish({
        ...state,
        providerResolution: request ? "pending" : "idle",
        providerScope: request,
        providerSnapshotRequest: request,
        modelSelectorProviders: [],
      });
    },
    applyProviderSnapshot(providerSnapshot) {
      const incomingScope: TeamProfileProviderSnapshotRequest = {
        workspaceId: providerSnapshot.workspaceId.trim(),
        serverId: providerSnapshot.serverId.trim(),
        cwd: providerSnapshot.cwd.trim(),
      };
      if (!sameProviderScope(providerScope, incomingScope)) return;
      providerEntries = providerSnapshot.entries;
      publish({
        ...state,
        providerResolution: "complete",
        providerSnapshotRequest: null,
        modelSelectorProviders: buildSelectableProviderSelectorProviders([...providerEntries]),
      });
    },
    addSkill() {
      publish({
        ...state,
        skills: [
          ...state.skills,
          { key: snapshot.newRowKey(), skillId: "", name: "", description: "" },
        ],
      });
    },
    removeSkill(key) {
      publish({ ...state, skills: state.skills.filter((skill) => skill.key !== key) });
    },
    setSkillId(key, value) {
      publish({
        ...state,
        skills: state.skills.map((skill) =>
          skill.key === key ? { ...skill, skillId: value } : skill,
        ),
      });
    },
    setSkillName(key, value) {
      publish({
        ...state,
        skills: state.skills.map((skill) =>
          skill.key === key ? { ...skill, name: value } : skill,
        ),
      });
    },
    setSkillDescription(key, value) {
      publish({
        ...state,
        skills: state.skills.map((skill) =>
          skill.key === key ? { ...skill, description: value } : skill,
        ),
      });
    },
    addMember() {
      publish({
        ...state,
        members: [
          ...state.members,
          {
            key: snapshot.newRowKey(),
            memberId: null,
            role: "",
            level: 3,
            skillIds: [],
            executionProfile: {
              provider: null,
              model: null,
              modeId: null,
              thinkingOptionId: null,
              featureValues: {},
            },
            executionProfileDisplay: {
              provider: null,
              model: null,
              mode: null,
              thinking: null,
            },
            executionProfileModified: true,
            executionProfileAvailability: "unresolved",
            modeOptions: [],
            availableThinkingOptions: [],
          },
        ],
      });
    },
    removeMember(key) {
      publish({ ...state, members: state.members.filter((member) => member.key !== key) });
    },
    setMemberRole(key, value) {
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key ? { ...member, role: value } : member,
        ),
      });
    },
    setMemberLevel(key, value) {
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key ? { ...member, level: value } : member,
        ),
      });
    },
    setMemberSkillIds(key, skillIds) {
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key ? { ...member, skillIds: [...skillIds] } : member,
        ),
      });
    },
    setMemberExecutionProfile(key, nextProfile) {
      const executionProfile = structuredClone(nextProfile);
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key
            ? {
                ...member,
                executionProfile,
                executionProfileDisplay: captureExecutionProfileDisplay(
                  executionProfile,
                  providerEntries,
                ),
                executionProfileModified: true,
              }
            : member,
        ),
      });
    },
    setMemberModel(key, provider, modelId) {
      const entry = providerEntries.find((candidate) => candidate.provider === provider);
      const providerDef = buildProviderDefinitions([...providerEntries]).find(
        (candidate) => candidate.id === provider,
      );
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key
            ? applyAgentFormAction(
                member,
                providerScope,
                {
                  type: "SET_PROVIDER_AND_MODEL_FROM_USER",
                  provider,
                  modelId,
                  providerDef,
                  providerModels: filterSelectableModels(entry?.models ?? null),
                },
                providerEntries,
              )
            : member,
        ),
      });
    },
    setMemberMode(key, modeId) {
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key
            ? applyAgentFormAction(
                member,
                providerScope,
                {
                  type: "SET_MODE_FROM_USER",
                  modeId: modeId ?? "",
                },
                providerEntries,
              )
            : member,
        ),
      });
    },
    setMemberThinking(key, thinkingOptionId) {
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key
            ? applyAgentFormAction(
                member,
                providerScope,
                {
                  type: "SET_THINKING_OPTION_FROM_USER",
                  thinkingOptionId: thinkingOptionId ?? "",
                },
                providerEntries,
              )
            : member,
        ),
      });
    },
    setMemberFeatureValues(key, featureValues) {
      publish({
        ...state,
        members: state.members.map((member) =>
          member.key === key
            ? {
                ...member,
                executionProfile: {
                  ...member.executionProfile,
                  featureValues: structuredClone(featureValues),
                },
                executionProfileModified: true,
              }
            : member,
        ),
      });
    },
    setLead(key) {
      const member = state.members.find((candidate) => candidate.key === key);
      if (!member || (state.mode === "edit" && member.memberId === null)) return;
      publish({ ...state, leadRowKey: key });
    },
    submitStarted() {
      if (
        closed ||
        state.submission.status === "pending" ||
        state.submission.status === "success"
      ) {
        return null;
      }
      const isUnknownRetry =
        state.submission.status === "failure" && state.submission.outcome === "unknown";
      if (!isUnknownRetry && !state.canSubmit) return null;
      if (!frozenIntent) {
        frozenIntent = deepFreeze(structuredClone(buildSubmitIntent(state, originalProfile)));
      }
      publish({ ...state, submission: { status: "pending" } });
      return frozenIntent;
    },
    submitFailed(failure) {
      if (closed || state.submission.status !== "pending") return;
      if (failure.outcome === "definite") {
        frozenIntent = null;
      }
      publish({
        ...state,
        submission: { status: "failure", ...failure },
        idempotencyKey:
          failure.outcome === "definite" ? snapshot.newIdempotencyKey() : state.idempotencyKey,
      });
    },
    submitSucceeded(teamId) {
      if (closed || state.submission.status !== "pending") return null;
      const tab: TeamProfileTabDescriptor = { kind: "team", teamId };
      publish({ ...state, submission: { status: "success", tab } });
      return tab;
    },
  };
}
