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
 * Takes a member off a team without ending the agent: its team labels go and
 * its roster entry closes, and it goes on running as an ordinary agent.
 */
export async function runRemoveCommand(
  teamId: string,
  agentId: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<ListResult<TeamMemberRow>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.removeTeamMember({ teamId, agentId });
    if (!payload.team) {
      throw toTeamResponseError("remove the member", payload);
    }
    return {
      type: "list",
      data: toTeamMemberRows(payload.team),
      schema: teamMemberSchema,
    };
  } catch (err) {
    throw toTeamCommandError("TEAM_REMOVE_FAILED", "remove team member", err);
  } finally {
    await client.close().catch(() => {});
  }
}
