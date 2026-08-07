import { describe, expect, it, vi } from "vitest";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import {
  runTeamAction,
  teamActionKeyOf,
  type TeamActionGateway,
  type TeamActionState,
} from "./team-actions";

const LABELS = {
  archiveRefused: "The team could not be archived.",
  removeRefused: "That member could not be removed.",
};

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

/**
 * One `vi.fn` per method, not one shared between them.
 *
 * A single mock behind both makes "removing calls removeTeamMember" pass when
 * the code archives instead — the assertion is on the mock, and both names
 * point at it.
 */
function gateway(answer: { team: TeamSnapshot | null; error: string | null } | Error): {
  gateway: TeamActionGateway;
  archiveTeam: ReturnType<typeof vi.fn>;
  removeTeamMember: ReturnType<typeof vi.fn>;
} {
  const respond = async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const archiveTeam = vi.fn(respond);
  const removeTeamMember = vi.fn(respond);
  return { gateway: { archiveTeam, removeTeamMember }, archiveTeam, removeTeamMember };
}

describe("running one team action", () => {
  it("goes through pending and back to idle", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction(
      { kind: "archive" },
      "team-1",
      gateway({ team: team(), error: null }).gateway,
      LABELS,
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
      gateway({ team: null, error: "The lead cannot be removed from its team" }).gateway,
      LABELS,
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({
      status: "failure",
      message: "The lead cannot be removed from its team",
    });
  });

  it("says what failed when the daemon says nothing", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction(
      { kind: "archive" },
      "team-1",
      gateway({ team: null, error: null }).gateway,
      LABELS,
      (s) => seen.push(s),
    );

    expect(seen.at(-1)).toMatchObject({ message: expect.stringMatching(/archived/i) });
  });

  it("reports a request that never got an answer", async () => {
    const seen: TeamActionState[] = [];

    await runTeamAction(
      { kind: "remove", agentId: "member-1" },
      "team-1",
      gateway(new Error("The connection dropped")).gateway,
      LABELS,
      (state) => seen.push(state),
    );

    expect(seen.at(-1)).toEqual({ status: "failure", message: "The connection dropped" });
  });

  it("sends the member's id when removing, and does not archive the team", async () => {
    const client = gateway({ team: team(), error: null });

    await runTeamAction(
      { kind: "remove", agentId: "member-1" },
      "team-1",
      client.gateway,
      LABELS,
      () => {},
    );

    expect(client.removeTeamMember).toHaveBeenCalledWith({
      teamId: "team-1",
      agentId: "member-1",
    });
    expect(client.archiveTeam).not.toHaveBeenCalled();
  });

  it("archives the team without touching any member", async () => {
    const client = gateway({ team: team(), error: null });

    await runTeamAction({ kind: "archive" }, "team-1", client.gateway, LABELS, () => {});

    expect(client.archiveTeam).toHaveBeenCalledWith({ teamId: "team-1" });
    expect(client.removeTeamMember).not.toHaveBeenCalled();
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
