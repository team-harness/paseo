// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";
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

const HISTORY_MISSION = {
  id: "mission-history",
  teamId: TEAM.id,
  workspaceId: "workspace-live",
  objective: "Previous delivery",
  status: "completed",
  attentionItems: [],
  rosterSnapshots: [],
  participants: [],
  updatedAt: "2026-08-12T00:00:00.000Z",
} as unknown as TeamMission;

let replica = {
  status: "ready" as const,
  profiles: new Map([[TEAM.id, TEAM]]),
  missions: new Map<string, TeamMission>(),
  historyReads: new Map(),
  error: null,
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
  getHostRuntimeStore: () => ({
    readTeamMissionHistory: vi.fn(),
    refreshTeamMissions: vi.fn(),
  }),
}));

vi.mock("@/agent-profiles/internal/use-agent-profiles", () => ({
  useAgentProfiles: () => ({ profiles: [] }),
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          agents: new Map(),
          workspaces: new Map(),
          teamMissionsReplica: replica,
        },
      },
    }),
}));

vi.mock("@/components/teams/team-room", () => ({
  TeamRoom: ({
    onOpenSettings,
    onStartMission,
    onExitReplay,
  }: {
    onOpenSettings: () => void;
    onStartMission?: () => void;
    onExitReplay?: () => void;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "team-room-mock" },
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
      onExitReplay
        ? React.createElement(
            "button",
            { type: "button", "data-testid": "room-exit-replay", onClick: onExitReplay },
            "Back to Team",
          )
        : null,
    ),
}));

vi.mock("@/components/teams/team-idle-overview", () => ({
  TeamIdleOverview: () => React.createElement("div", { "data-testid": "team-idle-overview" }),
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
  beforeEach(() => {
    replica = {
      status: "ready",
      profiles: new Map([[TEAM.id, TEAM]]),
      missions: new Map(),
      historyReads: new Map(),
      error: null,
    };
  });
  afterEach(cleanup);

  it("renders an idle Team overview instead of an empty room", () => {
    render(<TeamPanel serverId="server-1" workspaceId={null} teamId="team-1" />);

    expect(screen.getByTestId("team-idle-overview")).toBeTruthy();
    expect(screen.queryByTestId("team-room-mock")).toBeNull();
    expect(screen.queryByTestId("room-start-mission")).toBeNull();
    expect(screen.queryByTestId("mission-start-sheet")).toBeNull();
  });

  it("can start a new Mission from terminal replay and return to the Team overview", () => {
    replica = {
      status: "ready",
      profiles: new Map([[TEAM.id, TEAM]]),
      missions: new Map([[HISTORY_MISSION.id, HISTORY_MISSION]]),
      historyReads: new Map(),
      error: null,
    };

    render(
      <TeamPanel
        serverId="server-1"
        workspaceId="workspace-live"
        teamId="team-1"
        selectedMissionId={HISTORY_MISSION.id}
      />,
    );

    expect(screen.getByTestId("team-room-mock")).toBeTruthy();
    expect(screen.getByTestId("room-start-mission")).toBeTruthy();
    fireEvent.click(screen.getByTestId("room-exit-replay"));
    expect(screen.getByTestId("team-idle-overview")).toBeTruthy();
  });

  it("opens settings when mounted from the Hub management menu", () => {
    render(
      <TeamPanel serverId="server-1" workspaceId={null} teamId="team-1" initialSettingsOpen />,
    );

    expect(screen.getByTestId("settings-sheet")).toBeTruthy();
  });
});
