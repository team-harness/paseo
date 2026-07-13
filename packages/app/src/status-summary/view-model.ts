import type {
  HostStatusSummaryPayload,
  StatusAgentSnapshot,
  StatusPinnedSession,
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
  details?: StatusBarRowDetail[];
}

export interface StatusBarRowDetail {
  label: string;
  value: string;
}

export interface StatusBarHostSummary {
  serverId: string;
  serverLabel: string;
  summary: HostStatusSummaryPayload;
  canUseStatusBarSessionPins: boolean;
}

export interface StatusSummaryHostViewState {
  serverId: string;
  serverLabel: string;
  state: StatusSummaryQueryState;
  canUseStatusBarSessionPins: boolean;
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
      pinnedSessions: StatusPinnedSession[];
      canUseStatusBarSessionPins: boolean;
      hostSummaries?: StatusBarHostSummary[];
      generatedAt: string;
      isRefreshing: boolean;
    };

export function buildStatusSummaryViewModel(
  state: StatusSummaryQueryState,
  options: { canUseStatusBarSessionPins?: boolean } = {},
): StatusSummaryViewModel {
  if (state.kind === "disabled") {
    if (state.reason === "no-host") {
      return { kind: "hidden", reason: "no-host" };
    }
    if (state.reason === "unsupported") {
      return {
        kind: "unsupported",
        previousSummary: state.previousSummary,
      };
    }
    return {
      kind: "offline",
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
    pinnedSessions: summary.pinnedSessions ?? [],
    canUseStatusBarSessionPins: options.canUseStatusBarSessionPins === true,
    generatedAt: summary.generatedAt,
    isRefreshing: state.isRefreshing,
  };
}

export function buildMultiHostStatusSummaryViewModel(
  hosts: StatusSummaryHostViewState[],
): StatusSummaryViewModel {
  const readyHosts = hosts.filter(
    (
      host,
    ): host is StatusSummaryHostViewState & {
      state: Extract<StatusSummaryQueryState, { kind: "ready" }>;
    } => host.state.kind === "ready",
  );
  if (readyHosts.length > 0) {
    const hostSummaries = readyHosts.map((host) => ({
      serverId: host.serverId,
      serverLabel: host.serverLabel,
      summary: host.state.summary,
      canUseStatusBarSessionPins: host.canUseStatusBarSessionPins,
    }));
    const summary = aggregateHostStatusSummaries(hostSummaries);
    return {
      kind: "ready",
      summary,
      primaryRows: buildPrimaryRows(summary),
      runningAgents: summary.activity.runningAgents,
      needsAttentionAgents: summary.activity.needsAttentionAgents,
      recentlyCompletedAgents: summary.activity.recentlyCompletedAgents,
      pinnedSessions: summary.pinnedSessions ?? [],
      canUseStatusBarSessionPins:
        hostSummaries.length === 1 && hostSummaries[0]?.canUseStatusBarSessionPins === true,
      hostSummaries,
      generatedAt: summary.generatedAt,
      isRefreshing: readyHosts.some((host) => host.state.isRefreshing),
    };
  }
  if (hosts.length === 0) {
    return { kind: "hidden", reason: "no-host" };
  }
  if (hosts.some((host) => host.state.kind === "loading")) {
    return { kind: "loading" };
  }
  const error = hosts.find((host) => host.state.kind === "error")?.state;
  if (error?.kind === "error") {
    return { kind: "error", message: error.message };
  }
  if (
    hosts.every((host) => host.state.kind === "disabled" && host.state.reason === "unsupported")
  ) {
    return { kind: "unsupported" };
  }
  return { kind: "offline" };
}

export function aggregateHostStatusSummaries(
  hosts: StatusBarHostSummary[],
): HostStatusSummaryPayload {
  const summaries = hosts.map((host) => host.summary);
  const firstSummary = summaries[0];
  if (!firstSummary) {
    throw new Error("At least one host summary is required");
  }
  const generatedAt = summaries.reduce(
    (latest, summary) => (summary.generatedAt > latest ? summary.generatedAt : latest),
    firstSummary.generatedAt,
  );
  const windowStart = summaries.reduce(
    (earliest, summary) =>
      summary.usage.today.windowStart < earliest ? summary.usage.today.windowStart : earliest,
    firstSummary.usage.today.windowStart,
  );
  const windowEnds = summaries
    .map((summary) => summary.usage.today.windowEnd)
    .filter((windowEnd): windowEnd is string => typeof windowEnd === "string");

  return {
    generatedAt,
    usage: {
      lifetime: sumUsageTotals(summaries.map((summary) => summary.usage.lifetime)),
      today: {
        ...sumUsageTotals(summaries.map((summary) => summary.usage.today)),
        windowStart,
        windowEnd: windowEnds.length > 0 ? (windowEnds.sort().at(-1) ?? null) : null,
      },
      byProvider: [],
      byModel: [],
    },
    activity: {
      runningAgents: summaries.flatMap((summary) => summary.activity.runningAgents),
      needsAttentionAgents: summaries.flatMap((summary) => summary.activity.needsAttentionAgents),
      recentlyCompletedAgents: summaries.flatMap(
        (summary) => summary.activity.recentlyCompletedAgents,
      ),
      counts: {
        running: sumNumbers(summaries.map((summary) => summary.activity.counts.running)),
        needsAttention: sumNumbers(
          summaries.map((summary) => summary.activity.counts.needsAttention),
        ),
        idle: sumNumbers(summaries.map((summary) => summary.activity.counts.idle)),
        error: sumNumbers(summaries.map((summary) => summary.activity.counts.error)),
      },
    },
    pinnedSessions: summaries.length === 1 ? (firstSummary.pinnedSessions ?? []) : [],
  };
}

function sumUsageTotals(totals: StatusSummaryUsageTotals[]): StatusSummaryUsageTotals {
  return {
    inputTokens: sumOptionalNumbers(totals.map((total) => total.inputTokens)),
    cachedInputTokens: sumOptionalNumbers(totals.map((total) => total.cachedInputTokens)),
    outputTokens: sumOptionalNumbers(totals.map((total) => total.outputTokens)),
    totalCostUsd: sumOptionalNumbers(totals.map((total) => total.totalCostUsd)),
    totalTokens: sumNumbers(totals.map((total) => total.totalTokens)),
  };
}

function sumOptionalNumbers(values: Array<number | undefined>): number | undefined {
  const definedValues = values.filter((value): value is number => value !== undefined);
  return definedValues.length > 0 ? sumNumbers(definedValues) : undefined;
}

function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function buildPrimaryRows(summary: HostStatusSummaryPayload): StatusBarRow[] {
  const rows: StatusBarRow[] = [
    {
      id: "lifetime-tokens",
      label: "Total tokens",
      value: formatTokenCount(summary.usage.lifetime.totalTokens),
      tone: "default",
    },
  ];

  const todayCost = summary.usage.today.totalCostUsd;
  const lifetimeCost = summary.usage.lifetime.totalCostUsd;
  const cost = todayCost ?? lifetimeCost;
  rows.push({
    id: "cost",
    label: todayCost === undefined && lifetimeCost !== undefined ? "Total cost" : "Today cost",
    value: formatCost(cost),
    tone: cost === undefined ? "default" : "ok",
    ...(cost !== undefined
      ? {
          details: [
            { label: "Today", value: formatCost(todayCost) },
            { label: "Total", value: formatCost(lifetimeCost) },
          ],
        }
      : {}),
  });

  rows.push(
    {
      id: "today-tokens",
      label: "Today",
      value: formatTokenCount(summary.usage.today.totalTokens),
      tone: "default",
    },
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
  if (value >= 100_000_000) {
    return formatChineseUnit(value, 100_000_000, "亿");
  }
  if (value >= 10_000_000) {
    return formatChineseUnit(value, 10_000_000, "千万");
  }
  if (value >= 10_000) {
    return formatChineseUnit(value, 10_000, "万");
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

function formatChineseUnit(value: number, unitValue: number, suffix: string): string {
  const scaled = value / unitValue;
  const maximumFractionDigits = scaled >= 10 ? 0 : 1;
  const formatted = new Intl.NumberFormat("zh-CN", {
    useGrouping: false,
    maximumFractionDigits,
  }).format(scaled);
  return `${formatted}${suffix}`;
}
