#!/usr/bin/env npx tsx

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { startTestDaemon, type TestDaemonContext } from "./helpers/test-daemon.ts";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const CLI_BIN = fileURLToPath(new URL("../bin/paseo", import.meta.url));

function runRealPaseo(
  ctx: TestDaemonContext,
  args: string[],
  options: { timeout?: number; cwd?: string } = {},
): Promise<CliResult> {
  const timeout = options.timeout ?? 30_000;

  return new Promise((resolve, reject) => {
    const child = spawn(CLI_BIN, args, {
      cwd: options.cwd ?? ctx.workDir,
      env: {
        ...process.env,
        CI: "true",
        NO_COLOR: "1",
        PASEO_HOME: ctx.paseoHome,
        PASEO_HOST: `127.0.0.1:${ctx.port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`CLI command timed out after ${timeout}ms: paseo ${args.join(" ")}`));
    }, timeout);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function parseJson<T>(result: CliResult): T {
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as T;
}

console.log("=== Team Missions Command Tests ===\n");

const ctx = await startTestDaemon({
  timeout: 45_000,
  env: { PASEO_TEAM_MISSIONS_RUNTIME: "1" },
});

try {
  console.log("Test 1: workspace and Team profile creation use the real CLI binary");
  const workspace = parseJson<{
    workspaceId: string;
    isolation: string;
    cwd: string;
  }>(
    await runRealPaseo(ctx, [
      "workspace",
      "create",
      "--isolation",
      "local",
      "--path",
      ctx.workDir,
      "--title",
      "Team Missions E2E",
      "--json",
    ]),
  );
  assert.ok(workspace.workspaceId);
  assert.equal(workspace.isolation, "local");
  assert.equal(workspace.cwd, ctx.workDir);

  const created = parseJson<{
    id: string;
    name: string;
    workspace: string;
    lifecycle: string;
    revision: number;
    lead: string;
    members: number;
    skills: number;
  }>(
    await runRealPaseo(ctx, [
      "team",
      "profile",
      "create",
      "Delivery Team",
      "--workspace",
      workspace.workspaceId,
      "--skill",
      "plan=Planning=Break work into executable steps",
      "--skill",
      "verify=Verification=Check the acceptance criteria",
      "--lead",
      "lead=coordinator",
      "--member",
      "worker=implementer",
      "--level",
      "lead=5",
      "--level",
      "worker=4",
      "--member-skill",
      "lead=plan",
      "--member-skill",
      "lead=verify",
      "--member-skill",
      "worker=plan",
      "--provider",
      "lead=codex",
      "--provider",
      "worker=codex",
      "--json",
    ]),
  );
  assert.ok(created.id);
  assert.deepEqual(
    {
      name: created.name,
      workspace: created.workspace,
      lifecycle: created.lifecycle,
      revision: created.revision,
      lead: created.lead,
      members: created.members,
      skills: created.skills,
    },
    {
      name: "Delivery Team",
      workspace: workspace.workspaceId,
      lifecycle: "active",
      revision: 1,
      lead: "coordinator",
      members: 2,
      skills: 2,
    },
  );
  console.log("workspace and Team profile creation work\n");

  console.log("Test 2: Team profile list and inspect return structured JSON");
  const listed = parseJson<
    Array<{
      id: string;
      name: string;
      workspace: string;
      lifecycle: string;
      revision: number;
    }>
  >(await runRealPaseo(ctx, ["team", "profile", "list", "--json"]));
  assert.deepEqual(
    listed.map((team) => ({
      id: team.id,
      name: team.name,
      workspace: team.workspace,
      lifecycle: team.lifecycle,
      revision: team.revision,
    })),
    [
      {
        id: created.id,
        name: "Delivery Team",
        workspace: workspace.workspaceId,
        lifecycle: "active",
        revision: 1,
      },
    ],
  );

  const inspected = parseJson<{
    id: string;
    revision: number;
    catalog: Array<{ skillId: string; name: string; description: string | null }>;
    roster: Array<{
      memberId: string;
      role: string;
      level: number;
      skillIds: string[];
      provider: string;
      mention: string;
    }>;
  }>(await runRealPaseo(ctx, ["team", "profile", "inspect", created.id, "--json"]));
  assert.equal(inspected.id, created.id);
  assert.equal(inspected.revision, 1);
  assert.deepEqual(
    inspected.catalog.map(({ skillId, name }) => ({ skillId, name })),
    [
      { skillId: "plan", name: "Planning" },
      { skillId: "verify", name: "Verification" },
    ],
  );
  assert.deepEqual(
    inspected.roster.map(({ memberId, role, level, skillIds, provider, mention }) => ({
      memberId,
      role,
      level,
      skillIds,
      provider,
      mention,
    })),
    [
      {
        memberId: inspected.roster[0]?.memberId,
        role: "coordinator",
        level: 5,
        skillIds: ["plan", "verify"],
        provider: "codex",
        mention: "coordinator",
      },
      {
        memberId: inspected.roster[1]?.memberId,
        role: "implementer",
        level: 4,
        skillIds: ["plan"],
        provider: "codex",
        mention: "implementer",
      },
    ],
  );
  assert.ok(inspected.roster.every((member) => member.memberId));
  console.log("Team profile list and inspect work\n");

  console.log("Test 3: Team profile update enforces and advances revision");
  const implementer = inspected.roster.find((member) => member.role === "implementer");
  assert.ok(implementer);
  const updated = parseJson<{
    id: string;
    name: string;
    lifecycle: string;
    revision: number;
  }>(
    await runRealPaseo(ctx, [
      "team",
      "profile",
      "update",
      created.id,
      "--expected-revision",
      "1",
      "--name",
      "Delivery Team v2",
      "--update-level",
      `${implementer.memberId}=5`,
      "--json",
    ]),
  );
  assert.deepEqual(
    {
      id: updated.id,
      name: updated.name,
      lifecycle: updated.lifecycle,
      revision: updated.revision,
    },
    {
      id: created.id,
      name: "Delivery Team v2",
      lifecycle: "active",
      revision: 2,
    },
  );

  const inspectedAfterUpdate = parseJson<{
    id: string;
    name: string;
    revision: number;
    roster: Array<{ memberId: string; role: string; level: number }>;
  }>(await runRealPaseo(ctx, ["team", "profile", "inspect", created.id, "--json"]));
  assert.equal(inspectedAfterUpdate.name, "Delivery Team v2");
  assert.equal(inspectedAfterUpdate.revision, 2);
  assert.deepEqual(
    inspectedAfterUpdate.roster.map(({ memberId, role, level }) => ({ memberId, role, level })),
    [
      { memberId: inspected.roster[0]?.memberId, role: "coordinator", level: 5 },
      { memberId: implementer.memberId, role: "implementer", level: 5 },
    ],
  );
  console.log("Team profile update advances revision\n");

  console.log("Test 4: Mission list is available without starting a provider");
  const missions = parseJson<Array<{ id: string }>>(
    await runRealPaseo(ctx, ["team", "mission", "list", created.id, "--json"]),
  );
  assert.deepEqual(missions, []);
  // Mission start provisions and wakes a real Lead before the RPC resolves. Start,
  // inspect, and cancel belong in daemon E2E with an injected test provider.
  console.log("Mission list returns structured JSON without a provider\n");

  console.log("Test 5: Team profile archive advances revision and changes list visibility");
  const archived = parseJson<{
    id: string;
    name: string;
    lifecycle: string;
    revision: number;
  }>(
    await runRealPaseo(ctx, [
      "team",
      "profile",
      "archive",
      created.id,
      "--expected-revision",
      "2",
      "--json",
    ]),
  );
  assert.deepEqual(
    {
      id: archived.id,
      name: archived.name,
      lifecycle: archived.lifecycle,
      revision: archived.revision,
    },
    {
      id: created.id,
      name: "Delivery Team v2",
      lifecycle: "archived",
      revision: 3,
    },
  );

  const activeProfiles = parseJson<Array<{ id: string }>>(
    await runRealPaseo(ctx, ["team", "profile", "list", "--json"]),
  );
  assert.deepEqual(activeProfiles, []);
  const allProfiles = parseJson<Array<{ id: string; lifecycle: string; revision: number }>>(
    await runRealPaseo(ctx, ["team", "profile", "list", "--all", "--json"]),
  );
  assert.deepEqual(
    allProfiles.map(({ id, lifecycle, revision }) => ({ id, lifecycle, revision })),
    [{ id: created.id, lifecycle: "archived", revision: 3 }],
  );
  console.log("Team profile archive advances revision and changes list visibility\n");
} finally {
  await ctx.stop();
}

console.log("=== Team Missions Command Tests Passed ===");
