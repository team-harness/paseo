import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { testTeamMethodologyBinding } from "./test-fixtures";
import { selectHostLevelTeamRows } from "./host-level-team-rows";

function team(input: Pick<TeamV2, "id" | "name"> & Partial<TeamV2>): TeamV2 {
  return {
    creationWorkspaceId: "workspace-removed",
    leadMemberId: "member-lead",
    skills: [],
    lifecycle: "active",
    members: [],
    methodologyBinding: testTeamMethodologyBinding(),
    activeMissionId: null,
    revision: 1,
    lifecycleRecoveryFailure: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    archivedAt: null,
    ...input,
  };
}

function mission(input: Pick<TeamMission, "id" | "teamId"> & Partial<TeamMission>): TeamMission {
  return {
    workspaceId: "workspace-runtime",
    objective: "Ship the runtime",
    status: "active",
    attentionItems: [],
    updatedAt: "2026-08-16T09:00:00.000Z",
    ...input,
  } as TeamMission;
}

describe("host-level Team rows", () => {
  it("lists active Teams in stable name order and omits archived profiles", () => {
    const profiles = [
      team({ id: "team-z", name: "Zulu" }),
      team({ id: "team-archived", name: "Alpha", lifecycle: "archived" }),
      team({ id: "team-a", name: "Alpha" }),
    ];
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map(profiles.map((profile) => [profile.id, profile])),
    });

    expect(selectHostLevelTeamRows(replica)).toEqual([
      {
        teamId: "team-a",
        name: "Alpha",
        template: "standard",
        members: [],
        mission: null,
        missionPending: false,
        action: "start_mission",
      },
      {
        teamId: "team-z",
        name: "Zulu",
        template: "standard",
        members: [],
        mission: null,
        missionPending: false,
        action: "start_mission",
      },
    ]);
  });

  it("projects the active Mission, open Attention, members, and the next action", () => {
    const profile = team({
      id: "team-runtime",
      name: "Runtime",
      activeMissionId: "mission-runtime",
      members: [
        { memberId: "member-lead", role: "Lead" },
        { memberId: "member-review", role: "Reviewer" },
      ] as TeamV2["members"],
    });
    const activeMission = mission({
      id: "mission-runtime",
      teamId: profile.id,
      attentionItems: [
        { attentionId: "open", status: "open" },
        { attentionId: "resolved", status: "resolved" },
      ] as TeamMission["attentionItems"],
    });
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[profile.id, profile]]),
      missions: new Map([[activeMission.id, activeMission]]),
    });

    expect(selectHostLevelTeamRows(replica)).toEqual([
      {
        teamId: "team-runtime",
        name: "Runtime",
        template: "standard",
        members: [
          { memberId: "member-lead", role: "Lead", isLead: true },
          { memberId: "member-review", role: "Reviewer", isLead: false },
        ],
        mission: {
          missionId: "mission-runtime",
          objective: "Ship the runtime",
          status: "active",
          workspaceId: "workspace-runtime",
          workspaceLabel: "workspace-runtime",
          openAttentionCount: 1,
        },
        missionPending: false,
        action: "enter_room",
      },
    ]);
  });

  it("keeps the idle primary action stable after history is hydrated", () => {
    const profile = team({ id: "team-history", name: "History" });
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[profile.id, profile]]),
      historyReads: new Map([
        [
          profile.id,
          {
            status: "ready",
            missionIds: ["mission-old"],
            error: null,
            requestId: "history-request",
          },
        ],
      ]),
    });

    expect(selectHostLevelTeamRows(replica)[0]).toMatchObject({
      mission: null,
      missionPending: false,
      action: "start_mission",
    });
  });

  it("shows hydration instead of a false empty Mission when the active snapshot is missing", () => {
    const profile = team({
      id: "team-hydrating",
      name: "Hydrating",
      activeMissionId: "mission-pending",
    });
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[profile.id, profile]]),
    });

    expect(selectHostLevelTeamRows(replica)[0]).toMatchObject({
      mission: null,
      missionPending: true,
      action: "loading",
    });
  });
});
