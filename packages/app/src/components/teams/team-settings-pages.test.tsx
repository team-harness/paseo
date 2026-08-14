// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissionAttentionItem, TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";
import {
  TEST_METHODOLOGY,
  testMissionMethodologySnapshot,
  testTeamMethodologyBinding,
} from "@/teams/test-fixtures";

vi.stubGlobal("React", React);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { member?: string; workstream?: string }) => {
      if (values?.member) return `${key}:${values.member}`;
      if (values?.workstream) return `${key}:${values.workstream}`;
      return key;
    },
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
  RefreshCw: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/status-badge", async () => {
  const ReactModule = await import("react");
  return {
    StatusBadge: ({ label }: { label: string }) => ReactModule.createElement("span", null, label),
  };
});

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
  TeamMembersSettingsPage,
  TeamMethodologySettingsPage,
  TeamOverviewSettingsPage,
  TeamPlanSettingsPage,
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

function attention(kind: (typeof ATTENTION_KINDS)[number], index: number): MissionAttentionItem {
  return {
    attentionId: `attention-${index}`,
    kind,
    scope: { kind: "mission" },
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
    capabilityFacts: { kind: "known", capabilityIds: [] },
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
  creationWorkspaceId: "workspace-1",
  leadMemberId: "member-lead",
  skills: [],
  members: [],
  methodologyBinding: testTeamMethodologyBinding(),
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
    methodologySnapshot: testMissionMethodologySnapshot(1, 2),
    methodologyCompiledAt: "2026-08-10T00:00:00.000Z",
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
    reviewWaivers: [],
    lifecycleRecoveryFailure: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    completedAt: null,
    ...overrides,
    capabilityReplanRequests: overrides.capabilityReplanRequests ?? [],
  };
}

const MISSION = createMission({ attentionItems: ATTENTION_KINDS.map(attention) });

