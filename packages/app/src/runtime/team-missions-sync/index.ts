import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  DirectoryTransactionOwner,
  type DirectorySourceToken,
  type DirectoryTransaction,
} from "../directory-sync/transaction";
import {
  applyTeamMissionsDelta,
  clearTeamMissionsReplica,
  createTeamMissionsReplica,
  replaceTeamMissionHistory,
  replaceTeamMissionsAuthoritative,
  setTeamMissionHistoryRead,
  setTeamMissionsReplicaStatus,
  type TeamMissionsDelta,
  type TeamMissionsReplica,
} from "./replica";

export interface TeamMissionsSyncConnection {
  readonly client: DaemonClient | null;
  readonly status: "online" | "offline";
  readonly source: DirectorySourceToken;
  readonly supportsTeamMissions: boolean | null;
}

export interface TeamMissionsSyncCallbacks {
  commit(replica: TeamMissionsReplica): void;
}

const OFFLINE: TeamMissionsSyncConnection = {
  client: null,
  status: "offline",
  source: { clientGeneration: 0, connectionEpoch: 0 },
  supportsTeamMissions: null,
};

const HISTORY_CONNECTION_CHANGED =
  "The connection changed before Mission history finished loading.";

interface HydrationSnapshot {
  profiles: TeamV2[];
  missions: TeamMission[];
}

interface HistoryRequest {
  readonly id: number;
  readonly client: DaemonClient;
  readonly source: DirectorySourceToken;
  readonly teamId: string;
  readonly deltas: TeamMission[];
}

