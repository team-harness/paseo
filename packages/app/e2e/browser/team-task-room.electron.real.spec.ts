import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import getPort from "get-port";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { test, expect } from "@playwright/test";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";

const rootDir = path.resolve(process.cwd(), process.cwd().endsWith("packages/app") ? "../.." : ".");
const evidenceDir = path.join(rootDir, "dogfood-output/team-task-room/electron");
const packagedExecutablePath = path.join(
  rootDir,
  "packages/desktop/release/mac-arm64/Paseo.app/Contents/MacOS/Paseo",
);

interface TeamRoomSeedClient extends SeedDaemonClient {
  createTeamProfile(options: {
    idempotencyKey: string;
    name: string;
    creationWorkspaceId: string;
    skills: Array<{ skillId: string; name: string; description: string | null }>;
    leadClientMemberKey: string;
    members: TeamCreateMember[];
    methodologyBinding: {
      ref: TeamV2["methodologyBinding"]["ref"];
      presetId: string;
      memberArchetypeBindings: Array<{ clientMemberKey: string; archetypeId: null }>;
      skillBindings: Array<{ teamSkillId: string; methodologySkillId: null }>;
    };
  }): Promise<{ team: TeamV2 | null; error: string | null }>;
  startTeamMission(options: {
    idempotencyKey: string;
    teamId: string;
    expectedTeamRevision: number;
    expectedMethodologyRef: TeamV2["methodologyBinding"]["ref"];
    workspaceId: string;
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
  }): Promise<{ mission: TeamMission | null; error: string | null }>;
}

interface TeamCreateMember {
  clientMemberKey: string;
  role: string;
  level: 4 | 5;
  skillIds: string[];
  executionProfileSelection: {
    kind: "inline";
    executionProfile: ReturnType<typeof executionMember>["executionProfile"];
  };
}

const methodologyRef = {
  bundleId: "paseo/standard",
  version: "1",
  digest: "sha256:d5001287a60f868bcef21ecd3c4debb5a5237db002c5b9d0f7b0b78e98969697",
} as const;

function executionMember(role: string, level: 4 | 5, skillIds: string[]) {
  return {
    role,
    level,
    skillIds,
    executionProfile: {
      provider: "claude" as const,
      model: null,
      modeId: "bypassPermissions",
      thinkingOptionId: null,
      featureValues: {},
    },
  };
}

function createMember(
  clientMemberKey: string,
  member: ReturnType<typeof executionMember>,
): TeamCreateMember {
  return {
    clientMemberKey,
    role: member.role,
    level: member.level,
    skillIds: member.skillIds,
    executionProfileSelection: {
      kind: "inline",
      executionProfile: member.executionProfile,
    },
  };
}

async function connectElectron(cdpPort: number, child: ChildProcess): Promise<Browser> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited before CDP became ready (${child.exitCode})`);
    }
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 5_000 });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Electron CDP did not become ready: ${String(lastError)}`);
}

async function waitForAppPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("paseo://app"));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Packaged Electron renderer did not load paseo://app");
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = once(child, "exit");
  const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000));
  if ((await Promise.race([exited, deadline])) === "timeout") {
    child.kill("SIGKILL");
    await once(child, "exit").catch(() => undefined);
  }
}

