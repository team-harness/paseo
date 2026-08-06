import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import {
  DirectoryTransactionOwner,
  type DirectorySourceToken,
} from "../directory-sync/transaction";
import { replaceTeams, applyTeamUpdate, type TeamSnapshotMap } from "./team-replica";

export interface TeamSyncConnection {
  client: DaemonClient | null;
  status: "online" | "offline";
  source: DirectorySourceToken;
  /** False when the daemon predates teams; nothing is fetched and nothing is shown. */
  supportsTeams: boolean;
}

export interface TeamSyncCallbacks {
  /** Replaces everything held for this daemon. */
  commit(teams: TeamSnapshotMap): void;
  /** Marks whether a list has landed since the last connection change. */
  setHydrated(hydrated: boolean): void;
  onError?(error: unknown): void;
}

const OFFLINE: TeamSyncConnection = {
  client: null,
  status: "offline",
  source: { clientGeneration: 0, connectionEpoch: 0 },
  supportsTeams: false,
};

/**
 * Keeps one daemon's teams current.
 *
 * Two things arrive: a list, which is authoritative and replaces everything,
 * and `team.update` broadcasts, which are per-team and ordered by revision.
 * They race, so both halves matter — the list is what removes a team the client
 * never saw archived, and the broadcasts are what keep it from waiting for the
 * next list to learn anything.
 *
 * A broadcast that lands while a list is in flight is held and replayed onto
 * the result, keyed to the connection it belongs to. Without that, a team
 * created during the read is dropped: it is in no list yet, and its only
 * announcement has already been thrown away.
 */
export class TeamSync {
  private readonly transactions = new DirectoryTransactionOwner<null, TeamSnapshot>();
  private connection: TeamSyncConnection = OFFLINE;
  private unsubscribe: (() => void) | null = null;
  private teams: TeamSnapshotMap = new Map();

  constructor(private readonly callbacks: TeamSyncCallbacks) {}

  /** Returns whether the connection actually changed. */
  connectionChanged(connection: TeamSyncConnection): boolean {
    const changed =
      this.connection.client !== connection.client ||
      this.connection.source.clientGeneration !== connection.source.clientGeneration ||
      this.connection.source.connectionEpoch !== connection.source.connectionEpoch ||
      this.connection.supportsTeams !== connection.supportsTeams;
    const wentOffline = this.connection.status === "online" && connection.status === "offline";
    if (!changed && !wentOffline) {
      this.connection = connection;
      return false;
    }

    // Held broadcasts are fenced by source, so the next hydration would ignore
    // these anyway; dropping them here is about not carrying them around.
    this.transactions.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.connection = connection;
    this.callbacks.setHydrated(false);

    if (!connection.client || connection.status !== "online" || !connection.supportsTeams) {
      // A daemon without teams has none to show, and holding the last one's
      // would be worse than showing nothing.
      this.commit(new Map());
      return true;
    }

    const client = connection.client;
    const source = connection.source;
    // Opened before the list is asked for, so a broadcast that arrives during
    // the read has somewhere to go.
    this.transactions.begin(source, () => null);
    this.unsubscribe = client.on("team.update", (message) => {
      // Belt and braces: unsubscribing on a connection change is what actually
      // stops this, and the source check is what makes that not the only thing
      // standing between a dead socket and the store.
      if (message.type !== "team.update" || !this.isCurrent(client, source)) return;
      const team = message.payload.team;
      if (!this.transactions.record(source, team)) {
        this.commit(applyTeamUpdate(this.teams, team));
      }
    });
    void this.hydrate(client, source);
    return true;
  }

  /** Reads the list and commits it, with whatever arrived while it was in flight. */
  private async hydrate(client: DaemonClient, source: DirectorySourceToken): Promise<void> {
    const transaction = this.transactions.begin(source, () => null);
    try {
      const payload = await client.listTeams({ includeArchived: false });
      const completion = this.transactions.complete(transaction);
      // The connection changed under the read. Its answer describes a daemon
      // this client is no longer talking to.
      if (completion.kind === "stale") return;
      this.commit(replaceTeams(payload.teams, completion.deltas));
      this.callbacks.setHydrated(true);
    } catch (error) {
      // The held broadcasts still apply: they are about teams, not about the
      // read that failed. Dropping them would lose a team created during it.
      const held = this.transactions.fail(transaction);
      if (held && this.isCurrent(client, source)) {
        let next = this.teams;
        for (const team of held) next = applyTeamUpdate(next, team);
        this.commit(next);
      }
      this.callbacks.onError?.(error);
    }
  }

  private commit(teams: TeamSnapshotMap): void {
    if (teams === this.teams) return;
    this.teams = teams;
    this.callbacks.commit(teams);
  }

  private isCurrent(client: DaemonClient, source: DirectorySourceToken): boolean {
    return (
      this.connection.client === client &&
      this.connection.source.clientGeneration === source.clientGeneration &&
      this.connection.source.connectionEpoch === source.connectionEpoch
    );
  }

  dispose(): void {
    this.transactions.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.connection = OFFLINE;
  }
}
