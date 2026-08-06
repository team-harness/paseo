import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { TeamSync, type TeamSyncConnection } from "./index";
import type { TeamSnapshotMap } from "./team-replica";

function team(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    members: [],
    lifecycle: "active",
    revision: 1,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

/** Enough of a daemon client to answer a list and deliver broadcasts. */
class FakeClient {
  listTeams = vi.fn(async () => {
    await this.listGate;
    if (this.listThrows) throw this.listThrows;
    return { teams: this.listed, error: this.listError };
  });
  listed: TeamSnapshot[] = [];
  /** What the daemon answers with when its own read failed. */
  listError: string | null = null;
  listThrows: Error | null = null;
  listGate: Promise<void> = Promise.resolve();
  private handlers = new Set<(message: unknown) => void>();

  on(event: string, handler: (message: unknown) => void): () => void {
    if (event !== "team.update") return () => {};
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  broadcast(snapshot: TeamSnapshot): void {
    for (const handler of this.handlers) {
      handler({ type: "team.update", payload: { team: snapshot } });
    }
  }

  /** Holds the list until released, so a broadcast can land while it is in flight. */
  holdList(): () => void {
    let release = () => {};
    this.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }
}

describe("keeping one daemon's teams current", () => {
  let client: FakeClient;
  let committed: TeamSnapshotMap[];
  let hydrated: boolean[];
  let errors: Array<string | null>;
  let sync: TeamSync;

  function connection(overrides: Partial<TeamSyncConnection> = {}): TeamSyncConnection {
    return {
      client: client as never,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
      supportsTeams: true,
      ...overrides,
    };
  }

  function latest(): TeamSnapshotMap {
    return committed.at(-1) ?? new Map();
  }

  beforeEach(() => {
    client = new FakeClient();
    committed = [];
    hydrated = [];
    errors = [];
    sync = new TeamSync({
      commit: (teams) => committed.push(teams),
      setHydrated: (value) => hydrated.push(value),
      setError: (message) => errors.push(message),
    });
  });

  it("replaces everything with what the list says", async () => {
    client.listed = [team({ id: "team-2" })];

    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    expect([...latest().keys()]).toEqual(["team-2"]);
  });

  it("keeps a team announced while the list was in flight", async () => {
    const release = client.holdList();
    client.listed = [team({ id: "team-1" })];

    sync.connectionChanged(connection());
    client.broadcast(team({ id: "created-during", revision: 1 }));
    release();
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    // The list was assembled before this team existed and its only
    // announcement has already gone by. Without the replay the client is blind
    // to it until something unrelated happens.
    expect([...latest().keys()].toSorted()).toEqual(["created-during", "team-1"]);
  });

  it("lets the list win over a broadcast it already contains", async () => {
    const release = client.holdList();
    client.listed = [team({ revision: 5, name: "From the list" })];

    sync.connectionChanged(connection());
    client.broadcast(team({ revision: 4, name: "Older broadcast" }));
    release();
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    expect(latest().get("team-1")?.name).toBe("From the list");
  });

  it("drops a team the list no longer names", async () => {
    client.listed = [team({ id: "team-1" })];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    // Archived while the client was away, so it is missing from the next list.
    client.listed = [];
    sync.connectionChanged(connection({ source: { clientGeneration: 1, connectionEpoch: 2 } }));
    await vi.waitFor(() => expect(hydrated.filter(Boolean)).toHaveLength(2));

    expect([...latest().keys()]).toEqual([]);
  });

  it("applies a broadcast that arrives after hydration", async () => {
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    client.broadcast(team({ id: "team-9" }));

    expect([...latest().keys()]).toEqual(["team-9"]);
  });

  it("ignores a broadcast for a connection that has been replaced", async () => {
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));
    const stale = client;

    client = new FakeClient();
    sync.connectionChanged(connection({ source: { clientGeneration: 2, connectionEpoch: 1 } }));
    const before = committed.length;
    stale.broadcast(team({ id: "from-the-old-socket" }));

    expect(committed.length).toBe(before);
  });

  it("does not replay a broadcast from a connection that went away", async () => {
    const release = client.holdList();
    sync.connectionChanged(connection());
    client.broadcast(team({ id: "from-the-old-socket" }));

    // The connection changes under the read: whatever that socket said is
    // about a daemon this client may not even be talking to now.
    const previous = client;
    client = new FakeClient();
    client.listed = [team({ id: "team-1" })];
    sync.connectionChanged(connection({ source: { clientGeneration: 2, connectionEpoch: 1 } }));
    release();
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));
    previous.broadcast(team({ id: "also-old" }));

    expect([...latest().keys()]).toEqual(["team-1"]);
  });

  it("keeps what it was told when the list throws", async () => {
    const release = client.holdList();
    client.listThrows = new Error("offline");

    sync.connectionChanged(connection());
    client.broadcast(team({ id: "announced" }));
    release();
    await vi.waitFor(() => expect(errors.at(-1)).toBe("offline"));

    // The broadcasts are about teams, not about the read. Dropping them would
    // lose a team the client had already been told about.
    expect([...latest().keys()]).toEqual(["announced"]);
    expect(hydrated).not.toContain(true);
  });

  it("does not treat a failed read as an empty daemon", async () => {
    client.listed = [team({ id: "held" })];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    // The daemon answers a failed read with an empty list and a message.
    // Committing that would erase every team because one directory read broke.
    client.listed = [];
    client.listError = "teams could not be read";
    sync.connectionChanged(connection({ source: { clientGeneration: 1, connectionEpoch: 2 } }));
    await vi.waitFor(() => expect(errors.at(-1)).toBe("teams could not be read"));

    expect([...latest().keys()]).toEqual(["held"]);
    expect(hydrated.at(-1)).toBe(false);
  });

  it("keeps what it holds while offline, and reconciles on the way back", async () => {
    client.listed = [team({ id: "team-1" }), team({ id: "archived-while-away" })];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    sync.connectionChanged(connection({ status: "offline" }));
    // Agents and workspaces stay painted through a blip; teams vanishing where
    // they do not is worse than a roster a few seconds old.
    expect([...latest().keys()].toSorted()).toEqual(["archived-while-away", "team-1"]);

    // One of them was archived while the client was away, so the next list does
    // not name it. Replacement is what converges on that.
    client.listed = [team({ id: "team-1" })];
    sync.connectionChanged(connection({ source: { clientGeneration: 1, connectionEpoch: 2 } }));
    await vi.waitFor(() => expect(hydrated.filter(Boolean)).toHaveLength(2));

    expect([...latest().keys()]).toEqual(["team-1"]);
  });

  it("waits rather than deciding before the handshake answers", async () => {
    sync.connectionChanged(connection({ supportsTeams: null }));

    // "Not yet" is not "no". Reading it as no would hide teams on a daemon that
    // has them, and nothing would come back to correct it.
    expect(client.listTeams).not.toHaveBeenCalled();
    expect(committed).toEqual([]);

    sync.connectionChanged(connection({ supportsTeams: true }));
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));
  });

  it("shows nothing for a daemon that says it has none", async () => {
    client.listed = [team()];
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    sync.connectionChanged(connection({ supportsTeams: false }));

    // Holding the last daemon's teams would be worse than showing none.
    expect([...latest().keys()]).toEqual([]);
    expect(client.listTeams).toHaveBeenCalledTimes(1);
  });

  it("clears hydration when the connection drops", async () => {
    sync.connectionChanged(connection());
    await vi.waitFor(() => expect(hydrated.at(-1)).toBe(true));

    sync.connectionChanged(connection({ status: "offline" }));

    expect(hydrated.at(-1)).toBe(false);
  });
});
