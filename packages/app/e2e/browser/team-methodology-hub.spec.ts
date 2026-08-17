import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { metroTest as test } from "../support/fixtures";
import { buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { gotoAppShell } from "../support/helpers/app";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";

const evidenceDir = path.resolve(
  process.cwd(),
  process.cwd().endsWith("packages/app") ? "../.." : ".",
  "dogfood-output/team-methodology-catalog-hub",
);

async function preserveDaemonLog(daemon: { paseoHome: string }, name: string): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await copyFile(path.join(daemon.paseoHome, "daemon.log"), path.join(evidenceDir, name)).catch(
    () => undefined,
  );
}

test("zero-workspace host enters the static Team Hub and hydrates both catalogs", async ({
  page,
}) => {
  const serverId = `srv_methodology_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const daemon = await startIsolatedHostDaemon(serverId, { teamMissionsRuntime: true });
  try {
    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${daemon.port}`,
      nowIso: new Date().toISOString(),
    });
    await page.addInitScript((seededHost) => {
      localStorage.setItem("@paseo:e2e", "1");
      localStorage.setItem("@paseo:daemon-registry", JSON.stringify([seededHost]));
    }, host);
    await page.route(/:6767\b/, (route) => route.abort());
    await page.routeWebSocket(/:6767\b/, async (webSocket) => {
      await webSocket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
    });
    await gotoAppShell(page);
    await page.goto(`/h/${serverId}`);
    await expect(page).toHaveURL(new RegExp(`/h/${serverId}/teams$`), { timeout: 30_000 });
    await expect(page.getByTestId("team-hub-supported")).toBeVisible();
    await expect(page.getByTestId("host-level-team-list")).toBeVisible();
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "zero-workspace-team-hub.png") });
  } finally {
    await preserveDaemonLog(daemon, "diagnostics-zero-workspace.log");
    await daemon.close();
  }
});

test("a live workspace reaches its physical host Team Hub from the sidebar", async ({ page }) => {
  const serverId = `srv_methodology_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const daemon = await startIsolatedHostDaemon(serverId, { teamMissionsRuntime: true });
  const repo = await createTempGitRepo("methodology-hub-");
  const client = await connectSeedClient({ port: daemon.port });
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
      title: "Methodology Hub workspace",
    });
    if (!created.workspace) throw new Error(created.error ?? "Failed to create workspace");
    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${daemon.port}`,
      nowIso: new Date().toISOString(),
    });
    await page.addInitScript((seededHost) => {
      localStorage.setItem("@paseo:e2e", "1");
      localStorage.setItem("@paseo:daemon-registry", JSON.stringify([seededHost]));
    }, host);
    await page.route(/:6767\b/, (route) => route.abort());
    await page.routeWebSocket(/:6767\b/, async (webSocket) => {
      await webSocket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
    });
    await gotoAppShell(page);
    await page.goto(`/h/${serverId}/workspace/${created.workspace.id}`);
    const teams = page.getByTestId("sidebar-teams");
    await expect(teams).toBeVisible({ timeout: 30_000 });
    await teams.click();
    await expect(page).toHaveURL(new RegExp(`/h/${serverId}/teams$`));
    await expect(teams).toBeVisible();
    await expect(page.getByTestId("team-hub-create")).toBeVisible();
    await expect(page.getByTestId("team-hub-open-workspace")).toBeVisible();
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "workspace-sidebar-team-hub.png") });
  } finally {
    await preserveDaemonLog(daemon, "diagnostics-live-workspace.log");
    await client.close();
    await repo.cleanup();
    await daemon.close();
  }
});
