import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import {
  connectTeamClient,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";
import { teamSchema, toTeamRow, type TeamRow } from "./schema.js";

export interface TeamLsOptions extends TeamCommandOptions {
  all?: boolean;
}

export async function runLsCommand(
  options: TeamLsOptions,
  _command: Command,
): Promise<ListResult<TeamRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.listTeams({ includeArchived: options.all === true });
    if (payload.error) {
      throw toTeamResponseError("list teams", payload);
    }
    return { type: "list", data: payload.teams.map(toTeamRow), schema: teamSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_LIST_FAILED", "list teams", err);
  } finally {
    await client.close().catch(() => {});
  }
}
