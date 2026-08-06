import { describe, expect, it } from "vitest";

import type { TeamMemberEntry, TeamSnapshot } from "@getpaseo/protocol/team/types";

import { resolveCloseAgentTabPolicy } from "./close-tab-policy";

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

function teamLedBy(agentId: string, overrides: Partial<TeamSnapshot> = {}) {
  const team: TeamSnapshot = {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: agentId,
    members: [entry({ agentId, role: "lead" }), entry()],
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
  return new Map([[team.id, team]]);
}

describe("resolveCloseAgentTabPolicy", () => {
  it("archives root agents when their tab closes", () => {
    expect(resolveCloseAgentTabPolicy({ id: "agent-1", parentAgentId: null })).toEqual({
      kind: "archive-on-close",
    });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ id: "agent-1", parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
    });
  });

  it("preserves the existing archive fallback when the agent is missing", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "archive-on-close" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "archive-on-close" });
  });

  it("asks before closing the tab of a team's lead", () => {
    // A lead is a root agent, so the default archives it — and archiving a lead
    // ends the whole team. From the tab that looks like closing one agent.
    expect(
      resolveCloseAgentTabPolicy({ id: "lead-1", parentAgentId: null }, teamLedBy("lead-1")),
    ).toEqual({
      kind: "confirm-team-lead",
      teamId: "team-1",
      teamName: "Disk usage",
      agentCount: 2,
    });
  });

  it("says nothing about a team that is already over", () => {
    for (const lifecycle of ["archiving", "archived", "failed"] as const) {
      expect(
        resolveCloseAgentTabPolicy(
          { id: "lead-1", parentAgentId: null },
          teamLedBy("lead-1", { lifecycle }),
        ),
      ).toEqual({ kind: "archive-on-close" });
    }
  });

  it("says nothing when everyone has already left", () => {
    const emptied = teamLedBy("lead-1", {
      members: [
        entry({ agentId: "lead-1", role: "lead", state: "removed" }),
        entry({ state: "removed" }),
      ],
    });

    expect(resolveCloseAgentTabPolicy({ id: "lead-1", parentAgentId: null }, emptied)).toEqual({
      kind: "archive-on-close",
    });
  });

  it("leaves an ordinary member alone", () => {
    expect(
      resolveCloseAgentTabPolicy({ id: "member-1", parentAgentId: null }, teamLedBy("lead-1")),
    ).toEqual({ kind: "archive-on-close" });
  });
});
