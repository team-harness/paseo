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
  snapshot: StatusAgentSnapshot;
  primaryTarget: StatusBarAgentTarget;
  workspaceTarget?: StatusBarWorkspaceTarget;
}

export interface BuildStatusBarSessionListInput {
  serverId: string;
  needsAttentionAgents: StatusAgentSnapshot[];
  runningAgents: StatusAgentSnapshot[];
  recentlyCompletedAgents: StatusAgentSnapshot[];
  liveWorkspaceIds: ReadonlySet<string>;
}

export function buildStatusBarSessionList(
  input: BuildStatusBarSessionListInput,
): StatusBarSessionListItem[] {
  const seen = new Set<string>();
  const items: StatusBarSessionListItem[] = [];

  const appendGroup = (group: StatusBarSessionGroupKind, snapshots: StatusAgentSnapshot[]) => {
    for (const snapshot of snapshots) {
      if (seen.has(snapshot.agentId)) {
        continue;
      }
      seen.add(snapshot.agentId);
      const workspaceId = normalizeWorkspaceId(snapshot.workspaceId);
      items.push({
        key: `${group}:${snapshot.agentId}`,
        group,
        snapshot,
        primaryTarget: {
          kind: "agent",
          serverId: input.serverId,
          agentId: snapshot.agentId,
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

  appendGroup("attention", input.needsAttentionAgents);
  appendGroup("running", input.runningAgents);
  appendGroup("recent", input.recentlyCompletedAgents);

  return items;
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
