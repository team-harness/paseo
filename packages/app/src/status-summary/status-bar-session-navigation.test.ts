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

  it("folds descendant activity into its top-level agent", () => {
    const items = buildStatusBarSessionList({
      serverId: "server-1",
      needsAttentionAgents: [
        snapshot({
          agentId: "grandchild",
          parentAgentId: "child",
          attentionReason: "permission",
        }),
      ],
      runningAgents: [
        snapshot({ agentId: "child", parentAgentId: "parent" }),
        snapshot({ agentId: "independent" }),
      ],
      recentlyCompletedAgents: [],
      liveWorkspaceIds: new Set(["workspace-parent", "workspace-independent"]),
      agentHierarchy: new Map([
        [
          "parent",
          {
            agentId: "parent",
            parentAgentId: null,
            provider: "codex",
            cwd: "/work/parent",
            workspaceId: "workspace-parent",
            title: "Parent agent",
          },
        ],
        [
          "child",
          {
            agentId: "child",
            parentAgentId: "parent",
            provider: "codex",
            cwd: "/work/child",
            workspaceId: "workspace-parent",
            title: "Child agent",
          },
        ],
      ]),
    });

    expect(items.map((item) => `${item.group}:${item.snapshot.agentId}`)).toEqual([
      "attention:parent",
      "running:independent",
    ]);
    expect(items[0]?.snapshot).toMatchObject({
      agentId: "parent",
      title: "Parent agent",
      attentionReason: "permission",
    });
    expect(items[0]?.primaryTarget).toEqual({
      kind: "agent",
      serverId: "server-1",
      agentId: "parent",
      workspaceId: "workspace-parent",
    });
  });

  it("keeps sessions with the same agent id on different hosts", () => {
    const first = buildStatusBarSessionList({
      serverId: "host-1",
      serverLabel: "MacBook Pro",
      needsAttentionAgents: [],
      runningAgents: [snapshot({ agentId: "shared-agent" })],
      recentlyCompletedAgents: [],
      liveWorkspaceIds: new Set(),
    });
    const second = buildStatusBarSessionList({
      serverId: "host-2",
      serverLabel: "Build host",
      needsAttentionAgents: [],
      runningAgents: [snapshot({ agentId: "shared-agent" })],
      recentlyCompletedAgents: [],
      liveWorkspaceIds: new Set(),
    });

    expect([...first, ...second].map((item) => [item.key, item.serverLabel])).toEqual([
      ["host-1:running:shared-agent", "MacBook Pro"],
      ["host-2:running:shared-agent", "Build host"],
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
