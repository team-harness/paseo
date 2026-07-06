import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import { applyStatusSummaryUpdate } from "@/status-summary/push";
import {
  refreshStatusSummary,
  shouldRefreshStatusSummary,
  statusSummaryQueryKey,
  type StatusSummaryClient,
} from "@/status-summary/query-core";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { patchWorkspaceScripts } from "./session-workspace-scripts";

function workspace(input: {
  id: string;
  workspaceDirectory?: string;
  scripts?: WorkspaceDescriptor["scripts"];
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: "project-1",
    projectDisplayName: "Project 1",
    projectRootPath: "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo/main",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "main",
    status: "running",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: input.scripts ?? [],
  };
}

const runningScript: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  hostname: "web.paseo.localhost",
  port: 3000,
  proxyUrl: "http://web.paseo.localhost:6767",
  lifecycle: "running",
  health: "healthy",
  exitCode: null,
  terminalId: null,
};

describe("patchWorkspaceScripts", () => {
  it("patches only the matching workspace scripts", () => {
    const other = workspace({ id: "ws-other", workspaceDirectory: "/repo/other", scripts: [] });
    const current = new Map<string, WorkspaceDescriptor>([
      ["ws-main", workspace({ id: "ws-main", workspaceDirectory: "/repo/main", scripts: [] })],
      [other.id, other],
    ]);

    const next = patchWorkspaceScripts(current, {
      workspaceId: "ws-main",
      scripts: [runningScript],
    });

    expect(next).not.toBe(current);
    expect(next.get("ws-main")?.scripts).toEqual([runningScript]);
    expect(next.get("ws-other")).toBe(other);
  });

  it("patches the matching workspace when the map key differs from the workspace id", () => {
    const current = new Map<string, WorkspaceDescriptor>([
      [
        "workspace-record-42",
        workspace({
          id: "ws-main",
          workspaceDirectory: "C:\\repo\\main\\",
          scripts: [],
        }),
      ],
    ]);

    const next = patchWorkspaceScripts(current, {
      workspaceId: "ws-main",
      scripts: [runningScript],
    });

    expect(next).not.toBe(current);
    expect(next.get("workspace-record-42")?.scripts).toEqual([runningScript]);
  });

  it("ignores updates for unknown workspaces", () => {
    const current = new Map<string, WorkspaceDescriptor>([
      ["ws-main", workspace({ id: "ws-main", workspaceDirectory: "/repo/main", scripts: [] })],
    ]);

    const next = patchWorkspaceScripts(current, {
      workspaceId: "ws-missing",
      scripts: [runningScript],
    });

    expect(next).toBe(current);
    expect(next.get("ws-main")?.scripts).toEqual([]);
  });
});

function statusSummary(generatedAt: string): HostStatusSummaryPayload {
  return {
    generatedAt,
    usage: {
      lifetime: { totalTokens: 10 },
      today: {
        totalTokens: 5,
        windowStart: "2026-07-06T00:00:00.000Z",
        windowEnd: generatedAt,
      },
      byProvider: [],
      byModel: [],
    },
    activity: {
      runningAgents: [],
      needsAttentionAgents: [],
      recentlyCompletedAgents: [],
      counts: {
        running: 0,
        needsAttention: 0,
        idle: 0,
        error: 0,
      },
    },
  };
}

describe("status-summary SessionProvider service helpers", () => {
  it("refreshes only supported online hosts and writes push snapshots into the same cache", async () => {
    const queryClient = new QueryClient();
    const client: StatusSummaryClient & { calls: number } = {
      calls: 0,
      async getStatusSummary() {
        this.calls += 1;
        return {
          requestId: "status-summary-request",
          summary: statusSummary("2026-07-06T04:00:00.000Z"),
        };
      },
    };

    const refreshInput = {
      serverId: "server-1",
      client,
      isConnected: true,
      supportsStatusSummary: true,
    };
    expect(shouldRefreshStatusSummary(refreshInput)).toBe(true);
    await refreshStatusSummary({ queryClient, serverId: refreshInput.serverId, client });
    expect(client.calls).toBe(1);
    expect(queryClient.getQueryData(statusSummaryQueryKey("server-1"))).toEqual(
      statusSummary("2026-07-06T04:00:00.000Z"),
    );

    applyStatusSummaryUpdate({
      serverId: "server-1",
      queryClient,
      message: {
        type: "status.summary.updated",
        payload: statusSummary("2026-07-06T04:05:00.000Z"),
      },
    });
    expect(queryClient.getQueryData(statusSummaryQueryKey("server-1"))).toEqual(
      statusSummary("2026-07-06T04:05:00.000Z"),
    );

    expect(
      shouldRefreshStatusSummary({
        ...refreshInput,
        supportsStatusSummary: false,
      }),
    ).toBe(false);
  });
});
