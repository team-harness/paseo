import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(),
  getDaemonHost: () => "127.0.0.1:6767",
}));

import { createTeamCommand } from "./index.js";

function childNames(command: ReturnType<typeof createTeamCommand>): string[] {
  return command.commands.map((child) => child.name());
}

describe("the Team Missions command tree", () => {
  it("exposes profile and mission namespaces instead of legacy team commands", () => {
    const team = createTeamCommand();

    expect(childNames(team)).toEqual(["profile", "mission"]);
    expect(childNames(team.commands[0]!)).toEqual([
      "create",
      "list",
      "inspect",
      "update",
      "archive",
    ]);
    expect(childNames(team.commands[1]!)).toEqual(["start", "list", "inspect", "cancel"]);
  });

  it("keeps machine-readable output options on every leaf command", () => {
    const leaves = createTeamCommand().commands.flatMap((namespace) => namespace.commands);

    for (const leaf of leaves) {
      expect(leaf.options.map((option) => option.long)).toContain("--json");
      expect(leaf.options.map((option) => option.long)).toContain("--host");
    }
  });

  it("requires a Team skill catalog and keeps member skill declarations separate", () => {
    const create = createTeamCommand().commands[0]!.commands[0]!;
    const skill = create.options.find((option) => option.long === "--skill");

    expect(skill?.mandatory).toBe(true);
    expect(create.options.map((option) => option.long)).toContain("--member-skill");
  });

  it("documents declaration keys for create and add-member inputs", () => {
    const profile = createTeamCommand().commands[0]!;
    const create = profile.commands[0]!;
    const createHelp = create.helpInformation();
    const updateHelp = profile.commands[3]!.helpInformation();

    expect(createHelp).toContain("--lead <key=role>");
    expect(createHelp).toContain("--member <key=role>");
    expect(createHelp).toContain("--level <key=value>");
    expect(createHelp).toContain("--member-skill <key=value>");
    expect(createHelp).toContain("--provider <key=value>");
    expect(updateHelp).toContain("--add-member <key=role>");
    expect(updateHelp).toContain("--add-level <key=value>");
    expect(updateHelp).toContain("--add-model <key=value>");
    expect(createHelp).not.toContain("<role=value>");
    expect(updateHelp).not.toContain("--add-member <role>");

    create.parseOptions([
      "Platform",
      "--lead",
      "primary=coordinator",
      "--lead",
      "backup=coordinator",
    ]);
    expect(create.opts().lead).toEqual(["primary=coordinator", "backup=coordinator"]);
  });
});
