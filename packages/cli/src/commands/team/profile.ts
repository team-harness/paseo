import type { Command } from "commander";
import type {
  MethodologyDescriptor,
  TeamProfileMemberPatch,
} from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { TeamExecutionProfile } from "@getpaseo/protocol/team/v2-types";
import type { CommandError, ListResult, SingleResult } from "../../output/index.js";
import {
  buildProfileMembers,
  connectTeamClient,
  newIdempotencyKey,
  parseTeamSkills,
  toTeamCommandError,
  toTeamResponseError,
  type ProfileMemberDeclarations,
  type TeamCommandOptions,
} from "./shared.js";
import {
  teamProfileDetailSchema,
  teamProfileSchema,
  toTeamProfileDetail,
  toTeamProfileRow,
  type TeamProfileDetail,
  type TeamProfileRow,
} from "./schema.js";

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed)
    throw { code: "MISSING_OPTION", message: `${flag} is required` } satisfies CommandError;
  return trimmed;
}

function oneLeadDeclaration(values: string[] | undefined, flag: string): string {
  if (!values?.length) {
    throw { code: "MISSING_OPTION", message: `${flag} is required` } satisfies CommandError;
  }
  if (values.length > 1) {
    throw {
      code: "DUPLICATE_LEAD_DECLARATION",
      message: `${flag} must be provided exactly once`,
    } satisfies CommandError;
  }
  return required(values[0], flag);
}

function revision(value: string | undefined, flag: string): number {
  const parsed = Number(required(value, flag));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw {
      code: "INVALID_REVISION",
      message: `${flag} must be a non-negative integer`,
    } satisfies CommandError;
  }
  return parsed;
}

function pair(input: string, label: string): [string, string] {
  const separator = input.indexOf("=");
  const key = separator === -1 ? "" : input.slice(0, separator).trim();
  const value = separator === -1 ? "" : input.slice(separator + 1).trim();
  if (!key || !value) {
    throw {
      code: "INVALID_PROFILE_UPDATE",
      message: `Invalid ${label} declaration "${input}"`,
      details: `Use member-id=value, for example --${label} member-1=5.`,
    } satisfies CommandError;
  }
  return [key, value];
}

function singles(inputs: string[] | undefined, label: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const input of inputs ?? []) {
    const [memberId, value] = pair(input, label);
    if (values.has(memberId)) {
      throw {
        code: "DUPLICATE_PROFILE_UPDATE",
        message: `${label} for member "${memberId}" was provided more than once`,
      } satisfies CommandError;
    }
    values.set(memberId, value);
  }
  return values;
}

function repeated(inputs: string[] | undefined, label: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const input of inputs ?? []) {
    const [memberId, value] = pair(input, label);
    values.set(memberId, [...(values.get(memberId) ?? []), value]);
  }
  return values;
}

function methodologySelection(value: string | undefined): { bundleId: string; version: string } {
  const selected = value?.trim() || "paseo/standard@1";
  const separator = selected.lastIndexOf("@");
  const bundleId = separator === -1 ? "" : selected.slice(0, separator);
  const version = separator === -1 ? "" : selected.slice(separator + 1);
  if (!bundleId || !version) {
    throw {
      code: "INVALID_METHODOLOGY",
      message: "--methodology must use bundle-id@version",
    } satisfies CommandError;
  }
  return { bundleId, version };
}

function exactMethodology(
  methodologies: readonly MethodologyDescriptor[],
  selection: { bundleId: string; version: string },
): MethodologyDescriptor {
  const matches = methodologies.filter(
    (methodology) =>
      methodology.ref.bundleId === selection.bundleId &&
      methodology.ref.version === selection.version,
  );
  if (matches.length !== 1) {
    throw {
      code: "METHODOLOGY_NOT_FOUND",
      message: `Methodology ${selection.bundleId}@${selection.version} was not found`,
    } satisfies CommandError;
  }
  return matches[0]!;
}

function patchLevel(rawLevel: string | undefined, memberId: string): number | undefined {
  if (rawLevel === undefined) return undefined;
  const level = Number(rawLevel);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    throw {
      code: "INVALID_PROFILE_LEVEL",
      message: `Level for member "${memberId}" must be an integer from 1 to 5`,
    } satisfies CommandError;
  }
  return level;
}

