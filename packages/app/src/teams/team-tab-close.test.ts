import { describe, expect, it } from "vitest";

import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import { decideTabClose } from "./team-tab-close";

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
    members: [entry({ agentId: "lead-1", role: "lead" }), entry()],
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

const teams = (snapshot: TeamSnapshot) => new Map([[snapshot.id, snapshot]]);

describe("closing a tab", () => {
  it("asks before putting away a live team's lead", () => {
    const decision = decideTabClose({ kind: "agent", agentId: "lead-1" }, teams(team()));

    // Closing an agent tab has never ended the agent, but a lead's tab is the
    // one a user reads as "the team". Silence here either looks like the team
    // was archived, or invites closing it in order to archive it.
    expect(decision).toEqual({
      kind: "confirm",
      reason: "team_lead",
      teamId: "team-1",
      teamName: "Disk usage",
      agentCount: 2,
    });
  });

  it("just closes an ordinary member's tab", () => {
    expect(decideTabClose({ kind: "agent", agentId: "member-1" }, teams(team()))).toEqual({
      kind: "close",
    });
  });

  it("just closes a tab that is not an agent's", () => {
    expect(decideTabClose({ kind: "terminal", terminalId: "t-1" }, teams(team()))).toEqual({
      kind: "close",
    });
  });

  it("says nothing about a team that is already over", () => {
    for (const lifecycle of ["archiving", "archived", "failed"] as const) {
      expect(
        decideTabClose({ kind: "agent", agentId: "lead-1" }, teams(team({ lifecycle }))),
      ).toEqual({ kind: "close" });
    }
  });

  it("says nothing when every member has already left", () => {
    const emptied = team({
      members: [
        entry({ agentId: "lead-1", role: "lead", state: "removed" }),
        entry({ state: "removed" }),
      ],
    });

    // There is nothing left to be mistaken about.
    expect(decideTabClose({ kind: "agent", agentId: "lead-1" }, teams(emptied))).toEqual({
      kind: "close",
    });
  });

  it("just closes when the agent leads no team", () => {
    expect(decideTabClose({ kind: "agent", agentId: "stranger" }, teams(team()))).toEqual({
      kind: "close",
    });
  });
});
