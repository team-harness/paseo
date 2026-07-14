/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { StatusSummaryViewModel } from "./view-model";

const { theme, runtimeState, navigationSpies } = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
  return {
    theme: {
      spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16 },
      borderWidth: { 1: 1 },
      borderRadius: { md: 6, full: 999 },
      iconSize: { xs: 12, sm: 14 },
      fontSize: { xs: 11 },
      fontWeight: { normal: "400", medium: "500" },
      opacity: { 50: 0.5 },
      colors: {
        surface1: "#111",
        surface2: "#222",
        border: "#333",
        borderAccent: "#555",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        statusWarning: "#d97706",
        palette: {
          amber: { 500: "#f59e0b" },
          blue: { 500: "#3b82f6" },
          green: { 500: "#22c55e" },
          red: { 500: "#ef4444" },
        },
      },
    },
    runtimeState: {
      compact: false,
      pathname: "/h/server-1",
      liveWorkspaceIds: ["workspace-1"],
      historyAgents: [] as AggregatedAgent[],
      historyInitialLoad: false,
      historyError: false,
      historyRevalidating: false,
      historyOptions: null as { serverId?: string | null; serverIds?: readonly string[] } | null,
      refreshAgent: vi.fn(),
      refreshHistory: vi.fn(),
      setStatusSessionPin: vi.fn(),
      setStatusSessionPinOnServerTwo: vi.fn(),
    },
    navigationSpies: {
      navigateToAgent: vi.fn(),
      navigateToWorkspace: vi.fn(),
    },
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  View: ({ children, testID }: { children?: React.ReactNode; style?: unknown; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Pressable: ({
    children,
    disabled,
    onPress,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    disabled?: boolean;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { "data-testid": testID, disabled, onClick: () => onPress?.(), type: "button" },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme }),
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) => (props: Record<string, unknown>) =>
      React.createElement(Component, props),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "statusBar.sessions.actions.openAgent" ? `Open ${String(options?.title ?? "")}` : key,
  }),
}));

vi.mock("lucide-react-native", () => ({
  ArrowUpRight: () => React.createElement("span", { "data-testid": "arrow-icon" }),
  BriefcaseBusiness: () => React.createElement("span", { "data-testid": "workspace-icon" }),
  CheckCircle2: () => React.createElement("span", { "data-testid": "finished-icon" }),
  CirclePlay: () => React.createElement("span", { "data-testid": "running-icon" }),
  CircleX: () => React.createElement("span", { "data-testid": "error-icon" }),
  FolderGit2: () => React.createElement("span", { "data-testid": "folder-git-icon" }),
  GitBranch: () => React.createElement("span", { "data-testid": "git-branch-icon" }),
  Pin: () => React.createElement("span", { "data-testid": "pin-icon" }),
  PinOff: () => React.createElement("span", { "data-testid": "pin-off-icon" }),
  RefreshCw: () => React.createElement("span", { "data-testid": "refresh-icon" }),
  ShieldQuestion: () => React.createElement("span", { "data-testid": "permission-icon" }),
  TriangleAlert: () => React.createElement("span", { "data-testid": "attention-icon" }),
}));

vi.mock("expo-router", () => ({
  usePathname: () => runtimeState.pathname,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => runtimeState.compact,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        sessions: {
          "server-1": {
            workspaces: new Map(runtimeState.liveWorkspaceIds.map((id) => [id, { id }])),
            client: {
              refreshAgent: runtimeState.refreshAgent,
              setStatusSessionPin: runtimeState.setStatusSessionPin,
            },
          },
          "server-2": {
            workspaces: new Map(),
            client: {
              setStatusSessionPin: runtimeState.setStatusSessionPinOnServerTwo,
            },
          },
        },
      }),
    {
      getState: () => ({
        sessions: {
          "server-1": {
            workspaces: new Map(runtimeState.liveWorkspaceIds.map((id) => [id, { id }])),
            client: {
              refreshAgent: runtimeState.refreshAgent,
              setStatusSessionPin: runtimeState.setStatusSessionPin,
            },
          },
          "server-2": {
            workspaces: new Map(),
            client: {
              setStatusSessionPin: runtimeState.setStatusSessionPinOnServerTwo,
            },
          },
        },
      }),
    },
  ),
}));

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (state: { desktop: { focusModeEnabled: boolean } }) => unknown) =>
    selector({ desktop: { focusModeEnabled: false } }),
}));

