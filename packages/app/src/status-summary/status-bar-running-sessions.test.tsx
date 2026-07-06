/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import type { StatusSummaryViewModel } from "./view-model";

const { theme, runtimeState, navigationSpies } = vi.hoisted(() => ({
  theme: {
    spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6 },
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
    },
  },
  runtimeState: {
    compact: false,
    pathname: "/h/server-1",
    liveWorkspaceIds: ["workspace-1"],
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
}));

vi.mock("expo-router", () => ({
  usePathname: () => runtimeState.pathname,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => runtimeState.compact,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          workspaces: new Map(runtimeState.liveWorkspaceIds.map((id) => [id, { id }])),
        },
      },
    }),
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
      { id: "today-tokens", label: "Today", value: "250", tone: "default" },
      { id: "cost", label: "Cost", value: "-", tone: "default" },
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
});
