// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

const mocked = vi.hoisted(() => ({
  supported: true,
  profiles: new Map<string, TeamV2>(),
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: () => mocked.supported,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-a": {
          teamMissionsReplica: { profiles: mocked.profiles },
        },
      },
    }),
}));

import { useWorkspaceTeamActions } from "./use-workspace-team-actions";

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

describe("workspace Team actions", () => {
  afterEach(() => {
    cleanup();
    mocked.supported = true;
    mocked.profiles = new Map();
  });

  it("opens Team profile and Mission forms from one capability and only focuses the Team tab", () => {
    mocked.profiles = new Map([
      ["team-a", team("team-a", "workspace-a")],
      ["team-b", team("team-b", "workspace-b")],
    ]);
    const openWorkspaceTabFocused = vi.fn(() => "tab-team-a");
    const { result } = renderHook(() =>
      useWorkspaceTeamActions({
        serverId: "server-a",
        workspaceId: "workspace-a",
        persistenceKey: "server-a:workspace-a",
        workspaceDirectory: "/work/a",
        routeFocused: true,
        openWorkspaceTabFocused,
      }),
    );

    expect(result.current.supported).toBe(true);
    expect(result.current.profiles.map((profile) => profile.id)).toEqual(["team-a"]);

    act(result.current.newTeam.open);
    expect(result.current.newTeam.visible).toBe(true);
    act(result.current.newTeam.close);

    act(result.current.startMission.open);
    expect(result.current.startMission.visible).toBe(true);

    act(() => result.current.onTeamCreated("team-a"));
    act(() => result.current.onMissionStarted("team-a"));
    expect(openWorkspaceTabFocused).toHaveBeenNthCalledWith(1, "server-a:workspace-a", {
      kind: "team",
      teamId: "team-a",
    });
    expect(openWorkspaceTabFocused).toHaveBeenNthCalledWith(2, "server-a:workspace-a", {
      kind: "team",
      teamId: "team-a",
    });
  });

  it("hides both entries when the host does not advertise Team Missions", () => {
    mocked.supported = false;
    const { result } = renderHook(() =>
      useWorkspaceTeamActions({
        serverId: "server-a",
        workspaceId: "workspace-a",
        persistenceKey: "server-a:workspace-a",
        workspaceDirectory: "/work/a",
        routeFocused: true,
        openWorkspaceTabFocused: vi.fn(),
      }),
    );

    expect(result.current.supported).toBe(false);
    expect(result.current.profiles).toEqual([]);
  });
});
