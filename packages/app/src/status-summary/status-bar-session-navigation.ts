import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import { navigateToWorkspace as defaultNavigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  navigateToAgent as defaultNavigateToAgent,
  type NavigateToAgentInput,
} from "@/utils/navigate-to-agent";

export type StatusBarSessionGroupKind = "attention" | "running" | "recent";

export interface StatusBarAgentTarget {
  kind: "agent";
  serverId: string;
  agentId: string;
  workspaceId: string | null;
}

export interface StatusBarWorkspaceTarget {
  kind: "workspace";
  serverId: string;
  workspaceId: string;
}

export type StatusBarSessionTarget = StatusBarAgentTarget | StatusBarWorkspaceTarget;

export interface StatusBarSessionListItem {
  key: string;
  group: StatusBarSessionGroupKind;
  serverLabel?: string;
  snapshot: StatusAgentSnapshot;
  primaryTarget: StatusBarAgentTarget;
  workspaceTarget?: StatusBarWorkspaceTarget;
}

export interface StatusBarSessionIdentity {
  agentId: string;
  parentAgentId: string | null;
  provider: StatusAgentSnapshot["provider"];
  cwd: string;
  workspaceId: string | null;
  title: string | null;
}

export interface BuildStatusBarSessionListInput {
  serverId: string;
  serverLabel?: string;
  needsAttentionAgents: StatusAgentSnapshot[];
  runningAgents: StatusAgentSnapshot[];
  recentlyCompletedAgents: StatusAgentSnapshot[];
  liveWorkspaceIds: ReadonlySet<string>;
  agentHierarchy?: ReadonlyMap<string, StatusBarSessionIdentity>;
}

export function buildStatusBarSessionList(
  input: BuildStatusBarSessionListInput,
): StatusBarSessionListItem[] {
  const snapshotsByAgentId = createActivitySnapshotIndex(input);
  const seen = new Set<string>();
  const items: StatusBarSessionListItem[] = [];

  const appendGroup = (group: StatusBarSessionGroupKind, snapshots: StatusAgentSnapshot[]) => {
    for (const snapshot of snapshots) {
      const topLevelAgentId = findTopLevelAgentId(
        snapshot,
        snapshotsByAgentId,
        input.agentHierarchy,
      );
      if (seen.has(topLevelAgentId)) {
        continue;
      }
      seen.add(topLevelAgentId);
      const topLevelSnapshot = toTopLevelSnapshot({
        snapshot,
        topLevelAgentId,
        snapshotsByAgentId,
        agentHierarchy: input.agentHierarchy,
      });
      const workspaceId = normalizeWorkspaceId(topLevelSnapshot.workspaceId);
      items.push({
        key: `${input.serverId}:${group}:${topLevelSnapshot.agentId}`,
        group,
        serverLabel: input.serverLabel,
        snapshot: topLevelSnapshot,
        primaryTarget: {
          kind: "agent",
          serverId: input.serverId,
          agentId: topLevelSnapshot.agentId,
          workspaceId,
        },
        workspaceTarget:
          workspaceId && input.liveWorkspaceIds.has(workspaceId)
            ? {
                kind: "workspace",
                serverId: input.serverId,
                workspaceId,
              }
            : undefined,
      });
    }
  };

  appendGroup("attention", sortAttentionSnapshots(input.needsAttentionAgents));
  appendGroup("running", input.runningAgents);
  appendGroup("recent", input.recentlyCompletedAgents);

  return items;
}

function createActivitySnapshotIndex(
  input: BuildStatusBarSessionListInput,
): ReadonlyMap<string, StatusAgentSnapshot> {
  const snapshotsByAgentId = new Map<string, StatusAgentSnapshot>();
  for (const snapshots of [
    sortAttentionSnapshots(input.needsAttentionAgents),
    input.runningAgents,
    input.recentlyCompletedAgents,
  ]) {
    for (const snapshot of snapshots) {
      if (!snapshotsByAgentId.has(snapshot.agentId)) {
        snapshotsByAgentId.set(snapshot.agentId, snapshot);
      }
    }
  }
  return snapshotsByAgentId;
}

function findTopLevelAgentId(
  snapshot: StatusAgentSnapshot,
  snapshotsByAgentId: ReadonlyMap<string, StatusAgentSnapshot>,
  agentHierarchy: ReadonlyMap<string, StatusBarSessionIdentity> | undefined,
): string {
  const visitedAgentIds = new Set([snapshot.agentId]);
  let topLevelAgentId = snapshot.agentId;
  let parentAgentId = snapshot.parentAgentId;

  while (parentAgentId && !visitedAgentIds.has(parentAgentId)) {
    const parent = snapshotsByAgentId.get(parentAgentId) ?? agentHierarchy?.get(parentAgentId);
    if (!parent) {
      break;
    }
    visitedAgentIds.add(parentAgentId);
    topLevelAgentId = parent.agentId;
    parentAgentId = parent.parentAgentId;
  }

  return topLevelAgentId;
}

function toTopLevelSnapshot({
  snapshot,
  topLevelAgentId,
  snapshotsByAgentId,
  agentHierarchy,
}: {
  snapshot: StatusAgentSnapshot;
  topLevelAgentId: string;
  snapshotsByAgentId: ReadonlyMap<string, StatusAgentSnapshot>;
  agentHierarchy: ReadonlyMap<string, StatusBarSessionIdentity> | undefined;
}): StatusAgentSnapshot {
  const topLevelAgent =
    snapshotsByAgentId.get(topLevelAgentId) ?? agentHierarchy?.get(topLevelAgentId);
  if (!topLevelAgent || topLevelAgent.agentId === snapshot.agentId) {
    return snapshot;
  }
  return {
    ...snapshot,
    agentId: topLevelAgent.agentId,
    provider: topLevelAgent.provider,
    cwd: topLevelAgent.cwd,
    workspaceId: topLevelAgent.workspaceId,
    title: topLevelAgent.title,
    parentAgentId: null,
  };
}

export interface NavigateToStatusBarSessionDeps {
  navigateToAgent?: (input: NavigateToAgentInput) => unknown;
  navigateToWorkspace?: (serverId: string, workspaceId: string) => unknown;
}

export function navigateToStatusBarSession(
  target: StatusBarSessionTarget,
  deps: NavigateToStatusBarSessionDeps = {},
): void {
  if (target.kind === "agent") {
    const navigateToAgent = deps.navigateToAgent ?? defaultNavigateToAgent;
    navigateToAgent({
      serverId: target.serverId,
      agentId: target.agentId,
      workspaceId: target.workspaceId,
    });
    return;
  }

  const navigateToWorkspace = deps.navigateToWorkspace ?? defaultNavigateToWorkspace;
  navigateToWorkspace(target.serverId, target.workspaceId);
}

function normalizeWorkspaceId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sortAttentionSnapshots(snapshots: StatusAgentSnapshot[]): StatusAgentSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const priorityDelta = attentionPriority(a) - attentionPriority(b);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return timestampForAttentionSort(b) - timestampForAttentionSort(a);
  });
}

function attentionPriority(snapshot: StatusAgentSnapshot): number {
  if (snapshot.attentionReason === "permission") return 0;
  if (snapshot.attentionReason === "error" || snapshot.status === "error") return 1;
  if (snapshot.attentionReason === "finished") return 2;
  return 3;
}

function timestampForAttentionSort(snapshot: StatusAgentSnapshot): number {
  const timestamp = Date.parse(snapshot.attentionTimestamp ?? snapshot.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
