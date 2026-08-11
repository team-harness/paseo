import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import {
  runMissionCancelCommand,
  runMissionInspectCommand,
  runMissionListCommand,
  runMissionStartCommand,
} from "./mission.js";
import {
  runProfileArchiveCommand,
  runProfileCreateCommand,
  runProfileInspectCommand,
  runProfileListCommand,
  runProfileUpdateCommand,
} from "./profile.js";

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function addExecutionOptions(command: Command, prefix = ""): Command {
  const association = prefix ? "member-id" : "key";
  const associationName = prefix ? "Member ID" : "member declaration key";
  const option = (name: string) => `--${prefix}${name} <${association}=value>`;
  const skillOption = prefix ? option("skill") : "--member-skill <key=value>";
  return command
    .option(option("level"), `Level from 1 to 5; repeat once per ${associationName}`, collect)
    .option(skillOption, `Skill ID; repeat for each ${associationName}`, collect)
    .option(option("provider"), `Execution provider; repeat once per ${associationName}`, collect)
    .option(option("model"), `Execution model; repeat once per ${associationName}`, collect)
    .option(option("mode"), `Provider mode; repeat once per ${associationName}`, collect)
    .option(
      option("thinking-option"),
      `Provider thinking option; repeat once per ${associationName}`,
      collect,
    )
    .option(
      `--${prefix}feature <${association}=feature=json>`,
      "Execution feature value; repeat as needed",
      collect,
    );
}

function addMutationKey(command: Command): Command {
  return command.option(
    "--idempotency-key <key>",
    "Reuse after an attempt whose outcome was not observed",
  );
}

export function createTeamCommand(): Command {
  const team = new Command("team").description("Manage Team profiles and Missions");
  const profile = team.command("profile").description("Manage reusable Team profiles");
  const mission = team.command("mission").description("Manage Team Missions");

  addJsonAndDaemonHostOptions(
    addMutationKey(
      addExecutionOptions(
        profile
          .command("create")
          .description("Create a Team profile")
          .argument("<name>", "Team profile name")
          .requiredOption("--workspace <id>", "Workspace for Missions")
          .requiredOption(
            "--skill <id=name=description>",
            "Team skill catalog entry; repeat",
            collect,
          )
          .requiredOption(
            "--lead <key=role>",
            "Lead declaration; key links its member options",
            collect,
          )
          .option(
            "--member <key=role>",
            "Member declaration; key links its member options; repeat",
            collect,
          ),
      ),
    ),
  ).action(withOutput(runProfileCreateCommand));

  addJsonAndDaemonHostOptions(
    profile
      .command("list")
      .description("List Team profiles")
      .option("-a, --all", "Include archived profiles"),
  ).action(withOutput(runProfileListCommand));

  addJsonAndDaemonHostOptions(
    profile
      .command("inspect")
      .description("Inspect a Team profile")
      .argument("<team-id>", "Team ID"),
  ).action(withOutput(runProfileInspectCommand));

  let update = profile
    .command("update")
    .description("Update a Team profile")
    .argument("<team-id>", "Team ID")
    .requiredOption("--expected-revision <revision>", "Expected Team profile revision")
    .option("--name <name>", "Replacement profile name")
    .option(
      "--skill <id=name=description>",
      "Replacement Team skill catalog entry; repeat",
      collect,
    )
    .option("--lead-member <id>", "Member ID to select as Lead")
    .option(
      "--add-member <key=role>",
      "Member declaration to add; key links its --add-* options; repeat",
      collect,
    )
    .option("--add-level <key=value>", "Added member Level by declaration key; repeat", collect)
    .option("--add-skill <key=value>", "Added member skill ID by declaration key; repeat", collect)
    .option(
      "--add-provider <key=value>",
      "Added member provider by declaration key; repeat",
      collect,
    )
    .option("--add-model <key=value>", "Added member model by declaration key; repeat", collect)
    .option("--add-mode <key=value>", "Added member mode by declaration key; repeat", collect)
    .option(
      "--add-thinking-option <key=value>",
      "Added member thinking option by declaration key; repeat",
      collect,
    )
    .option(
      "--add-feature <key=feature=json>",
      "Added member feature value by declaration key; repeat",
      collect,
    )
    .option("--update-role <member-id=value>", "Replacement Role; repeat", collect)
    .option("--remove-member <id>", "Member ID to remove; repeat", collect);
  update = addExecutionOptions(update, "update-");
  addJsonAndDaemonHostOptions(addMutationKey(update)).action(withOutput(runProfileUpdateCommand));

  addJsonAndDaemonHostOptions(
    addMutationKey(
      profile
        .command("archive")
        .description("Archive a Team profile")
        .argument("<team-id>", "Team ID")
        .requiredOption("--expected-revision <revision>", "Expected Team profile revision"),
    ),
  ).action(withOutput(runProfileArchiveCommand));

  addJsonAndDaemonHostOptions(
    addMutationKey(
      mission
        .command("start")
        .description("Start a Mission from a Team profile")
        .argument("<team-id>", "Team ID")
        .requiredOption("--expected-team-revision <revision>", "Expected Team profile revision")
        .requiredOption("--objective <text>", "Mission objective")
        .option("--constraint <text>", "Mission constraint; repeat", collect)
        .requiredOption("--acceptance <text>", "Acceptance criterion; repeat", collect),
    ),
  ).action(withOutput(runMissionStartCommand));

  addJsonAndDaemonHostOptions(
    mission
      .command("list")
      .description("List Missions for a Team")
      .argument("<team-id>", "Team ID")
      .option("-a, --all", "Include terminal Missions"),
  ).action(withOutput(runMissionListCommand));

  addJsonAndDaemonHostOptions(
    mission
      .command("inspect")
      .description("Inspect a Mission")
      .argument("<mission-id>", "Mission ID"),
  ).action(withOutput(runMissionInspectCommand));

  addJsonAndDaemonHostOptions(
    addMutationKey(
      mission
        .command("cancel")
        .description("Cancel a Mission")
        .argument("<mission-id>", "Mission ID")
        .requiredOption("--expected-revision <revision>", "Expected Mission revision")
        .requiredOption("--reason <text>", "Cancellation reason"),
    ),
  ).action(withOutput(runMissionCancelCommand));

  return team;
}
