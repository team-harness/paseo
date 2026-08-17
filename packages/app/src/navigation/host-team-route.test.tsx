// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const mocked = vi.hoisted(() => ({
  navigateToWorkspace: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  params: { serverId: "host-1", teamId: "team-1", settings: undefined as string | undefined },
  activeMissionId: null as string | null,
  liveWorkspaceIds: [] as string[],
}));

vi.mock("expo-router", () => ({
  useLocalSearchParams: () => mocked.params,
  useRouter: () => ({
    replace: mocked.replace,
    push: mocked.push,
    back: mocked.back,
    canGoBack: () => false,
  }),
}));

vi.mock("@/components/host-route-bootstrap-boundary", () => ({
  HostRouteBootstrapBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/teams/team-panel", () => ({
  TeamPanel: ({
    serverId,
    workspaceId,
    teamId,
    initialSettingsOpen,
    onOpenAgent,
  }: {
    serverId: string;
    workspaceId: string | null;
    teamId: string;
    initialSettingsOpen?: boolean;
    onOpenAgent?: (agentId: string) => void;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "host-level-team-panel",
        "data-server-id": serverId,
        "data-workspace-id": workspaceId ?? "null",
        "data-team-id": teamId,
        "data-settings-open": initialSettingsOpen ? "true" : "false",
      },
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "host-level-open-agent",
          onClick: () => onOpenAgent?.("agent-1"),
        },
        "Open Agent",
      ),
    ),
}));

vi.mock("@/navigation/team-route-resolution-view", () => ({
  TeamRouteResolutionView: () => React.createElement("div", null),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "host-1", label: "Local" }],
  useHostRuntimeSnapshot: () => ({ connectionStatus: "online", lastError: null }),
  getHostRuntimeStore: () => ({ runProbeCycleNow: vi.fn() }),
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: mocked.navigateToWorkspace,
}));

vi.mock("@/stores/session-store-hooks", () => ({
  useLiveWorkspaceIds: () => mocked.liveWorkspaceIds,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "host-1": {
          serverInfo: {
            features: {
              teamMissions: true,
              globalTeamProfiles: true,
              teamMethodologies: true,
            },
          },
          workspaces: new Map(),
          teamMissionsReplica: {
            status: "ready",
            profiles: new Map([
              [
                "team-1",
                {
                  id: "team-1",
                  creationWorkspaceId: "workspace-removed",
                  activeMissionId: mocked.activeMissionId,
                },
              ],
            ]),
            missions: mocked.activeMissionId
              ? new Map([
                  [
                    mocked.activeMissionId,
                    { id: mocked.activeMissionId, workspaceId: "workspace-live" },
                  ],
                ])
              : new Map(),
          },
        },
      },
    }),
}));

import HostTeamRoute from "@/app/h/[serverId]/team/[teamId]";

describe("host-level Team deep links", () => {
  beforeEach(() => {
    mocked.navigateToWorkspace.mockClear();
    mocked.replace.mockClear();
    mocked.push.mockClear();
    mocked.params.settings = undefined;
    mocked.activeMissionId = null;
    mocked.liveWorkspaceIds = [];
  });
  afterEach(cleanup);

  it("renders an idle Team without inventing a workspace", () => {
    render(<HostTeamRoute />);

    const panel = screen.getByTestId("host-level-team-panel");
    expect(panel.getAttribute("data-server-id")).toBe("host-1");
    expect(panel.getAttribute("data-team-id")).toBe("team-1");
    expect(panel.getAttribute("data-workspace-id")).toBe("null");
    expect(mocked.navigateToWorkspace).not.toHaveBeenCalled();
    expect(mocked.replace).not.toHaveBeenCalled();
  });

  it("keeps a settings intent on the host-owned surface for an active Team", () => {
    mocked.params.settings = "1";
    mocked.activeMissionId = "mission-active";
    mocked.liveWorkspaceIds = ["workspace-live"];

    render(<HostTeamRoute />);

    const panel = screen.getByTestId("host-level-team-panel");
    expect(panel.getAttribute("data-workspace-id")).toBe("workspace-live");
    expect(panel.getAttribute("data-settings-open")).toBe("true");
    expect(mocked.navigateToWorkspace).not.toHaveBeenCalled();
  });

  it("opens a historical member through the host-owned Agent deep link", () => {
    render(<HostTeamRoute />);

    fireEvent.click(screen.getByTestId("host-level-open-agent"));

    expect(mocked.push).toHaveBeenCalledWith("/h/host-1/agent/agent-1");
  });
});
