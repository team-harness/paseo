// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const mocked = vi.hoisted(() => ({ navigate: vi.fn(), create: vi.fn(), openWorkspace: vi.fn() }));

vi.mock("expo-router", () => ({ router: { navigate: mocked.navigate } }));

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/constants/platform", () => ({ isNative: false }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(":")}` : key,
  }),
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

vi.mock("@/components/teams/member-avatar", () => ({
  MemberAvatar: ({ testID }: { testID?: string }) =>
    React.createElement("span", { "data-testid": testID }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onPress, disabled },
      children,
    ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("button", { type: "button", "data-testid": testID }, children),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onSelect },
      children,
    ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", () => ({
  ChevronRight: () => null,
  FolderOpen: () => null,
  MoreVertical: () => null,
  Plus: () => null,
  Settings2: () => null,
  Users: () => null,
}));

import { HostLevelTeamList } from "./host-level-team-list";

describe("host-level Team list", () => {
  beforeEach(() => mocked.navigate.mockClear());
  afterEach(cleanup);

  it("opens a Team deep link without creating a workspace route", () => {
    render(
      <HostLevelTeamList
        serverId="host one"
        onCreate={mocked.create}
        onOpenWorkspace={mocked.openWorkspace}
        rows={[
          {
            teamId: "team/alpha",
            name: "Alpha",
            template: "lean-delivery",
            members: [{ memberId: "member-lead", role: "Lead", isLead: true }],
            mission: {
              missionId: "mission-alpha",
              objective: "Ship Alpha",
              status: "needs_attention",
              workspaceId: "workspace-alpha",
              workspaceLabel: "Alpha workspace",
              openAttentionCount: 2,
            },
            missionPending: false,
            action: "enter_room",
          },
          {
            teamId: "team-beta",
            name: "Beta",
            template: "standard",
            members: [],
            mission: null,
            missionPending: false,
            action: "start_mission",
          },
        ]}
      />,
    );

    expect(screen.getByText("teams.host.title")).toBeTruthy();
    expect(screen.getByTestId("team-hub-create")).toBeTruthy();
    expect(screen.getByText("teams.host.hub.template:lean-delivery")).toBeTruthy();
    expect(screen.getByText("Ship Alpha")).toBeTruthy();
    expect(screen.getByText("teams.host.hub.enterRoom")).toBeTruthy();
    expect(screen.getByText("teams.host.hub.startMission")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.click(screen.getByTestId("host-team-row-team/alpha"));

    expect(mocked.navigate).toHaveBeenCalledTimes(1);
    expect(mocked.navigate).toHaveBeenCalledWith("/h/host%20one/team/team%2Falpha");

    fireEvent.click(screen.getByTestId("host-team-settings-team/alpha"));
    expect(mocked.navigate).toHaveBeenLastCalledWith("/h/host%20one/team/team%2Falpha?settings=1");
  });

  it("renders a localized empty state with the Hub-selected workspace guidance", () => {
    render(
      <HostLevelTeamList
        serverId="host-one"
        onCreate={mocked.create}
        onOpenWorkspace={mocked.openWorkspace}
        rows={[]}
        emptyDescription="teams.host.hub.emptyWithWorkspace"
      />,
    );

    expect(screen.getByTestId("host-level-team-list-empty")).toBeTruthy();
    expect(screen.getByText("teams.host.hub.emptyTitle")).toBeTruthy();
    expect(screen.getByText("teams.host.hub.emptyWithWorkspace")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-hub-create"));
    fireEvent.click(screen.getByTestId("team-hub-open-workspace"));
    expect(mocked.create).toHaveBeenCalledTimes(1);
    expect(mocked.openWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps the Hub actions but suppresses a false empty state after a Team read failure", () => {
    render(
      <HostLevelTeamList
        serverId="host-one"
        onCreate={mocked.create}
        onOpenWorkspace={mocked.openWorkspace}
        rows={[]}
        showEmptyState={false}
      />,
    );

    expect(screen.getByTestId("team-hub-create")).toBeTruthy();
    expect(screen.queryByTestId("host-level-team-list-empty")).toBeNull();
  });
});
