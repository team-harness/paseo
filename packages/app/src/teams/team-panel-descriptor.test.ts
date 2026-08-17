import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { describeTeamPanel } from "./team-panel-descriptor";

function team(overrides: Partial<TeamV2> = {}): TeamV2 {
  return {
    id: "team-1",
    name: "Disk usage",
    lifecycle: "active",
    ...overrides,
  } as TeamV2;
}

function mission(overrides: Partial<TeamMission> = {}): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    objective: "Ship the runtime",
    status: "active",
    ...overrides,
  } as TeamMission;
}

describe("describing a Team Mission tab", () => {
  it("waits rather than naming a Team whose profile has not arrived", () => {
    expect(describeTeamPanel(null, null, "team-7")).toEqual({
      label: null,
      subtitle: "team-7",
      titleState: "loading",
      statusBucket: null,
    });
  });

  it("takes its name from the profile and objective from the active Mission", () => {
    expect(describeTeamPanel(team(), mission(), "team-1")).toEqual({
      label: "Disk usage",
      subtitle: "Ship the runtime",
      titleState: "ready",
      statusBucket: "running",
    });
  });

  it("raises the actionable badge for a Mission that needs attention", () => {
    expect(
      describeTeamPanel(team(), mission({ status: "needs_attention" }), "team-1").statusBucket,
    ).toBe("needs_input");
  });

  it("shows no activity badge before a Mission starts", () => {
    expect(describeTeamPanel(team(), null, "team-1").statusBucket).toBeNull();
  });

  it("reports terminal Mission and Team states without consulting participant activity", () => {
    expect(describeTeamPanel(team(), mission({ status: "completed" }), "team-1").statusBucket).toBe(
      "done",
    );
    expect(describeTeamPanel(team(), mission({ status: "failed" }), "team-1").statusBucket).toBe(
      "failed",
    );
    expect(
      describeTeamPanel(team({ lifecycle: "archived" }), mission(), "team-1").statusBucket,
    ).toBe("done");
  });
});
