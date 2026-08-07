import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

import { metroTest as test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

/**
 * Picks the first provider from an open provider picker.
 *
 * By list position rather than by name: once a picker has a selection, its
 * trigger shows that provider's label too, so matching on the label picks the
 * trigger of the field that is already answered.
 */
async function pickProvider(page: Page): Promise<void> {
  await page.locator('[data-testid="combobox-desktop-container"] [role="button"]').first().click();
}

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
    // Archiving is behind the header menu now. What has to stay reachable is
    // the menu; the item itself is checked where it is actually pressed.
    await expect(page.getByTestId("team-panel-menu")).toBeVisible();
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});

test("a team can be created from the workspace, without touching the daemon directly", async ({
  page,
}) => {
  const serverId = `srv_team_new_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({ repoPrefix: "team-new-", port: daemon.port });
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
    await page.locator('[data-testid^="sidebar-workspace-row-"]').first().click();

    // Every other team test seeds through the daemon, so none of them would
    // notice the entry missing from the workspace. This one is the entry.
    await page.getByTestId("workspace-header-menu-trigger").first().click();
    await page.getByTestId("workspace-header-new-team").click();

    await page.getByTestId("team-form-name").fill("Disk usage");
    await page.getByTestId("team-form-task").fill("find what is eating the disk");

    // The lead's provider comes from the daemon's own list — the form has no
    // default, because a team built on a provider that is not installed fails
    // at creation rather than at the picker.
    await page.getByTestId("team-form-lead").click();
    await pickProvider(page);

    // One member beside the lead, so the confirmation has a count to be wrong
    // about.
    await page.getByTestId("team-form-add-member").click();
    await page.getByTestId("team-form-member-0-role").fill("reviewer");
    await page.getByTestId("team-form-member-0-provider").click();
    await pickProvider(page);

    await expect(page.getByTestId("team-form-review")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("team-form-review").click();

    // The confirmation says what it will cost before it spends it: a lead plus
    // the members, which is the number of agents about to start.
    await expect(page.getByTestId("team-form-cost")).toContainText("2 agents");
    await page.getByTestId("team-form-submit").click();

    // Straight onto the team that was made, and the daemon agrees it exists.
    await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("team-panel-name")).toHaveText("Disk usage");
    const listed = await workspace.client.listTeams();
    expect(listed.teams.map((team) => team.name)).toContain("Disk usage");
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});

test("the panel aggregates two members' requests and answers each on its own", async ({ page }) => {
  const serverId = `srv_team_perms_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({ repoPrefix: "team-perms-", port: daemon.port });
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
    const reviewer = team.members.find((entry) => entry.role === "reviewer")!;

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

    await page.goto(`/h/${encodeURIComponent(serverId)}/team/${encodeURIComponent(team.id)}`);
    await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 60_000 });

    // Both members ask at once. Two blocked members are two decisions, and one
    // pair of buttons for both answers a question the user was never shown.
    // The lead's request carries its own actions; the reviewer's does not,
    // which is what most adapters send — a row that rendered only what the
    // request carried would offer no way to answer that one.
    await workspace.client.sendMessage(team.leadAgentId, "emit a synthetic plan approval");
    await workspace.client.sendMessage(reviewer.agentId, "emit a synthetic tool approval");

    const leadRow = page.getByTestId(`team-permission-${team.leadAgentId}`);
    const reviewerRow = page.getByTestId(`team-permission-${reviewer.agentId}`);
    await expect(leadRow).toBeVisible({ timeout: 60_000 });
    await expect(reviewerRow).toBeVisible({ timeout: 60_000 });

    // The team as a whole says it is blocked, not that it is working. This is
    // the aggregate the sidebar dot and the tab badge read, and it depends on
    // the panel handing the selector the field the store actually holds.
    await expect(page.getByTestId("team-panel-activity")).toHaveText("Waiting on you");

    // The lead's request keeps its own options; the reviewer's falls back to
    // the standard pair rather than to nothing.
    await expect(page.getByTestId(`team-permission-${team.leadAgentId}-implement`)).toBeVisible();
    await expect(page.getByTestId(`team-permission-${reviewer.agentId}-reject`)).toBeVisible();
    await expect(page.getByTestId(`team-permission-${reviewer.agentId}-accept`)).toBeVisible();

    // Answer one, and only that one goes away.
    await page.getByTestId(`team-permission-${reviewer.agentId}-reject`).click();
    await expect(reviewerRow).toBeHidden({ timeout: 30_000 });
    await expect(leadRow).toBeVisible();

    await page.getByTestId(`team-permission-${team.leadAgentId}-implement`).click();
    await expect(page.getByTestId("team-panel-permissions")).toBeHidden({ timeout: 30_000 });
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});

test("a person can say something in the team's room", async ({ page }) => {
  const serverId = `srv_team_room_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({ repoPrefix: "team-room-", port: daemon.port });
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

    await page.goto(`/h/${encodeURIComponent(serverId)}/team/${encodeURIComponent(team.id)}`);
    await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 60_000 });

    const composer = page.getByTestId("team-room-composer");
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill("what is the status?");
    await page.getByTestId("team-room-send").click();

    // The message reaches the room, and the timeline learns about it from the
    // subscription rather than from a local copy.
    await expect(page.getByText("what is the status?")).toBeVisible({ timeout: 30_000 });
    await expect(composer).toHaveValue("");

    const messages = await workspace.client.readChatMessages({ room: team.chatRoomId });
    expect(messages.messages.some((message) => message.body === "what is the status?")).toBe(true);
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});
