import type { HostStatusSummaryPayload, StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import type { Page } from "@playwright/test";
import { buildHostAgentDetailRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test } from "./fixtures";
import { daemonWsRoutePattern } from "./helpers/daemon-port";
import { getServerId } from "./helpers/server-id";
import type { CreatedWorkspace } from "./helpers/with-workspace";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const COMPACT_VIEWPORT = { width: 390, height: 844 };

type WebSocketMessage = string | Buffer;

function parseJson(message: WebSocketMessage): unknown {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseJson(message);
  if (!envelope || typeof envelope !== "object") return null;
  const maybeEnvelope = envelope as { type?: unknown; message?: unknown };
  if (maybeEnvelope.type !== "session" || typeof maybeEnvelope.message !== "object") return null;
  return maybeEnvelope.message as Record<string, unknown>;
}

function withStatusSummaryFeature(message: WebSocketMessage): string | null {
  const envelope = parseJson(message);
  if (!envelope || typeof envelope !== "object") return null;
  const maybeEnvelope = envelope as {
    type?: unknown;
    message?: {
      type?: unknown;
      payload?: Record<string, unknown>;
    };
  };
  const payload = maybeEnvelope.message?.payload;
  if (
    maybeEnvelope.type !== "session" ||
    maybeEnvelope.message?.type !== "status" ||
    payload?.status !== "server_info"
  ) {
    return null;
  }
  return JSON.stringify({
    ...maybeEnvelope,
    message: {
      ...maybeEnvelope.message,
      payload: {
        ...payload,
        features: {
          ...(typeof payload.features === "object" && payload.features !== null
            ? payload.features
            : {}),
          statusSummary: true,
        },
      },
    },
  });
}

async function installStatusSummaryFixture(
  page: Page,
  summary: HostStatusSummaryPayload,
): Promise<{ pushSummary(): void; requestCount(): number; pushCount(): number }> {
  let activeClient: { send: (message: string) => void } | null = null;
  let requests = 0;
  let pushes = 0;
  const sendSummaryUpdate = () => {
    pushes += 1;
    activeClient?.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "status.summary.updated",
          payload: summary,
        },
      }),
    );
  };

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    activeClient = { send: (message: string) => ws.send(message) };

    ws.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      if (sessionMessage?.type === "status.summary.get.request") {
        requests += 1;
        const requestId = sessionMessage.requestId;
        if (typeof requestId !== "string") {
          throw new Error("status.summary.get.request missing requestId");
        }
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "status.summary.get.response",
              payload: { requestId, summary },
            },
          }),
        );
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => {
      const serverInfo = typeof message === "string" ? withStatusSummaryFeature(message) : null;
      ws.send(serverInfo ?? message);
      if (serverInfo) {
        setTimeout(sendSummaryUpdate, 100);
        setTimeout(sendSummaryUpdate, 500);
        setTimeout(sendSummaryUpdate, 1500);
      }
    });
  });

  return {
    pushSummary: sendSummaryUpdate,
    requestCount: () => requests,
    pushCount: () => pushes,
  };
}

function buildSummary(workspaceId: string): HostStatusSummaryPayload {
  const now = "2026-07-06T09:30:00.000Z";
  const running = snapshot({
    agentId: "agent-running-e2e",
    title: "Running nav e2e",
    workspaceId,
    status: "running",
    stateBucket: "running",
    updatedAt: now,
  });
  const attention = snapshot({
    agentId: "agent-attention-e2e",
    title: "Attention nav e2e",
    workspaceId,
    status: "closed",
    stateBucket: "needs_input",
    attentionReason: "finished",
    attentionTimestamp: now,
    updatedAt: now,
  });
  return {
    generatedAt: now,
    usage: {
      lifetime: {
        inputTokens: 1000,
        cachedInputTokens: 100,
        outputTokens: 200,
        totalTokens: 1200,
        totalCostUsd: 0.12,
      },
      today: {
        windowStart: "2026-07-06T00:00:00.000Z",
        windowEnd: null,
        inputTokens: 900,
        cachedInputTokens: 80,
        outputTokens: 180,
        totalTokens: 1080,
        totalCostUsd: 0.1,
      },
      byProvider: [],
      byModel: [],
    },
    activity: {
      runningAgents: [running],
      needsAttentionAgents: [attention],
      recentlyCompletedAgents: [],
      counts: {
        running: 1,
        needsAttention: 1,
        idle: 0,
        error: 0,
      },
    },
  };
}

