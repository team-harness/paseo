import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  addFakeScheduleHostAndReload,
  buildFakeScheduleHostWorkspace,
  FAKE_HOST_MODEL_ID,
  FAKE_HOST_MODEL_LABEL,
  installFakeScheduleHost,
} from "../support/helpers/schedule-fake-host";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectSettled, expectStableHeight } from "../support/helpers/settled";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildSchedulesRoute } from "../../src/utils/host-routes";

interface ScheduleSeedClient {
  scheduleCreate(input: {
    prompt: string;
    name?: string;
    cadence: { type: "cron"; expression: string };
    target:
      | {
          type: "new-agent";
          config: {
            provider: "mock";
            cwd: string;
            model: string;
            modeId: string;
            title: string;
          };
        }
      | { type: "agent"; agentId: string };
    runOnCreate: boolean;
  }): Promise<{ schedule: { id: string } | null; error: string | null }>;
  scheduleDelete(input: { id: string }): Promise<{ error: string | null }>;
  scheduleList(): Promise<{ schedules: Array<{ id: string; prompt: string }> }>;
}

async function typeWithIme(page: Page, input: Locator, value: string): Promise<void> {
  await input.focus();
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.imeSetComposition", {
      text: value,
      selectionStart: value.length,
      selectionEnd: value.length,
      replacementStart: 0,
      replacementEnd: 0,
    });
    await session.send("Input.insertText", { text: value });
  } finally {
    await session.detach();
  }
}

async function seedMockSchedule(workspace: SeededWorkspace, name: string): Promise<string> {
  const client = workspace.client as unknown as ScheduleSeedClient;
  const result = await client.scheduleCreate({
    prompt: "Say hello from the scheduled agent.",
    name,
    cadence: { type: "cron", expression: "0 9 * * *" },
    target: {
      type: "new-agent",
      config: {
        provider: "mock",
        cwd: workspace.repoPath,
        model: "ten-second-stream",
        modeId: "load-test",
        title: name,
      },
    },
    runOnCreate: false,
  });

  if (!result.schedule) {
    throw new Error(result.error ?? "Failed to seed schedule");
  }

  return result.schedule.id;
}

function ignoreScheduleDeleteError(): void {}

async function deleteSeededSchedule(owner: { client: unknown }, id: string): Promise<void> {
  await (owner.client as ScheduleSeedClient)
    .scheduleDelete({ id })
    .catch(ignoreScheduleDeleteError);
}

async function readSchedulePrompt(client: ScheduleSeedClient, id: string): Promise<string | null> {
  const schedules = await client.scheduleList();
  return schedules.schedules.find((schedule) => schedule.id === id)?.prompt ?? null;
}

type FakeScheduleHostSchedule = NonNullable<
  Parameters<typeof installFakeScheduleHost>[0]["schedules"]
>[number];

function buildFakeHostSchedule(input: {
  id: string;
  name: string;
  cwd: string;
}): FakeScheduleHostSchedule {
  const now = "2026-07-01T00:00:00.000Z";
  return {
    id: input.id,
    name: input.name,
    prompt: "Run on the secondary host.",
    cadence: { type: "cron", expression: "0 9 * * *" },
    target: {
      type: "new-agent",
      config: {
        provider: "mock",
        cwd: input.cwd,
        model: FAKE_HOST_MODEL_ID,
        modeId: "load-test",
        title: input.name,
      },
    },
    status: "active",
    createdAt: now,
    updatedAt: now,
    nextRunAt: now,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
  };
}