export class TeamMissionsSync {
  private readonly transactions = new DirectoryTransactionOwner<
    HydrationSnapshot,
    TeamMissionsDelta
  >();
  private readonly historyRequests = new Map<string, HistoryRequest>();
  private nextHistoryRequestId = 1;
  private connection = OFFLINE;
  private replica = createTeamMissionsReplica();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly callbacks: TeamMissionsSyncCallbacks) {}

  connectionChanged(connection: TeamMissionsSyncConnection): boolean {
    const previous = this.connection;
    const changed =
      previous.client !== connection.client ||
      previous.status !== connection.status ||
      previous.source.clientGeneration !== connection.source.clientGeneration ||
      previous.source.connectionEpoch !== connection.source.connectionEpoch ||
      previous.supportsTeamMissions !== connection.supportsTeamMissions;
    this.connection = connection;
    if (!changed) return false;

    const held = this.transactions.abort();
    this.failPendingHistoryReads();
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (connection.supportsTeamMissions === null) {
      this.commit(setTeamMissionsReplicaStatus(this.replica, "checking_host"), true);
      return true;
    }
    if (connection.supportsTeamMissions === false) {
      this.commit(clearTeamMissionsReplica("update_host"));
      return true;
    }
    if (!connection.client || connection.status !== "online") {
      let next = this.replica;
      const sameSource =
        previous.client === connection.client &&
        previous.source.clientGeneration === connection.source.clientGeneration &&
        previous.source.connectionEpoch === connection.source.connectionEpoch;
      if (sameSource) {
        for (const delta of held) next = applyTeamMissionsDelta(next, delta);
      }
      this.commit(setTeamMissionsReplicaStatus(next, "connecting"));
      return true;
    }
    const transaction = this.beginHydration(connection.source);
    this.attach(connection.client, connection.source);
    void this.hydrate(connection.client, connection.source, transaction);
    return true;
  }

  async refresh(): Promise<void> {
    const { client, source, status, supportsTeamMissions } = this.connection;
    if (!client || status !== "online" || supportsTeamMissions !== true) return;

    await this.hydrate(client, source, this.beginHydration(source));
  }

  private beginHydration(
    source: DirectorySourceToken,
  ): DirectoryTransaction<HydrationSnapshot, TeamMissionsDelta> {
    const transaction = this.transactions.begin(source, () => ({ profiles: [], missions: [] }));
    this.commit(setTeamMissionsReplicaStatus(this.replica, "loading"));
    return transaction;
  }

  private async hydrate(
    client: DaemonClient,
    source: DirectorySourceToken,
    transaction: DirectoryTransaction<HydrationSnapshot, TeamMissionsDelta>,
  ): Promise<void> {
    try {
      const profilePayload = await client.listTeamProfiles({ includeArchived: false });
      if (profilePayload.error) throw new Error(profilePayload.error);
      transaction.snapshot.profiles.push(...profilePayload.teams);

      const activeMissionIds = [
        ...new Set(
          profilePayload.teams.flatMap((team) =>
            team.activeMissionId === null ? [] : [team.activeMissionId],
          ),
        ),
      ];
      const missionPayloads = await Promise.all(
        activeMissionIds.map((missionId) => client.inspectTeamMission({ missionId })),
      );
      for (let index = 0; index < missionPayloads.length; index += 1) {
        const payload = missionPayloads[index];
        if (payload.error) throw new Error(payload.error);
        if (!payload.mission) {
          throw new Error(`Mission ${activeMissionIds[index]} could not be inspected.`);
        }
        transaction.snapshot.missions.push(payload.mission);
      }

      const completion = this.transactions.complete(transaction);
      if (completion.kind === "stale" || !this.isCurrent(client, source)) return;
      const replacement = replaceTeamMissionsAuthoritative(
        this.replica,
        completion.snapshot,
        completion.deltas,
      );
      this.commit(setTeamMissionsReplicaStatus(replacement, "ready"));
    } catch (error) {
      const held = this.transactions.fail(transaction);
      if (!held || !this.isCurrent(client, source)) return;
      let next = this.replica;
      for (const delta of held) next = applyTeamMissionsDelta(next, delta);
      this.commit(
        setTeamMissionsReplicaStatus(
          next,
          "failed",
          error instanceof Error ? error.message : "Team Missions could not be read.",
        ),
      );
    }
  }

  async readHistory(teamId: string): Promise<void> {
    const { client, source, status, supportsTeamMissions } = this.connection;
    if (!client || status !== "online" || supportsTeamMissions !== true) return;

    const request: HistoryRequest = {
      id: this.nextHistoryRequestId++,
      client,
      source,
      teamId,
      deltas: [],
    };
    this.historyRequests.set(teamId, request);
    const previousRead = this.replica.historyReads.get(teamId);
    this.commit(
      setTeamMissionHistoryRead(this.replica, teamId, {
        status: "loading",
        missionIds: previousRead?.missionIds ?? [],
        error: null,
      }),
    );

    try {
      const payload = await client.listTeamMissions({ teamId, includeTerminal: true });
      if (!this.isCurrentHistoryRequest(request)) return;
      if (payload.error) throw new Error(payload.error);
      let next = replaceTeamMissionHistory(this.replica, teamId, payload.missions, request.deltas);
      const missionIds = [...next.missions.values()]
        .filter((mission) => mission.teamId === teamId)
        .map((mission) => mission.id);
      next = setTeamMissionHistoryRead(next, teamId, {
        status: "ready",
        missionIds,
        error: null,
      });
      this.commit(next);
    } catch (error) {
      if (!this.isCurrentHistoryRequest(request)) return;
      let next = this.replica;
      for (const mission of request.deltas) {
        next = applyTeamMissionsDelta(next, { kind: "mission", mission });
      }
      next = setTeamMissionHistoryRead(next, teamId, {
        status: "failed",
        missionIds: previousRead?.missionIds ?? [],
        error: error instanceof Error ? error.message : "Mission history could not be read.",
      });
      this.commit(next);
    } finally {
      if (this.historyRequests.get(teamId) === request) this.historyRequests.delete(teamId);
    }
  }

  dispose(): void {
    this.transactions.abort();
    this.historyRequests.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.connection = OFFLINE;
  }

  private failPendingHistoryReads(): void {
    if (this.historyRequests.size === 0) return;
    let next = this.replica;
    for (const request of this.historyRequests.values()) {
      const read = next.historyReads.get(request.teamId);
      if (read?.status !== "loading") continue;
      next = setTeamMissionHistoryRead(next, request.teamId, {
        status: "failed",
        missionIds: read.missionIds,
        error: HISTORY_CONNECTION_CHANGED,
      });
    }
    this.historyRequests.clear();
    this.commit(next);
  }

  private attach(client: DaemonClient, source: DirectorySourceToken): void {
    const detachProfiles = client.on("team.profile.snapshot", (message) => {
      if (!this.isCurrent(client, source)) return;
      const delta: TeamMissionsDelta = {
        kind: "profile",
        profile: message.payload.team,
      };
      if (!this.transactions.record(source, delta)) {
        this.commit(applyTeamMissionsDelta(this.replica, delta));
      }
    });
    const detachMissions = client.on("team.mission.snapshot", (message) => {
      if (!this.isCurrent(client, source)) return;
      const delta: TeamMissionsDelta = {
        kind: "mission",
        mission: message.payload.mission,
      };
      this.historyRequests.get(delta.mission.teamId)?.deltas.push(delta.mission);
      if (!this.transactions.record(source, delta)) {
        this.commit(applyTeamMissionsDelta(this.replica, delta));
      }
    });
    this.unsubscribe = () => {
      detachProfiles();
      detachMissions();
    };
  }

  private isCurrent(client: DaemonClient, source: DirectorySourceToken): boolean {
    return (
      this.connection.client === client &&
      this.connection.source.clientGeneration === source.clientGeneration &&
      this.connection.source.connectionEpoch === source.connectionEpoch
    );
  }

  private isCurrentHistoryRequest(request: HistoryRequest): boolean {
    return (
      this.historyRequests.get(request.teamId) === request &&
      this.isCurrent(request.client, request.source)
    );
  }

  private commit(replica: TeamMissionsReplica, force = false): void {
    if (!force && replica === this.replica) return;
    this.replica = replica;
    this.callbacks.commit(replica);
  }
}

export type { TeamMissionsReplica } from "./replica";
