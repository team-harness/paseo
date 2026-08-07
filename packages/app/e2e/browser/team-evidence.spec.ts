import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

import { metroTest as test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

/**
 * QA evidence for the Web platform row of `docs/qa.md`.
 *
 * Not a substitute for the assertions in `team-panel.spec.ts` — this one walks
 * the same surfaces and writes a screenshot at each, so a reviewer can see what
 * the feature looks like rather than take a passing test's word for it. It
 * still asserts at every step, because a screenshot of the wrong screen is
 * worse than none.
 */
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  process.cwd().endsWith("packages/app") ? "../.." : ".",
  ".codestable/audits/agent-teams-qa",
);

const COMPACT_VIEWPORT = { width: 420, height: 900 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

/** Picks the first provider from an open picker, by position rather than name. */
async function pickProvider(page: Page): Promise<void> {
  await page.locator('[data-testid="combobox-desktop-container"] [role="button"]').first().click();
}

/** One seeded ledger row, with the short id a room message would name it by. */
interface SeededTask {
  taskId: string;
  short: string;
}

/**
 * Puts a task ledger on disk for a team that has none.
 *
 * These rows would come from the lead calling `assign_task`, and the mock
 * provider this team runs on cannot reach MCP. `TeamInbox` re-reads the file on
 * every call and caches nothing, so a file written here is the ledger the panel
 * reads. It has to land before the panel mounts: the client lists the ledger
 * once and afterwards only follows `team.tasks.update`, which a write from
 * outside the daemon does not raise.
 *
 * Every row is settled, and that is not a shortcut. `TeamPump.settleDispatched`
 * looks up the turn behind every `dispatched` row and settles it as `unknown`
 * when the turn is not running — and no turn id invented here belongs to a real
 * turn, so a seeded in-flight row is settled out from under the screenshot by
 * the next pass. The live states are covered against real providers in
 * `.codestable/audits/agent-teams-fix-verify/`.
 *
 * Timestamps are fixed relative to now so the durations never move.
 */
async function seedTaskLedger(input: {
  paseoHome: string;
  teamId: string;
  reviewerAgentId: string;
  leadAgentId: string;
}): Promise<{ done: SeededTask; failed: SeededTask; canceled: SeededTask }> {
  const base = Date.now() - 10 * 60_000;
  const at = (offsetMs: number): string => new Date(base + offsetMs).toISOString();
  const done = randomUUID();
  const failed = randomUUID();
  const canceled = randomUUID();

  const dir = path.join(input.paseoHome, "teams", "inbox");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${input.teamId}.inbox.json`),
    JSON.stringify({
      revision: 6,
      assignments: [
        {
          taskId: done,
          assigneeAgentId: input.reviewerAgentId,
          prompt: "Measure the cache directory and list what is stale.",
          clientMessageId: randomUUID(),
          state: "settled",
          acceptedTurnId: randomUUID(),
          outcome: "completed",
          completionEventId: randomUUID(),
          createdAt: at(0),
          dispatchedAt: at(2_000),
          settledAt: at(182_000),
        },
        {
          taskId: failed,
          assigneeAgentId: input.reviewerAgentId,
          prompt: "Draft the deletion list for anything untouched in six months.",
          clientMessageId: randomUUID(),
          state: "settled",
          acceptedTurnId: randomUUID(),
          outcome: "failed",
          completionEventId: randomUUID(),
          createdAt: at(184_000),
          dispatchedAt: at(186_000),
          settledAt: at(231_000),
        },
        {
          // Never dispatched, so it has no span to report — the row shows a
          // status and no duration, which is what a cancelled one looks like.
          taskId: canceled,
          assigneeAgentId: input.leadAgentId,
          prompt: "Check whether the backup job still writes here.",
          clientMessageId: randomUUID(),
          state: "settled",
          acceptedTurnId: null,
          outcome: "canceled",
          completionEventId: randomUUID(),
          createdAt: at(240_000),
          dispatchedAt: null,
          settledAt: at(244_000),
        },
      ],
      pendingCompletions: [],
      inFlightDelivery: null,
    }),
    "utf8",
  );

  return {
    done: { taskId: done, short: done.slice(0, 8) },
    failed: { taskId: failed, short: failed.slice(0, 8) },
    canceled: { taskId: canceled, short: canceled.slice(0, 8) },
  };
}

test("captures the team surfaces on Web", async ({ page }) => {
  const serverId = `srv_team_qa_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({ repoPrefix: "team-qa-", port: daemon.port });
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

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoAppShell(page);
    await page.locator('[data-testid^="sidebar-workspace-row-"]').first().click();

    // 1 — the entry, in the workspace header menu.
    await page.getByTestId("workspace-header-menu-trigger").first().click();
    await expect(page.getByTestId("workspace-header-new-team")).toBeVisible();
    await shoot(page, "01-new-team-entry");

    // 2 — the form, filled. Not submitted: the rest of this walk needs a team
    // on the mock provider so its agents can be driven into a permission, and
    // the picker here takes whatever the daemon lists first.
    await page.getByTestId("workspace-header-new-team").click();
    await page.getByTestId("team-form-name").fill("Disk usage");
    await page.getByTestId("team-form-task").fill("find what is eating the disk");
    await page.getByTestId("team-form-lead").click();
    await pickProvider(page);
    await page.getByTestId("team-form-add-member").click();
    await page.getByTestId("team-form-member-0-role").fill("reviewer");
    await page.getByTestId("team-form-member-0-provider").click();
    await pickProvider(page);
    await expect(page.getByTestId("team-form-review")).toBeEnabled({ timeout: 30_000 });
    await shoot(page, "02-new-team-form");

    // 3 — the confirmation, which says what it is about to spend.
    await page.getByTestId("team-form-review").click();
    await expect(page.getByTestId("team-form-cost")).toContainText("2 agents");
    await shoot(page, "03-new-team-confirm");

    await page.keyboard.press("Escape");

    const created = await workspace.client.createTeam({
      idempotencyKey: `qa-${serverId}`,
      name: "Disk usage",
      workspaceId: workspace.workspaceId,
      task: "find what is eating the disk",
      lead: { role: "lead", provider: "mock", settings: { modeId: "load-test" } },
      members: [{ role: "reviewer", provider: "mock", settings: { modeId: "load-test" } }],
    });
    expect(created.error).toBeNull();
    const team = created.team!;
    const reviewer = team.members.find((entry) => entry.role === "reviewer")!;
    const tasks = await seedTaskLedger({
      paseoHome: daemon.paseoHome,
      teamId: team.id,
      reviewerAgentId: reviewer.agentId,
      leadAgentId: team.leadAgentId,
    });

    await page.goto(`/h/${encodeURIComponent(serverId)}/team/${encodeURIComponent(team.id)}`);
    await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("team-panel-name")).toHaveText("Disk usage");

    // 4 — the panel as it opens: the roster is a strip of faces at the top and
    // the conversation has the width.
    await expect(page.getByTestId("team-panel-roster")).toBeVisible();
    await shoot(page, "04-team-panel");

    // 5 — the room with a conversation in it. The messages arrive over the
    // subscription, the same way they do from the agents themselves.
    await workspace.client.postChatMessage({
      room: team.chatRoomId,
      body: "Starting on the cache directory. It is 40GB and most of it is stale.",
      authorAgentId: team.leadAgentId,
    });
    await workspace.client.postChatMessage({
      room: team.chatRoomId,
      body: "Checked the last write on each entry — 38GB has not been touched in six months.",
      authorAgentId: reviewer.agentId,
    });
    await expect(page.getByText(/Starting on the cache directory/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/38GB has not been touched/)).toBeVisible();
    await shoot(page, "05-team-room-conversation");

    // 6 — a person joining the conversation, through the composer.
    await page.getByTestId("team-room-composer").fill("Leave anything from this week alone.");
    await page.getByTestId("team-room-send").click();
    await expect(page.getByText("Leave anything from this week alone.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("team-room-composer")).toHaveValue("");
    await shoot(page, "06-team-room-person-posted");

    // 7 — a folded message. Agents post transcripts; one unfolded would bury
    // the rest of the room.
    await workspace.client.postChatMessage({
      room: team.chatRoomId,
      body: Array.from({ length: 40 }, (_, index) => `stale/entry-${index}.bin  1.0G`).join("\n"),
      authorAgentId: reviewer.agentId,
    });
    await expect(page.getByText(/Show \d+ more lines/)).toBeVisible({ timeout: 30_000 });
    await shoot(page, "07-team-room-folded-message");

    // 8 — the composer's mention menu. It offers roles, because a role is what
    // the daemon resolves inside a team room. Typed with the keyboard rather
    // than filled: the menu follows the caret, and `fill` sets a value without
    // moving one.
    await page.getByTestId("team-room-composer").click();
    await page.keyboard.type("@re");
    await expect(page.getByTestId("team-room-mentions")).toBeVisible();
    await expect(page.getByTestId("team-room-mentions")).toContainText("@reviewer");
    await shoot(page, "08-team-room-mention-autocomplete");
    await page.getByTestId("team-room-composer").fill("");

    // 9 — two members blocked at once, each answered on its own. The lead's
    // request carries its own actions; the reviewer's does not, which is what
    // most adapters send.
    await workspace.client.sendMessage(team.leadAgentId, "emit a synthetic plan approval");
    await workspace.client.sendMessage(reviewer.agentId, "emit a synthetic tool approval");
    await expect(page.getByTestId(`team-permission-${team.leadAgentId}`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId(`team-permission-${reviewer.agentId}`)).toBeVisible();
    await expect(page.getByTestId("team-panel-activity")).toHaveText("Waiting on you");
    await shoot(page, "09-team-permissions-aggregated");

    await page.getByTestId(`team-permission-${reviewer.agentId}-reject`).click();
    await expect(page.getByTestId(`team-permission-${reviewer.agentId}`)).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`team-permission-${team.leadAgentId}`)).toBeVisible();
    await shoot(page, "10-team-permissions-one-answered");

    // 11 — a body that names people and work. The mention is the role the lead
    // is briefed to use; the chips are short task ids from the ledger. Both are
    // drawn only because they resolve — a token that means nobody stays text.
    await workspace.client.postChatMessage({
      room: team.chatRoomId,
      body: `@reviewer closed #${tasks.done.short}. #${tasks.failed.short} needs another pass.`,
      authorAgentId: team.leadAgentId,
    });
    await expect(page.getByText(`#${tasks.failed.short}`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("@reviewer", { exact: true })).toBeVisible();
    await shoot(page, "11-team-room-chips");

    // 12 — the task tab, with an outcome of each kind: the one that worked, the
    // one that did not, and the one that was never sent and so has no duration.
    await page.getByTestId("team-tab-tasks").click();
    await expect(page.getByTestId(`team-task-${tasks.done.taskId}-duration`)).toHaveText("3m");
    await expect(page.getByTestId(`team-task-${tasks.failed.taskId}-duration`)).toHaveText("45s");
    await expect(page.getByTestId(`team-task-${tasks.canceled.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`team-task-${tasks.canceled.taskId}-duration`)).toBeHidden();
    await shoot(page, "12-team-tasks");

    // 13 — a chip answered. Tapping `#id` switches tabs and rings the row it
    // named; without the ring the tap lands on a list and says nothing.
    await page.getByTestId("team-tab-chat").click();
    await page.getByText(`#${tasks.failed.short}`, { exact: true }).click();
    await expect(page.getByTestId(`team-task-${tasks.failed.taskId}`)).toBeVisible();
    await shoot(page, "13-team-tasks-highlighted");
    await page.getByTestId("team-tab-chat").click();

    // 14 — the sidebar entry, which is how a team is found without a link.
    await expect(page.getByTestId(`sidebar-team-row-${team.id}`)).toBeVisible();
    await shoot(page, "14-sidebar-team-entry");

    // 15 — the archive confirmation. Red on the page is not consent, and on
    // the web that consent is a `window.confirm`, which does not render into a
    // screenshot — so the evidence is what it says, captured from the dialog.
    await page.getByTestId("team-panel-menu").click();
    await expect(page.getByTestId("team-panel-archive")).toBeVisible();
    const confirmation = await new Promise<string>((resolve) => {
      page.once("dialog", (dialog) => {
        resolve(dialog.message());
        void dialog.dismiss();
      });
      void page.getByTestId("team-panel-archive").click();
    });
    expect(confirmation).toContain("2");
    expect(confirmation).toMatch(/cannot be undone/i);
    await writeFile(path.join(EVIDENCE_DIR, "15-archive-confirmation.txt"), confirmation, "utf8");
    // Dismissed, so the team is still here for the compact shot. Selecting the
    // item closed the menu, so what is on screen again is the trigger.
    await expect(page.getByTestId("team-panel-menu")).toBeVisible();

    // 16 — compact. The strip of faces wraps and the conversation keeps the
    // width it had.
    await page.setViewportSize(COMPACT_VIEWPORT);
    await expect(page.getByTestId("team-panel")).toBeVisible();
    await shoot(page, "16-team-panel-compact");
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});
