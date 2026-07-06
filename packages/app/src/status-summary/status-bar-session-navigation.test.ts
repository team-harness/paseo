import { describe, expect, it, vi } from "vitest";
import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: vi.fn(),
}));

vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: vi.fn(),
}));

import {
  buildStatusBarSessionList,
  navigateToStatusBarSession,
  type StatusBarSessionListItem,
} from "./status-bar-session-navigation";

function snapshot(input: Partial<StatusAgentSnapshot> & { agentId: string }): StatusAgentSnapshot {
  return {
    agentId: input.agentId,
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? `/work/${input.agentId}`,
    workspaceId: input.workspaceId,
    title: input.title ?? input.agentId,
    status: input.status ?? "running",
    stateBucket: input.stateBucket ?? "running",
    updatedAt: input.updatedAt ?? "2026-07-06T04:00:00.000Z",
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp,
    parentAgentId: input.parentAgentId,
  };
}

describe("status bar session navigation", () => {
  it("groups and dedupes snapshots by attention, running, then recent priority", () => {
    const items = buildStatusBarSessionList({
      serverId: "server-1",
      needsAttentionAgents: [snapshot({ agentId: "agent-1", workspaceId: "workspace-1" })],
      runningAgents: [
        snapshot({ agentId: "agent-1", workspaceId: "workspace-1" }),
        snapshot({ agentId: "agent-2", workspaceId: "workspace-2" }),
      ],
      recentlyCompletedAgents: [
        snapshot({ agentId: "agent-2", workspaceId: "workspace-2" }),
        snapshot({ agentId: "agent-3", workspaceId: "workspace-3" }),
      ],
      liveWorkspaceIds: new Set(["workspace-1", "workspace-2", "workspace-3"]),
    });

    expect(items.map((item) => `${item.group}:${item.snapshot.agentId}`)).toEqual([
      "attention:agent-1",
      "running:agent-2",
      "recent:agent-3",
    ]);
  });

  it("builds agent targets while hiding workspace actions for missing or unknown workspaces", () => {
    const items = buildStatusBarSessionList({
      serverId: "server-1",
      needsAttentionAgents: [
        snapshot({ agentId: "agent-known", workspaceId: "workspace-known" }),
        snapshot({ agentId: "agent-missing-workspace" }),
        snapshot({ agentId: "agent-archived-workspace", workspaceId: "workspace-archived" }),
      ],
      runningAgents: [],
      recentlyCompletedAgents: [],
      liveWorkspaceIds: new Set(["workspace-known"]),
    });

    expect(items).toHaveLength(3);
    expect(items[0]?.primaryTarget).toEqual({
      kind: "agent",
      serverId: "server-1",
      agentId: "agent-known",
      workspaceId: "workspace-known",
    });
    expect(items[0]?.workspaceTarget).toEqual({
      kind: "workspace",
      serverId: "server-1",
      workspaceId: "workspace-known",
    });
    expect(items[1]?.primaryTarget.workspaceId).toBeNull();
    expect(items[1]?.workspaceTarget).toBeUndefined();
    expect(items[2]?.primaryTarget.workspaceId).toBe("workspace-archived");
    expect(items[2]?.workspaceTarget).toBeUndefined();
  });

  it("executes agent and workspace navigation through injected helpers", () => {
    const navigateToAgent = vi.fn();
    const navigateToWorkspace = vi.fn();
    const item: StatusBarSessionListItem = buildStatusBarSessionList({
      serverId: "server-1",
      needsAttentionAgents: [snapshot({ agentId: "agent-1", workspaceId: "workspace-1" })],
      runningAgents: [],
      recentlyCompletedAgents: [],
      liveWorkspaceIds: new Set(["workspace-1"]),
    })[0]!;

    navigateToStatusBarSession(item.primaryTarget, {
      navigateToAgent,
      navigateToWorkspace,
    });
    navigateToStatusBarSession(item.workspaceTarget!, {
      navigateToAgent,
      navigateToWorkspace,
    });

    expect(navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
    });
    expect(navigateToWorkspace).toHaveBeenCalledWith("server-1", "workspace-1");
  });
});
