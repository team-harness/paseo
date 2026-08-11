// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

const noop = () => {};

const mocked = vi.hoisted(() => ({
  profiles: new Map<string, TeamV2>(),
  features: { teamMissions: true, globalTeamProfiles: false },
  optionIds: [] as string[],
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-a": {
          serverInfo: { features: mocked.features },
          teamMissionsReplica: { profiles: mocked.profiles },
        },
      },
    }),
}));
vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactModule.createElement("div", null, children) : null,
    AdaptiveTextInput: ReactModule.forwardRef(
      (
        props: React.InputHTMLAttributes<HTMLInputElement>,
        ref: React.ForwardedRef<HTMLInputElement>,
      ) => ReactModule.createElement("input", { ...props, ref }),
    ),
  };
});
vi.mock("@/components/ui/form-field", async () => {
  const ReactModule = await import("react");
  return {
    Field: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
    FormTextInput: ({ testID, value }: { testID?: string; value?: string }) =>
      ReactModule.createElement("input", { "data-testid": testID, value, readOnly: true }),
  };
});
vi.mock("@/components/ui/select-field", async () => {
  const ReactModule = await import("react");
  return {
    SelectField: ({ testID, options }: { testID?: string; options: Array<{ id: string }> }) => {
      mocked.optionIds = options.map((option) => option.id);
      return ReactModule.createElement("div", { "data-testid": testID });
    },
  };
});
vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
      ReactModule.createElement("button", { "data-testid": testID, type: "button" }, children),
  };
});

import { MissionStartSheet } from "./mission-start-sheet";

describe("MissionStartSheet", () => {
  afterEach(() => {
    cleanup();
    mocked.profiles = new Map();
    mocked.features.globalTeamProfiles = false;
    mocked.optionIds = [];
  });

  it("starts work from a Team selection, objective, constraints and acceptance criteria", () => {
    render(
      <MissionStartSheet serverId="server-a" workspaceId="workspace-a" visible onClose={noop} />,
    );

    expect(screen.getByTestId("mission-start-team")).toBeTruthy();
    expect(screen.getByTestId("mission-start-objective")).toBeTruthy();
    expect(screen.getByTestId("mission-start-add-constraint")).toBeTruthy();
    expect(screen.getByTestId("mission-start-acceptance-0")).toBeTruthy();
  });

  it("offers a Team created in another workspace when profiles are host-global", () => {
    mocked.features.globalTeamProfiles = true;
    mocked.profiles = new Map([
      ["team-other", team("team-other", "workspace-b")],
      ["team-local", team("team-local", "workspace-a")],
    ]);

    render(
      <MissionStartSheet serverId="server-a" workspaceId="workspace-a" visible onClose={noop} />,
    );

    expect(mocked.optionIds).toEqual(["team-other", "team-local"]);
  });

  it("keeps creation-workspace filtering when the feature is absent", () => {
    mocked.profiles = new Map([
      ["team-other", team("team-other", "workspace-b")],
      ["team-local", team("team-local", "workspace-a")],
    ]);

    render(
      <MissionStartSheet serverId="server-a" workspaceId="workspace-a" visible onClose={noop} />,
    );

    expect(mocked.optionIds).toEqual(["team-local"]);
  });
});

function team(id: string, workspaceId: string): TeamV2 {
  return {
    id,
    name: id,
    workspaceId,
    leadMemberId: `lead-${id}`,
    skills: [],
    members: [],
    lifecycle: "active",
    activeMissionId: null,
    lifecycleRecoveryFailure: null,
    revision: 1,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    archivedAt: null,
  };
}
