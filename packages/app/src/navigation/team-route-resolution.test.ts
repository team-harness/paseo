import { describe, expect, it } from "vitest";

import { resolveTeamRoute } from "./team-route-resolution";

const BASE = {
  serverId: "host-1",
  teamId: "team-1",
  supported: true,
  connectionStatus: "online" as const,
  hydrated: true,
  workspaceId: "ws-1" as string | null,
};

describe("resolving a team URL to the workspace that holds it", () => {
  it("resolves once the team is known", () => {
    expect(resolveTeamRoute(BASE)).toEqual({ kind: "resolved", workspaceId: "ws-1" });
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
        workspaceId: null,
      }),
    ).toEqual({ kind: "waitingForHost", connectionStatus: "connecting" });
  });

  it("waits for the team list rather than answering from an empty one", () => {
    // Before hydration the client holds no teams at all, and every team looks
    // deleted.
    expect(resolveTeamRoute({ ...BASE, hydrated: false, workspaceId: null })).toEqual({
      kind: "hydrating",
    });
  });

  it("reports a team that is genuinely absent from a hydrated list", () => {
    expect(resolveTeamRoute({ ...BASE, workspaceId: null })).toEqual({ kind: "notFound" });
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
        workspaceId: null,
      }),
    ).toEqual({ kind: "waitingForHost", connectionStatus: "connecting" });
  });

  it("says the host is too old rather than looking for a team it cannot have", () => {
    // A daemon without the teams feature never sends a list, so waiting for
    // hydration would wait forever.
    expect(
      resolveTeamRoute({ ...BASE, supported: false, hydrated: false, workspaceId: null }),
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
