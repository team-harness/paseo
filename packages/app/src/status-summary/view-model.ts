import type {
  HostStatusSummaryPayload,
  StatusAgentSnapshot,
  StatusSummaryUsageTotals,
} from "@getpaseo/protocol/messages";
import type { StatusSummaryQueryState } from "./query";

export type StatusBarRowId =
  | "lifetime-tokens"
  | "today-tokens"
  | "cost"
  | "running"
  | "attention"
  | "errors";

export interface StatusBarRow {
  id: StatusBarRowId;
  label: string;
  value: string;
  tone: "default" | "ok" | "warning" | "danger";
}

export type StatusSummaryViewModel =
  | { kind: "hidden"; reason: "no-host" }
  | {
      kind: "offline" | "unsupported" | "loading" | "error";
      message?: string;
      previousSummary?: HostStatusSummaryPayload;
    }
  | {
      kind: "ready";
      summary: HostStatusSummaryPayload;
      primaryRows: StatusBarRow[];
      runningAgents: StatusAgentSnapshot[];
      needsAttentionAgents: StatusAgentSnapshot[];
      recentlyCompletedAgents: StatusAgentSnapshot[];
      generatedAt: string;
      isRefreshing: boolean;
    };

export function buildStatusSummaryViewModel(
  state: StatusSummaryQueryState,
): StatusSummaryViewModel {
  if (state.kind === "disabled") {
    if (state.reason === "no-host") {
      return { kind: "hidden", reason: "no-host" };
    }
    if (state.reason === "unsupported") {
      return {
        kind: "unsupported",
        message: "Update the host to use this.",
        previousSummary: state.previousSummary,
      };
    }
    return {
      kind: "offline",
      message: "Host is offline.",
      previousSummary: state.previousSummary,
    };
  }
  if (state.kind === "loading") {
    return { kind: "loading", previousSummary: state.previousSummary };
  }
  if (state.kind === "error") {
    return {
      kind: "error",
      message: state.message,
      previousSummary: state.previousSummary,
    };
  }

  const { summary } = state;
  return {
    kind: "ready",
    summary,
    primaryRows: buildPrimaryRows(summary),
    runningAgents: summary.activity.runningAgents,
    needsAttentionAgents: summary.activity.needsAttentionAgents,
    recentlyCompletedAgents: summary.activity.recentlyCompletedAgents,
    generatedAt: summary.generatedAt,
    isRefreshing: state.isRefreshing,
  };
}

export function buildPrimaryRows(summary: HostStatusSummaryPayload): StatusBarRow[] {
  const rows: StatusBarRow[] = [
    {
      id: "lifetime-tokens",
      label: "Total tokens",
      value: formatTokenCount(summary.usage.lifetime.totalTokens),
      tone: "default",
    },
    {
      id: "today-tokens",
      label: "Today",
      value: formatTokenCount(summary.usage.today.totalTokens),
      tone: "default",
    },
  ];

  const cost = summary.usage.lifetime.totalCostUsd ?? summary.usage.today.totalCostUsd;
  rows.push({
    id: "cost",
    label: "Cost",
    value: formatCost(cost),
    tone: cost === undefined ? "default" : "ok",
  });

  rows.push(
    {
      id: "running",
      label: "Running",
      value: String(summary.activity.counts.running),
      tone: summary.activity.counts.running > 0 ? "ok" : "default",
    },
    {
      id: "attention",
      label: "Needs attention",
      value: String(summary.activity.counts.needsAttention),
      tone: summary.activity.counts.needsAttention > 0 ? "warning" : "default",
    },
    {
      id: "errors",
      label: "Errors",
      value: String(summary.activity.counts.error),
      tone: summary.activity.counts.error > 0 ? "danger" : "default",
    },
  );

  return rows;
}

function formatTokenCount(value: StatusSummaryUsageTotals["totalTokens"]): string {
  if (value === undefined) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCost(value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}
