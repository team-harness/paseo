import { describe, expect, it } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { describeTeamPanel } from "./team-panel-descriptor";

function team(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    members: [],
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

describe("describing a team tab", () => {
  it("waits rather than naming a team it has not been told about", () => {
    // A tab that renames itself "Team" for the second between opening and
    // hydration, then renames itself again, reads as two different tabs.
    expect(describeTeamPanel(null, "idle", "team-7")).toMatchObject({
      titleState: "loading",
      statusBucket: null,
    });
  });

  it("keeps the id as the subtitle so an unnamed tab is still identifiable", () => {
    expect(describeTeamPanel(null, "idle", "team-7").subtitle).toBe("team-7");
  });

  it("takes its name from the team", () => {
    expect(describeTeamPanel(team(), "idle", "team-1")).toMatchObject({
      label: "Disk usage",
      titleState: "ready",
    });
  });

  it("raises a badge for a team that is blocked, and for one that is working", () => {
    expect(describeTeamPanel(team(), "needs_input", "team-1").statusBucket).toBe("needs_input");
    expect(describeTeamPanel(team(), "running", "team-1").statusBucket).toBe("running");
  });

  it("shows nothing for a team that is merely idle", () => {
    // A permanent badge on every team tab is a badge that means nothing.
    expect(describeTeamPanel(team(), "idle", "team-1").statusBucket).toBeNull();
  });

  it("reports a team that ended, and separates one that failed to form", () => {
    expect(describeTeamPanel(team({ lifecycle: "archived" }), "idle", "team-1").statusBucket).toBe(
      "done",
    );
    expect(describeTeamPanel(team({ lifecycle: "failed" }), "idle", "team-1").statusBucket).toBe(
      "failed",
    );
  });

  it("stops reporting member activity once the team is on its way out", () => {
    // Members mid-turn during teardown are still running, and saying so puts a
    // spinner on a team that is ending.
    expect(
      describeTeamPanel(team({ lifecycle: "archiving" }), "running", "team-1").statusBucket,
    ).toBe("done");
  });
});
