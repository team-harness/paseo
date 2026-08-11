// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissionAttentionItem, TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

vi.stubGlobal("React", React);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { member?: string }) =>
      values?.member ? `${key}:${values.member}` : key,
  }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", () => ({
  Archive: () => null,
  ChevronRight: () => null,
  ExternalLink: () => null,
  Pencil: () => null,
  Play: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      disabled,
      loading,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      loading?: boolean;
      onPress?: () => void;
      testID?: string;
    }) =>
      ReactModule.createElement(
        "button",
        {
          "data-loading": loading ? "true" : "false",
          "data-testid": testID,
          disabled,
          onClick: onPress,
          type: "button",
        },
        children,
      ),
  };
});

vi.mock("@/screens/settings/settings-section", async () => {
  const ReactModule = await import("react");
  return {
    SettingsSection: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("section", null, children),
  };
});

import {
  TeamAttentionSettingsPage,
  TeamOverviewSettingsPage,
  type TeamSettingsPageActions,
} from "./team-settings-pages";

const ATTENTION_KINDS = [
  "ownership_violation",
  "provider_unavailable",
  "lead_unavailable",
  "notification_unacknowledged",
  "missing_report",
  "assignment_requires_replan",
  "dispatch_acceptance_unknown",
  "participant_unavailable",
  "reviewer_unavailable",
] as const satisfies readonly MissionAttentionItem["kind"][];

const LEAD_RECOVERY_KINDS = [
  "missing_report",
  "assignment_requires_replan",
  "participant_unavailable",
  "reviewer_unavailable",
] as const satisfies readonly MissionAttentionItem["kind"][];

function attention(kind: MissionAttentionItem["kind"], index: number): MissionAttentionItem {
  return {
    attentionId: `attention-${index}`,
    kind,
    status: "open",
    priorMissionStatus: "active",
    assignmentId: "assignment-1",
    summary: `${kind} requires attention`,
    pathEvidence: [],
    createdAt: "2026-08-10T00:00:00.000Z",
    resolution: null,
  };
}

function rosterMember(
  memberId: string,
  role: string,
  mentionHandle: string,
  providerAvailable = true,
): TeamMission["rosterSnapshots"][number]["members"][number] {
  return {
    memberId,
    role,
    level: 3,
    skillIds: [],
    executionProfile: {
      provider: "codex",
      model: null,
      modeId: null,
      thinkingOptionId: null,
      featureValues: {},
    },
    mentionHandle,
    runtimeSnapshot: { providerAvailable, toolIds: [], capabilityIds: [] },
  };
}

function rosterSnapshot(
  members: TeamMission["rosterSnapshots"][number]["members"],
): TeamMission["rosterSnapshots"][number] {
  return {
    revision: 2,
    teamRevision: 1,
    leadMemberId: "member-lead",
    reason: "initial",
    skills: [],
    members,
    createdAt: "2026-08-10T00:00:00.000Z",
  };
}

function participant(
  agentId: string,
  bindingEpoch: number,
  archivedAt: string | null,
): TeamMission["participants"][number] {
  return {
    memberId: "member-lead",
    agentId,
    bindingEpoch,
    joinedAt: "2026-08-10T00:00:00.000Z",
    archivedAt,
  };
}

const TEAM: TeamV2 = {
  id: "team-1",
  name: "Release Team",
  workspaceId: "workspace-1",
  leadMemberId: "member-lead",
  skills: [],
  members: [],
  lifecycle: "active",
  activeMissionId: "mission-1",
  lifecycleRecoveryFailure: null,
  revision: 1,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  archivedAt: null,
};

const MISSING_LEAD_TEAM: TeamV2 = {
  ...TEAM,
  leadMemberId: "0d293cb7-9ed1-46ab-8432-f5bbb75df28e",
};
const NO_ACTIONS: TeamSettingsPageActions = {};

function createMission(overrides: Partial<TeamMission> = {}): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Recover the Mission",
    constraints: [],
    acceptanceCriteria: ["Attention is resolved"],
    status: "needs_attention",
    suspendedStatus: "active",
    activeRosterSnapshotRevision: 2,
    rosterSnapshots: [
      rosterSnapshot([
        rosterMember("member-lead", "Lead", "lead"),
        rosterMember("member-reviewer", "Reviewer", "reviewer"),
      ]),
    ],
    planRevision: 1,
    revision: 4,
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    },
    chatRoomId: "room-1",
    participants: [participant("agent-lead", 1, null)],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const MISSION = createMission({ attentionItems: ATTENTION_KINDS.map(attention) });

