/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import type { StatusSummaryViewModel } from "./view-model";

const { theme, runtimeState, navigationSpies } = vi.hoisted(() => ({
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
    refreshAgent: vi.fn(),
    refreshHistory: vi.fn(),
  },
  navigationSpies: {
    navigateToAgent: vi.fn(),
    navigateToWorkspace: vi.fn(),
  },
}));

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
  RefreshCw: () => React.createElement("span", { "data-testid": "refresh-icon" }),
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
            client: { refreshAgent: runtimeState.refreshAgent },
          },
        },
      }),
    {
      getState: () => ({
        sessions: {
          "server-1": {
            workspaces: new Map(runtimeState.liveWorkspaceIds.map((id) => [id, { id }])),
            client: { refreshAgent: runtimeState.refreshAgent },
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
  useAgentHistory: () => ({
    agents: runtimeState.historyAgents,
    isInitialLoad: runtimeState.historyInitialLoad,
    isError: runtimeState.historyError,
    isLoading: runtimeState.historyInitialLoad,
    isRevalidating: runtimeState.historyRevalidating,
    hasMore: false,
    isLoadingMore: false,
    refreshAll: runtimeState.refreshHistory,
    loadMore: vi.fn(),
  }),
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: navigationSpies.navigateToWorkspace,
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

function readyView(): StatusSummaryViewModel {
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
    runtimeState.refreshAgent.mockReset();
    runtimeState.refreshAgent.mockResolvedValue(undefined);
    runtimeState.refreshHistory.mockReset();
    runtimeState.refreshHistory.mockResolvedValue(undefined);
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

    expect(navigationSpies.navigateToWorkspace).toHaveBeenCalledWith("server-1", "workspace-1");
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

  it("shows a history trigger next to sessions and lists the 10 latest host sessions", () => {
    runtimeState.historyAgents = Array.from({ length: 12 }, (_, index) =>
      historyAgent({ id: `history-${index + 1}`, offsetMinutes: index }),
    );

    act(() => {
      root?.render(renderStatusBar());
    });

    expect(container?.querySelector('[data-testid="status-bar-sessions-trigger"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-history-trigger"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
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
  });

  it("shows each history row status", () => {
    runtimeState.historyAgents = [
      historyAgent({ id: "history-running", offsetMinutes: 0, status: "running" }),
    ];

    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
    });

    expect(
      container?.querySelector('[data-testid="status-bar-history-status-history-running"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("agentList.status.running");
  });

  it("opens history even when the host has no recent sessions", () => {
    runtimeState.historyAgents = [];

    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-panel"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-history-empty"]')).not.toBeNull();
  });

  it("refreshes history on demand from the history panel", () => {
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
    });

    expect(container?.querySelector('[data-testid="status-bar-history-refresh"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-refresh"]')
        ?.click();
    });

    expect(runtimeState.refreshHistory).toHaveBeenCalledTimes(1);
  });

  it("navigates from a compact history row after closing the sheet", () => {
    runtimeState.compact = true;
    runtimeState.historyAgents = [historyAgent({ id: "history-1", offsetMinutes: 0 })];

    act(() => {
      root?.render(renderStatusBar());
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="status-bar-history-trigger"]')
        ?.click();
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
