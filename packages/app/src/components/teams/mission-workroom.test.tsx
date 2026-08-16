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

vi.mock("lucide-react-native", () => ({
  FileCheck2: () => null,
  ListChecks: () => null,
  ListTree: () => null,
  Users: () => null,
}));

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

vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    value,
    onValueChange,
    testID,
  }: {
    options: { value: string; label: string; testID?: string }[];
    value: string;
    onValueChange: (value: string) => void;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": testID, "data-value": value },
      options.map((option) =>
        React.createElement(
          "button",
          {
            key: option.value,
            type: "button",
            "data-testid": option.testID,
            onClick: () => onValueChange(option.value),
          },
          option.label,
        ),
      ),
    ),
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
      agentLifecycleStatus: "running",
      requiresAttention: true,
      attentionReason: "permission",
      pendingPermissionCount: 1,
      currentAssignments: [],
      needsInput: true,
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
      workstreamId: "workstream-1",
      workstreamTitle: "Verify release",
      reviewOutcome: "waived",
      reviewReport: null,
      reviewWaiver: {
        waiverId: "waiver-1",
        connectionId: "connection-1",
        selfReportedClientLabel: "Desktop",
        reason: "No reviewer available",
      },
      finalVerificationStatus: "changes_requested",
      finalVerificationEvidence: {
        kind: "final_verification",
        finalGateFingerprint: "sha256:final",
        verdict: "changes_requested",
        reviewGateEvidence: [],
      },
      reports: [
        {
          assignmentId: "assignment-1",
          assignmentKind: "verification",
          assigneeRole: "Verifier",
          status: "failed",
          summary: "Tests failed",
          artifactPaths: ["artifacts/report.json"],
          tests: [{ command: "npm test", passed: false }],
          verdict: "changes_requested",
        },
      ],
    },
  ],
};
const UPDATED_VIEW: MissionWorkroomView = { ...VIEW, objective: "Updated objective" };
const OTHER_MISSION_VIEW: MissionWorkroomView = { ...VIEW, missionId: "mission-2" };
const DEPENDENCY_VIEW = {
  ...VIEW,
  workstreams: [
    {
      workstreamId: "workstream-main",
      title: "Main delivery",
      objective: "Integrate everything",
      status: "blocked",
      owner: { memberId: "member-lead", role: "Lead", mentionHandle: "lead" },
      dependencyWorkstreamIds: ["workstream-api"],
      dependencies: [{ workstreamId: "workstream-api", title: "Build API", status: "active" }],
      blockers: [],
      reviewSelection: "not_required",
      reviewOutcome: "not_required",
      finalVerificationStatus: null,
    },
  ],
  members: [
    {
      ...VIEW.members[0],
      currentAssignments: [
        {
          assignmentId: "assignment-long",
          kind: "delivery",
          objective: "A very long Assignment objective that must wrap within the inspector",
          state: "running",
        },
      ],
    },
  ],
} as unknown as MissionWorkroomView;

describe("MissionWorkroom", () => {
  afterEach(() => {
    compact = false;
    roomInstance = 0;
    cleanup();
  });

  it("keeps chat and the inspector visible together on desktop", () => {
    const onOpenSettings = vi.fn();
    const onOpenAttention = vi.fn();
    render(
      <MissionWorkroom
        serverId="server-1"
        view={VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenAttention={onOpenAttention}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByTestId("mission-workroom-objective").textContent).toBe("Ship the task room");
    expect(screen.getByTestId("mission-workroom-workspace").textContent).toBe("paseo / feature");
    expect(screen.getByTestId("team-room")).toBeTruthy();
    expect(screen.getByTestId("team-room").getAttribute("data-read-only")).toBe("false");
    expect(screen.getByTestId("mission-workroom-inspector")).toBeTruthy();
    expect(screen.getByTestId("mission-workroom-inspector-tabs").getAttribute("data-value")).toBe(
      "work",
    );
    fireEvent.click(screen.getByTestId("mission-workroom-attention-attention-1-open"));
    expect(onOpenAttention).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByTestId("mission-workroom-inspector-tab-people"));
    fireEvent.click(screen.getByTestId("mission-workroom-member-agent-lead"));
    expect(onOpenAgent).toHaveBeenCalledWith("agent-lead");
  });

  it("switches between the people and result evidence views", () => {
    render(
      <MissionWorkroom
        serverId="server-1"
        view={FAILED_VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("mission-workroom-inspector-tab-people"));
    expect(screen.getByTestId("mission-workroom-member-agent-lead")).toBeTruthy();
    expect(screen.getByText(/agentList\.status\.running/)).toBeTruthy();
    expect(screen.getByText("teams.workroom.pendingPermissions")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mission-workroom-inspector-tab-results"));
    expect(screen.getByText("teams.v2Settings.status.failed")).toBeTruthy();
    expect(screen.getByText("artifacts/report.json")).toBeTruthy();
    expect(screen.getByText(/npm test/)).toBeTruthy();
    expect(screen.getByText("No reviewer available")).toBeTruthy();
    expect(screen.getByText("teams.v2Settings.plan.reviewOutcome.waived")).toBeTruthy();
    expect(
      screen.getByText("teams.v2Settings.plan.finalVerificationStatus.changes_requested"),
    ).toBeTruthy();
    expect(screen.getByText("teams.workroom.reviewVerdict")).toBeTruthy();
    expect(screen.getByText("teams.workroom.finalVerificationEvidence")).toBeTruthy();
  });

  it("shows dependency identities and keeps a long Assignment objective inside the row", () => {
    render(
      <MissionWorkroom
        serverId="server-1"
        view={DEPENDENCY_VIEW}
        roster={ROSTER}
        readOnly={false}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByTestId("mission-workroom-dependency-workstream-api")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mission-workroom-inspector-tab-people"));
    expect(screen.getByTestId("mission-workroom-assignment-assignment-long-copy")).toBeTruthy();
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