test("real Electron renders and operates the Mission task room", async () => {
  test.setTimeout(180_000);

  const serverId = `srv_ttr_electron_${Date.now()}`;
  const previousMetroPort = process.env.E2E_METRO_PORT;
  process.env.E2E_METRO_PORT = String(await getPort());
  let daemon: Awaited<ReturnType<typeof startIsolatedHostDaemon>> | null = null;
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;
  let userData: string | null = null;
  let child: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    daemon = await startIsolatedHostDaemon(serverId, {
      environment: { NODE_ENV: "development", PASEO_NODE_INSPECT: "0" },
      mcpInjectIntoAgents: true,
      teamMissionsRuntime: true,
    });
    const activeDaemon = daemon;
    workspace = await seedWorkspace({ repoPrefix: "ttr-electron-", port: activeDaemon.port });
    const client = workspace.client as TeamRoomSeedClient;
    userData = await mkdtemp(path.join(os.tmpdir(), "paseo-ttr-electron-user-data-"));
    const members = [
      createMember("lead", executionMember("负责人", 5, ["coordination"])),
      createMember("delivery", executionMember("交付成员", 4, ["delivery"])),
    ];
    const skills = [
      { skillId: "coordination", name: "协作调度", description: null },
      { skillId: "delivery", name: "交付实现", description: null },
    ];
    const created = await client.createTeamProfile({
      idempotencyKey: `ttr-electron-team-${Date.now()}`,
      name: "Electron Task Room",
      creationWorkspaceId: workspace.workspaceId,
      skills,
      leadClientMemberKey: "lead",
      members,
      methodologyBinding: {
        ref: methodologyRef,
        presetId: "lean-delivery",
        memberArchetypeBindings: members.map((member) => ({
          clientMemberKey: member.clientMemberKey,
          archetypeId: null,
        })),
        skillBindings: skills.map((skill) => ({
          teamSkillId: skill.skillId,
          methodologySkillId: null,
        })),
      },
    });
    if (!created.team) throw new Error(created.error ?? "Failed to create Electron evidence Team");
    const started = await client.startTeamMission({
      idempotencyKey: `ttr-electron-mission-${Date.now()}`,
      teamId: created.team.id,
      expectedTeamRevision: created.team.revision,
      expectedMethodologyRef: created.team.methodologyBinding.ref,
      workspaceId: workspace.workspaceId,
      objective: "Verify the real Electron task room",
      constraints: [],
      acceptanceCriteria: ["A human can post and inspect Mission state in Electron"],
    });
    if (!started.mission)
      throw new Error(started.error ?? "Failed to start Electron evidence Mission");

    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${activeDaemon.port}`,
      nowIso: new Date().toISOString(),
    });
    const launch = async (cdpPort: number): Promise<ChildProcess> =>
      spawn(packagedExecutablePath, [], {
        cwd: rootDir,
        env: {
          ...process.env,
          PASEO_DAEMON_ENDPOINT: `127.0.0.1:${activeDaemon.port}`,
          PASEO_HOME: activeDaemon.paseoHome,
          PASEO_ELECTRON_USER_DATA_DIR: userData ?? undefined,
          PASEO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
          PASEO_ELECTRON_FLAGS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
          PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
          PASEO_DICTATION_ENABLED: "0",
          PASEO_VOICE_MODE_ENABLED: "0",
        },
        stdio: "ignore",
      });
    const firstCdpPort = await getPort();
    child = await launch(firstCdpPort);
    browser = await connectElectron(firstCdpPort, child);
    let page = await waitForAppPage(browser);
    await page.route(/:6767\b/, (route) => route.abort());
    await page.routeWebSocket(/:6767\b/, async (socket) => {
      await socket.close({ code: 1008, reason: "Blocked developer daemon during Electron E2E" });
    });
    await expect.poll(() => page.evaluate(() => Boolean(window.paseoDesktop?.invoke))).toBe(true);
    await page.evaluate(
      ({ seededHost, preferences }) => {
        localStorage.setItem("@paseo:e2e", "1");
        localStorage.setItem("@paseo:daemon-registry", JSON.stringify([seededHost]));
        localStorage.setItem("@paseo:create-agent-preferences", JSON.stringify(preferences));
      },
      { seededHost: host, preferences: buildCreateAgentPreferences() },
    );
    await browser.close();
    browser = null;
    await stopProcess(child);

    const secondCdpPort = await getPort();
    child = await launch(secondCdpPort);
    browser = await connectElectron(secondCdpPort, child);
    page = await waitForAppPage(browser);
    const teamRow = page.getByTestId(`host-team-row-${created.team.id}`);
    await expect(teamRow).toBeVisible({ timeout: 30_000 });
    await teamRow.click();
    const composer = page.getByTestId("team-room-composer");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Electron task room status check");
    await page.getByTestId("team-room-send").click();
    await expect(page.getByText("Electron task room status check", { exact: true })).toBeVisible();
    await expect(page.getByTestId("mission-workroom-inspector")).toBeVisible();
    await page.getByTestId("mission-workroom-inspector-tab-people").click();
    await expect(page.getByTestId("mission-workroom-inspector")).toContainText("负责人");
    await page.getByTestId("mission-workroom-inspector-tab-results").click();
    await expect(page.getByTestId("mission-workroom-inspector")).toContainText("暂时没有结果");
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "real-electron-task-room.png") });
  } finally {
    await browser?.close().catch(() => undefined);
    if (child) await stopProcess(child);
    await workspace?.cleanup();
    await daemon?.close();
    if (userData) await rm(userData, { recursive: true, force: true });
    if (previousMetroPort === undefined) delete process.env.E2E_METRO_PORT;
    else process.env.E2E_METRO_PORT = previousMetroPort;
  }
});
