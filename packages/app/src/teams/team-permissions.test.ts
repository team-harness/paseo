import { describe, expect, it } from "vitest";

import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { PendingPermission } from "@/types/shared";

import { selectTeamPermissions } from "./team-permissions";

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

function team(members: TeamMemberEntry[]): TeamSnapshot {
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
  };
}

function permission(agentId: string, id: string): PendingPermission {
  return {
    key: `${agentId}:${id}`,
    agentId,
    request: { id, provider: "claude", name: "Bash", kind: "tool", input: {} } as never,
  };
}

describe("the requests a team is waiting on", () => {
  it("keeps two members' requests apart", () => {
    const rows = selectTeamPermissions(
      team([entry({ agentId: "lead-1", role: "lead" }), entry({ agentId: "member-1" })]),
      new Map([
        ["a", permission("member-1", "req-a")],
        ["b", permission("lead-1", "req-b")],
      ]),
    );

    // Two members blocked at once are two decisions. One button for both would
    // answer a question the user was never shown.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.permission.request.id)).toEqual(["req-b", "req-a"]);
  });

  it("puts the lead first", () => {
    const rows = selectTeamPermissions(
      team([entry({ agentId: "member-1" }), entry({ agentId: "lead-1", role: "lead" })]),
      new Map([
        ["a", permission("member-1", "req-a")],
        ["b", permission("lead-1", "req-b")],
      ]),
    );

    // The lead's answer is usually what unblocks the rest.
    expect(rows[0]?.isLead).toBe(true);
  });

  it("lists every request one member has", () => {
    const rows = selectTeamPermissions(
      team([entry({ agentId: "member-1" })]),
      new Map([
        ["a", permission("member-1", "req-a")],
        ["b", permission("member-1", "req-b")],
      ]),
    );

    expect(rows.map((row) => row.permission.request.id)).toEqual(["req-a", "req-b"]);
  });

  it("ignores a member that has left", () => {
    const rows = selectTeamPermissions(
      team([entry({ agentId: "gone-1", state: "removed" })]),
      new Map([["a", permission("gone-1", "req-a")]]),
    );

    // What an ex-member is blocked on is its own business, and this panel does
    // not speak for it any more.
    expect(rows).toEqual([]);
  });

  it("ignores an agent that is not on the team at all", () => {
    const rows = selectTeamPermissions(
      team([entry({ agentId: "member-1" })]),
      new Map([["a", permission("stranger", "req-a")]]),
    );

    expect(rows).toEqual([]);
  });

  it("is empty when nobody is waiting", () => {
    expect(selectTeamPermissions(team([entry()]), new Map())).toEqual([]);
  });
});
