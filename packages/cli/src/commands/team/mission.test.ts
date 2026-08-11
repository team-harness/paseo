import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runMissionCancelCommand,
  runMissionInspectCommand,
  runMissionListCommand,
  runMissionStartCommand,
} from "./mission.js";

const { connectToDaemon, client } = vi.hoisted(() => ({
  connectToDaemon: vi.fn(),
  client: {
    getLastServerInfoMessage: () => ({ features: { teamMissions: true } }),
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
  connectToDaemon.mockResolvedValue(client);
});

describe("Mission commands", () => {
  it("starts a Mission with repeated constraints and acceptance criteria", async () => {
    client.startTeamMission.mockResolvedValue({ mission, error: null, errorCode: null });

    await runMissionStartCommand(
      "team-1",
      {
        expectedTeamRevision: "4",
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
      objective: "Ship the CLI",
      constraints: ["No fallback"],
      acceptanceCriteria: ["CLI tests pass", "Typecheck passes"],
    });
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