vi.mock("./use-status-summary", () => ({
  useGlobalStatusBarView: () => ({ kind: "hidden", reason: "no-host" }),
}));

vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: navigationSpies.navigateToAgent,
}));

vi.mock("@getpaseo/protocol/agent-state-bucket", () => ({
  deriveAgentStateBucket: ({
    attentionReason,
    pendingPermissionCount,
    requiresAttention,
    status,
  }: {
    attentionReason?: string | null;
    pendingPermissionCount?: number;
    requiresAttention?: boolean;
    status: string;
  }) => {
    if ((pendingPermissionCount ?? 0) > 0 || attentionReason === "permission") {
      return "needs_input";
    }
    if (status === "error" || attentionReason === "error") {
      return "failed";
    }
    if (status === "running") {
      return "running";
    }
    if (requiresAttention) {
      return "attention";
    }
    return "done";
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-agent-history", () => ({
  useAgentHistory: (options: { serverId?: string | null; serverIds?: readonly string[] }) => {
    runtimeState.historyOptions = options;
    return {
      agents: runtimeState.historyAgents,
      isInitialLoad: runtimeState.historyInitialLoad,
      isError: runtimeState.historyError,
      isLoading: runtimeState.historyInitialLoad,
      isRevalidating: runtimeState.historyRevalidating,
      hasMore: false,
      isLoadingMore: false,
      refreshAll: runtimeState.refreshHistory,
      loadMore: vi.fn(),
    };
  },
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: navigationSpies.navigateToWorkspace,
  useActiveWorkspaceSelection: () => null,
}));

vi.mock("@/git/use-status-query", () => ({
  useCheckoutStatusQuery: () => ({
    status: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    open,
    onOpenChange,
  }: {
    children?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    React.createElement(
      "div",
      { "data-open": String(open), "data-testid": "dropdown-root" },
      React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
              __open: open,
              __onOpenChange: onOpenChange,
            })
          : child,
      ),
    ),
  DropdownMenuTrigger: ({
    children,
    testID,
    __onOpenChange,
  }: {
    children?: React.ReactNode;
    testID?: string;
    __onOpenChange?: (open: boolean) => void;
  }) =>
    React.createElement(
      "button",
      { "data-testid": testID, onClick: () => __onOpenChange?.(true), type: "button" },
      children,
    ),
  DropdownMenuContent: ({
    children,
    testID,
    __open,
  }: {
    children?: React.ReactNode;
    testID?: string;
    __open?: boolean;
  }) => (__open ? React.createElement("div", { "data-testid": testID }, children) : null),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    children,
    visible,
    onClose,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    onClose?: () => void;
    testID?: string;
  }) =>
    visible
      ? React.createElement(
          "div",
          { "data-testid": testID },
          React.createElement("button", {
            "data-testid": `${testID}-close`,
            onClick: onClose,
            type: "button",
          }),
          children,
        )
      : null,
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { GlobalStatusBar } from "./global-status-bar";

let rafQueue: FrameRequestCallback[] = [];
type ReadyStatusSummaryViewModel = Extract<StatusSummaryViewModel, { kind: "ready" }>;

vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  rafQueue.push(callback);
  return rafQueue.length;
});

