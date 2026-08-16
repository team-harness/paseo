// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamPanelMember } from "@/teams/team-panel-view";
import type { MissionWorkroomView } from "@/teams/mission-workroom-view";

vi.stubGlobal("React", React);

let compact = false;
let roomInstance = 0;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  ScrollView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));

vi.mock("lucide-react-native", () => ({ ListTree: () => null }));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => compact,
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    children,
    testID,
    sizeContentToCurrentSnapPoint,
  }: {
    visible: boolean;
    children: React.ReactNode;
    testID?: string;
    sizeContentToCurrentSnapPoint?: boolean;
  }) =>
    visible
      ? React.createElement(
          "div",
          {
            "data-testid": testID,
            "data-size-to-current-snap": sizeContentToCurrentSnapPoint ? "true" : "false",
          },
          children,
        )
      : null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick: onPress, "data-testid": testID },
      children,
    ),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => React.createElement("span", null, label),
}));

vi.mock("@/components/teams/member-avatar", () => ({
  MemberAvatar: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
    React.createElement("button", { type: "button", onClick: onPress, "data-testid": testID }),
}));

vi.mock("@/components/teams/team-room", () => ({
  TeamRoom: ({ readOnly }: { readOnly?: boolean }) => {
    const [instance] = React.useState(() => ++roomInstance);
    return React.createElement("div", {
      "data-testid": "team-room",
      "data-read-only": readOnly ? "true" : "false",
      "data-instance": String(instance),
    });
  },
}));

import { MissionWorkroom } from "./mission-workroom";

const VIEW = {
  missionId: "mission-1",
  objective: "Ship the task room",
  status: "active",
  workspaceId: "workspace-1",
  workspaceLabel: "paseo / feature",
  attentionCount: 1,
  members: [
    {
      memberId: "member-lead",
      role: "Lead",
      level: 5,
      mentionHandle: "lead",
      skillNames: ["TypeScript"],
      provider: "codex",
      model: "gpt-5",
      isLead: true,
      participantAgentId: "agent-lead",
      participantState: "active",
      executionSourceStatus: { kind: "inline" },
    },
  ],
  workstreams: [],
  attention: [
    {
      attentionId: "attention-1",
      kind: "lead_unavailable",
      assignmentId: null,
      summary: "Lead needs recovery",
      pathEvidence: [],
      createdAt: "2026-08-16T00:00:00.000Z",
      scope: "mission",
      workstreamId: null,
      workstreamTitle: null,
    },
  ],
  results: [],
} as MissionWorkroomView;

const ROSTER: TeamPanelMember[] = [
  {
    memberId: "member-lead",
    agentId: "agent-lead",
    role: "Lead",
    mentionHandle: "lead",
    active: true,
    isLead: true,
    agent: null,
  },
];

const FAILED_VIEW: MissionWorkroomView = {
  ...VIEW,
  results: [
    {
      id: "workstream-1:0",
      workstreamId: "workstream-1",
      workstreamTitle: "Verify release",
      status: "failed",
      summary: "Tests failed",
      artifactPaths: [],
    },
  ],
};
const UPDATED_VIEW: MissionWorkroomView = { ...VIEW, objective: "Updated objective" };
const OTHER_MISSION_VIEW: MissionWorkroomView = { ...VIEW, missionId: "mission-2" };

describe("MissionWorkroom", () => {
  afterEach(() => {
    compact = false;
    roomInstance = 0;
    cleanup();
  });

  it("keeps chat and the inspector visible together on desktop", () => {
    render(
      <MissionWorkroom
        serverId="server-1"
        view={VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByTestId("mission-workroom-objective").textContent).toBe("Ship the task room");
    expect(screen.getByTestId("mission-workroom-workspace").textContent).toBe("paseo / feature");
    expect(screen.getByTestId("team-room")).toBeTruthy();
    expect(screen.getByTestId("team-room").getAttribute("data-read-only")).toBe("false");
    expect(screen.getByTestId("mission-workroom-inspector")).toBeTruthy();
    expect(screen.queryByTestId("mission-workroom-inspector-sheet")).toBeNull();
  });

  it("opens the same inspector content in a sheet on compact layouts", () => {
    compact = true;
    const onOpenAgent = vi.fn();
    render(
      <MissionWorkroom
        serverId="server-1"
        view={VIEW}
        roster={ROSTER}
        readOnly
        onOpenAgent={onOpenAgent}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("mission-workroom-inspector")).toBeNull();
    expect(screen.getByTestId("team-room").getAttribute("data-read-only")).toBe("true");
    fireEvent.click(screen.getByTestId("mission-workroom-inspector-trigger"));
    expect(screen.getByTestId("mission-workroom-inspector-sheet")).toBeTruthy();
    expect(
      screen
        .getByTestId("mission-workroom-inspector-sheet")
        .getAttribute("data-size-to-current-snap"),
    ).toBe("true");
    expect(screen.getByTestId("mission-workroom-inspector-sheet-content")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mission-workroom-member-agent-lead"));
    expect(onOpenAgent).toHaveBeenCalledWith("agent-lead");
  });

  it("distinguishes failed reports from successful results", () => {
    render(
      <MissionWorkroom
        serverId="server-1"
        view={FAILED_VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("teams.v2Settings.status.failed")).toBeTruthy();
  });

  it("remounts the Room session only when the Mission identity changes", () => {
    const { rerender } = render(
      <MissionWorkroom
        serverId="server-1"
        view={VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );
    const firstInstance = screen.getByTestId("team-room").getAttribute("data-instance");

    rerender(
      <MissionWorkroom
        serverId="server-1"
        view={UPDATED_VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByTestId("team-room").getAttribute("data-instance")).toBe(firstInstance);

    rerender(
      <MissionWorkroom
        serverId="server-1"
        view={OTHER_MISSION_VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByTestId("team-room").getAttribute("data-instance")).not.toBe(firstInstance);
  });
});
