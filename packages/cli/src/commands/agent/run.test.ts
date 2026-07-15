import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRunWorkspace, runRunCommand, type AgentRunOptions } from "./run";

// validateRunOptions runs before the CLI ever connects to a daemon, so these
// invalid combinations reject without one running.
describe("runRunCommand option validation", () => {
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function expectInvalidOptions(options: AgentRunOptions, messageMatch: RegExp) {
    await expect(runRunCommand("do something", options, {} as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
      message: expect.stringMatching(messageMatch),
    });
  }

  it("rejects --worktree combined with --workspace", async () => {
    await expectInvalidOptions(
      { worktree: "feat", workspace: "ws-1" },
      /--worktree and --workspace cannot be combined/,
    );
  });

  it("rejects --worktree combined with an ambient PASEO_WORKSPACE_ID", async () => {
    process.env.PASEO_WORKSPACE_ID = "ws-ambient";
    await expectInvalidOptions(
      { worktree: "feat" },
      /--worktree cannot be combined with an ambient PASEO_WORKSPACE_ID/,
    );
  });

  it("allows a bare --worktree through validation when no workspace is selected", async () => {
    // A bare --worktree with no --workspace and no ambient PASEO_WORKSPACE_ID
    // must clear validation. It still fails later (provider resolution), which
    // is enough to prove the new guard did not reject it.
    await expect(
      runRunCommand("do something", { worktree: "feat", provider: undefined }, {} as never),
    ).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
  });
});

