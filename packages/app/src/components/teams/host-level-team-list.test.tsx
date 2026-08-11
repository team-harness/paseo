// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const mocked = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("expo-router", () => ({ router: { navigate: mocked.navigate } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "teams.host.title" ? "Teams" : key) }),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onPress },
      children,
    ),
  ScrollView: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", () => ({
  ChevronRight: () => null,
  Users: () => null,
}));

import { HostLevelTeamList } from "./host-level-team-list";

describe("host-level Team list", () => {
  beforeEach(() => mocked.navigate.mockClear());

  it("opens a Team deep link without creating a workspace route", () => {
    render(
      <HostLevelTeamList
        serverId="host one"
        rows={[
          { teamId: "team/alpha", name: "Alpha" },
          { teamId: "team-beta", name: "Beta" },
        ]}
      />,
    );

    expect(screen.getByText("Teams")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.click(screen.getByTestId("host-team-row-team/alpha"));

    expect(mocked.navigate).toHaveBeenCalledTimes(1);
    expect(mocked.navigate).toHaveBeenCalledWith("/h/host%20one/team/team%2Falpha");
  });
});
