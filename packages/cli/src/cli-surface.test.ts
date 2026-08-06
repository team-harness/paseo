import { describe, expect, it } from "vitest";
import { createCli } from "./cli.js";

describe("canonical CLI surface", () => {
  it("shows workspace and heartbeat commands while hiding worktree compatibility", () => {
    const cli = createCli();
    const help = cli.helpInformation();
    expect(help).toContain("workspace");
    expect(help).toContain("heartbeat");
    expect(help).not.toContain("worktree");
  });

  it("names explicit workspace creation without exposing older syntax", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    const help = run?.helpInformation();
    expect(help).toContain("--new-workspace <local|worktree>");
    expect(help).not.toContain("--isolation");
    expect(help).not.toContain("--worktree <name>");
  });

  it("offers the worktree creation options on run", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    const help = run?.helpInformation();
    expect(help).toContain("--worktree-mode <mode>");
    expect(help).toContain("--worktree-slug <slug>");
    expect(help).toContain("--new-branch <name>");
    expect(help).toContain("--branch <name>");
    expect(help).toContain("--pr-number <n>");
    expect(help).toContain("--forge <forge>");
  });

  it("uses background for execution and reserves detach for ownership", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    expect(run?.helpInformation()).toContain("--background");
    expect(run?.helpInformation()).not.toContain("--detach");
  });

  it("offers thinking configuration when running, updating, and scheduling agents", () => {
    const cli = createCli();
    const run = cli.commands.find((command) => command.name() === "run");
    const agent = cli.commands.find((command) => command.name() === "agent");
    const update = agent?.commands.find((command) => command.name() === "update");
    const schedule = cli.commands.find((command) => command.name() === "schedule");
    const scheduleCreate = schedule?.commands.find((command) => command.name() === "create");

    expect(run?.helpInformation()).toContain("--thinking <id>");
    expect(update?.helpInformation()).toContain("--thinking <id>");
    expect(scheduleCreate?.helpInformation()).toContain("--thinking <id>");
  });

  it("offers the team commands", () => {
    const team = createCli().commands.find((command) => command.name() === "team");
    const names = team?.commands.map((command) => command.name());

    expect(names).toEqual(["create", "ls", "inspect", "archive", "remove"]);
  });

  it("asks a team create for everything a team cannot be built without", () => {
    const team = createCli().commands.find((command) => command.name() === "team");
    const create = team?.commands.find((command) => command.name() === "create");
    const help = create?.helpInformation();

    // Members are optional: a lead can build the rest of its team itself.
    expect(help).toContain("--workspace <id>");
    expect(help).toContain("--task <text>");
    expect(help).toContain("--lead <role=provider>");
    expect(help).toContain("--member <role=provider>");
  });

  it("offers opening an existing agent in the desktop app", () => {
    const agent = createCli().commands.find((command) => command.name() === "agent");
    const open = agent?.commands.find((command) => command.name() === "open");

    expect(open?.helpInformation()).toContain("<agent-id>");
    expect(open?.helpInformation()).toContain("--server <server-id>");
  });
});
