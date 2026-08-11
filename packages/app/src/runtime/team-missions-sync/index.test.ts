import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { TeamMissionsSync, type TeamMissionsSyncConnection } from "./index";
import type { TeamMissionsReplica } from "./replica";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function profile(overrides: Partial<TeamV2> = {}): TeamV2 {
  return {
    id: "team-1",
    name: "Runtime",
    activeMissionId: null,
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

class FakeClient {
  readonly operations: string[] = [];
  listedProfiles: TeamV2[] = [];
  listProfilesError: string | null = null;
  listProfilesFailure: Error | null = null;
  listProfilesGate: Promise<void> = Promise.resolve();
  inspectedMissions = new Map<string, TeamMission | null>();
  inspectFailures = new Map<string, Error>();
  historyResponses: Array<{
    missions: TeamMission[];
    error: string | null;
    gate?: Promise<void>;
  }> = [];
  private readonly profileHandlers = new Set<(message: unknown) => void>();
  private readonly missionHandlers = new Set<(message: unknown) => void>();

  listTeamProfiles = vi.fn(async () => {
    this.operations.push("list-profiles");
    await this.listProfilesGate;
    if (this.listProfilesFailure) throw this.listProfilesFailure;
    return {
      requestId: "req-profiles",
      teams: this.listedProfiles,
      error: this.listProfilesError,
      errorCode: this.listProfilesError ? "READ_FAILED" : null,
    };
  });

  inspectTeamMission = vi.fn(async ({ missionId }: { missionId: string }) => {
    this.operations.push(`inspect:${missionId}`);
    const failure = this.inspectFailures.get(missionId);
    if (failure) throw failure;
    return {
      requestId: `req-${missionId}`,
      mission: this.inspectedMissions.get(missionId) ?? null,
      error: null,
      errorCode: null,
    };
  });

  listTeamMissions = vi.fn(async ({ teamId }: { teamId: string }) => {
    this.operations.push(`history:${teamId}`);
    const response = this.historyResponses.shift() ?? { missions: [], error: null };
    await response.gate;
    return {
      requestId: `req-history-${teamId}`,
      missions: response.missions,
      error: response.error,
      errorCode: response.error ? "READ_FAILED" : null,
    };
  });

  on(event: string, handler: (message: unknown) => void): () => void {
    this.operations.push(`listen:${event}`);
    const handlers =
      event === "team.profile.snapshot" ? this.profileHandlers : this.missionHandlers;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  broadcastProfile(team: TeamV2): void {
    for (const handler of this.profileHandlers) {
      handler({ type: "team.profile.snapshot", payload: { team } });
    }
  }

  broadcastMission(snapshot: TeamMission): void {
    for (const handler of this.missionHandlers) {
      handler({ type: "team.mission.snapshot", payload: { mission: snapshot } });
    }
  }

  holdProfiles(): () => void {
    let release = () => {};
    this.listProfilesGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }
}

describe("Team Missions authoritative synchronization", () => {
  let client: FakeClient;
  let replicas: TeamMissionsReplica[];
  let sync: TeamMissionsSync;

  function connection(
    overrides: Partial<TeamMissionsSyncConnection> = {},
  ): TeamMissionsSyncConnection {
    return {
      client: client as never,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
      supportsTeamMissions: true,
      ...overrides,
    };
  }

  function latest(): TeamMissionsReplica {
    const replica = replicas.at(-1);
    if (!replica) throw new Error("the sync has not published a replica");
    return replica;
  }

  beforeEach(() => {
    client = new FakeClient();
    replicas = [];
    sync = new TeamMissionsSync({ commit: (replica) => replicas.push(replica) });
  });

  it("waits for the host capability before sending any RPC", () => {
    sync.connectionChanged(connection({ supportsTeamMissions: null }));

    expect(latest().status).toBe("checking_host");
    expect(client.listTeamProfiles).not.toHaveBeenCalled();
    expect(client.inspectTeamMission).not.toHaveBeenCalled();
    expect(client.listTeamMissions).not.toHaveBeenCalled();
  });

  it("subscribes before listing profiles and inspecting active Missions", async () => {
    client.listedProfiles = [profile({ activeMissionId: "mission-1" })];
    client.inspectedMissions.set("mission-1", mission());

    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().status).toBe("ready"));

    expect(client.operations).toEqual([
      "listen:team.profile.snapshot",
      "listen:team.mission.snapshot",
      "list-profiles",
      "inspect:mission-1",
    ]);
    expect([...latest().profiles.keys()]).toEqual(["team-1"]);
    expect([...latest().missions.keys()]).toEqual(["mission-1"]);
  });

  it("reads terminal Mission history for one Team", async () => {
    client.listedProfiles = [profile()];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().status).toBe("ready"));
    client.historyResponses.push({
      missions: [mission({ id: "mission-old", status: "completed", objective: "Earlier Mission" })],
      error: null,
    });

    await sync.readHistory("team-1");

    expect(client.listTeamMissions).toHaveBeenCalledWith({
      teamId: "team-1",
      includeTerminal: true,
    });
    expect(latest().missions.get("mission-old")?.objective).toBe("Earlier Mission");
    expect(latest().historyReads.get("team-1")).toEqual({
      status: "ready",
      missionIds: ["mission-old"],
      error: null,
    });
  });

  it("replays only higher-revision snapshots buffered during hydration", async () => {
    const release = client.holdProfiles();
    client.listedProfiles = [profile({ revision: 4, name: "From list" })];

    sync.connectionChanged(connection());
    client.broadcastProfile(profile({ revision: 3, name: "Older snapshot" }));
    client.broadcastProfile(profile({ revision: 5, name: "Newest snapshot" }));
    release();
    await vi.waitFor(() => expect(latest().status).toBe("ready"));

    expect(latest().profiles.get("team-1")?.name).toBe("Newest snapshot");
  });

  it("keeps old data and replays buffered snapshots when hydration fails", async () => {
    client.listedProfiles = [profile({ revision: 1, name: "Held" })];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().status).toBe("ready"));

    const release = client.holdProfiles();
    client.listProfilesFailure = new Error("host read failed");
    sync.connectionChanged(connection({ source: { clientGeneration: 1, connectionEpoch: 2 } }));
    client.broadcastProfile(profile({ revision: 2, name: "From snapshot" }));
    release();
    await vi.waitFor(() => expect(latest().status).toBe("failed"));

    expect(latest().profiles.get("team-1")?.name).toBe("From snapshot");
    expect(latest().error).toBe("host read failed");
  });

  it("keeps data while offline and clears it for an unsupported host", async () => {
    client.listedProfiles = [profile()];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().status).toBe("ready"));

    sync.connectionChanged(connection({ status: "offline" }));
    expect(latest().status).toBe("connecting");
    expect([...latest().profiles.keys()]).toEqual(["team-1"]);

    sync.connectionChanged(connection({ status: "offline", supportsTeamMissions: false }));
    expect(latest().status).toBe("update_host");
    expect(latest().profiles.size).toBe(0);
    expect(latest().missions.size).toBe(0);
    expect(latest().historyReads.size).toBe(0);
    expect(client.listTeamProfiles).toHaveBeenCalledTimes(1);
  });

  it("keeps buffered snapshots when the same source goes offline", async () => {
    const release = client.holdProfiles();
    sync.connectionChanged(connection());
    client.broadcastProfile(profile({ name: "Observed before disconnect" }));

    sync.connectionChanged(connection({ status: "offline" }));

    expect(latest().status).toBe("connecting");
    expect(latest().profiles.get("team-1")?.name).toBe("Observed before disconnect");
    release();
    await Promise.resolve();
  });

  it("drops hydration from a replaced client even when its source numbers match", async () => {
    const staleClient = client;
    const releaseStale = staleClient.holdProfiles();
    staleClient.listedProfiles = [profile({ id: "stale-team" })];
    sync.connectionChanged(connection());

    client = new FakeClient();
    client.listedProfiles = [profile({ id: "current-team" })];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().profiles.has("current-team")).toBe(true));
    releaseStale();
    await Promise.resolve();

    expect([...latest().profiles.keys()]).toEqual(["current-team"]);
  });

  it("drops hydration from old generation and connection epochs", async () => {
    const staleClient = client;
    const releaseStale = staleClient.holdProfiles();
    staleClient.listedProfiles = [profile({ id: "stale-team" })];
    sync.connectionChanged(connection());

    client = new FakeClient();
    client.listedProfiles = [profile({ id: "current-team" })];
    sync.connectionChanged(connection({ source: { clientGeneration: 2, connectionEpoch: 3 } }));
    await vi.waitFor(() => expect(latest().profiles.has("current-team")).toBe(true));
    releaseStale();
    await Promise.resolve();

    expect([...latest().profiles.keys()]).toEqual(["current-team"]);
  });

  it("lets the later history request for one Team win", async () => {
    client.listedProfiles = [profile()];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().status).toBe("ready"));
    const first = deferred();
    const second = deferred();
    client.historyResponses.push(
      {
        missions: [mission({ id: "mission-stale", objective: "Stale" })],
        error: null,
        gate: first.promise,
      },
      {
        missions: [mission({ id: "mission-current", objective: "Current" })],
        error: null,
        gate: second.promise,
      },
    );

    const staleRead = sync.readHistory("team-1");
    const currentRead = sync.readHistory("team-1");
    second.resolve();
    await currentRead;
    first.resolve();
    await staleRead;

    expect([...latest().missions.keys()]).toEqual(["mission-current"]);
    expect(latest().historyReads.get("team-1")?.missionIds).toEqual(["mission-current"]);
  });

  it("drops a history response after the source changes", async () => {
    client.listedProfiles = [profile()];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(latest().status).toBe("ready"));
    const stale = deferred();
    client.historyResponses.push({
      missions: [mission({ id: "mission-stale" })],
      error: null,
      gate: stale.promise,
    });

    const staleRead = sync.readHistory("team-1");
    sync.connectionChanged(connection({ source: { clientGeneration: 1, connectionEpoch: 2 } }));
    expect(latest().historyReads.get("team-1")).toEqual({
      status: "failed",
      missionIds: [],
      error: "The connection changed before Mission history finished loading.",
    });
    await vi.waitFor(() => expect(latest().status).toBe("ready"));
    stale.resolve();
    await staleRead;

    expect(latest().missions.has("mission-stale")).toBe(false);
  });
});
