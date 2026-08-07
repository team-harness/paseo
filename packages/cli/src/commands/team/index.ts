import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runArchiveCommand } from "./archive.js";
import { runCreateCommand } from "./create.js";
import { runInspectCommand } from "./inspect.js";
import { runLsCommand } from "./ls.js";
import { runRemoveCommand } from "./remove.js";

function collectMember(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function createTeamCommand(): Command {
  const team = new Command("team").description("Manage teams of agents");

  addJsonAndDaemonHostOptions(
    team
      .command("create")
      .description("Create a team: one lead, its members, a room, and a shared task")
      .argument("<name>", "Team name")
      .requiredOption("--workspace <id>", "Workspace the team's agents run in")
      .requiredOption("--task <text>", "What the team is for")
      .requiredOption("--lead <provider>", "Provider for the lead, for example claude")
      .option(
        "--member <role=provider>",
        "A member; repeat for more, for example --member server=codex",
        collectMember,
      )
      .option("--template <id>", "Template this team was built from")
      .option(
        "--idempotency-key <key>",
        "Reuse the key from an attempt whose outcome you never learned, so the daemon " +
          "returns the team it already built instead of building a second one",
      ),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    team.command("ls").description("List teams").option("-a, --all", "Include archived teams"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    team.command("inspect").description("Show a team's roster").argument("<team-id>", "Team ID"),
  ).action(withOutput(runInspectCommand));

  addJsonAndDaemonHostOptions(
    team
      .command("archive")
      .description("Archive a team and every member still on it")
      .argument("<team-id>", "Team ID"),
  ).action(withOutput(runArchiveCommand));

  addJsonAndDaemonHostOptions(
    team
      .command("remove")
      .description("Take a member off a team; the agent keeps running")
      .argument("<team-id>", "Team ID")
      .argument("<agent-id>", "Agent ID of the member"),
  ).action(withOutput(runRemoveCommand));

  return team;
}
