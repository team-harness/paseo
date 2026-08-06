import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import {
  connectTeamClient,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";
import { teamMemberSchema, toTeamMemberRows, type TeamMemberRow } from "./schema.js";

/**
 * The roster, including entries that are no longer members.
 *
 * `paseo team ls` answers "which teams"; this answers "who, and what happened
 * to them" — and a member that left with a reason is the part of that worth
 * looking up.
 */
export async function runInspectCommand(
  teamId: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<ListResult<TeamMemberRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.inspectTeam({ teamId });
    if (!payload.team) {
      throw toTeamResponseError("inspect the team", payload);
    }
    return {
      type: "list",
      data: toTeamMemberRows(payload.team),
      schema: teamMemberSchema,
    };
  } catch (err) {
    throw toTeamCommandError("TEAM_INSPECT_FAILED", "inspect team", err);
  } finally {
    await client.close().catch(() => {});
  }
}