function flushAnimationFrames() {
  const queued = rafQueue;
  rafQueue = [];
  queued.forEach((callback, index) => {
    callback(index);
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

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

function historyAgent(input: Partial<AggregatedAgent> & { id: string; offsetMinutes: number }) {
  const lastActivityAt = new Date(Date.UTC(2026, 6, 6, 4, 0 - input.offsetMinutes, 0));
  return {
    id: input.id,
    serverId: input.serverId ?? "server-1",
    serverLabel: input.serverLabel ?? "Host",
    title: input.title ?? input.id,
    status: input.status ?? "idle",
    lastActivityAt,
    cwd: input.cwd ?? `/work/${input.id}`,
    workspaceId: input.workspaceId ?? "workspace-1",
    provider: input.provider ?? "codex",
    pendingPermissionCount: input.pendingPermissionCount ?? 0,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp ?? null,
    archivedAt: input.archivedAt,
    createdAt: input.createdAt ?? lastActivityAt,
    labels: input.labels ?? {},
    projectPlacement: input.projectPlacement,
  } satisfies AggregatedAgent;
}

function readyView(): ReadyStatusSummaryViewModel {
  const running = snapshot({ agentId: "agent-running", workspaceId: "workspace-1" });
  const attention = snapshot({ agentId: "agent-attention", workspaceId: "workspace-1" });
  return {
    kind: "ready",
    summary: {
      generatedAt: "2026-07-06T04:00:00.000Z",
      usage: {
        lifetime: { totalTokens: 1500 },
        today: {
          totalTokens: 250,
          windowStart: "2026-07-06T00:00:00.000Z",
          windowEnd: "2026-07-06T04:00:00.000Z",
        },
        byProvider: [],
        byModel: [],
      },
      activity: {
        runningAgents: [running],
        needsAttentionAgents: [attention],
        recentlyCompletedAgents: [],
        counts: { running: 1, needsAttention: 1, idle: 0, error: 0 },
      },
      pinnedSessions: [],
    },
    primaryRows: [
      { id: "lifetime-tokens", label: "Total tokens", value: "1,500", tone: "default" },
      { id: "cost", label: "Total cost", value: "-", tone: "default" },
      { id: "today-tokens", label: "Today", value: "250", tone: "default" },
      { id: "running", label: "Running", value: "1", tone: "ok" },
      { id: "attention", label: "Needs attention", value: "1", tone: "warning" },
      { id: "errors", label: "Errors", value: "0", tone: "default" },
    ],
    runningAgents: [running],
    needsAttentionAgents: [attention],
    recentlyCompletedAgents: [],
    pinnedSessions: [],
    canUseStatusBarSessionPins: false,
    generatedAt: "2026-07-06T04:00:00.000Z",
    isRefreshing: false,
  };
}

function renderStatusBar(view = readyView()) {
  return <GlobalStatusBar serverId="server-1" chromeState={createChromeState(view)} />;
}

function createChromeState(view: StatusSummaryViewModel) {
  return { view, isVisible: true };
}

describe("status bar running sessions", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    rafQueue = [];
    runtimeState.compact = false;
    runtimeState.pathname = "/h/server-1";
    runtimeState.liveWorkspaceIds = ["workspace-1"];
    runtimeState.historyAgents = [];
    runtimeState.historyInitialLoad = false;
    runtimeState.historyError = false;
    runtimeState.historyRevalidating = false;
    runtimeState.historyOptions = null;
    runtimeState.refreshAgent.mockReset();
    runtimeState.refreshAgent.mockResolvedValue(undefined);
    runtimeState.refreshHistory.mockReset();
    runtimeState.refreshHistory.mockResolvedValue(undefined);
    runtimeState.setStatusSessionPin.mockReset();
    runtimeState.setStatusSessionPin.mockResolvedValue({
      requestId: "pin-test",
      pinnedSessions: [],
    });
    runtimeState.setStatusSessionPinOnServerTwo.mockReset();
    runtimeState.setStatusSessionPinOnServerTwo.mockResolvedValue({
      requestId: "pin-test-server-two",
      pinnedSessions: [],
    });
    navigationSpies.navigateToAgent.mockClear();
    navigationSpies.navigateToWorkspace.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("upgrades running and attention chips into a single desktop sessions trigger", () => {
    act(() => {
      root?.render(renderStatusBar());
    });

    expect(container?.querySelector('[data-testid="global-status-bar-row-running"]')).toBeNull();
    expect(container?.querySelector('[data-testid="global-status-bar-row-attention"]')).toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-sessions-trigger"]')).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-sessions-attention-count"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-sessions-running-count"]'),
    ).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-panel"]')).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-session-row-agent-attention"]'),
    ).not.toBeNull();
  });

  it("prioritizes actionable attention rows and labels session status", () => {
    const permission = snapshot({
      agentId: "agent-permission",
      status: "idle",
      stateBucket: "needs_input",
      attentionReason: "permission",
      attentionTimestamp: "2026-07-06T04:01:00.000Z",
    });
    const error = snapshot({
      agentId: "agent-error",
      status: "error",
      stateBucket: "failed",
      attentionReason: "error",
      attentionTimestamp: "2026-07-06T04:03:00.000Z",
    });
    const finished = snapshot({
      agentId: "agent-finished",
      status: "idle",
      stateBucket: "attention",
      attentionReason: "finished",
      attentionTimestamp: "2026-07-06T04:05:00.000Z",
    });
    const view = readyView();
    view.needsAttentionAgents = [finished, error, permission];
    view.runningAgents = [];
    view.summary.activity.needsAttentionAgents = view.needsAttentionAgents;
    view.summary.activity.runningAgents = [];

    act(() => {
      root?.render(renderStatusBar(view));
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    const rows = Array.from(
      container?.querySelectorAll('[data-testid^="status-bar-session-row-"]') ?? [],
    ).map((row) => row.getAttribute("data-testid"));
    expect(rows.slice(0, 3)).toEqual([
      "status-bar-session-row-agent-permission",
      "status-bar-session-row-agent-error",
      "status-bar-session-row-agent-finished",
    ]);
    expect(container?.textContent).toContain("statusBar.sessions.status.permission");
    expect(container?.textContent).toContain("statusBar.sessions.status.error");
    expect(container?.textContent).toContain("statusBar.sessions.status.finished");
  });

  it("merges session rows from ready hosts and pins through their owning host", async () => {
    const view = readyView();
    const hostTwoRunning = snapshot({
      agentId: "agent-host-two",
      title: "Build the release",
      workspaceId: "workspace-host-two",
    });
    const firstHostSummary = view.summary;
    const secondHostSummary = {
      ...view.summary,
      activity: {
        ...view.summary.activity,
        runningAgents: [hostTwoRunning],
        needsAttentionAgents: [],
        recentlyCompletedAgents: [],
        counts: { running: 1, needsAttention: 0, idle: 0, error: 0 },
      },
    };
    view.hostSummaries = [
      {
        serverId: "server-1",
        serverLabel: "MacBook Pro",
        summary: firstHostSummary,
        canUseStatusBarSessionPins: true,
      },
      {
        serverId: "server-2",
        serverLabel: "Build host",
        summary: secondHostSummary,
        canUseStatusBarSessionPins: true,
      },
    ];

    act(() => {
      root?.render(renderStatusBar(view));
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    expect(container?.textContent).toContain("MacBook Pro");
    expect(container?.textContent).toContain("Build host");
    expect(
      container?.querySelector('[data-testid="status-bar-session-pin-agent-running"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-session-pin-agent-host-two"]'),
    ).not.toBeNull();
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="status-bar-session-row-agent-host-two"] button',
        )
        ?.click();
    });

    expect(navigationSpies.navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-2",
      agentId: "agent-host-two",
      workspaceId: "workspace-host-two",
    });

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-session-pin-agent-host-two"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.setStatusSessionPinOnServerTwo).toHaveBeenCalledWith({
      agentId: "agent-host-two",
      pinned: true,
      workspaceId: "workspace-host-two",
      title: "Build the release",
      provider: "codex",
      cwd: "/work/agent-host-two",
      status: "running",
      requiresAttention: false,
      attentionReason: undefined,
      pendingPermissionCount: 0,
      updatedAt: "2026-07-06T04:00:00.000Z",
    });
  });

  it("uses a compact sheet and closes before agent navigation", () => {
    runtimeState.compact = true;
    act(() => {
      root?.render(renderStatusBar());
    });
    expect(container?.querySelector('[data-testid="global-status-bar-row-running"]')).toBeNull();
    expect(container?.querySelector('[data-testid="global-status-bar-row-attention"]')).toBeNull();
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-sheet"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="status-bar-session-row-agent-attention"] button',
        )
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-sheet"]')).toBeNull();
    expect(navigationSpies.navigateToAgent).not.toHaveBeenCalled();

    act(() => {
      flushAnimationFrames();
    });

    expect(navigationSpies.navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-1",
      agentId: "agent-attention",
      workspaceId: "workspace-1",
    });
  });

  it("shows workspace action only for live workspaces", () => {
    runtimeState.compact = true;
    runtimeState.liveWorkspaceIds = [];
    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    expect(
      container?.querySelector('[data-testid="status-bar-session-workspace-agent-attention"]'),
    ).toBeNull();
  });

  it("toggles a running session pin without navigating the row", async () => {
    const view = readyView();
    view.canUseStatusBarSessionPins = true;
    view.summary.pinnedSessions = [];

    act(() => {
      root?.render(renderStatusBar(view));
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-session-pin-agent-running"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.setStatusSessionPin).toHaveBeenCalledWith({
      agentId: "agent-running",
      pinned: true,
      workspaceId: "workspace-1",
      title: "agent-running",
      provider: "codex",
      cwd: "/work/agent-running",
      status: "running",
      requiresAttention: false,
      attentionReason: undefined,
      pendingPermissionCount: 0,
      updatedAt: "2026-07-06T04:00:00.000Z",
    });
    expect(navigationSpies.navigateToAgent).not.toHaveBeenCalled();
  });

  it("closes the compact sheet before workspace navigation", () => {
    runtimeState.compact = true;
    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-sheet"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="status-bar-session-workspace-agent-attention"]',
        )
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-sheet"]')).toBeNull();
    expect(navigationSpies.navigateToWorkspace).not.toHaveBeenCalled();

    act(() => {
      flushAnimationFrames();
    });

    expect(navigationSpies.navigateToWorkspace).toHaveBeenCalledWith({
      serverId: "server-1",
      workspaceId: "workspace-1",
    });
  });

  it("closes an open panel on route change", () => {
    const view = readyView();
    act(() => {
      root?.render(renderStatusBar(view));
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });
    expect(container?.querySelector('[data-testid="status-bar-sessions-panel"]')).not.toBeNull();

    runtimeState.pathname = "/h/server-1/settings";
    act(() => {
      root?.render(renderStatusBar(view));
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-panel"]')).toBeNull();
  });

  it("shows a history trigger next to sessions and lists the 10 latest host sessions", async () => {
    runtimeState.historyAgents = Array.from({ length: 12 }, (_, index) =>
      historyAgent({ id: `history-${index + 1}`, offsetMinutes: index }),
    );

    act(() => {
      root?.render(renderStatusBar());
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-trigger"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-history-trigger"]')).not.toBeNull();

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-panel"]')).not.toBeNull();
    expect(container?.querySelectorAll('[data-testid^="status-bar-history-row-"]')).toHaveLength(
      10,
    );
    expect(
      container?.querySelector('[data-testid="status-bar-history-row-history-1"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-history-row-history-10"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-history-row-history-11"]'),
    ).toBeNull();
    expect(runtimeState.refreshHistory).toHaveBeenCalledTimes(1);
  });

  it("filters closed and child agents before applying the history limit", async () => {
    runtimeState.historyAgents = [
      historyAgent({ id: "closed-latest", offsetMinutes: 0, status: "closed" }),
      historyAgent({
        id: "child-latest",
        offsetMinutes: 1,
        labels: { [PARENT_AGENT_ID_LABEL]: "parent-agent" },
      }),
      ...Array.from({ length: 10 }, (_, index) =>
        historyAgent({ id: `root-history-${index + 1}`, offsetMinutes: index + 2 }),
      ),
    ];

    act(() => {
      root?.render(renderStatusBar());
    });

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelectorAll('[data-testid^="status-bar-history-row-"]')).toHaveLength(
      10,
    );
    expect(
      container?.querySelector('[data-testid="status-bar-history-row-closed-latest"]'),
    ).toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-history-row-child-latest"]'),
    ).toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-history-row-root-history-10"]'),
    ).not.toBeNull();
  });

  it("uses all-host history and labels entries when multiple status summaries are ready", async () => {
    const view = readyView();
    view.hostSummaries = [
      {
        serverId: "server-1",
        serverLabel: "MacBook Pro",
        summary: view.summary,
        canUseStatusBarSessionPins: true,
      },
      {
        serverId: "server-2",
        serverLabel: "Build host",
        summary: view.summary,
        canUseStatusBarSessionPins: true,
      },
    ];
    runtimeState.historyAgents = [
      historyAgent({ id: "history-one", offsetMinutes: 0, serverLabel: "MacBook Pro" }),
      historyAgent({
        id: "history-two",
        offsetMinutes: 1,
        serverId: "server-2",
        serverLabel: "Build host",
      }),
    ];

    act(() => {
      root?.render(renderStatusBar(view));
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.historyOptions).toEqual({
      serverId: undefined,
      serverIds: ["server-1", "server-2"],
    });
    expect(container?.textContent).toContain("MacBook Pro");
    expect(container?.textContent).toContain("Build host");
    expect(
      container?.querySelector('[data-testid="status-bar-history-pin-history-one"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-history-pin-history-two"]'),
    ).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="status-bar-history-row-history-two"] button',
        )
        ?.click();
    });
    expect(navigationSpies.navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-2",
      agentId: "history-two",
      workspaceId: "workspace-1",
      pin: false,
    });
  });

  it("keeps pinned sessions scoped to the current host", () => {
    const view = readyView();
    view.hostSummaries = [
      {
        serverId: "server-1",
        serverLabel: "MacBook Pro",
        summary: { ...view.summary, pinnedSessions: [] },
        canUseStatusBarSessionPins: true,
      },
      {
        serverId: "server-2",
        serverLabel: "Build host",
        summary: {
          ...view.summary,
          pinnedSessions: [
            {
              agentId: "agent-pinned-elsewhere",
              workspaceId: "workspace-2",
              title: "Pinned elsewhere",
              provider: "codex",
              updatedAt: "2026-07-06T04:00:00.000Z",
              pinnedAt: "2026-07-06T04:00:00.000Z",
            },
          ],
        },
        canUseStatusBarSessionPins: true,
      },
    ];

    act(() => {
      root?.render(renderStatusBar(view));
    });

    expect(container?.querySelector('[data-testid="status-bar-pins-trigger"]')).toBeNull();
  });

  it("hides session pin controls when the host lacks the feature gate", async () => {
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-sessions-trigger"]')
        ?.click();
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelector('[data-testid^="status-bar-session-pin-"]')).toBeNull();
    expect(container?.querySelector('[data-testid^="status-bar-history-pin-"]')).toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-pins-trigger"]')).toBeNull();
  });

  it("toggles a history session pin without navigating the row", async () => {
    const view = readyView();
    view.canUseStatusBarSessionPins = true;
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar(view));
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-pin-history-1"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.setStatusSessionPin).toHaveBeenCalledWith({
      agentId: "history-1",
      pinned: true,
      workspaceId: "workspace-1",
      title: "history-1",
      provider: "codex",
      cwd: "/work/history-1",
      status: "idle",
      requiresAttention: undefined,
      attentionReason: undefined,
      pendingPermissionCount: 0,
      updatedAt: "2026-07-06T04:00:00.000Z",
    });
    expect(navigationSpies.navigateToAgent).not.toHaveBeenCalled();
  });

  it("opens pinned sessions next to history and navigates without requiring workspaceId", () => {
    const view = readyView();
    view.canUseStatusBarSessionPins = true;
    view.pinnedSessions = [
      {
        agentId: "pinned-1",
        workspaceId: null,
        title: "Pinned one",
        provider: "codex",
        cwd: "/work/pinned-1",
        status: "running",
        requiresAttention: false,
        attentionReason: null,
        pendingPermissionCount: 0,
        updatedAt: "2026-07-06T04:00:00.000Z",
        pinnedAt: "2026-07-06T04:01:00.000Z",
      },
    ];
    view.summary.pinnedSessions = view.pinnedSessions;

    act(() => {
      root?.render(renderStatusBar(view));
    });

    expect(container?.querySelector('[data-testid="status-bar-history-trigger"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-pins-trigger"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-pins-trigger"]')
        ?.click();
    });
    expect(container?.querySelector('[data-testid="status-bar-pins-panel"]')).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="status-bar-pin-status-pinned-1"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("codex · pinned-1");
    expect(container?.textContent).toContain("agentList.status.running");

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-pin-row-pinned-1"] button')
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-pins-panel"]')).toBeNull();
    expect(navigationSpies.navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-1",
      agentId: "pinned-1",
      workspaceId: null,
    });
  });

  it("refreshes history automatically when opening the history panel", async () => {
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar());
    });

    expect(runtimeState.refreshHistory).not.toHaveBeenCalled();

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.refreshHistory).toHaveBeenCalledTimes(1);
  });

  it("does not auto-refresh history while the initial load is active", async () => {
    runtimeState.historyInitialLoad = true;

    act(() => {
      root?.render(renderStatusBar());
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.refreshHistory).not.toHaveBeenCalled();
  });

  it("shows each history row status", async () => {
    runtimeState.historyAgents = [
      historyAgent({ id: "history-running", offsetMinutes: 0, status: "running" }),
    ];

    act(() => {
      root?.render(renderStatusBar());
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(
      container?.querySelector('[data-testid="status-bar-history-status-history-running"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("agentList.status.running");
  });

  it("opens history even when the host has no recent sessions", async () => {
    runtimeState.historyAgents = [];

    act(() => {
      root?.render(renderStatusBar());
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-panel"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-history-empty"]')).not.toBeNull();
  });

  it("shows the history empty state when every loaded history session is filtered out", async () => {
    runtimeState.historyAgents = [
      historyAgent({ id: "closed-only", offsetMinutes: 0, status: "closed" }),
      historyAgent({
        id: "child-only",
        offsetMinutes: 1,
        labels: { [PARENT_AGENT_ID_LABEL]: "parent-agent" },
      }),
    ];

    act(() => {
      root?.render(renderStatusBar());
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-panel"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-history-empty"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid^="status-bar-history-row-"]')).toBeNull();
  });

  it("refreshes history on demand from the history panel", async () => {
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar());
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-refresh"]')).not.toBeNull();

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-refresh"]')
        ?.click();
      await flushPromises();
    });

    expect(runtimeState.refreshHistory).toHaveBeenCalledTimes(2);
  });

  it("navigates from a compact history row after closing the sheet", async () => {
    runtimeState.compact = true;
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar());
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
      await flushPromises();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-sheet"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="status-bar-history-row-history-1"] button',
        )
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-sheet"]')).toBeNull();
    expect(navigationSpies.navigateToAgent).not.toHaveBeenCalled();

    act(() => {
      flushAnimationFrames();
    });

    expect(navigationSpies.navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-1",
      agentId: "history-1",
      workspaceId: "workspace-1",
      pin: false,
    });
  });
});
