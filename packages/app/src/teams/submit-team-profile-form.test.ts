import { describe, expect, it } from "vitest";
import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { openTeamProfileForm, type TeamProfileFormModel } from "./team-profile-form-model";
import {
  submitTeamProfileForm,
  type TeamProfileFormGateway,
  type TeamProfileMutationResponse,
} from "./submit-team-profile-form";

const timestamp = "2026-08-09T08:00:00.000Z";

function createdTeam(): TeamV2 {
  return {
    id: "team-1",
    name: "Platform",
    workspaceId: "workspace-1",
    leadMemberId: "member-1",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    members: [
      {
        memberId: "member-1",
        role: "Engineer",
        level: 4,
        skillIds: ["typescript"],
        executionProfile: {
          provider: "codex",
          model: "gpt-5.6-sol",
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
        mentionHandle: "engineer",
      },
    ],
    lifecycle: "active",
    activeMissionId: null,
    lifecycleRecoveryFailure: null,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}

function openFilledCreateForm(): TeamProfileFormModel {
  let row = 0;
  let attempt = 0;
  const form = openTeamProfileForm({
    mode: "create",
    workspaceId: "workspace-1",
    hostSnapshot: {
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
    },
    newRowKey: () => `row-${++row}`,
    newIdempotencyKey: () => `attempt-${++attempt}`,
  });
  form.applyProviderSnapshot({
    workspaceId: "workspace-1",
    serverId: "server-1",
    cwd: "/repo",
    entries: [
      {
        provider: "codex",
        status: "ready",
        enabled: true,
        models: [
          {
            provider: "codex",
            id: "gpt-5.6-sol",
            label: "GPT-5.6",
            isDefault: true,
          },
        ],
      },
    ],
  });
  form.setName("  Platform  ");
  const skill = form.getState().skills[0]!;
  form.setSkillId(skill.key, "  typescript  ");
  form.setSkillName(skill.key, "  TypeScript  ");
  const member = form.getState().members[0]!;
  form.setMemberRole(member.key, "  Engineer  ");
  form.setMemberLevel(member.key, 4);
  form.setMemberSkillIds(member.key, ["typescript"]);
  form.setMemberExecutionProfile(member.key, {
    provider: "codex",
    model: "gpt-5.6-sol",
    modeId: null,
    thinkingOptionId: null,
    featureValues: {},
  });
  return form;
}

class InMemoryTeamProfileGateway implements TeamProfileFormGateway {
  readonly creates: Parameters<TeamProfileFormGateway["createTeamProfile"]>[0][] = [];
  readonly updates: Parameters<TeamProfileFormGateway["updateTeamProfile"]>[0][] = [];

  constructor(private readonly response: TeamProfileMutationResponse) {}

  async createTeamProfile(
    input: Parameters<TeamProfileFormGateway["createTeamProfile"]>[0],
  ): Promise<TeamProfileMutationResponse> {
    this.creates.push(input);
    return this.response;
  }

  async updateTeamProfile(
    input: Parameters<TeamProfileFormGateway["updateTeamProfile"]>[0],
  ): Promise<TeamProfileMutationResponse> {
    this.updates.push(input);
    return this.response;
  }
}

class SequencedTeamProfileGateway implements TeamProfileFormGateway {
  readonly creates: Parameters<TeamProfileFormGateway["createTeamProfile"]>[0][] = [];
  private next = 0;

  constructor(private readonly answers: Array<TeamProfileMutationResponse | Error>) {}

  async createTeamProfile(
    input: Parameters<TeamProfileFormGateway["createTeamProfile"]>[0],
  ): Promise<TeamProfileMutationResponse> {
    this.creates.push(input);
    const answer = this.answers[this.next++];
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error("Missing in-memory answer");
    return answer;
  }

  async updateTeamProfile(): Promise<TeamProfileMutationResponse> {
    throw new Error("Unexpected update");
  }
}

describe("submitting a Team profile", () => {
  it("creates a profile and returns only its Team tab descriptor", async () => {
    const form = openFilledCreateForm();
    const gateway = new InMemoryTeamProfileGateway({ team: createdTeam(), error: null });

    const result = await submitTeamProfileForm(form, gateway, {
      refused: "The Team profile could not be saved.",
    });

    expect(gateway.creates).toEqual([
      {
        idempotencyKey: "attempt-1",
        name: "Platform",
        workspaceId: "workspace-1",
        skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
        lead: {
          role: "Engineer",
          level: 4,
          skillIds: ["typescript"],
          executionProfile: {
            provider: "codex",
            model: "gpt-5.6-sol",
            modeId: null,
            thinkingOptionId: null,
            featureValues: {},
          },
        },
        members: [],
      },
    ]);
    expect(gateway.updates).toEqual([]);
    expect(result).toEqual({ kind: "team", teamId: "team-1" });
    expect(form.getState().submission).toEqual({
      status: "success",
      tab: { kind: "team", teamId: "team-1" },
    });
  });

  it("updates through CAS with only the fields that changed", async () => {
    let row = 0;
    let attempt = 0;
    const original = { ...createdTeam(), revision: 7 };
    const form = openTeamProfileForm({
      mode: "edit",
      profile: original,
      newRowKey: () => `edit-row-${++row}`,
      newIdempotencyKey: () => `edit-attempt-${++attempt}`,
    });
    expect(form.getState().canSubmit).toBe(false);
    form.setName("  Platform Runtime  ");
    const gateway = new InMemoryTeamProfileGateway({
      team: { ...original, name: "Platform Runtime", revision: 8 },
      error: null,
    });

    const result = await submitTeamProfileForm(form, gateway, {
      refused: "The Team profile could not be saved.",
    });

    expect(gateway.creates).toEqual([]);
    expect(gateway.updates).toEqual([
      {
        idempotencyKey: "edit-attempt-1",
        teamId: "team-1",
        expectedRevision: 7,
        name: "Platform Runtime",
      },
    ]);
    expect(result).toEqual({ kind: "team", teamId: "team-1" });
  });

  it("retries an unknown edit outcome with one durable idempotency key", async () => {
    let row = 0;
    let attempt = 0;
    const original = { ...createdTeam(), revision: 7 };
    const form = openTeamProfileForm({
      mode: "edit",
      profile: original,
      newRowKey: () => `edit-row-${++row}`,
      newIdempotencyKey: () => `edit-attempt-${++attempt}`,
    });
    form.setName("Runtime Team");
    const updates: Parameters<TeamProfileFormGateway["updateTeamProfile"]>[0][] = [];
    let call = 0;
    const gateway: TeamProfileFormGateway = {
      createTeamProfile: async () => {
        throw new Error("Unexpected create");
      },
      updateTeamProfile: async (input) => {
        updates.push(input);
        call += 1;
        if (call === 1) throw new Error("Response was lost after commit");
        return { team: { ...original, ...input, revision: 8 }, error: null };
      },
    };

    await submitTeamProfileForm(form, gateway, { refused: "Save failed" });
    const result = await submitTeamProfileForm(form, gateway, { refused: "Save failed" });

    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual(updates[0]);
    expect(updates[0]?.idempotencyKey).toBe("edit-attempt-1");
    expect(result).toEqual({ kind: "team", teamId: "team-1" });
  });

  it("retries an unknown create outcome with the same key and frozen payload", async () => {
    const form = openFilledCreateForm();
    const gateway = new SequencedTeamProfileGateway([
      new Error("The connection dropped"),
      { team: createdTeam(), error: null },
    ]);

    await submitTeamProfileForm(form, gateway, { refused: "Save failed" });
    form.setName("A different draft");
    const result = await submitTeamProfileForm(form, gateway, { refused: "Save failed" });

    expect(gateway.creates).toHaveLength(2);
    expect(gateway.creates[0]).toEqual(gateway.creates[1]);
    expect(gateway.creates.map((input) => input.idempotencyKey)).toEqual([
      "attempt-1",
      "attempt-1",
    ]);
    expect(gateway.creates.map((input) => input.name)).toEqual(["Platform", "Platform"]);
    expect(result).toEqual({ kind: "team", teamId: "team-1" });
  });

  it("uses a new key after the daemon definitely rejects create", async () => {
    const form = openFilledCreateForm();
    const gateway = new SequencedTeamProfileGateway([
      { team: null, error: "The workspace was archived" },
      { team: createdTeam(), error: null },
    ]);

    await submitTeamProfileForm(form, gateway, { refused: "Save failed" });
    expect(form.getState()).toMatchObject({
      idempotencyKey: "attempt-2",
      submission: {
        status: "failure",
        outcome: "definite",
        message: "The workspace was archived",
      },
    });

    await submitTeamProfileForm(form, gateway, { refused: "Save failed" });
    expect(gateway.creates.map((input) => input.idempotencyKey)).toEqual([
      "attempt-1",
      "attempt-2",
    ]);
  });

  it("does not navigate when success arrives after the form closes", async () => {
    const form = openFilledCreateForm();
    let resolve!: (value: TeamProfileMutationResponse) => void;
    const response = new Promise<TeamProfileMutationResponse>((complete) => {
      resolve = complete;
    });
    const gateway: TeamProfileFormGateway = {
      createTeamProfile: () => response,
      updateTeamProfile: async () => {
        throw new Error("Unexpected update");
      },
    };

    const submission = submitTeamProfileForm(form, gateway, { refused: "Save failed" });
    form.close();
    resolve({ team: createdTeam(), error: null });

    await expect(submission).resolves.toBeNull();
  });
});
