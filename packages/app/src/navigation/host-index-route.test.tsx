// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) =>
    React.createElement("div", { "data-testid": "redirect", "data-href": href }),
}));

vi.mock("@/navigation/host-route-context", () => ({
  useHostRouteServerId: () => "host-1",
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeSnapshot: () => ({ connectionStatus: "online" }),
}));

vi.mock("@/screens/startup-splash-screen", () => ({
  StartupSplashScreen: () => React.createElement("div", { "data-testid": "startup-splash" }),
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  useLastWorkspaceSelection: () => null,
  useIsLastWorkspaceSelectionHydrated: () => true,
}));

vi.mock("@/stores/session-store-hooks", () => ({
  useHasHydratedWorkspaces: () => true,
  useHasLiveWorkspaces: () => false,
  useWorkspaceExists: () => false,
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
          teamMissionsReplica: {
            status: "ready",
            profiles: new Map([
              ["team-1", { id: "team-1", name: "Platform", lifecycle: "active" }],
              ["team-archived", { id: "team-archived", name: "Old", lifecycle: "archived" }],
            ]),
            missions: new Map(),
            historyReads: new Map(),
            error: null,
          },
        },
      },
    }),
}));

import HostIndexRoute from "@/app/h/[serverId]";

describe("the host index without a workspace", () => {
  it("redirects to Team Hub when no workspace selection exists", () => {
    render(<HostIndexRoute />);

    expect(screen.getByTestId("redirect").getAttribute("data-href")).toBe("/h/host-1/teams");
  });
});