const ACTIONS = { onResolveAttention: vi.fn() };

function renderAttention(currentMission: TeamMission, actions: TeamSettingsPageActions): void {
  render(
    <TeamAttentionSettingsPage
      team={TEAM}
      mission={currentMission}
      actions={actions}
      permissionRows={null}
      pendingPermissionCount={0}
    />,
  );
}

describe("TeamAttentionSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("replaces an unavailable Lead with a distinguishable active roster Member", () => {
    const onResolveAttention = vi.fn();
    const leadUnavailableMission = createMission({
      rosterSnapshots: [
        rosterSnapshot([
          rosterMember("member-lead", "Software engineer", "lead"),
          rosterMember("member-server", "Software engineer", "server"),
          rosterMember("member-server-2", "Software engineer", "server-2"),
        ]),
      ],
      participants: [],
      attentionItems: [attention("lead_unavailable", 0)],
    });

    renderAttention(leadUnavailableMission, { onResolveAttention });

    expect(screen.getByText("Software engineer · @server")).toBeTruthy();
    expect(screen.getByText("Software engineer · @server-2")).toBeTruthy();

    fireEvent.click(screen.getByTestId("team-attention-attention-0-replace-member-server-2"));

    expect(onResolveAttention).toHaveBeenCalledWith("attention-0", {
      kind: "replace_lead",
      replacementMemberId: "member-server-2",
      reason: "teams.v2Settings.attention.replaceLeadReason:@server-2",
    });
  });

  it("shows a localized empty state when no eligible replacement Lead exists", () => {
    const leadUnavailableMission = createMission({
      rosterSnapshots: [
        rosterSnapshot([
          rosterMember("member-lead", "Lead", "lead"),
          rosterMember("member-offline", "Reviewer", "offline", false),
        ]),
      ],
      attentionItems: [attention("lead_unavailable", 0)],
    });

    renderAttention(leadUnavailableMission, { onResolveAttention: vi.fn() });

    expect(screen.getByTestId("team-attention-attention-0-no-replacements").textContent).toBe(
      "teams.v2Settings.attention.noReplacementLead",
    );
    expect(screen.getByTestId("team-attention-attention-0-cancel_mission")).toBeTruthy();
  });

  it("opens the active Lead for Attention that requires a new recovery Assignment", () => {
    const onOpenAgent = vi.fn();
    const recoveryMission = createMission({
      rosterSnapshots: [
        rosterSnapshot([
          rosterMember("member-lead", "Lead", "lead"),
          rosterMember("member-reviewer", "Reviewer", "reviewer"),
        ]),
      ],
      participants: [
        participant("agent-old-lead", 1, "2026-08-10T00:00:00.000Z"),
        participant("agent-new-lead", 2, null),
      ],
      attentionItems: LEAD_RECOVERY_KINDS.map(attention),
    });

    renderAttention(recoveryMission, { onOpenAgent, onResolveAttention: vi.fn() });

    for (const index of LEAD_RECOVERY_KINDS.keys()) {
      expect(screen.getByTestId(`team-attention-attention-${index}-open-lead`)).toBeTruthy();
      expect(screen.queryByTestId(`team-attention-attention-${index}-replan`)).toBeNull();
      expect(screen.queryByTestId(`team-attention-attention-${index}-report_received`)).toBeNull();
      expect(
        screen.queryByTestId(`team-attention-attention-${index}-recovery_assignment`),
      ).toBeNull();
    }

    fireEvent.click(screen.getByTestId("team-attention-attention-1-open-lead"));
    expect(onOpenAgent).toHaveBeenCalledWith("agent-new-lead");
  });

  it("shows when recovery cannot proceed because the active Lead is unavailable", () => {
    const recoveryMission = createMission({
      rosterSnapshots: [rosterSnapshot([rosterMember("member-lead", "Lead", "lead")])],
      participants: [participant("agent-old-lead", 1, "2026-08-10T00:00:00.000Z")],
      attentionItems: [attention("missing_report", 0)],
    });

    renderAttention(recoveryMission, { onOpenAgent: vi.fn(), onResolveAttention: vi.fn() });

    expect(screen.getByTestId("team-attention-attention-0-lead-unavailable").textContent).toBe(
      "teams.v2Settings.attention.activeLeadUnavailable",
    );
    expect(screen.queryByTestId("team-attention-attention-0-open-lead")).toBeNull();
  });

  it("does not render an Open Lead button without an open-agent action", () => {
    const recoveryMission = createMission({
      attentionItems: [attention("missing_report", 0)],
    });

    renderAttention(recoveryMission, { onResolveAttention: vi.fn() });

    expect(screen.getByTestId("team-attention-attention-0-lead-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("team-attention-attention-0-open-lead")).toBeNull();
  });

  it("disables sibling actions while one replacement action is pending", () => {
    const leadUnavailableMission = createMission({
      rosterSnapshots: [
        rosterSnapshot([
          rosterMember("member-lead", "Lead", "lead"),
          rosterMember("member-a", "Reviewer", "reviewer-a"),
          rosterMember("member-b", "Reviewer", "reviewer-b"),
        ]),
      ],
      attentionItems: [attention("lead_unavailable", 0)],
    });

    renderAttention(leadUnavailableMission, {
      onResolveAttention: vi.fn(),
      pendingActionKey: "attention:attention-0:replace_lead:member-a",
    });

    expect(
      screen
        .getByTestId("team-attention-attention-0-replace-member-a")
        .getAttribute("data-loading"),
    ).toBe("true");
    expect(
      (screen.getByTestId("team-attention-attention-0-replace-member-b") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("team-attention-attention-0-cancel_mission") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("disables mutations across Attention rows while one mutation is pending", () => {
    renderAttention(MISSION, {
      onResolveAttention: vi.fn(),
      pendingActionKey: "attention:attention-0:external_change",
    });

    expect(
      (screen.getByTestId("team-attention-attention-1-resume_provider") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("team-attention-attention-3-restore_notification") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("does not render mutation buttons without an Attention resolution action", () => {
    renderAttention(MISSION, NO_ACTIONS);

    expect(screen.queryByTestId("team-attention-attention-0-external_change")).toBeNull();
    expect(screen.queryByTestId("team-attention-attention-2-replace-member-reviewer")).toBeNull();
    expect(screen.queryByTestId("team-attention-attention-2-cancel_mission")).toBeNull();
  });

  it("only renders Attention resolutions implemented by the application service", () => {
    renderAttention(MISSION, ACTIONS);

    expect(screen.getByTestId("team-attention-attention-0-external_change")).toBeTruthy();
    expect(screen.getByTestId("team-attention-attention-1-resume_provider")).toBeTruthy();
    expect(screen.getByTestId("team-attention-attention-3-restore_notification")).toBeTruthy();

    for (const index of ATTENTION_KINDS.keys()) {
      expect(screen.getByTestId(`team-attention-attention-${index}-cancel_mission`)).toBeTruthy();
      expect(screen.queryByTestId(`team-attention-attention-${index}-replan`)).toBeNull();
      expect(screen.queryByTestId(`team-attention-attention-${index}-replace_lead`)).toBeNull();
      expect(screen.queryByTestId(`team-attention-attention-${index}-report_received`)).toBeNull();
      expect(
        screen.queryByTestId(`team-attention-attention-${index}-recovery_assignment`),
      ).toBeNull();
    }
    expect(screen.queryByTestId("team-attention-attention-6-open-lead")).toBeNull();
  });
});

describe("TeamOverviewSettingsPage", () => {
  afterEach(cleanup);

  it("uses an unavailable label instead of exposing a missing Lead UUID", () => {
    render(
      <TeamOverviewSettingsPage team={MISSING_LEAD_TEAM} mission={null} actions={NO_ACTIONS} />,
    );

    expect(screen.queryByText("0d293cb7-9ed1-46ab-8432-f5bbb75df28e")).toBeNull();
    expect(screen.getByText("teams.v2Settings.team.leadUnavailable")).toBeTruthy();
  });
});
