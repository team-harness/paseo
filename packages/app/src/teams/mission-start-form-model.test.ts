import { describe, expect, it } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { openMissionStartForm } from "./mission-start-form-model";

function team(overrides: Partial<TeamV2> = {}): TeamV2 {
  return {
    id: "team-a",
    name: "Platform",
    workspaceId: "workspace-a",
    leadMemberId: "member-lead",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    members: [
      {
        memberId: "member-lead",
        role: "Lead",
        level: 5,
        skillIds: ["typescript"],
        executionProfile: {
          provider: "mock",
          model: "model-a",
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
        mentionHandle: "lead",
      },
    ],
    lifecycle: "active",
    activeMissionId: null,
    lifecycleRecoveryFailure: null,
    revision: 4,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function open(selectedTeam: TeamV2 | null = team()) {
  let row = 0;
  let key = 0;
  return openMissionStartForm({
    serverId: "server-a",
    workspaceId: "workspace-a",
    access: "supported",
    selectedTeam,
    teams: selectedTeam ? [selectedTeam] : [],
    newRowKey: () => `row-${++row}`,
    newIdempotencyKey: () => `key-${++key}`,
  });
}

describe("Mission start form model", () => {
  it("freezes the selected Team identity and becomes ready with one acceptance criterion", () => {
    const form = open();

    expect(form.getState()).toMatchObject({
      selectedTeamId: "team-a",
      selectedTeamDisplay: "Platform",
      selectedTeamRevision: 4,
      objective: "",
      constraints: [],
      acceptanceCriteria: [{ key: "row-1", value: "" }],
      staleTeam: false,
      canSubmit: false,
    });

    form.setObjective(" Ship the Mission UI ");
    form.setAcceptanceCriterion("row-1", " Playwright covers the happy path ");

    expect(form.getState().canSubmit).toBe(true);
  });

  it("allows no constraints while keeping every added row keyed", () => {
    const form = open();

    form.addConstraint();
    form.addConstraint();
    expect(form.getState().constraints.map((row) => row.key)).toEqual(["row-2", "row-3"]);

    form.setConstraint("row-2", "No legacy fallback");
    form.removeConstraint("row-3");
    expect(form.getState().constraints).toEqual([{ key: "row-2", value: "No legacy fallback" }]);
  });

  it("ignores late lists from another host or workspace", () => {
    const form = open();
    const replacement = team({ id: "team-b", name: "Other" });

    form.applyTeams({ serverId: "server-b", workspaceId: "workspace-a", teams: [replacement] });
    form.applyTeams({ serverId: "server-a", workspaceId: "workspace-b", teams: [replacement] });

    expect(form.getState().teamOptions.map((option) => option.teamId)).toEqual(["team-a"]);
  });

  it("marks a selected Team revision stale until the user explicitly reselects it", () => {
    const form = open();
    form.setObjective("Ship it");
    form.setAcceptanceCriterion("row-1", "All checks pass");

    form.applyTeams({
      serverId: "server-a",
      workspaceId: "workspace-a",
      teams: [team({ revision: 5, name: "Platform updated" })],
    });

    expect(form.getState()).toMatchObject({
      selectedTeamDisplay: "Platform",
      selectedTeamRevision: 4,
      staleTeam: true,
      canSubmit: false,
    });

    form.selectTeam("team-a");
    expect(form.getState()).toMatchObject({
      selectedTeamDisplay: "Platform updated",
      selectedTeamRevision: 5,
      staleTeam: false,
      canSubmit: true,
    });
  });

  it("rotates the key when the user abandons an unknown request by choosing another Team", () => {
    const form = open();
    form.setObjective("Ship it");
    form.setAcceptanceCriterion("row-1", "All checks pass");
    const request = form.prepareSubmission();
    expect(request).not.toBeNull();
    form.submitFailed({ message: "Connection dropped", retryable: true });
    const unknownKey = form.getState().idempotencyKey;

    form.applyTeams({
      serverId: "server-a",
      workspaceId: "workspace-a",
      teams: [team(), team({ id: "team-b", name: "Clients" })],
    });
    form.selectTeam("team-b");

    expect(form.getState()).toMatchObject({
      selectedTeamId: "team-b",
      idempotencyKey: expect.not.stringMatching(unknownKey),
      submission: { status: "idle" },
    });
  });
});
