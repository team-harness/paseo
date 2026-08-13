// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarTeamHubEntry } from "./sidebar-team-hub-entry";

const pushed: string[] = [];
const events: string[] = [];

vi.stubGlobal("React", React);
vi.mock("expo-router", () => ({
  router: { push: (href: string) => pushed.push(href) },
  usePathname: () => "/workspace",
}));
vi.mock("lucide-react-native", () => ({ Users: () => null }));
vi.mock("@/components/sidebar/sidebar-header-row", () => ({
  SidebarHeaderRow: ({
    label,
    onPress,
    testID,
  }: {
    label: string;
    onPress: () => void;
    testID: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onPress },
      label,
    ),
}));

const closeSidebar = () => events.push("close");

describe("SidebarTeamHubEntry", () => {
  afterEach(cleanup);
  beforeEach(() => {
    pushed.length = 0;
    events.length = 0;
  });

  it("navigates to the selected physical host Team Hub", () => {
    render(<SidebarTeamHubEntry serverId="host a" />);
    fireEvent.click(screen.getByTestId("sidebar-teams"));
    expect(pushed).toEqual(["/h/host%20a/teams"]);
  });

  it("closes a compact sidebar before navigating", () => {
    render(<SidebarTeamHubEntry serverId="host-a" onBeforeNavigate={closeSidebar} />);
    fireEvent.click(screen.getByTestId("sidebar-teams"));
    expect(events).toEqual(["close"]);
    expect(pushed).toEqual(["/h/host-a/teams"]);
  });
});
