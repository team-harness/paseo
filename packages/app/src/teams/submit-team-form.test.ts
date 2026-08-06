import { describe, expect, it, vi } from "vitest";

import { TEAM_ERROR_CODES } from "@getpaseo/protocol/team/rpc-schemas";

import { openTeamForm, type TeamFormModel } from "./team-form-model";
import { submitTeamForm, type TeamCreateGateway } from "./submit-team-form";

function openFilledForm(): TeamFormModel {
  let keys = 0;
  let idempotency = 0;
  const form = openTeamForm({
    workspaceId: "ws-1",
    workspaceDisplay: "paseo",
    template: null,
    newRowKey: () => `row-${++keys}`,
    newIdempotencyKey: () => `key-${++idempotency}`,
  });
  form.setName("  Disk usage  ");
  form.setTask("  find what is eating the disk  ");
  form.setLeadProvider("claude", "Claude");
  form.addMember();
  const [row] = form.getState().members;
  form.setMemberRole(row!.key, " server ");
  form.setMemberProvider(row!.key, "codex/gpt-5.4", "Codex");
  return form;
}

function gateway(
  answer: Awaited<ReturnType<TeamCreateGateway["createTeam"]>> | Error,
): TeamCreateGateway & { createTeam: ReturnType<typeof vi.fn> } {
  return {
    createTeam: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}

describe("sending a team to the daemon", () => {
  it("sends what the form holds, trimmed, with the lead's fixed role", async () => {
    const form = openFilledForm();
    const client = gateway({ team: { id: "team-1" }, error: null });

    await submitTeamForm(form, client);

    expect(client.createTeam).toHaveBeenCalledWith({
      idempotencyKey: "key-1",
      name: "Disk usage",
      workspaceId: "ws-1",
      task: "find what is eating the disk",
      // The daemon fixes the lead's role regardless, so asking the user for one
      // would only be discarded.
      lead: { role: "lead", provider: "claude" },
      // The provider string stays whole: "codex/gpt-5.4" is one value the
      // daemon splits.
      members: [{ role: "server", provider: "codex/gpt-5.4" }],
    });
    expect(form.getState().submission).toEqual({ status: "success", teamId: "team-1" });
  });

  it("leaves an empty briefing out rather than sending an empty string", async () => {
    const form = openFilledForm();
    const client = gateway({ team: { id: "team-1" }, error: null });

    await submitTeamForm(form, client);

    expect(client.createTeam.mock.calls[0]?.[0].members[0]).not.toHaveProperty("briefing");
  });

  it("takes a new key after the daemon refused", async () => {
    const form = openFilledForm();
    const key = form.getState().idempotencyKey;

    await submitTeamForm(form, gateway({ team: null, error: "That workspace is gone" }));

    // The daemon answered and built nothing. Reusing the key would keep asking
    // about the attempt that failed.
    expect(form.getState().submission).toEqual({
      status: "failure",
      message: "That workspace is gone",
      retryable: false,
    });
    expect(form.getState().idempotencyKey).not.toBe(key);
  });

  it("keeps the key when the answer never arrived", async () => {
    const form = openFilledForm();
    const key = form.getState().idempotencyKey;

    await submitTeamForm(form, gateway(new Error("The connection dropped")));

    // The daemon may already have built the team. The same key is what gets
    // that one back instead of a second.
    expect(form.getState().idempotencyKey).toBe(key);
    expect(form.getState().submission).toMatchObject({ retryable: true });
  });

  it("explains a key conflict in terms of what to do about it", async () => {
    const form = openFilledForm();

    await submitTeamForm(
      form,
      gateway({
        team: null,
        error: "Idempotency key key-1 was already used for a different team request",
        errorCode: TEAM_ERROR_CODES.idempotencyConflict,
      }),
    );

    expect(form.getState().submission).toMatchObject({ message: expect.stringMatching(/again/i) });
  });

  it("does nothing for a form that is not ready", async () => {
    const form = openTeamForm({
      workspaceId: null,
      workspaceDisplay: null,
      template: null,
      newRowKey: () => "row",
      newIdempotencyKey: () => "key",
    });
    const client = gateway({ team: { id: "team-1" }, error: null });

    await submitTeamForm(form, client);

    expect(client.createTeam).not.toHaveBeenCalled();
    expect(form.getState().submission).toEqual({ status: "idle" });
  });

  it("goes through pending on the way", async () => {
    const form = openFilledForm();
    const seen: string[] = [];
    form.subscribe(() => seen.push(form.getState().submission.status));

    await submitTeamForm(form, gateway({ team: { id: "team-1" }, error: null }));

    expect(seen).toEqual(["pending", "success"]);
  });
});
