// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";
import { testTeamMethodologyBinding } from "@/teams/test-fixtures";

vi.stubGlobal("React", React);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(":")}` : key,
  }),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
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
  ScrollView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", () => ({
  History: () => null,
  Play: () => null,
  RotateCw: () => null,
  Settings2: () => null,
}));

vi.mock("@/components/teams/member-avatar", () => ({
  MemberAvatar: ({ label }: { label: string }) => React.createElement("span", null, label),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
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
}));

vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => React.createElement("span", null, label),
}));
vi.mock("@/utils/time", () => ({ formatTimeAgo: () => "1h" }));

import { TeamIdleOverview } from "./team-idle-overview";

const TEAM = {
  id: "team-1",
  name: "Release Team",
  creationWorkspaceId: "workspace-1",
  leadMemberId: "member-lead",
  skills: [],
  lifecycle: "active",
  members: [
    {
      memberId: "member-lead",
      role: "Lead",
      level: 5,
      skillIds: [],
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
      mentionHandle: "lead",
    },
    {
      memberId: "member-review",
      role: "Reviewer",
      level: 4,
      skillIds: [],
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
      mentionHandle: "reviewer",
    },
  ],
  methodologyBinding: {
    ...testTeamMethodologyBinding(["member-lead", "member-review"]),
    presetId: "lean-delivery",
  },
  activeMissionId: null,
  revision: 1,
  lifecycleRecoveryFailure: null,
  createdAt: "2026-08-16T08:00:00.000Z",
  updatedAt: "2026-08-16T08:00:00.000Z",
  archivedAt: null,
} as TeamV2;

const HISTORY = [
  {
    id: "mission-completed",
    teamId: TEAM.id,
    workspaceId: "workspace-1",
    objective: "Ship release",
    status: "completed",
    updatedAt: "2026-08-16T09:00:00.000Z",
  } as TeamMission,
];

afterEach(cleanup);

describe("Team idle overview", () => {
  it("shows the Team summary and opens start, settings, and terminal history", () => {
    const onStartMission = vi.fn();
    const onOpenSettings = vi.fn();
    const onSelectMission = vi.fn();
    render(
      <TeamIdleOverview
        team={TEAM}
        history={HISTORY}
        historyStatus="ready"
        historyError={null}
        canStartMission
        workspaceAvailable
        onStartMission={onStartMission}
        onOpenSettings={onOpenSettings}
        onSelectMission={onSelectMission}
        onRetryHistory={vi.fn()}
      />,
    );

    expect(screen.getByText("Release Team")).toBeTruthy();
    expect(screen.getByText("lean-delivery")).toBeTruthy();
    expect(screen.getAllByText("Lead").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Reviewer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Ship release")).toBeTruthy();

    fireEvent.click(screen.getByTestId("team-overview-start-mission"));
    fireEvent.click(screen.getByTestId("team-overview-settings"));
    fireEvent.click(screen.getByTestId("team-overview-history-mission-completed"));

    expect(onStartMission).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onSelectMission).toHaveBeenCalledWith("mission-completed");
  });

  it("keeps the overview actionable when history fails", () => {
    const onRetryHistory = vi.fn();
    render(
      <TeamIdleOverview
        team={TEAM}
        history={[]}
        historyStatus="failed"
        historyError="history unavailable"
        canStartMission={false}
        workspaceAvailable={false}
        onOpenSettings={vi.fn()}
        onSelectMission={vi.fn()}
        onRetryHistory={onRetryHistory}
      />,
    );

    expect(screen.getByText("history unavailable")).toBeTruthy();
    expect(screen.getByText("teams.panel.workspaceRequired")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-overview-history-retry"));
    expect(onRetryHistory).toHaveBeenCalledTimes(1);
  });
});