const SOURCED_TEAM: TeamV2 = {
  ...TEAM,
  activeMissionId: null,
  skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
  members: [
    {
      ...rosterMember("member-lead", "Lead", "lead"),
      skillIds: ["typescript"],
      executionProfileSource: {
        kind: "agent_profile",
        profileId: "profile-lead",
        resolverVersion: 1,
        appliedDigest: `sha256:${"0".repeat(64)}`,
      },
    },
  ],
};
const REFRESH_MEMBER_EXECUTION = vi.fn();
const MEMBER_REFRESH_ACTIONS: TeamSettingsPageActions = {
  onRefreshMemberExecution: REFRESH_MEMBER_EXECUTION,
};
const MEMBER_REFRESH_ERROR_ACTIONS: TeamSettingsPageActions = {
  ...MEMBER_REFRESH_ACTIONS,
  actionError: "revision conflict",
};
const IDLE_METHODOLOGY_TEAM: TeamV2 = {
  ...SOURCED_TEAM,
  methodologyBinding: testTeamMethodologyBinding(["member-lead"]),
};
const ACTIVE_METHODOLOGY_TEAM: TeamV2 = {
  ...IDLE_METHODOLOGY_TEAM,
  activeMissionId: "mission-active",
};
const METHODOLOGY_UPGRADE_ACTIONS: TeamSettingsPageActions = {
  onUpgradeMethodology: vi.fn(),
};

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
  it("offers refresh for structural gates and shows pending or consumed replan state", () => {
    const onRefreshCapabilities = vi.fn();
    const structuralAttention = {
      attentionId: "attention-0",
      kind: "review_gate_capability_unknown",
      scope: { kind: "workstream", workstreamId: "workstream-1", blockDependents: true },
      reviewGateDetails: {
        gateKey: {
          subject: { workstreamId: "workstream-1", subjectAssignmentIds: [] },
          planRevision: 1,
        },
        gateKeyFingerprint: `sha256:${"1".repeat(64)}`,
        subjectFingerprint: `sha256:${"2".repeat(64)}`,
      },
      status: "open",
      priorMissionStatus: null,
      assignmentId: null,
      summary: "Reviewer capabilities are unknown.",
      pathEvidence: [],
      createdAt: "2026-08-10T00:00:00.000Z",
      resolution: null,
    } as const satisfies MissionAttentionItem;
    const mission = createMission({
      attentionItems: [structuralAttention],
      capabilityReplanRequests: [
        {
          requestId: "request-pending",
          idempotencyKey: "refresh-key",
          requestFingerprint: "refresh-fingerprint",
          sourceAttentionIds: ["attention-0"],
          rosterSnapshotRevision: 3,
          deliveryId: "delivery-pending",
          createdAt: "2026-08-10T00:00:00.000Z",
          consumedAt: null,
        },
      ],
    });
    renderAttention(mission, { onRefreshCapabilities });

    screen.getByTestId("team-attention-attention-0-refresh-capabilities").click();
    expect(onRefreshCapabilities).toHaveBeenCalledWith("attention-0");
    expect(screen.getByTestId("team-settings-page-attention").textContent).toContain(
      "teams.v2Settings.attention.capabilityRefreshPending",
    );

    cleanup();
    renderAttention(
      createMission({
        attentionItems: [structuralAttention],
        capabilityReplanRequests: [
          { ...mission.capabilityReplanRequests[0]!, consumedAt: "2026-08-10T00:01:00.000Z" },
        ],
      }),
      { onRefreshCapabilities },
    );
    expect(screen.getByTestId("team-settings-page-attention").textContent).toContain(
      "teams.v2Settings.attention.capabilityRefreshConsumed",
    );
  });
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

  it("shows a scoped blocker on its Workstream while an independent Workstream stays ready", () => {
    const scopedMission = createMission({
      status: "active",
      suspendedStatus: null,
      workstreams: [
        {
          workstreamId: "workstream-api",
          title: "API",
          objective: "Ship API",
          status: "blocked",
          ownerMemberId: "member-lead",
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
          finalVerificationGate: null,
          dependencyWorkstreamIds: [],
          mutableScope: { kind: "read_only" },
        },
        {
          workstreamId: "workstream-integration",
          title: "Integration",
          objective: "Integrate API",
          status: "blocked",
          ownerMemberId: "member-lead",
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
          finalVerificationGate: null,
          dependencyWorkstreamIds: ["workstream-api"],
          mutableScope: { kind: "read_only" },
        },
        {
          workstreamId: "workstream-ui",
          title: "UI",
          objective: "Ship UI",
          status: "ready",
          ownerMemberId: "member-lead",
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
          finalVerificationGate: null,
          dependencyWorkstreamIds: [],
          mutableScope: { kind: "read_only" },
        },
      ] as unknown as TeamMission["workstreams"],
      attentionItems: [
        {
          attentionId: "attention-api",
          kind: "review_gate_capability_unknown",
          scope: {
            kind: "workstream",
            workstreamId: "workstream-api",
            blockDependents: true,
          },
          status: "open",
          priorMissionStatus: null,
          assignmentId: null,
          summary: "API capability facts are unknown",
          pathEvidence: [],
          createdAt: "2026-08-10T00:00:00.000Z",
          resolution: null,
          reviewGateDetails: {} as never,
        },
      ],
    });

    render(<TeamPlanSettingsPage team={TEAM} mission={scopedMission} actions={NO_ACTIONS} />);
    expect(screen.getByTestId("team-workstream-workstream-api").textContent).toContain(
      "API capability facts are unknown",
    );
    expect(screen.getByTestId("team-workstream-workstream-api").textContent).toContain(
      "teams.v2Settings.status.blocked",
    );
    expect(screen.getByTestId("team-workstream-workstream-integration").textContent).toContain(
      "API capability facts are unknown",
    );
    expect(screen.getByTestId("team-workstream-workstream-integration").textContent).toContain(
      "workstream-api",
    );
    expect(screen.getByTestId("team-workstream-workstream-ui").textContent).toContain(
      "teams.v2Settings.status.ready",
    );

    cleanup();
    renderAttention(scopedMission, NO_ACTIONS);
    expect(screen.getByTestId("team-attention-attention-api-scope").textContent).toContain("API");
  });

  it("shows the final verifier and typed final evidence separately from the coordinator", () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const finalMission = createMission({
      status: "verifying",
      suspendedStatus: null,
      workstreams: [
        {
          workstreamId: "workstream-final-verification",
          kind: "verification",
          title: "Final verification",
          objective: "Verify the Mission",
          ownerMemberId: "member-lead",
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
          finalVerificationGate: {
            key: {
              workstreamId: "workstream-final-verification",
              planRevision: 1,
              methodologySnapshotRevision: 1,
              subjectAssignmentIds: ["assignment-api"],
              reviewGateFingerprints: [],
              requirements: {
                requiredSkillIds: ["typescript"],
                preferredSkillIds: [],
                requiredRuntimeCapabilityIds: [],
                minimumLevel: 3,
              },
            },
            fingerprint,
            selection: {
              kind: "assigned",
              verifierMemberId: "member-reviewer",
              matchExplanation: {} as never,
              independenceExceptionReason: null,
            },
          },
          dependencyWorkstreamIds: [],
          mutableScope: { kind: "read_only" },
          status: "active",
        } as unknown as TeamMission["workstreams"][number],
      ],
      assignments: [
        {
          assignmentId: "assignment-final-verification",
          kind: "verification",
          workstreamId: "workstream-final-verification",
          planRevision: 1,
          semanticState: "completed",
          finalVerificationGateFingerprint: fingerprint,
          reviewGateEvidence: [],
          report: {
            status: "completed",
            verdict: "approved",
            finalVerificationEvidence: {
              kind: "final_verification",
              finalGateFingerprint: fingerprint,
              verdict: "approved",
              reviewGateEvidence: [],
            },
            summary: "Approved",
            artifactPaths: [],
            tests: [],
            decisions: [],
            handoffs: [],
          },
        } as unknown as TeamMission["assignments"][number],
      ],
    });

    render(<TeamPlanSettingsPage team={TEAM} mission={finalMission} actions={NO_ACTIONS} />);
    const card = screen.getByTestId("team-workstream-workstream-final-verification");
    expect(card.textContent).toContain("teams.v2Settings.plan.finalVerificationStatus.approved");
    expect(card.textContent).toContain("Reviewer · @reviewer");
    expect(card.textContent).toContain(fingerprint);
    expect(card.textContent).toContain("approved · 0");
  });

  it("shows a localized empty state when no eligible replacement Lead exists", () => {
    const leadUnavailableMission = createMission({
      rosterSnapshots: [rosterSnapshot([rosterMember("member-lead", "Lead", "lead")])],
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

describe("TeamMembersSettingsPage", () => {
  afterEach(cleanup);

  it("shows an available Agent Profile refresh action", () => {
    REFRESH_MEMBER_EXECUTION.mockClear();

    render(
      <TeamMembersSettingsPage
        team={SOURCED_TEAM}
        mission={null}
        agentProfiles={[{ id: "profile-lead", provider: "codex", model: "changed" }]}
        actions={MEMBER_REFRESH_ACTIONS}
      />,
    );
    fireEvent.click(screen.getByTestId("team-member-member-lead-refresh"));

    expect(REFRESH_MEMBER_EXECUTION).toHaveBeenCalledWith("member-lead");
    expect(screen.getByText("teams.v2Settings.executionSource.update_available")).toBeTruthy();
  });

  it("renders a refresh failure on the Members page", () => {
    render(
      <TeamMembersSettingsPage
        team={SOURCED_TEAM}
        mission={null}
        actions={MEMBER_REFRESH_ERROR_ACTIONS}
      />,
    );

    expect(screen.getByTestId("team-settings-action-error").textContent).toBe("revision conflict");
  });
});

describe("TeamMethodologySettingsPage", () => {
  afterEach(cleanup);

  it("allows an idle Team upgrade while a terminal historical Mission is selected", () => {
    const next = {
      ...TEST_METHODOLOGY,
      ref: {
        ...TEST_METHODOLOGY.ref,
        version: "2",
        digest: `sha256:${"1".repeat(64)}`,
      },
    };
    render(
      <TeamMethodologySettingsPage
        team={IDLE_METHODOLOGY_TEAM}
        mission={createMission({ status: "completed", completedAt: "2026-08-10T01:00:00.000Z" })}
        methodologies={[TEST_METHODOLOGY, next]}
        actions={METHODOLOGY_UPGRADE_ACTIONS}
      />,
    );

    expect(
      (screen.getByTestId(`team-methodology-upgrade-${next.ref.digest}`) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("blocks an active Team upgrade while a terminal historical Mission is selected", () => {
    const next = {
      ...TEST_METHODOLOGY,
      ref: {
        ...TEST_METHODOLOGY.ref,
        version: "2",
        digest: `sha256:${"2".repeat(64)}`,
      },
    };
    render(
      <TeamMethodologySettingsPage
        team={ACTIVE_METHODOLOGY_TEAM}
        mission={createMission({ status: "completed", completedAt: "2026-08-10T01:00:00.000Z" })}
        methodologies={[TEST_METHODOLOGY, next]}
        actions={METHODOLOGY_UPGRADE_ACTIONS}
      />,
    );

    expect(
      (screen.getByTestId(`team-methodology-upgrade-${next.ref.digest}`) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
