import type { Command } from "commander";
import type { CommandError, SingleResult } from "../../output/index.js";
import {
  connectTeamClient,
  newIdempotencyKey,
  parseMemberSpec,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";
import { teamSchema, toTeamRow, type TeamRow } from "./schema.js";

export interface TeamCreateOptions extends TeamCommandOptions {
  // Optional on the type, required by commander. `withOutput` hands the handler
  // a plain `CommandOptions`, so a required field here would not type-check.
  workspace?: string;
  task?: string;
  lead?: string;
  member?: string[];
  template?: string;
}

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    const error: CommandError = { code: "MISSING_OPTION", message: `${flag} is required` };
    throw error;
  }
  return trimmed;
}

export async function runCreateCommand(
  name: string,
  options: TeamCreateOptions,
  _command: Command,
): Promise<SingleResult<TeamRow>> {
  const workspace = required(options.workspace, "--workspace");
  const task = required(options.task, "--task");
  const lead = required(options.lead, "--lead");

  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.createTeam({
      // One command is one attempt: a retry the user types is a new decision,
      // and reusing the key would keep handing back the team that failed.
      idempotencyKey: newIdempotencyKey(),
      name,
      workspaceId: workspace,
      task,
      lead: parseMemberSpec(lead),
      members: (options.member ?? []).map(parseMemberSpec),
      ...(options.template ? { templateId: options.template } : {}),
    });
    if (!payload.team) {
      throw toTeamResponseError("create the team", payload);
    }
    return { type: "single", data: toTeamRow(payload.team), schema: teamSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_CREATE_FAILED", "create team", err) as CommandError;
  } finally {
    await client.close().catch(() => {});
  }
}
