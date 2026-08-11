import type { Command } from "commander";
import type { CommandError, ListResult, SingleResult } from "../../output/index.js";
import {
  connectTeamClient,
  newIdempotencyKey,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";
import {
  missionDetailSchema,
  missionSchema,
  toMissionDetail,
  toMissionRow,
  type MissionDetail,
  type MissionRow,
} from "./schema.js";

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed)
    throw { code: "MISSING_OPTION", message: `${flag} is required` } satisfies CommandError;
  return trimmed;
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

export interface MissionStartOptions extends TeamCommandOptions {
  expectedTeamRevision?: string;
  objective?: string;
  constraint?: string[];
  acceptance?: string[];
  idempotencyKey?: string;
}

export async function runMissionStartCommand(
  teamId: string,
  options: MissionStartOptions,
  _command: Command,
): Promise<SingleResult<MissionRow>> {
  const acceptanceCriteria = (options.acceptance ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (!acceptanceCriteria.length) {
    throw { code: "MISSING_OPTION", message: "--acceptance is required" } satisfies CommandError;
  }
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.startTeamMission({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      teamId,
      expectedTeamRevision: revision(options.expectedTeamRevision, "--expected-team-revision"),
      objective: required(options.objective, "--objective"),
      constraints: (options.constraint ?? []).map((value) => value.trim()).filter(Boolean),
      acceptanceCriteria,
    });
    if (!payload.mission) throw toTeamResponseError("start the Mission", payload);
    return { type: "single", data: toMissionRow(payload.mission), schema: missionSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_MISSION_START_FAILED", "start Mission", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface MissionListOptions extends TeamCommandOptions {
  all?: boolean;
}

export async function runMissionListCommand(
  teamId: string,
  options: MissionListOptions,
  _command: Command,
): Promise<ListResult<MissionRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.listTeamMissions({
      teamId,
      includeTerminal: options.all === true,
    });
    if (payload.error) throw toTeamResponseError("list Missions", payload);
    return { type: "list", data: payload.missions.map(toMissionRow), schema: missionSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_MISSION_LIST_FAILED", "list Missions", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runMissionInspectCommand(
  missionId: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<SingleResult<MissionDetail>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.inspectTeamMission({ missionId });
    if (!payload.mission) throw toTeamResponseError("inspect the Mission", payload);
    return {
      type: "single",
      data: toMissionDetail(payload.mission),
      schema: missionDetailSchema,
    };
  } catch (err) {
    throw toTeamCommandError("TEAM_MISSION_INSPECT_FAILED", "inspect Mission", err);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface MissionCancelOptions extends TeamCommandOptions {
  expectedRevision?: string;
  reason?: string;
  idempotencyKey?: string;
}

export async function runMissionCancelCommand(
  missionId: string,
  options: MissionCancelOptions,
  _command: Command,
): Promise<SingleResult<MissionRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.cancelTeamMission({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      missionId,
      expectedRevision: revision(options.expectedRevision, "--expected-revision"),
      reason: required(options.reason, "--reason"),
    });
    if (!payload.mission) throw toTeamResponseError("cancel the Mission", payload);
    return { type: "single", data: toMissionRow(payload.mission), schema: missionSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_MISSION_CANCEL_FAILED", "cancel Mission", err);
  } finally {
    await client.close().catch(() => {});
  }
}
