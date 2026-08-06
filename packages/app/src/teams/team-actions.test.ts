import { describe, expect, it, vi } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import {
  runTeamAction,
  teamActionKeyOf,
  type TeamActionGateway,
  type TeamActionState,
} from "./team-actions";

function team(): TeamSnapshot {
  return {
    id: "team-1",
    name: "Disk usage",
    workspaceId: "ws-1",
    chatRoomId: "room-1",
    leadAgentId: "lead-1",
    members: [],
    lifecycle: "archived",
    revision: 2,
    templateId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    archivedAt: "2026-08-06T11:00:00.000Z",
  };
}

function gateway(
  answer: { team: TeamSnapshot | null; error: string | null } | Error,
): TeamActionGateway & { archiveTeam: ReturnType<typeof vi.fn> } {
  const respond = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { archiveTeam: respond, removeTeamMember: respond };
}

describe("running one team action", () => {
  it("goes through pending and back to idle", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction(
      { kind: "archive" },
      "team-1",
      gateway({ team: team(), error: null }),
      (s) => seen.push(s),
    );

    // No local "done": the daemon broadcasts the new snapshot to every client,
    // and a success badge kept beside that goes stale against a roster that has
    // already moved on.
    expect(seen.map((state) => state.status)).toEqual(["pending", "idle"]);
  });

  it("keeps the daemon's reason when it refuses", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction(
      { kind: "remove", agentId: "lead-1" },
      "team-1",
      gateway({ team: null, error: "The lead cannot be removed from its team" }),
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({
      status: "failure",
      message: "The lead cannot be removed from its team",
    });
  });

  it("says what failed when the daemon says nothing", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction({ kind: "archive" }, "team-1", gateway({ team: null, error: null }), (s) =>
      seen.push(s),
    );

    expect(seen.at(-1)).toMatchObject({ message: expect.stringMatching(/archived/i) });
  });

  it("reports a request that never got an answer", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction(
      { kind: "remove", agentId: "member-1" },
      "team-1",
      gateway(new Error("The connection dropped")),
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({ status: "failure", message: "The connection dropped" });
  });

  it("sends the member's id when removing", async () => {
    const client = gateway({ team: team(), error: null });

    await runTeamAction({ kind: "remove", agentId: "member-1" }, "team-1", client, () => {});

    expect(client.removeTeamMember).toHaveBeenCalledWith({
      teamId: "team-1",
      agentId: "member-1",
    });
  });
});

describe("keying one action apart from another", () => {
  it("gives each member its own key", () => {
    // Two removals in flight are two buttons. One key for both would spin the
    // wrong row, or worse, let one row's failure blame another.
    expect(teamActionKeyOf({ kind: "remove", agentId: "a" })).not.toBe(
      teamActionKeyOf({ kind: "remove", agentId: "b" }),
    );
    expect(teamActionKeyOf({ kind: "archive" })).toBe("archive");
  });
});
