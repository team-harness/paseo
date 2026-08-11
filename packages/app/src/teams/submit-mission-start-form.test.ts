import { describe, expect, it, vi } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { openMissionStartForm } from "./mission-start-form-model";
import { submitMissionStartForm, type MissionStartGateway } from "./submit-mission-start-form";

function team(): TeamV2 {
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
  };
}

function openFilled(access: "checking_host" | "supported" | "upgrade_required" = "supported") {
  let row = 0;
  let key = 0;
  const selected = team();
  const form = openMissionStartForm({
    serverId: "server-a",
    workspaceId: "workspace-a",
    access,
    selectedTeam: selected,
    teams: [selected],
    newRowKey: () => `row-${++row}`,
    newIdempotencyKey: () => `key-${++key}`,
  });
  form.setObjective("  Ship Mission UI  ");
  form.addConstraint();
  form.setConstraint("row-2", "  Do not open participant tabs  ");
  form.setAcceptanceCriterion("row-1", "  The Team tab stays selected  ");
  return form;
}

function gateway(
  answers: Array<Error | Awaited<ReturnType<MissionStartGateway["startTeamMission"]>>>,
): MissionStartGateway & { startTeamMission: ReturnType<typeof vi.fn> } {
  return {
    startTeamMission: vi.fn(async () => {
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      if (!answer) throw new Error("Missing test answer");
      return answer;
    }),
  };
}

describe("submitting a Mission start form", () => {
  it("sends a trimmed frozen request and only navigates to its Team tab", async () => {
    const form = openFilled();
    const client = gateway([
      { mission: { id: "mission-a", teamId: "team-a" }, error: null, errorCode: null },
    ]);

    const target = await submitMissionStartForm(form, client, "Mission could not be started");

    expect(client.startTeamMission).toHaveBeenCalledWith({
      idempotencyKey: "key-1",
      teamId: "team-a",
      expectedTeamRevision: 4,
      objective: "Ship Mission UI",
      constraints: ["Do not open participant tabs"],
      acceptanceCriteria: ["The Team tab stays selected"],
    });
    expect(target).toEqual({ kind: "team", teamId: "team-a" });
    expect(form.getState().submission).toEqual({
      status: "success",
      missionId: "mission-a",
      teamId: "team-a",
    });
  });

  it("reuses the exact frozen payload after an unknown outcome", async () => {
    const form = openFilled();
    const client = gateway([
      new Error("Connection dropped"),
      { mission: { id: "mission-a", teamId: "team-a" }, error: null, errorCode: null },
    ]);

    await submitMissionStartForm(form, client, "Mission could not be started");
    form.setObjective("A different request must not use the same key");
    await submitMissionStartForm(form, client, "Mission could not be started");

    expect(client.startTeamMission).toHaveBeenCalledTimes(2);
    expect(client.startTeamMission.mock.calls[1]?.[0]).toEqual(
      client.startTeamMission.mock.calls[0]?.[0],
    );
  });

  it("rotates the key after a definite refusal", async () => {
    const form = openFilled();
    const previousKey = form.getState().idempotencyKey;

    await submitMissionStartForm(
      form,
      gateway([{ mission: null, error: "Team revision changed", errorCode: "revision_conflict" }]),
      "Mission could not be started",
    );

    expect(form.getState()).toMatchObject({
      idempotencyKey: expect.not.stringMatching(previousKey),
      submission: { status: "failure", message: "Team revision changed", retryable: false },
    });
  });

  it("does not navigate when success arrives after the form closes", async () => {
    const form = openFilled();
    let resolve!: (value: Awaited<ReturnType<MissionStartGateway["startTeamMission"]>>) => void;
    const response = new Promise<Awaited<ReturnType<MissionStartGateway["startTeamMission"]>>>(
      (complete) => {
        resolve = complete;
      },
    );
    const client: MissionStartGateway = {
      startTeamMission: () => response,
    };

    const submission = submitMissionStartForm(form, client, "Mission could not be started");
    form.close();
    resolve({ mission: { id: "mission-a", teamId: "team-a" }, error: null, errorCode: null });

    await expect(submission).resolves.toBeNull();
  });

  it.each(["checking_host", "upgrade_required"] as const)(
    "sends zero requests while access is %s",
    async (access) => {
      const form = openFilled(access);
      const client = gateway([
        { mission: { id: "mission-a", teamId: "team-a" }, error: null, errorCode: null },
      ]);

      expect(await submitMissionStartForm(form, client, "Mission could not be started")).toBeNull();
      expect(client.startTeamMission).not.toHaveBeenCalled();
    },
  );
});
