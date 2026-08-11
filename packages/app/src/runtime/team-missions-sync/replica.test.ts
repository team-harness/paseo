import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  applyTeamMissionsDelta,
  createTeamMissionsReplica,
  replaceTeamMissionHistory,
  replaceTeamMissionsAuthoritative,
} from "./replica";

function profile(overrides: Partial<TeamV2> = {}): TeamV2 {
  return {
    id: "team-1",
    name: "Runtime",
    revision: 1,
    ...overrides,
  } as TeamV2;
}

function mission(overrides: Partial<TeamMission> = {}): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    objective: "Ship the runtime",
    revision: 1,
    ...overrides,
  } as TeamMission;
}

describe("Team Missions replica", () => {
  it("accepts a profile snapshot only when its revision is newer", () => {
    const initial = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([["team-1", profile({ revision: 2, name: "Current" })]]),
    });

    const newer = applyTeamMissionsDelta(initial, {
      kind: "profile",
      profile: profile({ revision: 3, name: "Newer" }),
    });
    const stale = applyTeamMissionsDelta(newer, {
      kind: "profile",
      profile: profile({ revision: 3, name: "Same revision" }),
    });

    expect(newer.profiles.get("team-1")?.name).toBe("Newer");
    expect(stale).toBe(newer);
  });

  it("accepts a Mission snapshot only when its revision is newer", () => {
    const initial = createTeamMissionsReplica({
      status: "ready",
      missions: new Map([["mission-1", mission({ revision: 4, objective: "Current" })]]),
    });

    const stale = applyTeamMissionsDelta(initial, {
      kind: "mission",
      mission: mission({ revision: 3, objective: "Stale" }),
    });
    const newer = applyTeamMissionsDelta(stale, {
      kind: "mission",
      mission: mission({ revision: 5, objective: "Newer" }),
    });

    expect(stale).toBe(initial);
    expect(newer.missions.get("mission-1")?.objective).toBe("Newer");
  });

  it("removes an active profile omitted by the authoritative list", () => {
    const initial = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([
        ["team-1", profile({ id: "team-1" })],
        ["team-2", profile({ id: "team-2" })],
      ]),
    });

    const next = replaceTeamMissionsAuthoritative(initial, {
      profiles: [profile({ id: "team-2" })],
      missions: [],
    });

    expect([...next.profiles.keys()]).toEqual(["team-2"]);
  });

  it("replays buffered snapshots under the same strict revision rule", () => {
    const next = replaceTeamMissionsAuthoritative(
      createTeamMissionsReplica({ status: "loading" }),
      {
        profiles: [profile({ revision: 4, name: "From list" })],
        missions: [mission({ revision: 4, objective: "From inspect" })],
      },
      [
        { kind: "profile", profile: profile({ revision: 3, name: "Older" }) },
        { kind: "mission", mission: mission({ revision: 5, objective: "Newer" }) },
      ],
    );

    expect(next.profiles.get("team-1")?.name).toBe("From list");
    expect(next.missions.get("mission-1")?.objective).toBe("Newer");
  });

  it("never mutates caller-owned maps", () => {
    const profiles = new Map([["team-1", profile({ revision: 1 })]]);
    const missions = new Map([["mission-1", mission({ revision: 1 })]]);
    const initial = createTeamMissionsReplica({ status: "ready", profiles, missions });

    applyTeamMissionsDelta(initial, {
      kind: "profile",
      profile: profile({ revision: 2 }),
    });
    applyTeamMissionsDelta(initial, {
      kind: "mission",
      mission: mission({ revision: 2 }),
    });

    expect(profiles.get("team-1")?.revision).toBe(1);
    expect(missions.get("mission-1")?.revision).toBe(1);
    expect(initial.profiles).not.toBe(profiles);
    expect(initial.missions).not.toBe(missions);
  });

  it("replaces history for only the requested Team", () => {
    const initial = createTeamMissionsReplica({
      status: "ready",
      missions: new Map([
        ["old-team-1", mission({ id: "old-team-1", teamId: "team-1" })],
        ["team-2", mission({ id: "team-2", teamId: "team-2" })],
      ]),
    });

    const next = replaceTeamMissionHistory(initial, "team-1", [
      mission({ id: "new-team-1", teamId: "team-1" }),
    ]);

    expect([...next.missions.keys()].toSorted()).toEqual(["new-team-1", "team-2"]);
  });
});
