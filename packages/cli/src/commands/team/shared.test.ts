import { describe, expect, it, vi } from "vitest";

import { TEAM_ERROR_CODES } from "@getpaseo/protocol/team/rpc-schemas";

import {
  connectTeamClient,
  newIdempotencyKey,
  parseMemberSpec,
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
  it("refuses a daemon that does not have teams", async () => {
    // Without the gate each subcommand fails on an unknown schema, which reads
    // as a broken command rather than as an old host.
    const client = fakeClient({ teams: false });
    connectToDaemon.mockResolvedValueOnce(client);

    await expect(connectTeamClient()).rejects.toMatchObject({ code: "DAEMON_UPDATE_REQUIRED" });
    expect(client.close).toHaveBeenCalled();
  });

  it("connects to a daemon that has them", async () => {
    connectToDaemon.mockResolvedValueOnce(fakeClient({ teams: true }));

    await expect(connectTeamClient()).resolves.toMatchObject({ daemonHost: "127.0.0.1:6767" });
  });
});

describe("reading a member off the command line", () => {
  it("splits role from provider", () => {
    expect(parseMemberSpec("server=codex")).toEqual({ role: "server", provider: "codex" });
  });

  it("keeps the provider string whole", () => {
    // "codex/gpt-5.4" is one provider-and-model string the daemon splits; the
    // CLI guessing at it would send a model the daemon never asked for.
    expect(parseMemberSpec("app=codex/gpt-5.4").provider).toBe("codex/gpt-5.4");
  });

  it("splits on the first separator only", () => {
    expect(parseMemberSpec("reviewer=custom=thing")).toEqual({
      role: "reviewer",
      provider: "custom=thing",
    });
  });

  it("trims what surrounds each half", () => {
    expect(parseMemberSpec("  server = codex  ")).toEqual({ role: "server", provider: "codex" });
  });

  it("refuses a half that is missing", () => {
    for (const input of ["server", "server=", "=codex", "", "  "]) {
      expect(() => parseMemberSpec(input)).toThrow(
        expect.objectContaining({ code: "INVALID_MEMBER" }),
      );
    }
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
      errorCode: TEAM_ERROR_CODES.idempotencyConflict,
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
