import { describe, expect, it } from "vitest";

import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { TeamMemberAgent } from "@/runtime/team-sync/selectors";

import { selectWorkspaceTeamRows } from "./workspace-team-rows";

function entry(overrides: Partial<TeamMemberEntry> = {}): TeamMemberEntry {
  return {
    agentId: "member-1",
    role: "server",
    joinedAt: "2026-08-06T10:00:00.000Z",
    leftAt: null,
    state: "active",
    removalReason: null,
    ...overrides,
  };
}

function team(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    members: [entry()],
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function teams(...list: TeamSnapshot[]): Map<string, TeamSnapshot> {
  return new Map(list.map((snapshot) => [snapshot.id, snapshot]));
}

const NO_AGENTS: ReadonlyMap<string, TeamMemberAgent> = new Map();

describe("the teams a workspace shows in the sidebar", () => {
  it("lists the teams that belong to this workspace", () => {
    const rows = selectWorkspaceTeamRows(
      teams(team(), team({ id: "team-2", workspaceId: "ws-2" })),
      "ws-1",
      NO_AGENTS,
    );

    expect(rows.map((row) => row.teamId)).toEqual(["team-1"]);
    expect(rows[0]).toMatchObject({ name: "Disk usage" });
  });

  it("drops a team that is over", () => {
    // The panel for an archived team is reachable from history; a permanent
    // sidebar entry for one is a list that only grows.
    const rows = selectWorkspaceTeamRows(
      teams(team({ lifecycle: "archived" }), team({ id: "team-2", lifecycle: "failed" })),
      "ws-1",
      NO_AGENTS,
    );

    expect(rows).toEqual([]);
  });

  it("keeps a team that is still being built", () => {
    // Creation takes seconds and involves several agents. A team that appears
    // only once it is finished looks like nothing happened.
    expect(
      selectWorkspaceTeamRows(teams(team({ lifecycle: "creating" })), "ws-1", NO_AGENTS),
    ).toHaveLength(1);
  });

  it("carries the badge the team's own members earn", () => {
    const agents = new Map<string, TeamMemberAgent>([
      ["member-1", { id: "member-1", title: null, status: "running", labels: {} }],
    ]);

    expect(selectWorkspaceTeamRows(teams(team()), "ws-1", agents)[0]?.statusBucket).toBe("running");
  });

  it("orders by name so the list does not shuffle between renders", () => {
    const rows = selectWorkspaceTeamRows(
      teams(
        team({ id: "b", name: "Zebra" }),
        team({ id: "a", name: "Alpha" }),
        team({ id: "c", name: "Alpha" }),
      ),
      "ws-1",
      NO_AGENTS,
    );

    // Same name falls back to id, or two teams called the same thing swap
    // places whenever the map's iteration order changes.
    expect(rows.map((row) => row.teamId)).toEqual(["a", "c", "b"]);
  });
});
