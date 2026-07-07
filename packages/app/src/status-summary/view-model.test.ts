import { describe, expect, it } from "vitest";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";
import { buildStatusSummaryViewModel } from "./view-model";

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
    expect(view.generatedAt).toBe("2026-07-06T04:00:00.000Z");
    expect(view.isRefreshing).toBe(true);
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
