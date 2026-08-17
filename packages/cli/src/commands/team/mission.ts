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
  workspace?: string;
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
    const workspaceId = required(options.workspace, "--workspace");
    const inspected = await client.inspectTeamProfile({ teamId });
    if (!inspected.team) throw toTeamResponseError("inspect the Team", inspected);
    const payload = await client.startTeamMission({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      teamId,
      expectedTeamRevision: revision(options.expectedTeamRevision, "--expected-team-revision"),
      expectedMethodologyRef: inspected.team.methodologyBinding.ref,
      workspaceId,
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

export interface MissionWaiveReviewOptions extends TeamCommandOptions {
  attention?: string;
  expectedRevision?: string;
  gateFingerprint?: string;
  subjectFingerprint?: string;
  reason?: string;
  idempotencyKey?: string;
}

export interface MissionRefreshCapabilitiesOptions extends TeamCommandOptions {
  attention?: string;
  expectedRevision?: string;
  idempotencyKey?: string;
}

interface MissionCapabilityRefreshRow {
  disposition: "unchanged" | "replan_requested";
  missionRevision: number;
  rosterSnapshotRevision: number;
  requestId: string;
  requestState: "none" | "pending";
  note: string;
}

const missionCapabilityRefreshSchema = {
  idField: "requestId",
  columns: [
    { header: "RESULT", field: "disposition", width: 18 },
    { header: "MISSION REV", field: "missionRevision", width: 11, align: "right" },
    { header: "ROSTER REV", field: "rosterSnapshotRevision", width: 10, align: "right" },
    { header: "REQUEST", field: "requestId", width: 28 },
    { header: "STATE", field: "requestState", width: 8 },
    { header: "NOTE", field: "note", width: 60 },
  ],
} satisfies import("../../output/index.js").OutputSchema<MissionCapabilityRefreshRow>;

export async function runMissionRefreshCapabilitiesCommand(
  missionId: string,
  options: MissionRefreshCapabilitiesOptions,
  _command: Command,
): Promise<SingleResult<MissionCapabilityRefreshRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.refreshTeamMissionCapabilities({
      missionId,
      attentionId: required(options.attention, "--attention"),
      expectedRevision: revision(options.expectedRevision, "--expected-revision"),
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
    });
    if (!payload.result) throw toTeamResponseError("refresh Mission capabilities", payload);
    const result = payload.result;
    return {
      type: "single",
      data: {
        disposition: result.disposition,
        missionRevision: result.missionRevision,
        rosterSnapshotRevision: result.rosterSnapshotRevision,
        requestId: result.disposition === "replan_requested" ? result.requestId : "-",
        requestState: result.disposition === "replan_requested" ? "pending" : "none",
        note:
          result.disposition === "unchanged"
            ? "Capability declarations unchanged; no Mission write occurred."
            : "Lead replan requested; this is not a plan commit and cannot change the frozen roster, Skills, or Levels.",
      },
      schema: missionCapabilityRefreshSchema,
    };
  } catch (err) {
    throw toTeamCommandError(
      "TEAM_MISSION_CAPABILITY_REFRESH_FAILED",
      "refresh Mission capabilities",
      err,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runMissionWaiveReviewCommand(
  missionId: string,
  options: MissionWaiveReviewOptions,
  _command: Command,
): Promise<SingleResult<MissionDetail>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.resolveTeamMissionAttention({
      idempotencyKey: options.idempotencyKey?.trim() || newIdempotencyKey(),
      missionId,
      attentionId: required(options.attention, "--attention"),
      expectedRevision: revision(options.expectedRevision, "--expected-revision"),
      resolution: {
        kind: "waive_review",
        gateKeyFingerprint: required(options.gateFingerprint, "--gate-fingerprint"),
        subjectFingerprint: required(options.subjectFingerprint, "--subject-fingerprint"),
        reason: required(options.reason, "--reason"),
      },
    });
    if (!payload.mission) throw toTeamResponseError("waive the review gate", payload);
    return { type: "single", data: toMissionDetail(payload.mission), schema: missionDetailSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_MISSION_REVIEW_WAIVER_FAILED", "waive review gate", err);
  } finally {
    await client.close().catch(() => {});
  }
}
