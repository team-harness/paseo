// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import type { MissionStartFormSnapshot } from "./mission-start-form-model";
import { useMissionStartFormModel } from "./use-mission-start-form-model";

function team(revision: number): TeamV2 {
  return {
    id: "team-a",
    name: revision === 1 ? "Platform" : "Platform updated",
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
          model: null,
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
    revision,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    archivedAt: null,
  };
}

function snapshot(selected: TeamV2): MissionStartFormSnapshot {
  let row = 0;
  return {
    serverId: "server-a",
    workspaceId: "workspace-a",
    access: "supported",
    selectedTeam: selected,
    teams: [selected],
    newRowKey: () => `row-${++row}`,
    newIdempotencyKey: () => "key-a",
  };
}

describe("useMissionStartFormModel", () => {
  afterEach(cleanup);

  it("keeps the draft and model instance while late Team data is applied explicitly", () => {
    const initial = team(1);
    const { result, rerender } = renderHook(({ input }) => useMissionStartFormModel(input), {
      initialProps: { input: snapshot(initial) },
    });
    const opened = result.current;

    act(() => {
      opened.setObjective("Keep this draft");
      opened.setAcceptanceCriterion("row-1", "Do not reconstruct the model");
    });

    rerender({ input: snapshot(team(2)) });

    expect(result.current).toBe(opened);
    expect(result.current.getState()).toMatchObject({
      objective: "Keep this draft",
      selectedTeamRevision: 1,
      staleTeam: true,
    });
  });
});
