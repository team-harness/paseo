/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  View: ({
    accessibilityLabel,
    accessibilityRole,
    children,
    testID,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children?: React.ReactNode;
    testID?: string;
  }) => (
    <div data-testid={testID} role={accessibilityRole} aria-label={accessibilityLabel}>
      {children}
    </div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: Record<string, unknown>) => unknown)({
            borderRadius: { full: 999 },
            colors: {
              border: "#444",
              foreground: "#fff",
              foregroundMuted: "#aaa",
              statusDotDanger: "#f00",
              statusDotRunning: "#00f",
              statusDotSuccess: "#0f0",
              statusDotWarning: "#fa0",
              surface0: "#111",
              surface1: "#222",
            },
            fontSize: { sm: 13 },
            spacing: { 1: 4, 2: 8 },
          })
        : factory,
  },
  withUnistyles: <T,>(component: T) => component,
}));

vi.mock("@/components/synced-loader", () => ({
  SyncedLoader: () => <span data-testid="synced-loader" />,
}));

vi.mock("lucide-react-native", () => ({
  Check: () => <span />,
  CircleAlert: () => <span />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("tiny-invariant", () => ({
  default: (condition: unknown) => {
    if (!condition) throw new Error("Invariant failed");
  },
}));

vi.mock("@/panels/register-panels", () => ({
  ensurePanelsRegistered: vi.fn(),
}));

vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: vi.fn(),
}));

vi.mock("@/panels/panel-instance-attributes", () => ({
  usePanelInstanceAttributes: () => ({ modified: false }),
}));

import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";

const Icon = () => <span data-testid="agent-icon" />;

function presentation(
  statusBucket: WorkspaceTabPresentation["statusBucket"],
): WorkspaceTabPresentation {
  return {
    key: "agent-agent-a",
    kind: "agent",
    label: "Agent A",
    subtitle: "",
    tooltip: "Agent A",
    modified: false,
    titleState: "ready",
    icon: Icon,
    statusBucket,
  };
}

describe("WorkspaceTabIcon", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("uses the synced loader for a running agent", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<WorkspaceTabIcon presentation={presentation("running")} />);
    });

    expect(container.querySelector('[data-testid="synced-loader"]')).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="workspace-tab-running-indicator"]')
        ?.getAttribute("aria-label"),
    ).toBe("Agent running");

    act(() => {
      root?.render(<WorkspaceTabIcon presentation={presentation("failed")} />);
    });

    expect(container.querySelector('[data-testid="synced-loader"]')).toBeNull();
  });
});
