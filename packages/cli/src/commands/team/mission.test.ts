import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runMissionCancelCommand,
  runMissionInspectCommand,
  runMissionListCommand,
  runMissionStartCommand,
} from "./mission.js";

const { connectToDaemon, client, serverFeatures } = vi.hoisted(() => ({
  connectToDaemon: vi.fn(),
  serverFeatures: { teamMissions: true, globalTeamProfiles: true } as {
    teamMissions: boolean;
    globalTeamProfiles?: boolean;
  },
  client: {
    getLastServerInfoMessage: () => ({ features: serverFeatures }),
    supportsGlobalTeamProfiles: () => serverFeatures.globalTeamProfiles === true,
    startTeamMission: vi.fn(),
    listTeamMissions: vi.fn(),
    inspectTeamMission: vi.fn(),
    cancelTeamMission: vi.fn(),
    close: vi.fn(async () => {}),
  },
}));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon,
  getDaemonHost: () => "127.0.0.1:6767",
}));

const mission = {
  id: "mission-1",
  teamId: "team-1",
  workspaceId: "workspace-1",
  objective: "Ship the CLI",
  constraints: ["No fallback"],
  acceptanceCriteria: ["CLI tests pass"],
  status: "planning",
  revision: 2,
  planRevision: 0,
  participants: [],
  workstreams: [],
  assignments: [],
  attentionItems: [],
  chatRoomId: "room-1",
  updatedAt: "2026-08-09T08:00:00.000Z",
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  serverFeatures.globalTeamProfiles = true;
  connectToDaemon.mockResolvedValue(client);
});

describe("Mission commands", () => {
  it("starts a Mission with repeated constraints and acceptance criteria", async () => {
    client.startTeamMission.mockResolvedValue({ mission, error: null, errorCode: null });

    await runMissionStartCommand(
      "team-1",
      {
        expectedTeamRevision: "4",
        workspace: "workspace-1",
        objective: "Ship the CLI",
        constraint: ["No fallback"],
        acceptance: ["CLI tests pass", "Typecheck passes"],
        idempotencyKey: "start-key",
      },
      null as never,
    );

    expect(client.startTeamMission).toHaveBeenCalledWith({
      idempotencyKey: "start-key",
      teamId: "team-1",
      expectedTeamRevision: 4,
      workspaceId: "workspace-1",
      objective: "Ship the CLI",
      constraints: ["No fallback"],
      acceptanceCriteria: ["CLI tests pass", "Typecheck passes"],
    });
  });

  it("requires an explicit workspace when the daemon exposes global Team profiles", async () => {
    await expect(
      runMissionStartCommand(
        "team-1",
        {
          expectedTeamRevision: "4",
          objective: "Ship the CLI",
          acceptance: ["CLI tests pass"],
        },
        null as never,
      ),
    ).rejects.toMatchObject({ code: "MISSING_OPTION", message: "--workspace is required" });
    expect(client.startTeamMission).not.toHaveBeenCalled();
  });

  it("keeps the old Mission request shape for a daemon without global Team profiles", async () => {
    delete serverFeatures.globalTeamProfiles;
    client.startTeamMission.mockResolvedValue({ mission, error: null, errorCode: null });

    await runMissionStartCommand(
      "team-1",
      {
        expectedTeamRevision: "4",
        objective: "Ship the CLI",
        acceptance: ["CLI tests pass"],
      },
      null as never,
    );

    expect(client.startTeamMission).toHaveBeenCalledWith(
      expect.not.objectContaining({ workspaceId: expect.anything() }),
    );
  });

  it("lists, inspects and cancels through the v2 SDK", async () => {
    client.listTeamMissions.mockResolvedValue({
      missions: [mission],
      error: null,
      errorCode: null,
    });
    client.inspectTeamMission.mockResolvedValue({ mission, error: null, errorCode: null });
    client.cancelTeamMission.mockResolvedValue({ mission, error: null, errorCode: null });

    await runMissionListCommand("team-1", { all: true }, null as never);
    await runMissionInspectCommand("mission-1", {}, null as never);
    await runMissionCancelCommand(
      "mission-1",
      { expectedRevision: "2", reason: "Stopped by user", idempotencyKey: "cancel-key" },
      null as never,
    );

    expect(client.listTeamMissions).toHaveBeenCalledWith({
      teamId: "team-1",
      includeTerminal: true,
    });
    expect(client.inspectTeamMission).toHaveBeenCalledWith({ missionId: "mission-1" });
    expect(client.cancelTeamMission).toHaveBeenCalledWith({
      idempotencyKey: "cancel-key",
      missionId: "mission-1",
      expectedRevision: 2,
      reason: "Stopped by user",
    });
  });
});
