import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { formatTimeAgo } from "@/utils/time";
import type { StatusBarSessionGroupKind } from "./status-bar-session-navigation";

export function getStatusBarSessionGroupLabel(group: StatusBarSessionGroupKind): string {
  if (group === "attention") return "Needs attention";
  if (group === "running") return "Running";
  return "Recent";
}

export function formatStatusBarSessionTitle(snapshot: StatusAgentSnapshot): string {
  const title = snapshot.title?.trim();
  if (title) return title;
  return snapshot.cwd.trim() || snapshot.agentId;
}

export function formatStatusBarSessionSubtitle(snapshot: StatusAgentSnapshot): string {
  const cwd = formatCwd(snapshot.cwd);
  const provider = snapshot.provider;
  return cwd ? `${provider} · ${cwd}` : provider;
}

export function formatStatusBarSessionMeta(snapshot: StatusAgentSnapshot): string {
  const updatedAt = Date.parse(snapshot.updatedAt);
  if (Number.isFinite(updatedAt)) {
    return formatTimeAgo(new Date(updatedAt));
  }
  return "recently";
}

export function formatStatusBarSessionUsage(snapshot: StatusAgentSnapshot): string | null {
  const usage = "lastUsage" in snapshot ? snapshot.lastUsage : undefined;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const totalTokens =
    readNumberField(usage, "totalTokens") ??
    sumDefinedNumbers(
      readNumberField(usage, "inputTokens"),
      readNumberField(usage, "outputTokens"),
    );
  if (totalTokens == null) {
    return null;
  }
  return `${formatTokenCount(totalTokens)} tokens`;
}

function formatCwd(cwd: string): string {
  const normalized = cwd.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  const segments = normalized.split("/");
  const lastSegment = segments.findLast(Boolean);
  return lastSegment ?? normalized;
}

function readNumberField(value: object, field: string): number | undefined {
  const record = value as Record<string, unknown>;
  const next = record[field];
  return typeof next === "number" && Number.isFinite(next) ? next : undefined;
}

function sumDefinedNumbers(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) {
    return undefined;
  }
  return defined.reduce((total, value) => total + value, 0);
}
