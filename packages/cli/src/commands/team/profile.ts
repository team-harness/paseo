import type { Command } from "commander";
import { confirm, isCancel } from "@clack/prompts";
import type {
  ExactMethodologyRef,
  MethodologyDescriptor,
  TeamExecutionProfileSelection,
  TeamProfileMemberPatch,
} from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { TeamProfileUpdateRequest } from "@getpaseo/protocol/messages";
import type { TeamExecutionProfile, TeamV2 } from "@getpaseo/protocol/team/v2-types";
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
  agentProfiles: Map<string, string>;
}

function patchExecutionSelection(
  memberId: string,
  maps: ExecutionPatchMaps,
): TeamExecutionProfileSelection | undefined {
  const changesInlineExecution =
    maps.providers.has(memberId) ||
    maps.models.has(memberId) ||
    maps.modes.has(memberId) ||
    maps.thinking.has(memberId) ||
    maps.features.has(memberId);
  const agentProfile = maps.agentProfiles.get(memberId);
  if (agentProfile && changesInlineExecution) {
    throw {
      code: "AMBIGUOUS_EXECUTION_SELECTION",
      message: `Member "${memberId}" cannot combine --update-agent-profile with inline execution options`,
    } satisfies CommandError;
  }
  if (agentProfile) return { kind: "agent_profile", profileId: agentProfile };
  if (!changesInlineExecution) return undefined;
  const provider = maps.providers.get(memberId);
  if (!provider) {
    throw {
      code: "MISSING_PROFILE_DECLARATION",
      message: `--update-provider is required when changing member "${memberId}" execution profile`,
    } satisfies CommandError;
  }
  return {
    kind: "inline",
    executionProfile: {
      provider: provider as TeamExecutionProfile["provider"],
      model: maps.models.get(memberId) ?? null,
      modeId: maps.modes.get(memberId) ?? null,
      thinkingOptionId: maps.thinking.get(memberId) ?? null,
      featureValues: patchFeatureValues(memberId, maps.features.get(memberId) ?? []),
    },
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
  const agentProfiles = singles(options.updateAgentProfile, "update-agent-profile");
  const memberIds = new Set([
    ...roles.keys(),
    ...levels.keys(),
    ...skills.keys(),
    ...providers.keys(),
    ...models.keys(),
    ...modes.keys(),
    ...thinking.keys(),
    ...features.keys(),
    ...agentProfiles.keys(),
  ]);

  const patches: TeamProfileMemberPatch[] = [];
  for (const memberId of memberIds) {
    const patch: TeamProfileMemberPatch = { memberId };
    const role = roles.get(memberId);
    const level = patchLevel(levels.get(memberId), memberId);
    const skillIds = skills.get(memberId);
    const executionProfileSelection = patchExecutionSelection(memberId, {
      providers,
      models,
      modes,
      thinking,
      features,
      agentProfiles,
    });
    if (role !== undefined) patch.role = role;
    if (level !== undefined) patch.level = level;
    if (skillIds !== undefined) patch.skillIds = skillIds;
    patches.push(
      executionProfileSelection === undefined ? patch : { ...patch, executionProfileSelection },
    );
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
    const members = profiles;
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
    const [payload, config, catalog] = await Promise.all([
      client.inspectTeamProfile({ teamId }),
      client.getDaemonConfig(),
      client.listTeamMethodologies(),
    ]);
    if (!payload.team) throw toTeamResponseError("inspect the Team profile", payload);
    if (catalog.error) throw toTeamResponseError("list Team Methodologies", catalog);
    const methodology = catalog.methodologies.find((item) =>
      sameRef(item.ref, payload.team!.methodologyBinding.ref),
    );
    return {
      type: "single",
      data: toTeamProfileDetail(
        payload.team,
        config.config.agentProfiles ?? [],
        methodology ?? null,
      ),
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
  addAgentProfile?: string[];
  updateRole?: string[];
  updateLevel?: string[];
  updateSkill?: string[];
  updateProvider?: string[];
  updateModel?: string[];
  updateMode?: string[];
  updateThinkingOption?: string[];
  updateFeature?: string[];
  updateAgentProfile?: string[];
  removeMember?: string[];
  methodology?: string;
  preset?: string;
  archetype?: string[];
  methodologySkill?: string[];
  idempotencyKey?: string;
  yes?: boolean;
}

function sameRef(left: ExactMethodologyRef, right: ExactMethodologyRef): boolean {
  return (
    left.bundleId === right.bundleId &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

function buildMethodologyUpgrade(
  team: TeamV2,
  methodology: MethodologyDescriptor,
  options: ProfileUpdateOptions,
) {
  const archetypes = singles(options.archetype, "archetype");
  const methodologySkills = singles(options.methodologySkill, "methodology-skill");
  const memberIds = new Set(team.members.map((member) => member.memberId));
  const teamSkillIds = new Set(team.skills.map((skill) => skill.skillId));
  for (const memberId of archetypes.keys()) {
    if (!memberIds.has(memberId)) {
      throw {
        code: "UNKNOWN_TEAM_MEMBER",
        message: `Archetype binding references unknown Team Member "${memberId}"`,
      } satisfies CommandError;
    }
  }
  for (const skillId of methodologySkills.keys()) {
    if (!teamSkillIds.has(skillId)) {
      throw {
        code: "UNKNOWN_TEAM_SKILL",
        message: `Methodology Skill binding references unknown Team skill "${skillId}"`,
      } satisfies CommandError;
    }
  }
  const priorArchetypes = new Map(
    team.methodologyBinding.memberArchetypeBindings.map((binding) => [
      binding.memberId,
      binding.archetypeId,
    ]),
  );
  const priorSkills = new Map(
    team.methodologyBinding.skillBindings.map((binding) => [
      binding.teamSkillId,
      binding.methodologySkillId,
    ]),
  );
  const validArchetypes = new Set(methodology.archetypes.map((item) => item.archetypeId));
  const validSkills = new Set(methodology.skills.map((item) => item.skillId));
  const presetId = options.preset?.trim() || team.methodologyBinding.presetId;
  if (presetId && !methodology.presets.some((preset) => preset.presetId === presetId)) {
    throw {
      code: "METHODOLOGY_PRESET_NOT_FOUND",
      message: `Preset "${presetId}" does not exist in ${methodology.ref.bundleId}@${methodology.ref.version}`,
    } satisfies CommandError;
  }
  return {
    expectedRef: team.methodologyBinding.ref,
    ref: methodology.ref,
    presetId,
    memberArchetypeBindings: team.members.map((member) => {
      const requested = archetypes.get(member.memberId);
      const prior = priorArchetypes.get(member.memberId) ?? null;
      const archetypeId = requested ?? (prior && validArchetypes.has(prior) ? prior : null);
      if (archetypeId && !validArchetypes.has(archetypeId)) {
        throw {
          code: "METHODOLOGY_ARCHETYPE_NOT_FOUND",
          message: `Archetype "${archetypeId}" does not exist in ${methodology.ref.bundleId}@${methodology.ref.version}`,
        } satisfies CommandError;
      }
      return { memberId: member.memberId, archetypeId };
    }),
    skillBindings: team.skills.map((skill) => {
      const requested = methodologySkills.get(skill.skillId);
      const prior = priorSkills.get(skill.skillId) ?? null;
      const methodologySkillId = requested ?? (prior && validSkills.has(prior) ? prior : null);
      if (methodologySkillId && !validSkills.has(methodologySkillId)) {
        throw {
          code: "METHODOLOGY_SKILL_NOT_FOUND",
          message: `Methodology Skill "${methodologySkillId}" does not exist in ${methodology.ref.bundleId}@${methodology.ref.version}`,
        } satisfies CommandError;
      }
      return { teamSkillId: skill.skillId, methodologySkillId };
    }),
  };
}

type TeamClient = Awaited<ReturnType<typeof connectTeamClient>>["client"];
type MethodologyUpgrade = NonNullable<TeamProfileUpdateRequest["methodologyUpgrade"]>;

function prepareMemberProfileUpdate(options: ProfileUpdateOptions): {
  memberAdds: NonNullable<TeamProfileUpdateRequest["memberAdds"]>;
  memberUpdates: TeamProfileMemberPatch[];
} {
  const addMembers = options.addMember ?? [];
  const addDeclarations = [
    options.addLevel,
    options.addSkill,
    options.addProvider,
    options.addModel,
    options.addMode,
    options.addThinkingOption,
    options.addFeature,
    options.addAgentProfile,
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
        agentProfiles: options.addAgentProfile,
      }).map(({ clientMemberKey: _clientMemberKey, ...member }) => member)
    : [];
  return { memberAdds, memberUpdates: buildMemberPatches(options) };
}

async function prepareMethodologyUpgrade(
  client: TeamClient,
  teamId: string,
  options: ProfileUpdateOptions,
): Promise<
  | {
      upgrade: MethodologyUpgrade;
      preview: string;
    }
  | undefined
> {
  if (!options.methodology) {
    if (options.preset || options.archetype?.length || options.methodologySkill?.length) {
      throw {
        code: "INVALID_PROFILE_UPDATE",
        message: "--methodology is required with Methodology binding options",
      } satisfies CommandError;
    }
    return undefined;
  }
  const [profile, catalog] = await Promise.all([
    client.inspectTeamProfile({ teamId }),
    client.listTeamMethodologies(),
  ]);
  if (!profile.team) throw toTeamResponseError("inspect the Team profile", profile);
  if (catalog.error) throw toTeamResponseError("list Team Methodologies", catalog);
  const methodology = exactMethodology(
    catalog.methodologies,
    methodologySelection(options.methodology),
  );
  const methodologyUpgrade = buildMethodologyUpgrade(profile.team, methodology, options);
  if (sameRef(methodologyUpgrade.expectedRef, methodologyUpgrade.ref)) {
    throw {
      code: "METHODOLOGY_ALREADY_CURRENT",
      message: "The Team already uses that exact Methodology ref",
    } satisfies CommandError;
  }
  const currentMethodology = catalog.methodologies.find((candidate) =>
    sameRef(candidate.ref, methodologyUpgrade.expectedRef),
  );
  return {
    upgrade: methodologyUpgrade,
    preview: formatMethodologyUpgradePreview(
      profile.team,
      currentMethodology ?? null,
      methodology,
      methodologyUpgrade,
    ),
  };
}

export function formatMethodologyUpgradePreview(
  team: TeamV2,
  current: MethodologyDescriptor | null,
  next: MethodologyDescriptor,
  upgrade: MethodologyUpgrade,
): string {
  const exactRef = (ref: ExactMethodologyRef) => `${ref.bundleId}@${ref.version}#${ref.digest}`;
  const memberRoles = new Map(team.members.map((member) => [member.memberId, member.role]));
  return [
    `Methodology: ${exactRef(upgrade.expectedRef)} -> ${exactRef(upgrade.ref)}`,
    `Preset: ${upgrade.presetId ?? "-"}`,
    `Member bindings: ${upgrade.memberArchetypeBindings
      .map(
        (binding) =>
          `${binding.memberId}${memberRoles.has(binding.memberId) ? ` (${memberRoles.get(binding.memberId)})` : ""}=${binding.archetypeId ?? "-"}`,
      )
      .join(", ")}`,
    `Skill bindings: ${upgrade.skillBindings
      .map((binding) => `${binding.teamSkillId}=${binding.methodologySkillId ?? "-"}`)
      .join(", ")}`,
    `Policy before: ${current ? JSON.stringify(current.policySummary) : "catalog entry unavailable"}`,
    `Policy after: ${JSON.stringify(next.policySummary)}`,
  ].join("\n");
}

async function confirmMethodologyUpgrade(preview: string, options: ProfileUpdateOptions) {
  process.stderr.write(`${preview}\n`);
  if (options.yes === true) return;
  if (options.json === true || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw {
      code: "METHODOLOGY_CONFIRMATION_REQUIRED",
      message: "Review the Methodology preview and rerun with --yes to apply it.",
      details: preview,
    } satisfies CommandError;
  }
  const answer = await confirm({ message: "Apply this Methodology upgrade?", initialValue: false });
  if (isCancel(answer) || !answer) {
    throw {
      code: "METHODOLOGY_UPGRADE_CANCELED",
      message: "Methodology upgrade canceled.",
    } satisfies CommandError;
  }
}

export async function runProfileUpdateCommand(
  teamId: string,
  options: ProfileUpdateOptions,
  _command: Command,
): Promise<SingleResult<TeamProfileRow>> {
  const { memberAdds, memberUpdates } = prepareMemberProfileUpdate(options);
  const { client } = await connectTeamClient(options.host);
  try {
    const methodologyPlan = await prepareMethodologyUpgrade(client, teamId, options);
    if (methodologyPlan) await confirmMethodologyUpgrade(methodologyPlan.preview, options);
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
      ...(methodologyPlan ? { methodologyUpgrade: methodologyPlan.upgrade } : {}),
    });
    if (!payload.team) throw toTeamResponseError("update the Team profile", payload);
    return { type: "single", data: toTeamProfileRow(payload.team), schema: teamProfileSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_UPDATE_FAILED", "update Team profile", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface ProfileRefreshExecutionOptions extends TeamCommandOptions {
  expectedRevision?: string;
  idempotencyKey?: string;
}

export async function runProfileRefreshExecutionCommand(
  teamId: string,
  memberId: string,
  options: ProfileRefreshExecutionOptions,
  _command: Command,
): Promise<SingleResult<TeamProfileDetail>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const config = await client.getDaemonConfig();
    const payload = await client.refreshTeamMemberExecution({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      teamId,
      memberId,
      expectedTeamRevision: revision(options.expectedRevision, "--expected-revision"),
    });
    if (payload.error) throw toTeamResponseError("refresh Member execution", payload);
    const inspected = payload.team ?? (await client.inspectTeamProfile({ teamId })).team;
    if (!inspected) {
      throw {
        code: "TEAM_PROFILE_NOT_FOUND",
        message: `Team profile "${teamId}" was not found after refresh`,
      } satisfies CommandError;
    }
    return {
      type: "single",
      data: toTeamProfileDetail(inspected, config.config.agentProfiles ?? []),
      schema: teamProfileDetailSchema,
    };
  } catch (err) {
    throw toTeamCommandError("TEAM_PROFILE_REFRESH_FAILED", "refresh Member execution", err);
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
