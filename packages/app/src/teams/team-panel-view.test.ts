import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { createTeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import type { Agent } from "@/stores/session-store";
import { describeTeamRoomAuthor, selectTeamPanelView } from "./team-panel-view";

function team(overrides: Partial<TeamV2> = {}): TeamV2 {
  return {
    id: "team-1",
    name: "Runtime",
    workspaceId: "workspace-1",
    lifecycle: "active",
    activeMissionId: "mission-1",
    lifecycleRecoveryFailure: null,
    members: [],
    ...overrides,
  } as TeamV2;
}

function mission(overrides: Partial<TeamMission> = {}): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Ship runtime",
    status: "active",
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        leadMemberId: "member-lead",
        members: [
          {
            memberId: "member-lead",
            role: "Lead",
            mentionHandle: "lead",
          },
          {
            memberId: "member-server",
            role: "Software Engineer",
            mentionHandle: "server",
          },
        ],
      },
    ],
    participants: [
      {
        memberId: "member-lead",
        agentId: "f7268ca6-ec05-4b93-b9c2-09c5140ade8d",
        bindingEpoch: 1,
        joinedAt: "2026-08-09T00:00:00.000Z",
        archivedAt: null,
      },
      {
        memberId: "member-server",
        agentId: "agent-old-server",
        bindingEpoch: 1,
        joinedAt: "2026-08-09T00:00:00.000Z",
        archivedAt: "2026-08-09T00:30:00.000Z",
      },
      {
        memberId: "member-server",
        agentId: "agent-new-server",
        bindingEpoch: 2,
        joinedAt: "2026-08-09T00:31:00.000Z",
        archivedAt: null,
      },
    ],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
    ...overrides,
  } as TeamMission;
}

describe("selecting the Team panel view", () => {
  it("distinguishes room messages from members with the same Role", () => {
    const labels = ["server", "server-2"].map((mentionHandle) =>
      describeTeamRoomAuthor({
        role: "Software Engineer",
        mentionHandle,
        isHuman: false,
        youLabel: "You",
        agentLabel: "Agent",
      }),
    );

    expect(labels).toEqual(["Software Engineer · @server", "Software Engineer · @server-2"]);
  });

  it("uses the Mission snapshot handle for every participant binding without exposing agent ids", () => {
    const profile = team();
    const activeMission = mission();
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[profile.id, profile]]),
      missions: new Map([[activeMission.id, activeMission]]),
    });

    const view = selectTeamPanelView(replica, "team-1", new Map());

    expect(view.state).toBe("ready");
    expect(
      view.members.map((member) => ({
        agentId: member.agentId,
        mentionHandle: member.mentionHandle,
        active: member.active,
      })),
    ).toEqual([
      {
        agentId: "f7268ca6-ec05-4b93-b9c2-09c5140ade8d",
        mentionHandle: "lead",
        active: true,
      },
      { agentId: "agent-old-server", mentionHandle: "server", active: false },
      { agentId: "agent-new-server", mentionHandle: "server", active: true },
    ]);
  });

  it("never presents an opaque agent id as a room author", () => {
    expect(
      describeTeamRoomAuthor({
        role: null,
        mentionHandle: null,
        isHuman: false,
        youLabel: "You",
        agentLabel: "Agent",
      }),
    ).toBe("Agent");
    expect(
      describeTeamRoomAuthor({
        role: null,
        mentionHandle: null,
        isHuman: true,
        youLabel: "我",
        agentLabel: "Agent",
      }),
    ).toBe("我");
    expect(
      describeTeamRoomAuthor({
        role: "Software Engineer",
        mentionHandle: "server",
        isHuman: false,
        youLabel: "You",
        agentLabel: "Agent",
      }),
    ).toBe("Software Engineer · @server");
  });

  it("offers Mission start only for an active Team without an active Mission", () => {
    const profile = team({ activeMissionId: null });
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[profile.id, profile]]),
    });

    expect(selectTeamPanelView(replica, "team-1", new Map())).toMatchObject({
      state: "ready",
      mission: null,
      canStartMission: true,
      readOnly: true,
    });

    const archived = team({ lifecycle: "archived", activeMissionId: null });
    const archivedReplica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[archived.id, archived]]),
    });
    expect(selectTeamPanelView(archivedReplica, "team-1", new Map()).canStartMission).toBe(false);
  });

  it("counts open Mission attention and participant permissions for the settings trigger", () => {
    const profile = team({ lifecycleRecoveryFailure: {} as TeamV2["lifecycleRecoveryFailure"] });
    const activeMission = mission({
      lifecycleRecoveryFailure: {} as TeamMission["lifecycleRecoveryFailure"],
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
    const agents = new Map([
      [
        "agent-new-server",
        { pendingPermissions: [{ id: "permission-1" }, { id: "permission-2" }] } as Agent,
      ],
    ]);

    expect(selectTeamPanelView(replica, "team-1", agents).settingsAttentionCount).toBe(5);
  });

  it("can select a historical Mission without replacing the profile's active Mission", () => {
    const profile = team();
    const activeMission = mission();
    const historicalMission = mission({
      id: "mission-history",
      objective: "Earlier delivery",
      status: "completed",
    });
    const replica = createTeamMissionsReplica({
      status: "ready",
      profiles: new Map([[profile.id, profile]]),
      missions: new Map([
        [activeMission.id, activeMission],
        [historicalMission.id, historicalMission],
      ]),
    });

    expect(selectTeamPanelView(replica, "team-1", new Map(), "mission-history")).toMatchObject({
      mission: { id: "mission-history", objective: "Earlier delivery" },
      readOnly: true,
    });
    expect(profile.activeMissionId).toBe("mission-1");
  });
});
