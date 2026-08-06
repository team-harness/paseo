import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

import { metroTest as test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

/**
 * The team panel over a real daemon and a real browser.
 *
 * The pieces underneath are unit-tested; what this covers is the part none of
 * them can: that a team created on the daemon reaches the sidebar, that its
 * deep link resolves to a workspace tab, and that the panel draws the roster
 * the daemon actually has.
 */
test("a team reaches the sidebar and its deep link opens the panel", async ({ page }) => {
  const serverId = `srv_team_panel_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({ repoPrefix: "team-panel-", port: daemon.port });

    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${daemon.port}`,
      nowIso: new Date().toISOString(),
    });
    await page.route(/:6767\b/, (route) => route.abort());
    await page.routeWebSocket(/:6767\b/, async (webSocket) => {
      await webSocket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
    });
    await page.addInitScript(
      ({ seededHost, preferences }) => {
        localStorage.setItem("@paseo:e2e", "1");
        localStorage.setItem("@paseo:daemon-registry", JSON.stringify([seededHost]));
        localStorage.setItem("@paseo:create-agent-preferences", JSON.stringify(preferences));
      },
      { seededHost: host, preferences: buildCreateAgentPreferences(serverId) },
    );

    await gotoAppShell(page);
    // The workspace is on screen before the team exists, so the team can only
    // arrive by broadcast — creating it first would prove nothing beyond the
    // list read that happens on connect.
    await expect(page.locator('[data-testid^="sidebar-workspace-row-"]').first()).toBeVisible({
      timeout: 60_000,
    });

    const created = await workspace.client.createTeam({
      idempotencyKey: `e2e-${serverId}`,
      name: "Disk usage",
      workspaceId: workspace.workspaceId,
      task: "find what is eating the disk",
      lead: { role: "lead", provider: "mock", settings: { modeId: "load-test" } },
      members: [{ role: "reviewer", provider: "mock", settings: { modeId: "load-test" } }],
    });
    expect(created.error).toBeNull();
    const team = created.team!;

    await expect(page.getByTestId(`sidebar-team-row-${team.id}`)).toBeVisible({ timeout: 30_000 });

    // The deep link carries no workspace; the route resolves one from the team
    // and hands off to the tab.
    await page.goto(`/h/${encodeURIComponent(serverId)}/team/${encodeURIComponent(team.id)}`);
    await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("team-panel-name")).toHaveText("Disk usage");

    // Every member the daemon has, including the lead. A roster that quietly
    // dropped one would still look like a team.
    for (const member of team.members) {
      await expect(page.getByTestId(`team-member-${member.agentId}`)).toBeVisible();
    }
    await expect(page.getByTestId("team-panel-archive")).toBeVisible();
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});
