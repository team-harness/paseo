/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSummaryViewModel } from "./view-model";

const { theme, runtimeState } = vi.hoisted(() => ({
  theme: {
    spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6 },
    fontSize: { xs: 11 },
    fontWeight: { normal: "400", medium: "500" },
    opacity: { 50: 0.5 },
    colors: {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      border: "#333",
      borderAccent: "#555",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      statusSuccess: "#15803d",
      statusWarning: "#d97706",
      statusDanger: "#b91c1c",
    },
  },
  runtimeState: {
    view: {
      kind: "unsupported",
      message: "Update the host to use this.",
    } as StatusSummaryViewModel,
    focusModeEnabled: false,
    compact: false,
    safeAreaBottom: 0,
    historyAgents: [],
  },
}));

vi.mock("react-native", () => ({
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { "data-testid": testID, onClick: () => onPress?.(), type: "button" },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
  View: ({
    children,
    style,
    testID,
  }: {
    children?: React.ReactNode;
    style?: unknown;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      { "data-style": JSON.stringify(style), "data-testid": testID },
      children,
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

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: runtimeState.safeAreaBottom, left: 0 }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "statusBar.sessions.actions.openAgent" ? `Open ${String(options?.title ?? "")}` : key,
  }),
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => runtimeState.compact,
}));

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (state: { desktop: { focusModeEnabled: boolean } }) => unknown) =>
    selector({ desktop: { focusModeEnabled: runtimeState.focusModeEnabled } }),
}));

vi.mock("lucide-react-native", () => ({
  ArrowUpRight: () => React.createElement("span"),
  BriefcaseBusiness: () => React.createElement("span"),
}));

vi.mock("expo-router", () => ({
  usePathname: () => "/h/server-1",
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({ sessions: { "server-1": { workspaces: new Map(), client: null } } }),
    {
      getState: () => ({ sessions: { "server-1": { workspaces: new Map(), client: null } } }),
    },
  ),
}));

vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-agent-history", () => ({
  useAgentHistory: () => ({
    agents: runtimeState.historyAgents,
    isInitialLoad: false,
    isError: false,
    isLoading: false,
    isRevalidating: false,
    hasMore: false,
    isLoadingMore: false,
    refreshAll: vi.fn(),
    loadMore: vi.fn(),
  }),
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: () => undefined,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("button", { "data-testid": testID, type: "button" }, children),
  DropdownMenuContent: () => null,
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: () => null,
}));

vi.mock("./use-status-summary", () => ({
  useGlobalStatusBarView: () => runtimeState.view,
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { HostStatusBarLayout } from "./global-status-bar-layout";
import { GlobalStatusBar } from "./global-status-bar";
import { HostBottomChromeProvider, useHostBottomChromeInset } from "./bottom-chrome-inset";

function readyView(): StatusSummaryViewModel {
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
        runningAgents: [],
        needsAttentionAgents: [],
        recentlyCompletedAgents: [],
        counts: { running: 2, needsAttention: 1, idle: 0, error: 0 },
      },
    },
    primaryRows: [
      { id: "lifetime-tokens", label: "Total tokens", value: "1,500", tone: "default" },
      { id: "today-tokens", label: "Today", value: "250", tone: "default" },
      { id: "cost", label: "Cost", value: "-", tone: "default" },
      { id: "running", label: "Running", value: "2", tone: "ok" },
      { id: "attention", label: "Needs attention", value: "1", tone: "warning" },
      { id: "errors", label: "Errors", value: "0", tone: "default" },
    ],
    runningAgents: [],
    needsAttentionAgents: [],
    recentlyCompletedAgents: [],
    generatedAt: "2026-07-06T04:00:00.000Z",
    isRefreshing: false,
  };
}

function BottomInsetProbe({ bottomInset }: { bottomInset: number }) {
  const effectiveInset = useHostBottomChromeInset(bottomInset);
  return <span data-testid="effective-bottom-inset">{effectiveInset}</span>;
}

function currentChromeState() {
  const isVisible =
    !runtimeState.focusModeEnabled &&
    runtimeState.view.kind !== "hidden" &&
    runtimeState.view.kind !== "unsupported";
  return { view: runtimeState.view, isVisible };
}

