import { describe, expect, it } from "vitest";

import { TEAM_MAX_NON_LEAD_MEMBERS } from "@getpaseo/protocol/team/rpc-schemas";

import { openTeamForm, type TeamFormModel, type TeamFormSnapshot } from "./team-form-model";

function snapshot(overrides: Partial<TeamFormSnapshot> = {}): TeamFormSnapshot {
  let keys = 0;
  let idempotency = 0;
  return {
    workspaceId: "ws-1",
    workspaceDisplay: "paseo",
    template: null,
    newRowKey: () => `row-${++keys}`,
    newIdempotencyKey: () => `key-${++idempotency}`,
    ...overrides,
  };
}

function fill(form: TeamFormModel): void {
  form.setName("Disk usage");
  form.setTask("find what is eating the disk");
  form.setLeadProvider("claude", "Claude");
}

describe("composing a team", () => {
  it("cannot be submitted until every field the daemon needs is there", () => {
    const form = openTeamForm(snapshot({ workspaceId: null, workspaceDisplay: null }));

    expect(form.getState().canSubmit).toBe(false);
    fill(form);
    expect(form.getState().canSubmit).toBe(false);
    form.setWorkspace("ws-1", "paseo");
    expect(form.getState().canSubmit).toBe(true);
  });

  it("refuses a half-filled member row rather than dropping it", () => {
    const form = openTeamForm(snapshot());
    fill(form);
    form.addMember();

    // Building a smaller team than the user drew is worse than saying no.
    expect(form.getState().canSubmit).toBe(false);
    const [row] = form.getState().members;
    form.setMemberRole(row!.key, "server");
    expect(form.getState().canSubmit).toBe(false);
    form.setMemberProvider(row!.key, "codex", "Codex");
    expect(form.getState().canSubmit).toBe(true);
  });

  it("keeps each row's input with its own row", () => {
    const form = openTeamForm(snapshot());
    form.addMember();
    form.addMember();
    const [first, second] = form.getState().members;
    form.setMemberRole(first!.key, "server");
    form.setMemberRole(second!.key, "app");

    form.removeMember(first!.key);

    // Keyed rows, so removing one cannot shift another's input onto it.
    expect(form.getState().members.map((member) => member.role)).toEqual(["app"]);
  });

  it("stops at the cap the daemon enforces", () => {
    const form = openTeamForm(snapshot());
    for (let index = 0; index < TEAM_MAX_NON_LEAD_MEMBERS; index += 1) form.addMember();

    expect(form.getState().canAddMember).toBe(false);
    form.addMember();
    expect(form.getState().members).toHaveLength(TEAM_MAX_NON_LEAD_MEMBERS);
  });

  it("counts what the request would actually start", () => {
    const form = openTeamForm(snapshot());
    form.addMember();
    form.addMember();

    // The confirm step states this because one button starts three agents.
    expect(form.getState().memberCount).toBe(2);
    expect(form.getState().agentCount).toBe(3);
  });
});

describe("starting from a template", () => {
  it("seeds every value, and the lead's provider with it", () => {
    const form = openTeamForm(
      snapshot({
        template: {
          id: "triage",
          name: "Triage",
          task: "work out what broke",
          // A template names the lead's provider because the lead uses tools all
          // day; a weak one there makes the whole team look broken.
          leadProvider: "claude",
          members: [{ role: "server", provider: "codex" }],
        },
      }),
    );

    const state = form.getState();
    expect(state.name).toBe("Triage");
    expect(state.leadProvider).toBe("claude");
    expect(state.members.map((member) => member.role)).toEqual(["server"]);
    expect(state.canSubmit).toBe(true);
    // Carried through so the team records what it was built from.
    expect(state.templateId).toBe("triage");
  });
});

describe("the confirm step", () => {
  it("will not open on a form that cannot be submitted", () => {
    const form = openTeamForm(snapshot());

    form.review();

    expect(form.getState().step).toBe("compose");
  });

  it("goes back without losing anything", () => {
    const form = openTeamForm(snapshot());
    fill(form);
    form.review();

    form.backToCompose();

    expect(form.getState().step).toBe("compose");
    expect(form.getState().name).toBe("Disk usage");
  });
});

describe("submitting", () => {
  it("blocks a second attempt while one is in flight", () => {
    const form = openTeamForm(snapshot());
    fill(form);

    form.submitStarted();

    // Under the same key the daemon answers with the first attempt's team;
    // under a new one it builds a second. Neither is what the user asked for.
    expect(form.getState().canSubmit).toBe(false);
  });

  it("keeps the key when the outcome was never learned", () => {
    const form = openTeamForm(snapshot());
    fill(form);
    const key = form.getState().idempotencyKey;
    form.submitStarted();

    form.submitFailed({ message: "The connection dropped", retryable: true });

    // The daemon may already have built it. Retrying under the same key is what
    // gets that team back instead of a second one.
    expect(form.getState().idempotencyKey).toBe(key);
    expect(form.getState().canSubmit).toBe(true);
  });

  it("takes a new key after a definite failure", () => {
    const form = openTeamForm(snapshot());
    fill(form);
    const key = form.getState().idempotencyKey;
    form.submitStarted();

    form.submitFailed({ message: "That workspace is gone", retryable: false });

    // Reusing it would keep handing back the team that failed.
    expect(form.getState().idempotencyKey).not.toBe(key);
  });

  it("will not send the same request twice after it succeeded", () => {
    const form = openTeamForm(snapshot());
    fill(form);
    form.submitStarted();
    form.submitSucceeded("team-1");

    // Under the same key the daemon answers with the team it already built;
    // edit anything first and the fingerprint no longer matches, so it is
    // refused. Neither is a second team.
    expect(form.getState().canSubmit).toBe(false);
  });

  it("reports the team it built", () => {
    const form = openTeamForm(snapshot());
    fill(form);
    form.submitStarted();

    form.submitSucceeded("team-1");

    expect(form.getState().submission).toEqual({ status: "success", teamId: "team-1" });
  });
});

describe("the model's lifetime", () => {
  it("tells subscribers about every change", () => {
    const form = openTeamForm(snapshot());
    let notified = 0;
    form.subscribe(() => {
      notified += 1;
    });

    form.setName("Disk usage");
    form.addMember();

    expect(notified).toBe(2);
  });

  it("goes quiet once closed", () => {
    const form = openTeamForm(snapshot());
    let notified = 0;
    form.subscribe(() => {
      notified += 1;
    });

    form.close();
    form.setName("Too late");

    expect(notified).toBe(0);
    expect(form.getState().name).toBe("");
  });
});
