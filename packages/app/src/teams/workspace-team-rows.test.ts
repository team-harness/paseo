import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTeamMissionsReplica } from "@/runtime/team-missions-sync/replica";

import { selectWorkspaceTeamRows } from "./workspace-team-rows";

function team(overrides: Partial<TeamV2> = {}): TeamV2 {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    lifecycle: "active",
    activeMissionId: "mission-1",
    ...overrides,
  } as TeamV2;
}

function mission(overrides: Partial<TeamMission> = {}): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "ws-1",
    objective: "Reduce disk usage",
    status: "active",
    ...overrides,
  } as TeamMission;
}

function replica(profiles: readonly TeamV2[], missions: readonly TeamMission[] = []) {
  return createTeamMissionsReplica({
    status: "ready",
    profiles: new Map(profiles.map((profile) => [profile.id, profile])),
    missions: new Map(missions.map((item) => [item.id, item])),
  });
}

describe("the Teams a workspace shows in the sidebar", () => {
  it("places an active Team under its Mission workspace", () => {
    const rows = selectWorkspaceTeamRows(
      replica([team()], [mission({ workspaceId: "ws-2" })]),
      "ws-2",
      ["ws-1", "ws-2"],
    );

    expect(rows).toEqual([{ teamId: "team-1", name: "Disk usage", statusBucket: "running" }]);
  });

  it("drops an archived Team", () => {
    expect(
      selectWorkspaceTeamRows(replica([team({ lifecycle: "archived" })]), "ws-1", ["ws-1"]),
    ).toEqual([]);
  });

  it("keeps an active Team that has no Mission yet", () => {
    expect(
      selectWorkspaceTeamRows(replica([team({ activeMissionId: null })]), "ws-1", ["ws-1"]),
    ).toEqual([{ teamId: "team-1", name: "Disk usage", statusBucket: null }]);
  });

  it("does not place an active Team until its Mission is hydrated", () => {
    expect(selectWorkspaceTeamRows(replica([team()]), "ws-1", ["ws-1"])).toEqual([]);
  });

  it("places an idle Team in the stable first live workspace when its creation workspace is gone", () => {
    const idle = team({ activeMissionId: null, workspaceId: "ws-archived" });

    expect(selectWorkspaceTeamRows(replica([idle]), "ws-a", ["ws-z", "ws-a"])).toEqual([
      { teamId: "team-1", name: "Disk usage", statusBucket: null },
    ]);
    expect(selectWorkspaceTeamRows(replica([idle]), "ws-z", ["ws-z", "ws-a"])).toEqual([]);
  });

  it("uses the active Mission state instead of member Agent activity", () => {
    const rows = selectWorkspaceTeamRows(
      replica([team()], [mission({ status: "needs_attention" })]),
      "ws-1",
      ["ws-1"],
    );

    expect(rows[0]?.statusBucket).toBe("needs_input");
  });

  it("orders by name and then id", () => {
    const rows = selectWorkspaceTeamRows(
      replica([
        team({ id: "b", name: "Zebra", activeMissionId: null }),
        team({ id: "a", name: "Alpha", activeMissionId: null }),
        team({ id: "c", name: "Alpha", activeMissionId: null }),
      ]),
      "ws-1",
      ["ws-1"],
    );

    expect(rows.map((row) => row.teamId)).toEqual(["a", "c", "b"]);
  });
});
