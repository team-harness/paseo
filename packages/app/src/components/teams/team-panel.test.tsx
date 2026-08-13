// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";
import { testTeamMethodologyBinding } from "@/teams/test-fixtures";

vi.stubGlobal("React", React);

const TEAM: TeamV2 = {
  id: "team-1",
  name: "Platform Team",
  creationWorkspaceId: "workspace-removed",
  leadMemberId: "member-lead",
  skills: [],
  lifecycle: "active",
  members: [],
  methodologyBinding: testTeamMethodologyBinding(),
  activeMissionId: null,
  revision: 1,
  lifecycleRecoveryFailure: null,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  archivedAt: null,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", () => ({ RotateCw: () => null }));

vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ refreshTeamMissions: vi.fn() }),
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          agents: new Map(),
          workspaces: new Map(),
          teamMissionsReplica: {
            status: "ready",
            profiles: new Map([[TEAM.id, TEAM]]),
            missions: new Map(),
            historyReads: new Map(),
            error: null,
          },
        },
      },
    }),
}));

vi.mock("@/components/teams/team-room", () => ({
  TeamRoom: ({
    onOpenSettings,
    onStartMission,
  }: {
    onOpenSettings: () => void;
    onStartMission?: () => void;
  }) =>
    React.createElement(
      "div",
      null,
      React.createElement(
        "button",
        { type: "button", "data-testid": "room-settings", onClick: onOpenSettings },
        "Settings",
      ),
      onStartMission
        ? React.createElement(
            "button",
            { type: "button", "data-testid": "room-start-mission", onClick: onStartMission },
            "Start Mission",
          )
        : null,
    ),
}));

vi.mock("@/components/teams/team-settings-sheet", () => ({
  TeamSettingsSheet: ({
    visible,
    onStartMission,
  }: {
    visible: boolean;
    onStartMission?: () => void;
  }) =>
    visible
      ? React.createElement("div", {
          "data-testid": "settings-sheet",
          "data-can-start-mission": onStartMission ? "true" : "false",
        })
      : null,
}));

vi.mock("@/components/teams/mission-start-sheet", () => ({
  MissionStartSheet: () => React.createElement("div", { "data-testid": "mission-start-sheet" }),
}));

vi.mock("@/components/teams/team-profile-form-sheet", () => ({
  TeamProfileFormSheet: () => null,
}));

import { TeamPanel } from "./team-panel";

describe("TeamPanel without a live workspace", () => {
  it("keeps settings reachable without exposing Mission start", () => {
    render(<TeamPanel serverId="server-1" workspaceId={null} teamId="team-1" />);

    expect(screen.queryByTestId("room-start-mission")).toBeNull();
    expect(screen.queryByTestId("mission-start-sheet")).toBeNull();

    fireEvent.click(screen.getByTestId("room-settings"));
    expect(screen.getByTestId("settings-sheet").getAttribute("data-can-start-mission")).toBe(
      "false",
    );
  });
});
