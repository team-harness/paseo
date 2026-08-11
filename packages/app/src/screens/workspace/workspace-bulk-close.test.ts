import { describe, expect, it, vi } from "vitest";
import {
  buildBulkCloseConfirmationMessage,
  classifyBulkClosableTabs,
  closeBulkWorkspaceTabs,
} from "@/screens/workspace/workspace-bulk-close";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function makeAgentTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `agent_${id}`,
    tabId: `agent_${id}`,
    kind: "agent",
    target: { kind: "agent", agentId: id },
  };
}

function makeTerminalTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `terminal_${id}`,
    tabId: `terminal_${id}`,
    kind: "terminal",
    target: { kind: "terminal", terminalId: id },
  };
}

function makeFileTab(path: string): WorkspaceTabDescriptor {
  return {
    key: `file_${path}`,
    tabId: `file_${path}`,
    kind: "file",
    target: { kind: "file", path },
  };
}

function makeTeamTab(teamId: string): WorkspaceTabDescriptor {
  return {
    key: `team_${teamId}`,
    tabId: `team_${teamId}`,
    kind: "team",
    target: { kind: "team", teamId },
  };
}

describe("workspace bulk close helpers", () => {
  it("classifies agent, terminal, and passive tabs for shared bulk close handling", () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);

    expect(groups).toEqual({
      agentTabs: [{ tabId: "agent_a1", agentId: "a1" }],
      terminalTabs: [{ tabId: "terminal_t1", terminalId: "t1" }],
      otherTabs: [
        {
          tabId: "file_/repo/README.md",
          target: { kind: "file", path: "/repo/README.md" },
        },
      ],
    });
  });

  it("routes an agent that does not archive on close away from the archive batch", () => {
    // Bulk close asks the same policy question as single close. Team and
    // delegated Agent tabs are views, so they remain layout-only here too.
    const groups = classifyBulkClosableTabs(
      [makeAgentTab("lead-1"), makeAgentTab("solo-1")],
      (agentId) => agentId !== "lead-1",
    );

    expect(groups.agentTabs).toEqual([{ tabId: "agent_solo-1", agentId: "solo-1" }]);
    expect(groups.otherTabs).toEqual([
      { tabId: "agent_lead-1", target: { kind: "agent", agentId: "lead-1" } },
    ]);
  });

  it("keeps archiving every agent when nothing objects", () => {
    const groups = classifyBulkClosableTabs([makeAgentTab("a1")]);

    expect(groups.agentTabs).toEqual([{ tabId: "agent_a1", agentId: "a1" }]);
    expect(groups.otherTabs).toEqual([]);
  });

  it("always treats a Team tab as layout-only", () => {
    const groups = classifyBulkClosableTabs([makeTeamTab("team-a")]);

    expect(groups.agentTabs).toEqual([]);
    expect(groups.terminalTabs).toEqual([]);
    expect(groups.otherTabs).toEqual([
      { tabId: "team_team-a", target: { kind: "team", teamId: "team-a" } },
    ]);
  });

  it("describes mixed destructive bulk close operations in the confirmation copy", () => {
    const message = buildBulkCloseConfirmationMessage(
      classifyBulkClosableTabs([
        makeAgentTab("a1"),
        makeAgentTab("a2"),
        makeTerminalTab("t1"),
        makeFileTab("/repo/README.md"),
      ]),
    );

    expect(message).toBe(
      "This will archive 2 agent(s), close 1 terminal(s), and close 1 tab(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("keeps terminal-only confirmations explicit about stopping running processes", () => {
    const message = buildBulkCloseConfirmationMessage(
      classifyBulkClosableTabs([makeTerminalTab("t1")]),
    );

    expect(message).toBe(
      "This will close 1 terminal(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("closes all tabs immediately and fires one mixed closeItems RPC in the background", async () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeTerminalTab("t2"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const closeItems = vi.fn(async () => ({
      agents: [{ agentId: "a1", archivedAt: "2026-04-01T04:00:00.000Z" }],
      terminals: [
        { terminalId: "t1", success: true },
        { terminalId: "t2", success: false },
      ],
      requestId: "req-1",
    }));

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeItems },
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      logLabel: "all tabs",
    });

    expect(closeItems).toHaveBeenCalledTimes(1);
    expect(closeItems).toHaveBeenCalledWith({
      agentIds: ["a1"],
      terminalIds: ["t1", "t2"],
    });
    expect(closedTabIds).toEqual([
      "agent_a1",
      "terminal_t1",
      "terminal_t2",
      "file_/repo/README.md",
    ]);
    expect(cleanupCalls).toEqual([
      { tabId: "agent_a1", target: { kind: "agent", agentId: "a1" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "terminal_t2", target: { kind: "terminal", terminalId: "t2" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });

  it("still closes all tabs when the mixed closeItems RPC fails", async () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const warn = vi.fn();

    await closeBulkWorkspaceTabs({
      groups,
      client: {
        closeItems: async () => {
          throw new Error("rpc failed");
        },
      },
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      warn,
      logLabel: "others",
    });

    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(closedTabIds).toEqual(["agent_a1", "terminal_t1", "file_/repo/README.md"]);
    expect(cleanupCalls).toEqual([
      { tabId: "agent_a1", target: { kind: "agent", agentId: "a1" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });
});