describe("resolveRunWorkspace current agent inheritance", () => {
  const originalAgentId = process.env.PASEO_AGENT_ID;
  const originalHost = process.env.PASEO_HOST;
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;
  const supportedServerInfo = () => ({
    features: { agentWorkspaceInheritance: true },
  });

  beforeEach(() => {
    delete process.env.PASEO_AGENT_ID;
    delete process.env.PASEO_HOST;
    delete process.env.PASEO_WORKSPACE_ID;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAgentId === undefined) {
      delete process.env.PASEO_AGENT_ID;
    } else {
      process.env.PASEO_AGENT_ID = originalAgentId;
    }
    if (originalHost === undefined) {
      delete process.env.PASEO_HOST;
    } else {
      process.env.PASEO_HOST = originalHost;
    }
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  it("reuses the current agent workspace without creating a new record", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn().mockResolvedValue({
      agent: { workspaceId: "wks-parent" },
      project: {},
    });
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "wks-parent" }],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        {
          getLastServerInfoMessage: supportedServerInfo,
          fetchAgent,
          fetchWorkspaces,
          createWorkspace,
        } as never,
        {},
        "/repo",
      ),
    ).resolves.toEqual({ id: "wks-parent", cwd: "/repo" });
    expect(fetchAgent).toHaveBeenCalledWith({ agentId: "parent-agent" });
    expect(fetchWorkspaces).toHaveBeenCalledWith({ page: { limit: 200 } });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("keeps an ambient workspace ahead of current agent inheritance", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    process.env.PASEO_WORKSPACE_ID = "wks-ambient";
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace({ fetchAgent, createWorkspace } as never, {}, "/repo"),
    ).resolves.toEqual({ id: "wks-ambient", cwd: "/repo" });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("keeps an explicit workspace ahead of current agent inheritance", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        { fetchAgent, createWorkspace } as never,
        { workspace: "wks-explicit" },
        "/repo",
      ),
    ).resolves.toEqual({ id: "wks-explicit", cwd: "/repo" });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("normalizes a current agent lookup rejection", async () => {
    process.env.PASEO_AGENT_ID = "missing-agent";
    const fetchAgent = vi.fn().mockRejectedValue(new Error("Agent not found"));
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        { getLastServerInfoMessage: supportedServerInfo, fetchAgent, createWorkspace } as never,
        {},
        "/repo",
      ),
    ).rejects.toMatchObject({
      code: "CURRENT_AGENT_WORKSPACE_UNAVAILABLE",
      details: expect.stringContaining("Agent not found"),
    });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("requires a daemon that advertises active workspace inheritance", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        {
          getLastServerInfoMessage: () => ({ features: {} }),
          fetchAgent,
          createWorkspace,
        } as never,
        {},
        "/repo",
      ),
    ).rejects.toMatchObject({
      code: "CURRENT_AGENT_WORKSPACE_UNSUPPORTED",
      details: expect.stringContaining("Update the host"),
    });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("confirms an inherited workspace when project placement is omitted", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn().mockResolvedValue({
      agent: { workspaceId: "wks-parent" },
      project: null,
    });
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "wks-parent" }],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        {
          getLastServerInfoMessage: supportedServerInfo,
          fetchAgent,
          fetchWorkspaces,
          createWorkspace,
        } as never,
        {},
        "/repo",
      ),
    ).resolves.toEqual({ id: "wks-parent", cwd: "/repo" });
    expect(fetchWorkspaces).toHaveBeenCalledWith({ page: { limit: 200 } });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("rejects an inherited workspace id that is not active", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn().mockResolvedValue({
      agent: { workspaceId: "wks-missing" },
      project: {},
    });
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        {
          getLastServerInfoMessage: supportedServerInfo,
          fetchAgent,
          fetchWorkspaces,
          createWorkspace,
        } as never,
        {},
        "/repo",
      ),
    ).rejects.toMatchObject({ code: "CURRENT_AGENT_WORKSPACE_UNAVAILABLE" });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("rejects an archived current agent", async () => {
    process.env.PASEO_AGENT_ID = "archived-agent";
    const fetchAgent = vi.fn().mockResolvedValue({
      agent: { workspaceId: "wks-parent", archivedAt: "2026-07-15T00:00:00.000Z" },
      project: {},
    });
    const fetchWorkspaces = vi.fn();
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        {
          getLastServerInfoMessage: supportedServerInfo,
          fetchAgent,
          fetchWorkspaces,
          createWorkspace,
        } as never,
        {},
        "/repo",
      ),
    ).rejects.toMatchObject({ code: "CURRENT_AGENT_WORKSPACE_UNAVAILABLE" });
    expect(fetchWorkspaces).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("fails instead of minting a workspace when the current agent has no workspace", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn().mockResolvedValue({
      agent: { workspaceId: undefined },
    });
    const createWorkspace = vi.fn();

    await expect(
      resolveRunWorkspace(
        { getLastServerInfoMessage: supportedServerInfo, fetchAgent, createWorkspace } as never,
        {},
        "/repo",
      ),
    ).rejects.toMatchObject({ code: "CURRENT_AGENT_WORKSPACE_UNAVAILABLE" });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("keeps explicit worktree creation ahead of current agent inheritance", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn().mockResolvedValue({
      workspace: {
        id: "wks-worktree",
        name: "review",
        workspaceDirectory: "/repo-review",
        gitRuntime: { currentBranch: "review" },
      },
    });

    await expect(
      resolveRunWorkspace(
        { fetchAgent, createWorkspace } as never,
        { worktree: "review" },
        "/repo",
      ),
    ).resolves.toEqual({ id: "wks-worktree", cwd: "/repo-review" });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).toHaveBeenCalledWith({
      source: {
        kind: "worktree",
        cwd: "/repo",
        worktreeSlug: "review",
        baseBranch: undefined,
      },
    });
  });

  it("keeps external bare runs creating an independent directory workspace", async () => {
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn().mockResolvedValue({
      workspace: {
        id: "wks-new",
        name: "main",
        workspaceDirectory: "/repo",
        gitRuntime: { currentBranch: "main" },
      },
    });

    await expect(
      resolveRunWorkspace({ fetchAgent, createWorkspace } as never, {}, "/repo"),
    ).resolves.toEqual({ id: "wks-new", cwd: "/repo" });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).toHaveBeenCalledWith({
      source: { kind: "directory", path: "/repo" },
    });
  });

  it("does not inherit a local agent workspace when targeting another host", async () => {
    process.env.PASEO_AGENT_ID = "local-parent-agent";
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn().mockResolvedValue({
      workspace: {
        id: "wks-remote",
        name: "main",
        workspaceDirectory: "/repo",
        gitRuntime: { currentBranch: "main" },
      },
    });

    await expect(
      resolveRunWorkspace(
        { fetchAgent, createWorkspace } as never,
        { host: "remote.example:6767" },
        "/repo",
      ),
    ).resolves.toEqual({ id: "wks-remote", cwd: "/repo" });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).toHaveBeenCalledWith({
      source: { kind: "directory", path: "/repo" },
    });
  });

  it("does not inherit a local agent workspace when PASEO_HOST targets another daemon", async () => {
    process.env.PASEO_AGENT_ID = "local-parent-agent";
    process.env.PASEO_HOST = "remote.example:6767";
    const fetchAgent = vi.fn();
    const createWorkspace = vi.fn().mockResolvedValue({
      workspace: {
        id: "wks-remote",
        name: "main",
        workspaceDirectory: "/repo",
        gitRuntime: { currentBranch: "main" },
      },
    });

    await expect(
      resolveRunWorkspace({ fetchAgent, createWorkspace } as never, {}, "/repo"),
    ).resolves.toEqual({ id: "wks-remote", cwd: "/repo" });
    expect(fetchAgent).not.toHaveBeenCalled();
    expect(createWorkspace).toHaveBeenCalledWith({
      source: { kind: "directory", path: "/repo" },
    });
  });
});
