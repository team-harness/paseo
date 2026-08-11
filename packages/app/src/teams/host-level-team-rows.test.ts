import { describe, expect, it } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { selectHostLevelTeamRows } from "./host-level-team-rows";

function team(input: Pick<TeamV2, "id" | "name"> & Partial<TeamV2>): TeamV2 {
  return {
    workspaceId: "workspace-removed",
    leadMemberId: "member-lead",
    skills: [],
    lifecycle: "active",
    members: [],
    activeMissionId: null,
    revision: 1,
    lifecycleRecoveryFailure: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    archivedAt: null,
    ...input,
  };
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
      { teamId: "team-a", name: "Alpha" },
      { teamId: "team-z", name: "Zulu" },
    ]);
  });
});