describe("GlobalStatusBar", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    runtimeState.view = { kind: "unsupported", message: "Update the host to use this." };
    runtimeState.focusModeEnabled = false;
    runtimeState.compact = false;
    runtimeState.safeAreaBottom = 0;
    runtimeState.historyAgents = [];
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

  it("renders ready summary rows in the host footer", () => {
    runtimeState.view = readyView();

    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });

    expect(container?.querySelector('[data-testid="global-status-bar"]')).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="global-status-bar-row-today-tokens"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="global-status-bar-row-running"]')?.textContent,
    ).toContain("2");
    expect(container?.querySelector('[data-testid="status-bar-sessions-trigger"]')).toBeNull();
    expect(container?.querySelector('[data-testid="status-bar-history-trigger"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="global-status-bar-row-cost"]')).not.toBeNull();
  });

  it("keeps compact rows to high-priority summary chips", () => {
    runtimeState.view = readyView();
    runtimeState.compact = true;

    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });

    expect(container?.querySelector('[data-testid="global-status-bar-row-cost"]')).toBeNull();
    expect(container?.querySelector('[data-testid="global-status-bar-row-errors"]')).toBeNull();
    expect(
      container?.querySelector('[data-testid="global-status-bar-row-running"]'),
    ).not.toBeNull();
  });

  it("renders quiet non-ready states and hides unsupported hosts", () => {
    runtimeState.view = { kind: "loading" };
    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });
    expect(
      container?.querySelector('[data-testid="global-status-bar-loading"]')?.textContent,
    ).toContain("statusBar.states.loading");

    runtimeState.view = { kind: "offline", message: "Host is offline." };
    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });
    expect(
      container?.querySelector('[data-testid="global-status-bar-offline"]')?.textContent,
    ).toContain("statusBar.states.offline");

    runtimeState.view = { kind: "error", message: "Status summary unavailable." };
    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });
    expect(
      container?.querySelector('[data-testid="global-status-bar-error"]')?.textContent,
    ).toContain("Status summary unavailable.");

    runtimeState.view = { kind: "hidden", reason: "no-host" };
    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });
    expect(container?.querySelector('[data-testid="global-status-bar"]')).toBeNull();

    runtimeState.view = { kind: "unsupported", message: "Update the host to use this." };
    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });
    expect(container?.querySelector('[data-testid="global-status-bar"]')).toBeNull();
  });

  it("hides the footer while desktop focus mode is enabled", () => {
    runtimeState.view = readyView();
    runtimeState.focusModeEnabled = true;

    act(() => {
      root?.render(<GlobalStatusBar serverId="server-1" chromeState={currentChromeState()} />);
    });

    expect(container?.querySelector('[data-testid="global-status-bar"]')).toBeNull();
  });

  it("wraps host content in a flex layout and owns the bottom safe area", () => {
    runtimeState.view = readyView();
    runtimeState.safeAreaBottom = 20;

    act(() => {
      root?.render(
        <HostStatusBarLayout serverId="server-1">
          <div data-testid="host-stack" />
          <BottomInsetProbe bottomInset={20} />
        </HostStatusBarLayout>,
      );
    });

    expect(container?.querySelector('[data-testid="host-status-bar-layout"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="host-status-bar-content"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="host-stack"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="global-status-bar"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="effective-bottom-inset"]')?.textContent).toBe(
      "0",
    );
  });

  it("does not claim the bottom safe area when the footer is hidden", () => {
    runtimeState.view = { kind: "unsupported", message: "Update the host to use this." };
    runtimeState.safeAreaBottom = 20;

    act(() => {
      root?.render(
        <HostStatusBarLayout serverId="server-1">
          <BottomInsetProbe bottomInset={20} />
        </HostStatusBarLayout>,
      );
    });

    expect(container?.querySelector('[data-testid="global-status-bar"]')).toBeNull();
    expect(container?.querySelector('[data-testid="effective-bottom-inset"]')?.textContent).toBe(
      "20",
    );
  });

  it("leaves bottom inset untouched outside the host bottom chrome provider", () => {
    act(() => {
      root?.render(
        <HostBottomChromeProvider bottomSafeAreaOwned={false} chromeHeight={0}>
          <BottomInsetProbe bottomInset={16} />
        </HostBottomChromeProvider>,
      );
    });

    expect(container?.querySelector('[data-testid="effective-bottom-inset"]')?.textContent).toBe(
      "16",
    );
  });
});
