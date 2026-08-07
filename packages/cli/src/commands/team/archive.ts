import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import {
  connectTeamClient,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";
import { teamSchema, toTeamRow, type TeamRow } from "./schema.js";

export async function runArchiveCommand(
  teamId: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<SingleResult<TeamRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.archiveTeam({ teamId });
    if (!payload.team) {
      throw toTeamResponseError("archive the team", payload);
    }
    return { type: "single", data: toTeamRow(payload.team), schema: teamSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_ARCHIVE_FAILED", "archive team", err);
  } finally {
    await client.close().catch(() => {});
  }
}
