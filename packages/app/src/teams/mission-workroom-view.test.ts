import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { selectMissionWorkroomView } from "./mission-workroom-view";

const TEAM = {
  id: "team-1",
  name: "Platform Team",
  leadMemberId: "member-lead",
  skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
  members: [
    {
      memberId: "member-lead",
      role: "Lead",
      level: 5,
      skillIds: ["typescript"],
      executionProfile: {
        provider: "codex",
        model: "gpt-5",
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
      executionProfileSource: null,
      mentionHandle: "lead",
    },
  ],
} as unknown as TeamV2;

const MISSION = {
  id: "mission-1",
  teamId: TEAM.id,
  workspaceId: "workspace-1",
  objective: "Ship the task room",
  status: "active",
  activeRosterSnapshotRevision: 1,
  rosterSnapshots: [
    {
      revision: 1,
      teamRevision: 1,
      leadMemberId: "member-lead",
      reason: "initial",
      skills: TEAM.skills,
      members: [
        {
          ...TEAM.members[0],
          capabilityFacts: { kind: "known", capabilityIds: [] },
        },
      ],
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  ],
  participants: [
    {
      memberId: "member-lead",
      agentId: "agent-lead",
      bindingEpoch: 1,
      joinedAt: "2026-08-16T00:00:00.000Z",
      archivedAt: null,
    },
  ],
  attentionItems: [
    {
      attentionId: "attention-1",
      kind: "lead_unavailable",
      assignmentId: null,
      summary: "Lead needs recovery",
      pathEvidence: [],
      createdAt: "2026-08-16T00:00:00.000Z",
      status: "open",
      scope: { kind: "mission" },
    },
  ],
  workstreams: [],
  assignments: [],
  reviewWaivers: [],
} as unknown as TeamMission;

describe("selectMissionWorkroomView", () => {
  it("combines the Mission header with existing member and Attention projections", () => {
    const view = selectMissionWorkroomView({
      team: TEAM,
      mission: MISSION,
      workspaceLabel: "paseo / feature",
      agentProfiles: [],
    });

    expect(view).toMatchObject({
      missionId: "mission-1",
      objective: "Ship the task room",
      status: "active",
      workspaceId: "workspace-1",
      workspaceLabel: "paseo / feature",
      attentionCount: 1,
      members: [
        {
          memberId: "member-lead",
          role: "Lead",
          participantAgentId: "agent-lead",
          participantState: "active",
        },
      ],
      attention: [
        {
          attentionId: "attention-1",
          summary: "Lead needs recovery",
          scope: "mission",
        },
      ],
      workstreams: [],
      results: [],
    });
  });

  it("uses the frozen Mission roster when the idle Team profile changed later", () => {
    const updatedTeam = {
      ...TEAM,
      leadMemberId: "member-new",
      members: [
        {
          ...TEAM.members[0],
          memberId: "member-new",
          role: "New maintainer",
          mentionHandle: "new-maintainer",
        },
      ],
    } as unknown as TeamV2;

    const view = selectMissionWorkroomView({
      team: updatedTeam,
      mission: MISSION,
      workspaceLabel: "paseo / feature",
    });

    expect(view.members).toHaveLength(1);
    expect(view.members[0]).toMatchObject({
      memberId: "member-lead",
      role: "Lead",
      mentionHandle: "lead",
      participantAgentId: "agent-lead",
    });
  });
});
