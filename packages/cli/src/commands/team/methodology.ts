import type { Command } from "commander";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { ListResult, OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectTeamClient,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";

type MethodologyTableRow = MethodologyDescriptor & {
  displayRef: string;
  digest: string;
  presetCount: number;
};
const schema: OutputSchema<MethodologyTableRow> = {
  idField: "displayRef",
  columns: [
    { header: "REF", field: "displayRef", width: 36 },
    { header: "DIGEST", field: "digest", width: 24 },
    { header: "NAME", field: "name", width: 28 },
    { header: "PRESETS", field: "presetCount", width: 8, align: "right" },
  ],
};

async function connect(host?: string) {
  const connected = await connectTeamClient(host);
  if (!connected.client.supportsTeamMethodologies()) {
    await connected.client.close().catch(() => {});
    throw {
      code: "DAEMON_UPDATE_REQUIRED",
      message: `Update the host at ${connected.daemonHost} to use Team Methodologies.`,
    };
  }
  return connected.client;
}

export async function runMethodologyListCommand(
  options: TeamCommandOptions,
  _command: Command,
): Promise<ListResult<MethodologyTableRow>> {
  const client = await connect(options.host);
  try {
    const payload = await client.listTeamMethodologies();
    if (payload.error) throw toTeamResponseError("list Methodologies", payload);
    return { type: "list", data: payload.methodologies.map(toTableRow), schema };
  } catch (error) {
    throw toTeamCommandError("TEAM_METHODOLOGY_LIST_FAILED", "list Methodologies", error);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runMethodologyInspectCommand(
  bundleId: string,
  version: string,
  digest: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<SingleResult<MethodologyTableRow>> {
  const client = await connect(options.host);
  try {
    const payload = await client.getTeamMethodology({ ref: { bundleId, version, digest } });
    if (!payload.methodology) throw toTeamResponseError("inspect the Methodology", payload);
    return { type: "single", data: toTableRow(payload.methodology), schema };
  } catch (error) {
    throw toTeamCommandError("TEAM_METHODOLOGY_INSPECT_FAILED", "inspect Methodology", error);
  } finally {
    await client.close().catch(() => {});
  }
}

function toTableRow(value: MethodologyDescriptor): MethodologyTableRow {
  return {
    ...value,
    displayRef: `${value.ref.bundleId}@${value.ref.version}`,
    digest: value.ref.digest,
    presetCount: value.presets.length,
  };
}