function patchFeatureValues(memberId: string, inputs: string[]): Record<string, unknown> {
  const featureValues: Record<string, unknown> = {};
  for (const input of inputs) {
    const [key, rawValue] = pair(input, "update-feature");
    try {
      featureValues[key] = JSON.parse(rawValue);
    } catch {
      throw {
        code: "INVALID_PROFILE_FEATURE",
        message: `Feature "${key}" for member "${memberId}" must contain a JSON value`,
      } satisfies CommandError;
    }
  }
  return featureValues;
}

interface ExecutionPatchMaps {
  providers: Map<string, string>;
  models: Map<string, string>;
  modes: Map<string, string>;
  thinking: Map<string, string>;
  features: Map<string, string[]>;
}

function patchExecutionProfile(
  memberId: string,
  maps: ExecutionPatchMaps,
): TeamExecutionProfile | undefined {
  const changesExecutionProfile =
    maps.providers.has(memberId) ||
    maps.models.has(memberId) ||
    maps.modes.has(memberId) ||
    maps.thinking.has(memberId) ||
    maps.features.has(memberId);
  if (!changesExecutionProfile) return undefined;
  const provider = maps.providers.get(memberId);
  if (!provider) {
    throw {
      code: "MISSING_PROFILE_DECLARATION",
      message: `--update-provider is required when changing member "${memberId}" execution profile`,
    } satisfies CommandError;
  }
  return {
    provider: provider as TeamExecutionProfile["provider"],
    model: maps.models.get(memberId) ?? null,
    modeId: maps.modes.get(memberId) ?? null,
    thinkingOptionId: maps.thinking.get(memberId) ?? null,
    featureValues: patchFeatureValues(memberId, maps.features.get(memberId) ?? []),
  };
}

function buildMemberPatches(options: ProfileUpdateOptions): TeamProfileMemberPatch[] {
  const roles = singles(options.updateRole, "update-role");
  const levels = singles(options.updateLevel, "update-level");
  const skills = repeated(options.updateSkill, "update-skill");
  const providers = singles(options.updateProvider, "update-provider");
  const models = singles(options.updateModel, "update-model");
  const modes = singles(options.updateMode, "update-mode");
  const thinking = singles(options.updateThinkingOption, "update-thinking-option");
  const features = repeated(options.updateFeature, "update-feature");
  const memberIds = new Set([
    ...roles.keys(),
    ...levels.keys(),
    ...skills.keys(),
    ...providers.keys(),
    ...models.keys(),
    ...modes.keys(),
    ...thinking.keys(),
    ...features.keys(),
  ]);

  const patches: TeamProfileMemberPatch[] = [];
  for (const memberId of memberIds) {
    const patch: TeamProfileMemberPatch = { memberId };
    const role = roles.get(memberId);
    const level = patchLevel(levels.get(memberId), memberId);
    const skillIds = skills.get(memberId);
    const executionProfile = patchExecutionProfile(memberId, {
      providers,
      models,
      modes,
      thinking,
      features,
    });
    if (role !== undefined) patch.role = role;
    if (level !== undefined) patch.level = level;
    if (skillIds !== undefined) patch.skillIds = skillIds;
    if (executionProfile !== undefined) patch.executionProfile = executionProfile;
    patches.push(patch);
  }
  return patches;
}

function assertMemberSkillsExist(
  skills: Array<{ skillId: string }>,
  members: Array<{ role: string; skillIds: string[] }>,
): void {
  const skillIds = new Set(skills.map((skill) => skill.skillId));
  for (const member of members) {
    const unknown = member.skillIds.find((skillId) => !skillIds.has(skillId));
    if (unknown) {
      throw {
        code: "UNKNOWN_TEAM_SKILL",
        message: `Role "${member.role}" references undeclared skill "${unknown}"`,
      } satisfies CommandError;
    }
  }
}

interface MemberDeclarationOptions extends TeamCommandOptions {
  level?: string[];
  memberSkill?: string[];
  provider?: string[];
  model?: string[];
  mode?: string[];
  thinkingOption?: string[];
  feature?: string[];
  agentProfile?: string[];
}

function memberDeclarations(
  members: string[],
  options: MemberDeclarationOptions,
): ProfileMemberDeclarations {
  return {
    members,
    levels: options.level,
    skills: options.memberSkill,
    providers: options.provider,
    models: options.model,
    modes: options.mode,
    thinkingOptions: options.thinkingOption,
    features: options.feature,
    agentProfiles: options.agentProfile,
  };
}

