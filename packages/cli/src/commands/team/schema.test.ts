import { describe, expect, it } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { toTeamDetail, toTeamMemberRows, toTeamRow } from "./schema.js";

function team(members: Array<Partial<TeamSnapshot["members"][number]>>): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    lifecycle: "active",
    revision: 3,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    members: members.map((member) => ({
      agentId: "member-1",
      role: "server",
      joinedAt: "2026-08-06T10:00:00.000Z",
      leftAt: null,
      state: "active" as const,
      removalReason: null,
      ...member,
    })),
  };
}

describe("the member count a team row reports", () => {
  it("leaves the lead out", () => {
    // The cap the user is told about is eight non-lead members. Counting the
    // lead would show nine on a full team, next to a limit of eight.
    const row = toTeamRow(team([{ agentId: "lead-1", role: "lead" }, { agentId: "member-1" }]));

    expect(row.members).toBe(1);
  });

  it("counts only seats that are still taken", () => {
    const row = toTeamRow(
      team([
        { agentId: "lead-1", role: "lead" },
        { agentId: "member-1" },
        { agentId: "gone-1", state: "removed", removalReason: "removed_by_user" },
        { agentId: "asleep-1", state: "archived" },
      ]),
    );

    // An archived member does not hold its seat — unarchiving it competes for
    // one, which is the rule the daemon's own capacity check uses.
    expect(row.members).toBe(1);
  });
});

describe("the roster a team detail reports", () => {
  it("keeps entries that are no longer members, with why", () => {
    const rows = toTeamMemberRows(
      team([{ agentId: "gone-1", state: "removed", removalReason: "unarchive_evicted" }]),
    );

    expect(rows).toEqual([
      {
        agentId: "gone-1",
        role: "server",
        state: "removed",
        removalReason: "unarchive_evicted",
        joinedAt: "2026-08-06T10:00:00.000Z",
      },
    ]);
  });

  it("carries the team's own state alongside it", () => {
    // A script polling for a creation to converge reads `lifecycle` here; a
    // roster on its own looks identical whatever state the team is in.
    const detail = toTeamDetail(team([{ agentId: "lead-1", role: "lead" }]));

    expect(detail.lifecycle).toBe("active");
    expect(detail.lead).toBe("lead-1");
    expect(detail.room).toBe("room-1");
    expect(detail.roster).toHaveLength(1);
  });
});
