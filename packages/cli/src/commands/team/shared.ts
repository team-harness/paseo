import { randomUUID } from "node:crypto";
import type { TeamProfileMemberInput } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { TeamSkill } from "@getpaseo/protocol/team/v2-types";
import type { CommandError, CommandOptions } from "../../output/index.js";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";

export interface TeamCommandOptions extends CommandOptions {
  host?: string;
}

const TEAM_IDEMPOTENCY_CONFLICT_CODE = "idempotency_conflict";

export async function connectTeamClient(host?: string) {
  const daemonHost = getDaemonHost({ host });
  // Connecting and asking what the host can do are two failures with two
  // answers. One `try` around both reports "cannot connect" for a daemon that
  // answered perfectly well and simply has no teams.
  let connected: Awaited<ReturnType<typeof connectToDaemon>>;
  try {
    connected = await connectToDaemon({ host });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${daemonHost}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    };
    throw error;
  }

  // COMPAT(teamMissions): added in v0.3.0-beta.3, remove after 2027-02-08 once
  // the daemon floor advertises Team Missions. Missing capability is a hard gate.
  if (connected.getLastServerInfoMessage()?.features?.teamMissions !== true) {
    await connected.close().catch(() => {});
    throw {
      code: "DAEMON_UPDATE_REQUIRED",
      message: `Update the host at ${daemonHost} to use Team Missions.`,
    } satisfies CommandError;
  }
  return { client: connected, daemonHost };
}

export interface ProfileMemberDeclarations {
  members: string[];
  levels?: string[];
  skills?: string[];
  providers?: string[];
  models?: string[];
  modes?: string[];
  thinkingOptions?: string[];
  features?: string[];
}

function invalidDeclaration(code: string, message: string, details?: string): CommandError {
  return { code, message, ...(details ? { details } : {}) };
}

function parsePair(input: string, label: string, details?: string): [string, string] {
  const separator = input.indexOf("=");
  const key = separator === -1 ? "" : input.slice(0, separator).trim();
  const value = separator === -1 ? "" : input.slice(separator + 1).trim();
  if (!key || !value) {
    throw invalidDeclaration(
      "INVALID_PROFILE_DECLARATION",
      `Invalid ${label} declaration "${input}"`,
      details ?? `Use key=value, for example --${label} reviewer=codex.`,
    );
  }
  return [key, value];
}

function singleValues(
  inputs: string[],
  label: string,
  knownKeys: Set<string>,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const input of inputs) {
    const [key, value] = parsePair(input, label);
    if (!knownKeys.has(key)) {
      throw invalidDeclaration(
        "UNKNOWN_MEMBER_DECLARATION_KEY",
        `${label} was provided for unknown member declaration key "${key}"`,
      );
    }
    if (values.has(key)) {
      throw invalidDeclaration(
        "DUPLICATE_PROFILE_DECLARATION",
        `${label} for member declaration key "${key}" was provided more than once`,
      );
    }
    values.set(key, value);
  }
  return values;
}

function repeatedValues(
  inputs: string[],
  label: string,
  knownKeys: Set<string>,
): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const input of inputs) {
    const [key, value] = parsePair(input, label);
    if (!knownKeys.has(key)) {
      throw invalidDeclaration(
        "UNKNOWN_MEMBER_DECLARATION_KEY",
        `${label} was provided for unknown member declaration key "${key}"`,
      );
    }
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  return values;
}

export function parseTeamSkills(inputs: string[]): TeamSkill[] {
  const seen = new Set<string>();
  return inputs.map((input) => {
    const first = input.indexOf("=");
    const second = first === -1 ? -1 : input.indexOf("=", first + 1);
    const skillId = first === -1 ? "" : input.slice(0, first).trim();
    const name =
      first === -1 ? "" : input.slice(first + 1, second === -1 ? undefined : second).trim();
    const description = second === -1 ? null : input.slice(second + 1).trim() || null;
    if (!skillId || !name) {
      throw invalidDeclaration(
        "INVALID_TEAM_SKILL",
        `Invalid Team skill "${input}"`,
        "Use id=name or id=name=description.",
      );
    }
    if (seen.has(skillId)) {
      throw invalidDeclaration("DUPLICATE_TEAM_SKILL", `Skill "${skillId}" was declared twice`);
    }
    seen.add(skillId);
    return { skillId, name, description };
  });
}

