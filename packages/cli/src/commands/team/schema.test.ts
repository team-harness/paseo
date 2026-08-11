import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { toMissionDetail, toMissionRow, toTeamProfileDetail, toTeamProfileRow } from "./schema.js";

const timestamp = "2026-08-09T08:00:00.000Z";
const team = {
  id: "team-1",
  name: "Platform",
  workspaceId: "workspace-1",
  leadMemberId: "member-lead",
  skills: [{ skillId: "ts", name: "TypeScript", description: null }],
  members: [
    {
      memberId: "member-lead",
      role: "lead",
      level: 5,
      skillIds: ["ts"],
      executionProfile: {
        provider: "codex",
        model: "gpt-5.6-sol",
        modeId: null,
        thinkingOptionId: "high",
        featureValues: {},
      },
      mentionHandle: "lead",
    },
  ],
  lifecycle: "active",
  activeMissionId: "mission-1",
  lifecycleRecoveryFailure: null,
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
} as const satisfies TeamV2;

const mission = {
  id: "mission-1",
  teamId: team.id,
  workspaceId: team.workspaceId,
  objective: "Ship the CLI",
  constraints: ["No legacy fallback"],
  acceptanceCriteria: ["CLI tests pass"],
  status: "planning",
  revision: 2,
  planRevision: 0,
  participants: [{ memberId: "member-lead" }],
  workstreams: [],
  assignments: [],
  attentionItems: [],
  chatRoomId: "room-1",
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
} as unknown as TeamMission;

describe("Team profile output", () => {
  it("keeps revision and active Mission visible in list output", () => {
    expect(toTeamProfileRow(team)).toMatchObject({
      id: "team-1",
      lifecycle: "active",
      revision: 4,
      lead: "lead",
      members: 1,
      skills: 1,
      activeMission: "mission-1",
    });
  });

  it("keeps Role, Level, Skills and execution profile in inspect output", () => {
    expect(toTeamProfileDetail(team).roster).toEqual([
      {
        memberId: "member-lead",
        role: "lead",
        level: 5,
        skillIds: ["ts"],
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: null,
        thinking: "high",
        featureValues: {},
        mention: "lead",
      },
    ]);
  });
});

describe("Mission output", () => {
  it("makes lifecycle and revision fields machine-readable", () => {
    expect(toMissionRow(mission)).toMatchObject({
      id: "mission-1",
      teamId: "team-1",
      status: "planning",
      revision: 2,
      participants: 1,
      workstreams: 0,
    });
  });

  it("keeps constraints and acceptance criteria in inspect output", () => {
    expect(toMissionDetail(mission)).toMatchObject({
      constraints: ["No legacy fallback"],
      acceptanceCriteria: ["CLI tests pass"],
      room: "room-1",
      assignments: 0,
      attentionItems: 0,
    });
  });
});