export interface ProfileCreateOptions extends MemberDeclarationOptions {
  workspace?: string;
  skill?: string[];
  lead?: string[];
  member?: string[];
  idempotencyKey?: string;
  methodology?: string;
  preset?: string;
  archetype?: string[];
  methodologySkill?: string[];
}

export async function runProfileCreateCommand(
  name: string,
  options: ProfileCreateOptions,
  _command: Command,
): Promise<SingleResult<TeamProfileRow>> {
  const leadDeclaration = oneLeadDeclaration(options.lead, "--lead");
  const profiles = buildProfileMembers(
    memberDeclarations([leadDeclaration, ...(options.member ?? [])], options),
  );
  const skills = parseTeamSkills(options.skill ?? []);
  if (!skills.length) {
    throw { code: "MISSING_OPTION", message: "--skill is required" } satisfies CommandError;
  }
  assertMemberSkillsExist(skills, profiles);
  const { client } = await connectTeamClient(options.host);
  try {
    const catalog = await client.listTeamMethodologies();
    if (catalog.error) throw toTeamResponseError("list Team Methodologies", catalog);
    const methodology = exactMethodology(
      catalog.methodologies,
      methodologySelection(options.methodology),
    );
    const presetId = required(options.preset, "--preset");
    if (!methodology.presets.some((preset) => preset.presetId === presetId)) {
      throw {
        code: "METHODOLOGY_PRESET_NOT_FOUND",
        message: `Preset "${presetId}" does not exist in ${methodology.ref.bundleId}@${methodology.ref.version}`,
      } satisfies CommandError;
    }
    const memberKeys = new Set(profiles.map((profile) => profile.clientMemberKey));
    const archetypes = singles(options.archetype, "archetype");
    const profileSources = singles(options.agentProfile, "agent-profile");
    const methodologySkills = singles(options.methodologySkill, "methodology-skill");
    for (const key of archetypes.keys()) {
      if (!memberKeys.has(key)) {
        throw {
          code: "UNKNOWN_MEMBER_DECLARATION_KEY",
          message: `archetype was provided for unknown member declaration key "${key}"`,
        } satisfies CommandError;
      }
    }
    for (const [key, archetypeId] of archetypes) {
      if (!methodology.archetypes.some((archetype) => archetype.archetypeId === archetypeId)) {
        throw {
          code: "METHODOLOGY_ARCHETYPE_NOT_FOUND",
          message: `Archetype "${archetypeId}" for member "${key}" does not exist in ${methodology.ref.bundleId}@${methodology.ref.version}`,
        } satisfies CommandError;
      }
    }
    for (const [teamSkillId, methodologySkillId] of methodologySkills) {
      if (!skills.some((skill) => skill.skillId === teamSkillId)) {
        throw {
          code: "UNKNOWN_TEAM_SKILL",
          message: `Methodology Skill binding references undeclared Team skill "${teamSkillId}"`,
        } satisfies CommandError;
      }
      if (!methodology.skills.some((skill) => skill.skillId === methodologySkillId)) {
        throw {
          code: "METHODOLOGY_SKILL_NOT_FOUND",
          message: `Methodology Skill "${methodologySkillId}" does not exist in ${methodology.ref.bundleId}@${methodology.ref.version}`,
        } satisfies CommandError;
      }
    }
    const members = profiles.map(({ clientMemberKey, executionProfile, ...facts }) => ({
      clientMemberKey,
      ...facts,
      executionProfileSelection: profileSources.has(clientMemberKey)
        ? {
            kind: "agent_profile" as const,
            profileId: profileSources.get(clientMemberKey)!,
          }
        : { kind: "inline" as const, executionProfile },
    }));
    const payload = await client.createTeamProfile({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      name: required(name, "name"),
      creationWorkspaceId: required(options.workspace, "--workspace"),
      skills,
      leadClientMemberKey: profiles[0]!.clientMemberKey,
      members,
      methodologyBinding: {
        ref: methodology.ref,
        presetId,
        memberArchetypeBindings: members.map((member) => ({
          clientMemberKey: member.clientMemberKey,
          archetypeId: archetypes.get(member.clientMemberKey) ?? null,
        })),
        skillBindings: skills.map((skill) => ({
          teamSkillId: skill.skillId,
          methodologySkillId: methodologySkills.get(skill.skillId) ?? null,
        })),
      },
    });
    if (!payload.team) throw toTeamResponseError("create the Team profile", payload);
    return { type: "single", data: toTeamProfileRow(payload.team), schema: teamProfileSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_CREATE_FAILED", "create Team profile", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface ProfileListOptions extends TeamCommandOptions {
  all?: boolean;
}

export async function runProfileListCommand(
  options: ProfileListOptions,
  _command: Command,
): Promise<ListResult<TeamProfileRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.listTeamProfiles({ includeArchived: options.all === true });
    if (payload.error) throw toTeamResponseError("list Team profiles", payload);
    return {
      type: "list",
      data: payload.teams.map(toTeamProfileRow),
      schema: teamProfileSchema,
    };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_LIST_FAILED", "list Team profiles", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runProfileInspectCommand(
  teamId: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<SingleResult<TeamProfileDetail>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.inspectTeamProfile({ teamId });
    if (!payload.team) throw toTeamResponseError("inspect the Team profile", payload);
    return {
      type: "single",
      data: toTeamProfileDetail(payload.team),
      schema: teamProfileDetailSchema,
    };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_INSPECT_FAILED", "inspect Team profile", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface ProfileUpdateOptions extends TeamCommandOptions {
  expectedRevision?: string;
  name?: string;
  skill?: string[];
  leadMember?: string;
  addMember?: string[];
  addLevel?: string[];
  addSkill?: string[];
  addProvider?: string[];
  addModel?: string[];
  addMode?: string[];
  addThinkingOption?: string[];
  addFeature?: string[];
  updateRole?: string[];
  updateLevel?: string[];
  updateSkill?: string[];
  updateProvider?: string[];
  updateModel?: string[];
  updateMode?: string[];
  updateThinkingOption?: string[];
  updateFeature?: string[];
  removeMember?: string[];
  idempotencyKey?: string;
}

export async function runProfileUpdateCommand(
  teamId: string,
  options: ProfileUpdateOptions,
  _command: Command,
): Promise<SingleResult<TeamProfileRow>> {
  const addMembers = options.addMember ?? [];
  const addDeclarations = [
    options.addLevel,
    options.addSkill,
    options.addProvider,
    options.addModel,
    options.addMode,
    options.addThinkingOption,
    options.addFeature,
  ];
  if (!addMembers.length && addDeclarations.some((values) => values?.length)) {
    throw {
      code: "INVALID_PROFILE_UPDATE",
      message: "--add-member is required when using an --add-* member declaration",
    } satisfies CommandError;
  }
  const memberAdds = addMembers.length
    ? buildProfileMembers({
        members: addMembers,
        levels: options.addLevel,
        skills: options.addSkill,
        providers: options.addProvider,
        models: options.addModel,
        modes: options.addMode,
        thinkingOptions: options.addThinkingOption,
        features: options.addFeature,
      })
    : [];
  const memberUpdates = buildMemberPatches(options);
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.updateTeamProfile({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      teamId,
      expectedRevision: revision(options.expectedRevision, "--expected-revision"),
      ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      ...(options.skill ? { skills: parseTeamSkills(options.skill) } : {}),
      ...(options.leadMember?.trim() ? { leadMemberId: options.leadMember.trim() } : {}),
      ...(memberAdds.length ? { memberAdds } : {}),
      ...(memberUpdates.length ? { memberUpdates } : {}),
      ...(options.removeMember?.length ? { memberRemovals: options.removeMember } : {}),
    });
    if (!payload.team) throw toTeamResponseError("update the Team profile", payload);
    return { type: "single", data: toTeamProfileRow(payload.team), schema: teamProfileSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_UPDATE_FAILED", "update Team profile", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface ProfileArchiveOptions extends TeamCommandOptions {
  expectedRevision?: string;
  idempotencyKey?: string;
}

export async function runProfileArchiveCommand(
  teamId: string,
  options: ProfileArchiveOptions,
  _command: Command,
): Promise<SingleResult<TeamProfileRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.archiveTeamProfile({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      teamId,
      expectedRevision: revision(options.expectedRevision, "--expected-revision"),
    });
    if (!payload.team) throw toTeamResponseError("archive the Team profile", payload);
    return { type: "single", data: toTeamProfileRow(payload.team), schema: teamProfileSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_ARCHIVE_FAILED", "archive Team profile", err);
  } finally {
    await client.close().catch(() => {});
  }
}
