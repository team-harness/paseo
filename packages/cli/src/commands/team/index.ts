import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import {
  runMissionCancelCommand,
  runMissionInspectCommand,
  runMissionListCommand,
  runMissionStartCommand,
  runMissionWaiveReviewCommand,
} from "./mission.js";
import { runMethodologyInspectCommand, runMethodologyListCommand } from "./methodology.js";
import {
  runProfileArchiveCommand,
  runProfileCreateCommand,
  runProfileInspectCommand,
  runProfileListCommand,
  runProfileRefreshExecutionCommand,
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
  const methodology = team.command("methodology").description("Inspect the Methodology catalog");
  addJsonAndDaemonHostOptions(methodology.command("list").description("List Methodologies")).action(
    withOutput(runMethodologyListCommand),
  );
  addJsonAndDaemonHostOptions(
    methodology
      .command("inspect")
      .description("Inspect a Methodology")
      .argument("<bundle-id>", "Exact bundle ID")
      .argument("<version>", "Exact bundle version")
      .argument("<digest>", "Exact sha256 digest"),
  ).action(withOutput(runMethodologyInspectCommand));

  addJsonAndDaemonHostOptions(
    addMutationKey(
      addExecutionOptions(
        profile
          .command("create")
          .description("Create a Team profile")
          .argument("<name>", "Team profile name")
          .requiredOption("--workspace <id>", "Workspace for Missions")
          .option("--methodology <bundle-id@version>", "Methodology", "paseo/standard@1")
          .requiredOption("--preset <id>", "Exact Methodology preset")
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
          )
          .requiredOption("--archetype <key=id>", "Methodology archetype; repeat", collect)
          .option(
            "--methodology-skill <team-skill=id>",
            "Methodology Skill binding; repeat",
            collect,
          )
          .option("--agent-profile <key=id>", "Agent Profile execution source; repeat", collect),
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
    .option("--add-agent-profile <key=id>", "Added member Agent Profile source; repeat", collect)
    .option("--update-role <member-id=value>", "Replacement Role; repeat", collect)
    .option(
      "--update-agent-profile <member-id=id>",
      "Rebind member execution to an Agent Profile; repeat",
      collect,
    )
    .option("--remove-member <id>", "Member ID to remove; repeat", collect)
    .option("--methodology <bundle-id@version>", "Upgrade to an exact catalog Methodology")
    .option("-y, --yes", "Confirm the displayed Methodology upgrade preview")
    .option("--preset <id>", "Preset for the upgraded Methodology")
    .option("--archetype <member-id=id>", "Upgraded Methodology archetype binding; repeat", collect)
    .option(
      "--methodology-skill <team-skill=id>",
      "Upgraded Methodology Skill binding; repeat",
      collect,
    );
  update = addExecutionOptions(update, "update-");
  addJsonAndDaemonHostOptions(addMutationKey(update)).action(withOutput(runProfileUpdateCommand));

  addJsonAndDaemonHostOptions(
    addMutationKey(
      profile
        .command("refresh-execution")
        .description("Refresh a Member from its Agent Profile source")
        .argument("<team-id>", "Team ID")
        .argument("<member-id>", "Member ID")
        .requiredOption("--expected-revision <revision>", "Expected Team profile revision"),
    ),
  ).action(withOutput(runProfileRefreshExecutionCommand));

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
        .option("--workspace <id>", "Mission workspace; required for global Team profiles")
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

  addJsonAndDaemonHostOptions(
    addMutationKey(
      mission
        .command("waive-review")
        .description("Waive a current known-empty Workstream review gate")
        .argument("<mission-id>", "Mission ID")
        .requiredOption("--attention <id>", "Scoped review gate Attention ID")
        .requiredOption("--expected-revision <revision>", "Expected Mission revision")
        .requiredOption("--gate-fingerprint <sha256>", "Exact review gate fingerprint")
        .requiredOption("--subject-fingerprint <sha256>", "Exact review subject fingerprint")
        .requiredOption("--reason <text>", "Immutable waiver reason"),
    ),
  ).action(withOutput(runMissionWaiveReviewCommand));

  return team;
}
