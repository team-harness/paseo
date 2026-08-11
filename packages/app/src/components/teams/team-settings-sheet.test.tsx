// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

vi.stubGlobal("React", React);

const mocked = vi.hoisted(() => ({
  clientAvailable: true,
  resolveAttention: vi.fn(),
}));

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
  CircleAlert: () => null,
  ClipboardList: () => null,
  ExternalLink: () => null,
  ListTree: () => null,
  Pencil: () => null,
  Play: () => null,
  Settings: () => null,
  Users: () => null,
  X: () => null,
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
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
          "data-disabled": disabled ? "true" : "false",
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

vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));

vi.mock("@/screens/settings/settings-section", async () => {
  const ReactModule = await import("react");
  return {
    SettingsSection: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("section", null, children),
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ readTeamMissionHistory: vi.fn() }),
  useHostRuntimeClient: () =>
    mocked.clientAvailable
      ? {
          resolveTeamMissionAttention: mocked.resolveAttention,
        }
      : null,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          pendingPermissions: new Map(),
          teamMissionsReplica: { historyReads: new Map(), missions: new Map() },
        },
      },
    }),
}));

import { TeamSettingsSheet } from "./team-settings-sheet";

const TEAM: TeamV2 = {
  id: "team-1",
  name: "Release Team",
  workspaceId: "workspace-1",
  leadMemberId: "member-lead",
  skills: [],
  lifecycle: "active",
  members: [],
  activeMissionId: "mission-1",
  revision: 3,
  lifecycleRecoveryFailure: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  archivedAt: null,
};

const EXECUTION_PROFILE = {
  provider: "codex",
  model: null,
  modeId: null,
  thinkingOptionId: null,
  featureValues: {},
} as const;

const MISSION: TeamMission = {
  id: "mission-1",
  teamId: "team-1",
  workspaceId: "workspace-1",
  revision: 4,
  objective: "Ship Attention recovery",
  constraints: [],
  acceptanceCriteria: ["Lead is replaced"],
  status: "needs_attention",
  suspendedStatus: "active",
  workstreams: [],
  activeRosterSnapshotRevision: 2,
  rosterSnapshots: [
    {
      revision: 2,
      teamRevision: 3,
      leadMemberId: "member-lead",
      reason: "initial",
      skills: [],
      members: [
        {
          memberId: "member-lead",
          role: "Lead",
          level: 5,
          skillIds: [],
          executionProfile: EXECUTION_PROFILE,
          mentionHandle: "lead",
          runtimeSnapshot: { providerAvailable: true, toolIds: [], capabilityIds: [] },
        },
        {
          memberId: "member-server",
          role: "Software engineer",
          level: 3,
          skillIds: [],
          executionProfile: EXECUTION_PROFILE,
          mentionHandle: "server",
          runtimeSnapshot: { providerAvailable: true, toolIds: [], capabilityIds: [] },
        },
        {
          memberId: "member-server-2",
          role: "Software engineer",
          level: 3,
          skillIds: [],
          executionProfile: EXECUTION_PROFILE,
          mentionHandle: "server-2",
          runtimeSnapshot: { providerAvailable: true, toolIds: [], capabilityIds: [] },
        },
      ],
      createdAt: "2026-08-10T00:00:00.000Z",
    },
  ],
  planRevision: 1,
  workspaceAuditPolicy: {
    revision: 1,
    includeTrackedPaths: true,
    includeNonIgnoredUntrackedPaths: true,
    includeDeclaredArtifactPaths: true,
    excludeGitignoredPathsByDefault: true,
    excludedPathPrefixes: [],
  },
  chatRoomId: "room-1",
  participants: [],
  workstreamPlanSnapshots: [],
  assignments: [],
  attentionItems: [
    {
      attentionId: "attention-lead",
      kind: "lead_unavailable",
      status: "open",
      priorMissionStatus: "active",
      assignmentId: null,
      summary: "Lead unavailable",
      pathEvidence: [],
      createdAt: "2026-08-10T00:00:00.000Z",
      resolution: null,
    },
  ],
  lifecycleRecoveryFailure: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  completedAt: null,
};

function deferredResult(): {
  promise: Promise<{ error: string | null }>;
  resolve: (result: { error: string | null }) => void;
} {
  let resolve!: (result: { error: string | null }) => void;
  const promise = new Promise<{ error: string | null }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function openAttention(): void {
  fireEvent.click(screen.getByTestId("team-settings-nav-attention"));
}

function renderSheet(visible = true) {
  return render(
    <TeamSettingsSheet
      serverId="server-1"
      team={TEAM}
      mission={MISSION}
      visible={visible}
      onClose={vi.fn()}
    />,
  );
}

describe("TeamSettingsSheet Attention actions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocked.clientAvailable = true;
  });

  it("sends the selected replacement Member and keeps that action pending", async () => {
    const pending = deferredResult();
    mocked.resolveAttention.mockReturnValueOnce(pending.promise);
    renderSheet();

    openAttention();
    const replace = screen.getByTestId("team-attention-attention-lead-replace-member-server");
    fireEvent.click(replace);

    expect(mocked.resolveAttention).toHaveBeenCalledWith({
      missionId: "mission-1",
      attentionId: "attention-lead",
      expectedRevision: 4,
      idempotencyKey: "team-ui:replace_lead:attention-lead:4",
      resolution: {
        kind: "replace_lead",
        replacementMemberId: "member-server",
        reason: "teams.v2Settings.attention.replaceLeadReason:@server",
      },
    });
    await waitFor(() => expect(replace.getAttribute("data-loading")).toBe("true"));
  });

  it("does not render Attention mutations when the host client is unavailable", () => {
    mocked.clientAvailable = false;
    renderSheet();
    openAttention();

    expect(screen.queryByTestId("team-attention-attention-lead-replace-member-server")).toBeNull();
    expect(screen.queryByTestId("team-attention-attention-lead-cancel_mission")).toBeNull();
  });

  it("does not let a closed sheet request overwrite a reopened instance", async () => {
    const oldRequest = deferredResult();
    const newRequest = deferredResult();
    mocked.resolveAttention
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const view = renderSheet();
    openAttention();
    fireEvent.click(screen.getByTestId("team-attention-attention-lead-replace-member-server"));

    view.rerender(
      <TeamSettingsSheet
        serverId="server-1"
        team={TEAM}
        mission={MISSION}
        visible={false}
        onClose={vi.fn()}
      />,
    );
    view.rerender(
      <TeamSettingsSheet
        serverId="server-1"
        team={TEAM}
        mission={MISSION}
        visible
        onClose={vi.fn()}
      />,
    );
    openAttention();
    const replacement = screen.getByTestId("team-attention-attention-lead-replace-member-server-2");
    fireEvent.click(replacement);
    await waitFor(() => expect(replacement.getAttribute("data-loading")).toBe("true"));

    await act(async () => {
      oldRequest.resolve({ error: "closed sheet failure" });
      await oldRequest.promise;
    });

    expect(replacement.getAttribute("data-loading")).toBe("true");
    expect(screen.queryByTestId("team-settings-action-error")).toBeNull();
    newRequest.resolve({ error: null });
    await waitFor(() => expect(replacement.getAttribute("data-loading")).toBe("false"));
  });
});
