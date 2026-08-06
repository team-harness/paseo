import { describe, expect, it } from "vitest";

import { TEAM_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import {
  selectLiveTeamIds,
  selectMemberActivity,
  selectSubagentsWithoutTeamMembers,
  selectTeamActivity,
  selectTeamRoster,
  selectTeamStage,
  teamStageAcceptsActions,
  type TeamMemberAgent,
} from "./selectors";

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

function team(members: TeamMemberEntry[], overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    members,
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function agent(overrides: Partial<TeamMemberAgent> = {}): TeamMemberAgent {
  return { id: "member-1", title: null, status: "idle", labels: {}, ...overrides };
}

describe("joining a roster to the agents the client holds", () => {
  it("keeps an entry whose agent has not loaded", () => {
    const rows = selectTeamRoster(team([entry()]), new Map());

    // Members load lazily. Dropping the row would shrink the team rather than
    // show it incompletely.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBeNull();
  });

  it("marks the lead", () => {
    const rows = selectTeamRoster(
      team([entry({ agentId: "lead-1", role: "lead" }), entry()]),
      new Map(),
    );

    expect(rows.map((row) => row.isLead)).toEqual([true, false]);
  });
});

describe("where a team is in its own life", () => {
  it("reads a team still being built as under construction", () => {
    expect(selectTeamStage(team([], { lifecycle: "creating" }))).toBe("creating");
  });

  it("keeps archiving separate from archived, because one is still going", () => {
    expect(selectTeamStage(team([], { lifecycle: "archiving" }))).toBe("archiving");
    expect(selectTeamStage(team([], { lifecycle: "archived" }))).toBe("ended");
  });

  it("reads a failed creation as over, not as a team to keep acting on", () => {
    expect(selectTeamStage(team([], { lifecycle: "failed" }))).toBe("ended");
  });

  it("stops offering lifecycle actions once one is under way or done", () => {
    expect(teamStageAcceptsActions("creating")).toBe(true);
    expect(teamStageAcceptsActions("active")).toBe(true);
    expect(teamStageAcceptsActions("archiving")).toBe(false);
    expect(teamStageAcceptsActions("ended")).toBe(false);
  });
});

describe("what a member is doing", () => {
  it("puts a request for input above everything else", () => {
    // A member blocked on a permission is running, as far as its status goes.
    // What matters is that somebody has to answer it.
    expect(
      selectMemberActivity(
        agent({ status: "running", requiresAttention: true, pendingPermissionCount: 1 }),
      ),
    ).toBe("needs_input");
    expect(
      selectMemberActivity(
        agent({ status: "running", requiresAttention: true, attentionReason: "permission" }),
      ),
    ).toBe("needs_input");
  });

  it("does not read a finished member as one waiting on you", () => {
    // Finishing sets `requiresAttention` too. Reading that as "waiting on you"
    // puts a permanent badge on the team over a panel with nothing to press:
    // the permissions section has no rows, because there are no requests.
    expect(
      selectMemberActivity(
        agent({ status: "idle", requiresAttention: true, attentionReason: "finished" }),
      ),
    ).toBe("idle");
  });

  it("counts initializing as working", () => {
    expect(selectMemberActivity(agent({ status: "initializing" }))).toBe("running");
  });

  it("treats an agent it has not loaded as quiet", () => {
    expect(selectMemberActivity(null)).toBe("idle");
  });
});

describe("what a team is doing", () => {
  it("takes the most urgent member", () => {
    const rows = selectTeamRoster(
      team([entry({ agentId: "a" }), entry({ agentId: "b" }), entry({ agentId: "c" })]),
      new Map([
        ["a", agent({ id: "a", status: "idle" })],
        ["b", agent({ id: "b", status: "running" })],
        ["c", agent({ id: "c", status: "idle", pendingPermissionCount: 1 })],
      ]),
    );

    // A team with one member waiting on a person is a blocked team; averaging
    // that away is how a request for input goes unnoticed.
    expect(selectTeamActivity(rows)).toBe("needs_input");
  });

  it("falls back to running when nobody is waiting", () => {
    const rows = selectTeamRoster(
      team([entry({ agentId: "a" }), entry({ agentId: "b" })]),
      new Map([
        ["a", agent({ id: "a", status: "idle" })],
        ["b", agent({ id: "b", status: "running" })],
      ]),
    );

    expect(selectTeamActivity(rows)).toBe("running");
  });

  it("ignores members that have left", () => {
    const rows = selectTeamRoster(
      team([entry({ agentId: "a" }), entry({ agentId: "gone", state: "removed" })]),
      new Map([
        ["a", agent({ id: "a", status: "idle" })],
        ["gone", agent({ id: "gone", status: "running", requiresAttention: true })],
      ]),
    );

    // What an ex-member is blocked on is not this team's business.
    expect(selectTeamActivity(rows)).toBe("idle");
  });

  it("is quiet for a team with nothing loaded", () => {
    expect(selectTeamActivity([])).toBe("idle");
  });
});

describe("keeping a subagents track from repeating the team panel", () => {
  it("drops members of the team being shown", () => {
    const subagents = [
      { id: "recruit-1", labels: { [TEAM_ID_LABEL]: "team-1" } },
      { id: "helper-1", labels: {} },
    ];

    // A recruit is stamped with its recruiter as parent, so it is a subagent
    // and a team member at once. Both surfaces would otherwise draw it.
    expect(
      selectSubagentsWithoutTeamMembers(subagents, new Set(["team-1"])).map((row) => row.id),
    ).toEqual(["helper-1"]);
  });

  it("keeps members of a team that is over", () => {
    const subagents = [{ id: "recruit-1", labels: { [TEAM_ID_LABEL]: "team-1" } }];

    // Nothing draws that team's panel any more, so hiding its members here
    // would hide them everywhere.
    expect(selectSubagentsWithoutTeamMembers(subagents, new Set())).toHaveLength(1);
  });

  it("keeps a subagent with no labels at all", () => {
    expect(selectSubagentsWithoutTeamMembers([{ id: "plain" }], new Set(["team-1"]))).toHaveLength(
      1,
    );
  });

  it("counts only the teams that still have a panel", () => {
    const teams = new Map([
      ["live", team([], { id: "live", lifecycle: "active" })],
      ["gone", team([], { id: "gone", lifecycle: "archived" })],
    ]);

    expect([...selectLiveTeamIds(teams)]).toEqual(["live"]);
  });
});
