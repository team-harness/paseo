import { describe, expect, it } from "vitest";

import { resolveTeamRoute } from "./team-route-resolution";

const BASE = {
  serverId: "host-1",
  teamId: "team-1",
  supported: true,
  connectionStatus: "online" as const,
  hydrated: true,
  activeMissionId: null as string | null,
  missionWorkspaceId: null as string | null,
  creationWorkspaceId: "ws-1" as string | null,
  liveWorkspaceIds: ["ws-1", "ws-2"],
};

describe("resolving a team URL to the workspace that holds it", () => {
  it("resolves once the team is known", () => {
    expect(resolveTeamRoute(BASE)).toEqual({ kind: "resolved", workspaceId: "ws-1" });
  });

  it("uses the active Mission workspace instead of the Team creation workspace", () => {
    expect(
      resolveTeamRoute({
        ...BASE,
        activeMissionId: "mission-1",
        missionWorkspaceId: "ws-2",
      }),
    ).toEqual({ kind: "resolved", workspaceId: "ws-2" });
  });

  it("waits when the active Mission has not hydrated instead of falling back", () => {
    expect(resolveTeamRoute({ ...BASE, activeMissionId: "mission-1" })).toEqual({
      kind: "hydrating",
    });
  });

  it("uses the stable first live workspace when an idle Team creation workspace is archived", () => {
    expect(
      resolveTeamRoute({
        ...BASE,
        creationWorkspaceId: "ws-archived",
        liveWorkspaceIds: ["ws-2", "ws-1"],
      }),
    ).toEqual({ kind: "resolved", workspaceId: "ws-1" });
  });

  it("keeps a hydrated idle Team at host level when no live workspace is available", () => {
    expect(resolveTeamRoute({ ...BASE, liveWorkspaceIds: [] })).toEqual({ kind: "hostLevel" });
  });

  it("rejects a URL with nothing to resolve", () => {
    expect(resolveTeamRoute({ ...BASE, teamId: "" })).toEqual({ kind: "invalid" });
    expect(resolveTeamRoute({ ...BASE, serverId: " " })).toEqual({ kind: "invalid" });
  });

  it("waits for the host instead of deciding the team is gone", () => {
    // Offline is not absence. Answering notFound here sends someone back to the
    // host home for a team that is sitting there, unreachable for a second.
    expect(
      resolveTeamRoute({
        ...BASE,
        connectionStatus: "connecting",
        hydrated: false,
        creationWorkspaceId: null,
      }),
    ).toEqual({ kind: "waitingForHost", connectionStatus: "connecting" });
  });

  it("waits for the team list rather than answering from an empty one", () => {
    // Before hydration the client holds no teams at all, and every team looks
    // deleted.
    expect(resolveTeamRoute({ ...BASE, hydrated: false, creationWorkspaceId: null })).toEqual({
      kind: "hydrating",
    });
  });

  it("reports a team that is genuinely absent from a hydrated list", () => {
    expect(resolveTeamRoute({ ...BASE, creationWorkspaceId: null, liveWorkspaceIds: [] })).toEqual({
      kind: "notFound",
    });
  });

  it("waits for a host that has not answered yet instead of calling it too old", () => {
    // `supported` comes from the handshake, which lands after the connection.
    // Before then it is false for every daemon, including one that has teams —
    // so this combination is what a cold deep link actually looks like, and
    // "too old, update it" is both wrong and unretryable.
    expect(
      resolveTeamRoute({
        ...BASE,
        supported: false,
        connectionStatus: "connecting",
        hydrated: false,
        creationWorkspaceId: null,
      }),
    ).toEqual({ kind: "waitingForHost", connectionStatus: "connecting" });
  });

  it("says the host is too old rather than looking for a team it cannot have", () => {
    // A daemon without the teams feature never sends a list, so waiting for
    // hydration would wait forever.
    expect(
      resolveTeamRoute({
        ...BASE,
        supported: false,
        hydrated: false,
        creationWorkspaceId: null,
      }),
    ).toEqual({ kind: "unsupported" });
  });

  it("prefers the known team over waiting, once it is in hand", () => {
    // A profile snapshot can arrive before the list does. Holding the route at
    // "hydrating" when the answer is already here is a wait for nothing.
    expect(resolveTeamRoute({ ...BASE, hydrated: false })).toEqual({
      kind: "resolved",
      workspaceId: "ws-1",
    });
  });
});
