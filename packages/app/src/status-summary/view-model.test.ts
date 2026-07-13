import { describe, expect, it } from "vitest";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";
import { buildMultiHostStatusSummaryViewModel, buildStatusSummaryViewModel } from "./view-model";

function summary(overrides: Partial<HostStatusSummaryPayload> = {}): HostStatusSummaryPayload {
  return {
    generatedAt: "2026-07-06T04:00:00.000Z",
    usage: {
      lifetime: {
        inputTokens: 1_000,
        cachedInputTokens: 500,
        outputTokens: 250,
        totalTokens: 112_000_000,
        totalCostUsd: 12.34,
      },
      today: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 61_000_000,
        totalCostUsd: 0.1234,
        windowStart: "2026-07-06T00:00:00.000Z",
        windowEnd: "2026-07-06T04:00:00.000Z",
      },
      byProvider: [],
      byModel: [],
    },
    activity: {
      runningAgents: [
        {
          agentId: "agent-running",
          provider: "codex",
          cwd: "/repo",
          workspaceId: "workspace-1",
          title: "Running agent",
          status: "running",
          stateBucket: "running",
          updatedAt: "2026-07-06T03:59:00.000Z",
        },
      ],
      needsAttentionAgents: [],
      recentlyCompletedAgents: [],
      counts: {
        running: 1,
        needsAttention: 2,
        idle: 3,
        error: 1,
      },
    },
    ...overrides,
  };
}

