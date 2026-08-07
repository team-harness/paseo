import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import {
  connectTeamClient,
  toTeamCommandError,
  toTeamResponseError,
  type TeamCommandOptions,
} from "./shared.js";
import { teamDetailSchema, toTeamDetail, type TeamDetail } from "./schema.js";

/**
 * The team and its roster, including entries that are no longer members.
 *
 * `paseo team ls` answers "which teams". This answers "what state is this one
 * in, and who is on it" — a script polling for a creation to converge reads
 * `lifecycle` here, and a member that left with a reason is the other half
 * worth looking up.
 */
export async function runInspectCommand(
  teamId: string,
  options: TeamCommandOptions,
  _command: Command,
): Promise<SingleResult<TeamDetail>> {
  const { client } = await connectTeamClient(options.host);
  try {
    const payload = await client.inspectTeam({ teamId });
    if (!payload.team) {
      throw toTeamResponseError("inspect the team", payload);
    }
    return { type: "single", data: toTeamDetail(payload.team), schema: teamDetailSchema };
  } catch (err) {
    throw toTeamCommandError("TEAM_INSPECT_FAILED", "inspect team", err);
  } finally {
    await client.close().catch(() => {});
  }
}
