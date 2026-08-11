// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const mocked = vi.hoisted(() => ({
  navigateToWorkspace: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ serverId: "host-1", teamId: "team-1" }),
  useRouter: () => ({
    replace: mocked.replace,
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
  }: {
    serverId: string;
    workspaceId: string | null;
    teamId: string;
  }) =>
    React.createElement("div", {
      "data-testid": "host-level-team-panel",
      "data-server-id": serverId,
      "data-workspace-id": workspaceId ?? "null",
      "data-team-id": teamId,
    }),
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
  useLiveWorkspaceIds: () => [],
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "host-1": {
          serverInfo: { features: { teamMissions: true, globalTeamProfiles: true } },
          workspaces: new Map(),
          teamMissionsReplica: {
            status: "ready",
            profiles: new Map([
              [
                "team-1",
                {
                  id: "team-1",
                  workspaceId: "workspace-removed",
                  activeMissionId: null,
                },
              ],
            ]),
            missions: new Map(),
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
  });

  it("renders an idle Team without inventing a workspace", () => {
    render(<HostTeamRoute />);

    const panel = screen.getByTestId("host-level-team-panel");
    expect(panel.getAttribute("data-server-id")).toBe("host-1");
    expect(panel.getAttribute("data-team-id")).toBe("team-1");
    expect(panel.getAttribute("data-workspace-id")).toBe("null");
    expect(mocked.navigateToWorkspace).not.toHaveBeenCalled();
    expect(mocked.replace).not.toHaveBeenCalled();
  });
});