describe("buildStatusSummaryViewModel", () => {
  it("maps disabled query states to explicit non-ready view states", () => {
    const previousSummary = summary();

    expect(buildStatusSummaryViewModel({ kind: "disabled", reason: "no-host" })).toMatchObject({
      kind: "hidden",
      reason: "no-host",
    });
    expect(
      buildStatusSummaryViewModel({
        kind: "disabled",
        reason: "unsupported",
        previousSummary,
      }),
    ).toMatchObject({
      kind: "unsupported",
      previousSummary,
    });
    expect(
      buildStatusSummaryViewModel({
        kind: "disabled",
        reason: "offline",
        previousSummary,
      }),
    ).toMatchObject({
      kind: "offline",
      previousSummary,
    });
  });

  it("builds stable rows and agent lists from a ready summary", () => {
    const view = buildStatusSummaryViewModel({
      kind: "ready",
      summary: summary(),
      isRefreshing: true,
    });

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") throw new Error("Expected ready view");
    expect(view.primaryRows.map((row) => [row.id, row.value, row.tone])).toEqual([
      ["lifetime-tokens", "1.1亿", "default"],
      ["cost", "$0.1234", "ok"],
      ["today-tokens", "6.1千万", "default"],
      ["running", "1", "ok"],
      ["attention", "2", "warning"],
      ["errors", "1", "danger"],
    ]);
    expect(view.primaryRows.find((row) => row.id === "cost")?.details).toEqual([
      { label: "Today", value: "$0.1234" },
      { label: "Total", value: "$12.34" },
    ]);
    expect(view.runningAgents).toHaveLength(1);
    expect(view.needsAttentionAgents).toHaveLength(0);
    expect(view.pinnedSessions).toEqual([]);
    expect(view.canUseStatusBarSessionPins).toBe(false);
    expect(view.generatedAt).toBe("2026-07-06T04:00:00.000Z");
    expect(view.isRefreshing).toBe(true);
  });

  it("aggregates ready summaries from multiple hosts while retaining their sources", () => {
    const first = summary();
    const second = summary({
      generatedAt: "2026-07-06T05:00:00.000Z",
      usage: {
        lifetime: {
          inputTokens: 2_000,
          cachedInputTokens: 1_000,
          outputTokens: 500,
          totalTokens: 10_000,
          totalCostUsd: 2,
        },
        today: {
          inputTokens: 200,
          outputTokens: 50,
          totalTokens: 5_000,
          totalCostUsd: 0.5,
          windowStart: "2026-07-06T01:00:00.000Z",
          windowEnd: "2026-07-06T05:00:00.000Z",
        },
        byProvider: [],
        byModel: [],
      },
      activity: {
        runningAgents: [
          {
            agentId: "agent-running-2",
            provider: "claude",
            cwd: "/repo-2",
            workspaceId: "workspace-2",
            title: "Running agent two",
            status: "running",
            stateBucket: "running",
            updatedAt: "2026-07-06T04:59:00.000Z",
          },
        ],
        needsAttentionAgents: [],
        recentlyCompletedAgents: [],
        counts: {
          running: 1,
          needsAttention: 1,
          idle: 2,
          error: 0,
        },
      },
    });

    const view = buildMultiHostStatusSummaryViewModel([
      {
        serverId: "host-1",
        serverLabel: "MacBook Pro",
        state: { kind: "ready", summary: first, isRefreshing: false },
        canUseStatusBarSessionPins: true,
      },
      {
        serverId: "host-2",
        serverLabel: "Build host",
        state: { kind: "ready", summary: second, isRefreshing: true },
        canUseStatusBarSessionPins: true,
      },
    ]);

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") throw new Error("Expected ready view");
    expect(view.summary.usage.lifetime.totalTokens).toBe(112_010_000);
    expect(view.summary.usage.today.totalTokens).toBe(61_005_000);
    expect(view.summary.usage.today.totalCostUsd).toBeCloseTo(0.6234);
    expect(view.summary.activity.counts).toEqual({
      running: 2,
      needsAttention: 3,
      idle: 5,
      error: 1,
    });
    expect(view.runningAgents.map((agent) => agent.agentId)).toEqual([
      "agent-running",
      "agent-running-2",
    ]);
    expect(view.hostSummaries?.map((host) => host.serverLabel)).toEqual([
      "MacBook Pro",
      "Build host",
    ]);
    expect(view.pinnedSessions).toEqual([]);
    expect(view.canUseStatusBarSessionPins).toBe(false);
    expect(view.isRefreshing).toBe(true);
    expect(view.generatedAt).toBe("2026-07-06T05:00:00.000Z");
  });

  it("exposes host pinned sessions only behind the single capability gate", () => {
    const view = buildStatusSummaryViewModel(
      {
        kind: "ready",
        summary: summary({
          pinnedSessions: [
            {
              agentId: "agent-pinned",
              workspaceId: "workspace-1",
              title: "Pinned agent",
              provider: "codex",
              updatedAt: "2026-07-06T03:59:00.000Z",
              pinnedAt: "2026-07-06T04:00:00.000Z",
            },
          ],
        }),
        isRefreshing: false,
      },
      { canUseStatusBarSessionPins: true },
    );

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") throw new Error("Expected ready view");
    expect(view.canUseStatusBarSessionPins).toBe(true);
    expect(view.pinnedSessions).toEqual([
      {
        agentId: "agent-pinned",
        workspaceId: "workspace-1",
        title: "Pinned agent",
        provider: "codex",
        updatedAt: "2026-07-06T03:59:00.000Z",
        pinnedAt: "2026-07-06T04:00:00.000Z",
      },
    ]);
  });

  it("preserves previous summary for loading and error states", () => {
    const previousSummary = summary();

    expect(buildStatusSummaryViewModel({ kind: "loading", previousSummary })).toMatchObject({
      kind: "loading",
      previousSummary,
    });
    expect(
      buildStatusSummaryViewModel({
        kind: "error",
        message: "network down",
        previousSummary,
      }),
    ).toMatchObject({
      kind: "error",
      message: "network down",
      previousSummary,
    });
  });

  it("formats missing usage totals as empty display values without inventing cost", () => {
    const view = buildStatusSummaryViewModel({
      kind: "ready",
      summary: summary({
        usage: {
          lifetime: { totalTokens: 0 },
          today: {
            totalTokens: 0,
            windowStart: "2026-07-06T00:00:00.000Z",
            windowEnd: "2026-07-06T04:00:00.000Z",
          },
          byProvider: [],
          byModel: [],
        },
      }),
      isRefreshing: false,
    });

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") throw new Error("Expected ready view");
    expect(view.primaryRows.map((row) => [row.id, row.value])).toEqual([
      ["lifetime-tokens", "0"],
      ["cost", "-"],
      ["today-tokens", "0"],
      ["running", "1"],
      ["attention", "2"],
      ["errors", "1"],
    ]);
  });
});