function snapshot(input: Partial<StatusAgentSnapshot> & { agentId: string }): StatusAgentSnapshot {
  return {
    agentId: input.agentId,
    provider: input.provider ?? "mock",
    cwd: input.cwd ?? `/tmp/${input.agentId}`,
    workspaceId: input.workspaceId ?? null,
    title: input.title ?? input.agentId,
    status: input.status ?? "running",
    stateBucket: input.stateBucket ?? "running",
    updatedAt: input.updatedAt ?? "2026-07-06T09:30:00.000Z",
    attentionReason: input.attentionReason ?? null,
    attentionTimestamp: input.attentionTimestamp ?? null,
    parentAgentId: input.parentAgentId ?? null,
  };
}

async function getBox(locator: ReturnType<Page["getByTestId"]>) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected visible locator to have a bounding box.");
  return box;
}

async function openStatusBar(
  page: Page,
  viewport: { width: number; height: number },
  workspace: CreatedWorkspace,
) {
  await page.setViewportSize(viewport);
  const serverId = getServerId();
  const statusSummary = await installStatusSummaryFixture(
    page,
    buildSummary(workspace.workspaceId),
  );
  await page.goto(buildHostWorkspaceRoute(serverId, workspace.workspaceId));
  await expect(page).toHaveURL(new RegExp(`/h/${serverId}/workspace/`), { timeout: 30_000 });
  const bar = page.getByTestId("global-status-bar");
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    statusSummary.pushSummary();
    const ready = page.getByTestId("global-status-bar-ready");
    if (!(await ready.isVisible().catch(() => false))) {
      throw new Error(
        `status summary did not become ready; requests=${statusSummary.requestCount()} pushes=${statusSummary.pushCount()}`,
      );
    }
  }).toPass({ timeout: 30_000 });
  const trigger = page.getByTestId("status-bar-sessions-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await expect(trigger).toContainText("Sessions", { timeout: 30_000 });
  return { serverId, bar, trigger };
}

test.describe("status bar running sessions navigation", () => {
  test("desktop trigger opens an anchored panel and closes via Esc, outside press, and route change", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(180_000);
    const workspace = await withWorkspace({ prefix: "status-bar-sessions-desktop-" });
    const { serverId, bar, trigger } = await openStatusBar(page, DESKTOP_VIEWPORT, workspace);
    const beforeBarBox = await getBox(bar);

    await trigger.click();
    const panel = page.getByTestId("status-bar-sessions-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("status-bar-session-row-agent-attention-e2e")).toBeVisible();
    await expect(page.getByTestId("status-bar-session-row-agent-running-e2e")).toBeVisible();

    const panelBox = await getBox(panel);
    const triggerBox = await getBox(trigger);
    const afterBarBox = await getBox(bar);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
    expect(Math.abs(afterBarBox.height - beforeBarBox.height)).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible({ timeout: 10_000 });

    await trigger.click();
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.mouse.click(24, 24);
    await expect(panel).not.toBeVisible({ timeout: 10_000 });

    await trigger.click();
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.goto(buildHostWorkspaceRoute(serverId, "workspace-route-change-e2e"));
    await expect(panel).not.toBeVisible({ timeout: 10_000 });
  });

  test("compact trigger opens a sheet, replaces running chips, closes on backdrop, and workspace press closes", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(180_000);
    const workspace = await withWorkspace({ prefix: "status-bar-sessions-compact-" });
    const { serverId, trigger } = await openStatusBar(page, COMPACT_VIEWPORT, workspace);

    await expect(page.getByTestId("global-status-bar-row-running")).toHaveCount(0);
    await expect(page.getByTestId("global-status-bar-row-attention")).toHaveCount(0);
    await expect(trigger).toHaveCount(1);

    await trigger.click();
    const sheet = page.getByTestId("status-bar-sessions-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Agent sessions", { exact: true })).toBeVisible();
    await expect(page.getByTestId("status-bar-session-row-agent-attention-e2e")).toBeVisible();

    const backdrop = page.getByRole("button", { name: "Bottom sheet backdrop" }).first();
    await expect(backdrop).toBeVisible({ timeout: 10_000 });
    const backdropBox = await backdrop.boundingBox();
    if (!backdropBox) {
      throw new Error("Expected compact sheet backdrop to have a bounding box.");
    }
    await page.mouse.click(backdropBox.x + 24, backdropBox.y + 24);
    await expect(sheet).not.toBeVisible({ timeout: 10_000 });

    await trigger.click();
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("status-bar-session-workspace-agent-attention-e2e").click({
      force: true,
    });
    await expect(sheet).not.toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/h/${serverId}/workspace/[^/?]+$`), {
      timeout: 30_000,
    });

    await page.goto(
      buildHostAgentDetailRoute(serverId, "agent-running-e2e", workspace.workspaceId),
    );
    await expect(page.getByTestId("status-bar-sessions-trigger")).toBeVisible({
      timeout: 30_000,
    });
  });
});
