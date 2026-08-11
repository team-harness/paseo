import { describe, expect, it, vi } from "vitest";

import {
  buildProfileMembers,
  connectTeamClient,
  newIdempotencyKey,
  parseTeamSkills,
  toTeamResponseError,
} from "./shared.js";

const { connectToDaemon } = vi.hoisted(() => ({ connectToDaemon: vi.fn() }));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon,
  getDaemonHost: () => "127.0.0.1:6767",
}));

function fakeClient(features: Record<string, boolean> | null) {
  return {
    getLastServerInfoMessage: () => (features ? { features } : null),
    close: vi.fn(async () => {}),
  };
}

describe("connecting for a team command", () => {
  it("refuses a daemon that does not have Team Missions", async () => {
    // Without the gate each subcommand fails on an unknown schema, which reads
    // as a broken command rather than as an old host.
    const client = fakeClient({ teams: true, teamMissions: false });
    connectToDaemon.mockResolvedValueOnce(client);

    await expect(connectTeamClient()).rejects.toMatchObject({ code: "DAEMON_UPDATE_REQUIRED" });
    expect(client.close).toHaveBeenCalled();
  });

  it("connects only from the Team Missions feature gate", async () => {
    connectToDaemon.mockResolvedValueOnce(fakeClient({ teams: false, teamMissions: true }));

    await expect(connectTeamClient()).resolves.toMatchObject({ daemonHost: "127.0.0.1:6767" });
  });
});

describe("reading a v2 profile off the command line", () => {
  it("parses repeated Team skills with an optional description", () => {
    expect(parseTeamSkills(["ts=TypeScript=Typed application code", "qa=QA"])).toEqual([
      { skillId: "ts", name: "TypeScript", description: "Typed application code" },
      { skillId: "qa", name: "QA", description: null },
    ]);
  });

  it("builds complete Role, Level, Skills and execution profiles", () => {
    expect(
      buildProfileMembers({
        members: ["lead=lead", "reviewer=reviewer"],
        levels: ["lead=5", "reviewer=3"],
        skills: ["lead=ts", "lead=qa", "reviewer=qa"],
        providers: ["lead=codex", "reviewer=claude"],
        models: ["lead=gpt-5.6-sol"],
        modes: ["reviewer=plan"],
        thinkingOptions: ["lead=high"],
        features: ['lead=sandbox="workspace-write"', "lead=network=true"],
      }),
    ).toEqual([
      {
        role: "lead",
        level: 5,
        skillIds: ["ts", "qa"],
        executionProfile: {
          provider: "codex",
          model: "gpt-5.6-sol",
          modeId: null,
          thinkingOptionId: "high",
          featureValues: { sandbox: "workspace-write", network: true },
        },
      },
      {
        role: "reviewer",
        level: 3,
        skillIds: ["qa"],
        executionProfile: {
          provider: "claude",
          model: null,
          modeId: "plan",
          thinkingOptionId: null,
          featureValues: {},
        },
      },
    ]);
  });

  it("keeps members with the same Role distinct by declaration key", () => {
    expect(
      buildProfileMembers({
        members: ["lead=coordinator", "api=implementer", "web=implementer"],
        levels: ["lead=5", "api=4", "web=2"],
        skills: ["lead=plan", "api=ts", "web=ts"],
        providers: ["lead=codex", "api=codex", "web=claude"],
        models: ["api=gpt-5.6-sol", "web=sonnet"],
      }),
    ).toEqual([
      expect.objectContaining({ role: "coordinator", level: 5 }),
      expect.objectContaining({
        role: "implementer",
        level: 4,
        executionProfile: expect.objectContaining({ provider: "codex", model: "gpt-5.6-sol" }),
      }),
      expect.objectContaining({
        role: "implementer",
        level: 2,
        executionProfile: expect.objectContaining({ provider: "claude", model: "sonnet" }),
      }),
    ]);
  });

  it("rejects duplicate declaration keys instead of overwriting a member", () => {
    expect(() =>
      buildProfileMembers({
        members: ["worker=builder", "worker=reviewer"],
        levels: ["worker=4"],
        skills: ["worker=ts"],
        providers: ["worker=codex"],
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_MEMBER_DECLARATION_KEY" }));
  });

  it("rejects an empty member declaration set", () => {
    expect(() => buildProfileMembers({ members: [] })).toThrow(
      expect.objectContaining({ code: "MISSING_PROFILE_DECLARATION" }),
    );
  });

  it("rejects an unknown declaration key instead of matching by Role or position", () => {
    expect(() =>
      buildProfileMembers({
        members: ["api=implementer"],
        levels: ["implementer=4"],
        skills: ["api=ts"],
        providers: ["api=codex"],
      }),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_MEMBER_DECLARATION_KEY" }));
  });

  it("rejects incomplete, duplicate, unknown and out-of-range declarations", () => {
    const complete = {
      members: ["lead=lead"],
      levels: ["lead=5"],
      skills: ["lead=ts"],
      providers: ["lead=codex"],
    };

    expect(() => buildProfileMembers({ ...complete, providers: [] })).toThrow(
      expect.objectContaining({ code: "MISSING_PROFILE_DECLARATION" }),
    );
    expect(() => buildProfileMembers({ ...complete, levels: ["lead=5", "lead=4"] })).toThrow(
      expect.objectContaining({ code: "DUPLICATE_PROFILE_DECLARATION" }),
    );
    expect(() => buildProfileMembers({ ...complete, skills: ["other=ts"] })).toThrow(
      expect.objectContaining({ code: "UNKNOWN_MEMBER_DECLARATION_KEY" }),
    );
    expect(() => buildProfileMembers({ ...complete, levels: ["lead=6"] })).toThrow(
      expect.objectContaining({ code: "INVALID_PROFILE_LEVEL" }),
    );
  });
});

describe("the key a create runs under", () => {
  it("is a new one every time", () => {
    // One command is one attempt. Reusing a key would make a retry the user
    // typed return the team that already failed, rather than trying again.
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe("turning the daemon's refusal into a command error", () => {
  it("tells a reused key apart from anything else", () => {
    const error = toTeamResponseError("create the team", {
      error: "Idempotency key k was already used for a different team request",
      errorCode: "idempotency_conflict",
    });

    expect(error.code).toBe("TEAM_IDEMPOTENCY_CONFLICT");
    expect(error.details).toMatch(/run the command again/i);
  });

  it("passes an unknown code through rather than flattening it", () => {
    // A newer daemon may name a failure this CLI has never heard of. Replacing
    // it with a generic code would throw away the only machine-readable part.
    expect(
      toTeamResponseError("archive the team", { error: "no", errorCode: "later_code" }).code,
    ).toBe("later_code");
  });

  it("falls back to a generic code and message when the daemon gave neither", () => {
    const error = toTeamResponseError("inspect the team", { error: null });

    expect(error.code).toBe("TEAM_REQUEST_FAILED");
    expect(error.message).toBe("Failed to inspect the team");
  });
});