export function buildProfileMembers(
  declarations: ProfileMemberDeclarations,
): TeamProfileMemberInput[] {
  if (declarations.members.length === 0) {
    throw invalidDeclaration(
      "MISSING_PROFILE_DECLARATION",
      "At least one member declaration is required",
    );
  }
  const members = declarations.members.map((input) => {
    const [key, role] = parsePair(
      input,
      "member",
      "Use key=role, for example lead=coordinator or api=implementer.",
    );
    return { key, role };
  });
  const knownKeys = new Set<string>();
  for (const member of members) {
    if (knownKeys.has(member.key)) {
      throw invalidDeclaration(
        "DUPLICATE_MEMBER_DECLARATION_KEY",
        `Member declaration key "${member.key}" was provided more than once`,
      );
    }
    knownKeys.add(member.key);
  }

  const levels = singleValues(declarations.levels ?? [], "level", knownKeys);
  const skills = repeatedValues(declarations.skills ?? [], "member-skill", knownKeys);
  const providers = singleValues(declarations.providers ?? [], "provider", knownKeys);
  const models = singleValues(declarations.models ?? [], "model", knownKeys);
  const modes = singleValues(declarations.modes ?? [], "mode", knownKeys);
  const thinking = singleValues(declarations.thinkingOptions ?? [], "thinking-option", knownKeys);
  const featureInputs = repeatedValues(declarations.features ?? [], "feature", knownKeys);

  return members.map(({ key: memberKey, role }) => {
    const rawLevel = levels.get(memberKey);
    const roleSkills = skills.get(memberKey);
    const provider = providers.get(memberKey);
    if (!rawLevel || !roleSkills?.length || !provider) {
      throw invalidDeclaration(
        "MISSING_PROFILE_DECLARATION",
        `Member declaration key "${memberKey}" needs one level, at least one member-skill, and one provider`,
      );
    }
    const level = Number(rawLevel);
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw invalidDeclaration(
        "INVALID_PROFILE_LEVEL",
        `Level for member declaration key "${memberKey}" must be an integer from 1 to 5`,
      );
    }

    const featureValues: Record<string, unknown> = {};
    for (const input of featureInputs.get(memberKey) ?? []) {
      const [featureKey, rawValue] = parsePair(input, "feature");
      if (featureKey in featureValues) {
        throw invalidDeclaration(
          "DUPLICATE_PROFILE_DECLARATION",
          `Feature "${featureKey}" for member declaration key "${memberKey}" was provided more than once`,
        );
      }
      try {
        featureValues[featureKey] = JSON.parse(rawValue);
      } catch {
        throw invalidDeclaration(
          "INVALID_PROFILE_FEATURE",
          `Feature "${featureKey}" for member declaration key "${memberKey}" must contain a JSON value`,
        );
      }
    }

    return {
      role,
      level,
      skillIds: roleSkills,
      executionProfile: {
        provider: provider as TeamProfileMemberInput["executionProfile"]["provider"],
        model: models.get(memberKey) ?? null,
        modeId: modes.get(memberKey) ?? null,
        thinkingOptionId: thinking.get(memberKey) ?? null,
        featureValues,
      },
    };
  });
}

/**
 * A key for one create attempt.
 *
 * A retry the user types after a definite failure is a new decision and needs a
 * new key, or the daemon keeps handing back the team that failed. A retry after
 * an outcome nobody learned is the opposite case, and that is what
 * `--idempotency-key` is for.
 */
export function newIdempotencyKey(): string {
  return `cli-${randomUUID()}`;
}

export function toTeamCommandError(code: string, action: string, err: unknown): CommandError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return err as CommandError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code, message: `Failed to ${action}: ${message}` };
}

/** Turns the daemon's refusal into a command error, keeping its machine-readable code. */
export function toTeamResponseError(
  action: string,
  payload: { error: string | null; errorCode?: string | null },
): CommandError {
  const message = payload.error ?? `Failed to ${action}`;
  if (payload.errorCode === TEAM_IDEMPOTENCY_CONFLICT_CODE) {
    return {
      code: "TEAM_IDEMPOTENCY_CONFLICT",
      message,
      details: "That key was already used for a different request. Run the command again.",
    };
  }
  return { code: payload.errorCode ?? "TEAM_REQUEST_FAILED", message };
}