test.describe("Schedules", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("edit form hydrates the scheduled model selection", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-model-hydration-" });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Hydrate model ${Date.now()}`;
    const scheduleId = await seedMockSchedule(workspace, scheduleName);
    cleanupTasks.push(() => deleteSeededSchedule(workspace, scheduleId));

    await page.goto(buildSchedulesRoute());
    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(workspace.projectDisplayName, { timeout: 30_000 });

    await row.click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    const hostTrigger = page.getByTestId("schedule-host-trigger");
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    const thinkingTrigger = page.getByTestId("schedule-thinking-trigger");
    const modeTrigger = page.getByTestId("schedule-mode-trigger");
    await expect(hostTrigger).toBeVisible({ timeout: 30_000 });
    await expect(hostTrigger).toBeDisabled();
    await expectSettled(hostTrigger);
    await expect(projectTrigger).toContainText(workspace.projectDisplayName, { timeout: 30_000 });
    await expectSettled(projectTrigger);
    await expect(modelTrigger).toContainText("Ten second stream", { timeout: 30_000 });
    await expectSettled(modelTrigger);
    await expect(thinkingTrigger).toContainText("Low");
    await expectSettled(thinkingTrigger);
    await expect(modeTrigger).toBeVisible({ timeout: 30_000 });
    await expectSettled(modeTrigger);
    await expect(page.getByTestId("cadence-mode")).toHaveCount(0);
    await expect(page.getByTestId("cadence-interval-value")).toHaveCount(0);
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
    await expect(page.getByText(/Times are in/)).toHaveCount(0);
    await expect(formSheet.getByText("Cron", { exact: true })).toHaveCount(0);
  });

  test("new schedule prompt accepts Chinese IME composition", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-prompt-ime-" });
    cleanupTasks.push(() => workspace.cleanup());

    await page.goto(buildSchedulesRoute());
    const newSchedule = page
      .getByTestId("schedules-new")
      .or(page.getByTestId("schedules-empty-new"))
      .first();
    await expect(newSchedule).toBeVisible({ timeout: 30_000 });
    await newSchedule.click();

    const promptInput = page.getByTestId("schedule-prompt-input");
    await expect(promptInput).toBeVisible({ timeout: 10_000 });
    await typeWithIme(page, promptInput, "检查项目状态并汇总最新变更");
    await expect(promptInput).toHaveValue("检查项目状态并汇总最新变更");
  });

  test("existing agent schedule exposes and saves its prompt", async ({ page }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "schedule-heartbeat-prompt-",
      title: "Heartbeat prompt target",
    });
    cleanupTasks.push(() => agent.cleanup());
    const client = agent.client as unknown as ScheduleSeedClient;
    const result = await client.scheduleCreate({
      prompt: "Check the agent status",
      name: "Editable heartbeat prompt",
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: { type: "agent", agentId: agent.agentId },
      runOnCreate: false,
    });
    if (!result.schedule) {
      throw new Error(result.error ?? "Failed to seed heartbeat schedule");
    }
    const scheduleId = result.schedule.id;
    cleanupTasks.push(() => deleteSeededSchedule(agent, scheduleId));

    await page.goto(buildSchedulesRoute());
    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const promptInput = page.getByTestId("schedule-prompt-input");
    await expect(promptInput).toBeVisible({ timeout: 10_000 });
    await expect(promptInput).toHaveValue("Check the agent status");
    await promptInput.fill("检查运行状态并汇总结果");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => readSchedulePrompt(client, scheduleId)).toBe("检查运行状态并汇总结果");
  });

  test("edit form hydrates a non-default host schedule after reload", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-host-b-hydration-" });
    cleanupTasks.push(() => workspace.cleanup());
    const fakeHost = await buildFakeScheduleHostWorkspace(workspace);
    const fakePort = String(59_000 + Math.floor(Math.random() * 900));
    const scheduleId = "fake-host-schedule";
    const scheduleName = "Secondary host schedule";

    await installFakeScheduleHost({
      page,
      port: fakePort,
      serverId: fakeHost.serverId,
      workspace: fakeHost.workspace,
      project: fakeHost,
      schedules: [
        buildFakeHostSchedule({
          id: scheduleId,
          name: scheduleName,
          cwd: String(fakeHost.workspace.workspaceDirectory),
        }),
      ],
    });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await addFakeScheduleHostAndReload({
      page,
      serverId: fakeHost.serverId,
      label: "Fake host",
      port: fakePort,
    });
    await page.reload();

    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    const hostTrigger = page.getByTestId("schedule-host-trigger");
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    const modeTrigger = page.getByTestId("schedule-mode-trigger");

    await expect(hostTrigger).toContainText("Fake host", { timeout: 30_000 });
    await expect(hostTrigger).toBeDisabled();
    await expectSettled(hostTrigger);
    await expect(projectTrigger).toContainText(fakeHost.projectDisplayName, { timeout: 30_000 });
    await expectSettled(projectTrigger);
    await expect(modelTrigger).toContainText(FAKE_HOST_MODEL_LABEL, { timeout: 30_000 });
    await expectSettled(modelTrigger);
    await expect(modeTrigger).toContainText("Load test", { timeout: 30_000 });
    await expectSettled(modeTrigger);
    await expect(page.getByTestId("cadence-mode")).toHaveCount(0);
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
  });

  test("create opens pristine after closing an edit form", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-pristine-create-" });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Pristine create ${Date.now()}`;
    const scheduleId = await seedMockSchedule(workspace, scheduleName);
    cleanupTasks.push(() => deleteSeededSchedule(workspace, scheduleId));

    await page.goto(buildSchedulesRoute());
    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(formSheet).toHaveCount(0, { timeout: 30_000 });

    await page.getByTestId("schedules-new").click();
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    await expect(projectTrigger).toContainText(/select project/i);
    await expectSettled(projectTrigger);
    await expect(page.getByTestId("schedule-model-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-thinking-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-mode-trigger")).toHaveCount(0);
    await expect(page.getByTestId("cadence-interval-value")).toHaveCount(0);
  });
});
