import { describe, expect, it } from "vitest";
import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { openTeamProfileForm } from "./team-profile-form-model";

const READY_ENTRIES = [
  {
    provider: "codex",
    status: "ready" as const,
    enabled: true,
    models: [
      {
        provider: "codex",
        id: "gpt-5.6-sol",
        label: "GPT-5.6",
        isDefault: true,
        thinkingOptions: [{ id: "high", label: "High" }],
        defaultThinkingOptionId: "high",
      },
    ],
    modes: [{ id: "auto", label: "Auto" }],
    defaultModeId: "auto",
  },
];

function createSnapshot() {
  let row = 0;
  let attempt = 0;
  return {
    mode: "create" as const,
    workspaceId: "workspace-1",
    hostSnapshot: undefined,
    newRowKey: () => `row-${++row}`,
    newIdempotencyKey: () => `attempt-${++attempt}`,
  };
}

function storedProfile(): TeamV2 {
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
          provider: "removed-provider",
          model: "old-model",
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
    revision: 7,
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T08:00:00.000Z",
    archivedAt: null,
  };
}

function editSnapshot() {
  let row = 0;
  let attempt = 0;
  return {
    mode: "edit" as const,
    profile: storedProfile(),
    hostSnapshot: undefined,
    newRowKey: () => `edit-row-${++row}`,
    newIdempotencyKey: () => `edit-attempt-${++attempt}`,
  };
}

describe("opening a Team profile form", () => {
  it("creates a fresh skill and member draft for each mount", () => {
    const first = openTeamProfileForm(createSnapshot());
    first.setName("Platform");

    const second = openTeamProfileForm(createSnapshot());

    expect(first.getState().name).toBe("Platform");
    expect(second.getState()).toMatchObject({
      name: "",
      skills: [{ key: "row-1" }],
      members: [{ key: "row-2" }],
      leadRowKey: "row-2",
    });
  });

  it("accepts late host data only for the opened workspace without rebuilding rows", () => {
    const form = openTeamProfileForm(createSnapshot());
    const keys = {
      skill: form.getState().skills[0]!.key,
      member: form.getState().members[0]!.key,
    };
    form.setName("Platform");

    form.applyHostSnapshot({
      workspaceId: "another-workspace",
      serverId: "server-stale",
      cwd: "/stale",
    });
    expect(form.getState().providerSnapshotRequest).toBeNull();

    form.applyHostSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
    });

    expect(form.getState()).toMatchObject({
      name: "Platform",
      skills: [{ key: keys.skill }],
      members: [{ key: keys.member }],
      providerResolution: "pending",
      providerSnapshotRequest: {
        workspaceId: "workspace-1",
        serverId: "server-1",
        cwd: "/repo",
      },
    });
  });
});

describe("validating the Team profile catalog", () => {
  it("reports a missing create workspace before submission", () => {
    const form = openTeamProfileForm({ ...createSnapshot(), workspaceId: "  " });

    expect(form.getState().validationIssues).toContainEqual({ kind: "workspace_required" });
  });

  it("reports duplicate skill identities and member references outside the catalog", () => {
    const form = openTeamProfileForm(createSnapshot());
    const firstSkill = form.getState().skills[0]!;
    const member = form.getState().members[0]!;
    form.setSkillId(firstSkill.key, "typescript");
    form.setSkillName(firstSkill.key, "TypeScript");
    form.addSkill();
    const duplicate = form.getState().skills[1]!;
    form.setSkillId(duplicate.key, "typescript");
    form.setSkillName(duplicate.key, "TypeScript");
    form.setMemberSkillIds(member.key, ["missing"]);

    expect(
      form
        .getState()
        .validationIssues.filter((issue) =>
          ["duplicate_skill_id", "duplicate_skill_name", "unknown_member_skill"].includes(
            issue.kind,
          ),
        ),
    ).toEqual([
      { kind: "duplicate_skill_id", skillId: "typescript" },
      { kind: "duplicate_skill_name", name: "TypeScript" },
      { kind: "unknown_member_skill", rowKey: member.key, skillId: "missing" },
    ]);
  });
});

describe("resolving member execution profiles", () => {
  it("accepts a provider snapshot only for the exact host and cwd request", () => {
    const form = openTeamProfileForm(createSnapshot());
    form.applyHostSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
    });
    const rowKey = form.getState().members[0]!.key;
    const entries = [
      {
        provider: "codex" as const,
        status: "ready" as const,
        enabled: true,
        models: [
          {
            id: "gpt-5.6-sol",
            provider: "codex" as const,
            label: "GPT-5.6 Sol",
            isDefault: true,
          },
        ],
      },
    ];

    form.applyProviderSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/other",
      entries,
    });
    expect(form.getState().providerResolution).toBe("pending");

    form.applyProviderSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
      entries,
    });

    expect(form.getState()).toMatchObject({
      members: [{ key: rowKey }],
      providerResolution: "complete",
      providerSnapshotRequest: null,
      modelSelectorProviders: [{ id: "codex" }],
    });
  });

  it("retains a saved unavailable execution profile for a name-only edit", () => {
    const form = openTeamProfileForm(editSnapshot());

    form.setName("Platform Runtime");

    expect(form.getState()).toMatchObject({
      mode: "edit",
      name: "Platform Runtime",
      leadRowKey: "edit-row-2",
      members: [
        {
          key: "edit-row-2",
          memberId: "member-1",
          executionProfileAvailability: "retained",
        },
      ],
      canSubmit: true,
    });
  });

  it("does not let an unsaved edit row become the lead", () => {
    const form = openTeamProfileForm(editSnapshot());
    const savedLead = form.getState().leadRowKey;
    form.addMember();
    const added = form.getState().members.at(-1)!;

    form.setLead(added.key);

    expect(added.memberId).toBeNull();
    expect(form.getState().leadRowKey).toBe(savedLead);
  });

  it("requires an available execution profile after the user changes it", () => {
    const form = openTeamProfileForm(editSnapshot());
    form.applyHostSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
    });
    form.applyProviderSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
      entries: READY_ENTRIES,
    });
    form.setName("Platform Runtime");
    const member = form.getState().members[0]!;

    form.setMemberExecutionProfile(member.key, storedProfile().members[0]!.executionProfile);
    expect(form.getState()).toMatchObject({
      members: [{ executionProfileAvailability: "unavailable" }],
      canSubmit: false,
    });

    form.setMemberExecutionProfile(member.key, {
      provider: "codex",
      model: "gpt-5.6-sol",
      modeId: "auto",
      thinkingOptionId: "high",
      featureValues: {},
    });
    expect(form.getState()).toMatchObject({
      members: [{ executionProfileAvailability: "available" }],
      canSubmit: true,
    });
  });

  it("allows multiple available members with the same role", () => {
    const form = openTeamProfileForm(createSnapshot());
    form.applyHostSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
    });
    form.applyProviderSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
      entries: READY_ENTRIES,
    });
    form.setName("Platform");
    const skill = form.getState().skills[0]!;
    form.setSkillId(skill.key, "typescript");
    form.setSkillName(skill.key, "TypeScript");
    const profile = {
      provider: "codex",
      model: "gpt-5.6-sol",
      modeId: "auto",
      thinkingOptionId: "high",
      featureValues: {},
    };
    const first = form.getState().members[0]!;
    form.setMemberRole(first.key, "Engineer");
    form.setMemberSkillIds(first.key, ["typescript"]);
    form.setMemberExecutionProfile(first.key, profile);
    form.addMember();
    const second = form.getState().members[1]!;
    form.setMemberRole(second.key, "Engineer");
    form.setMemberSkillIds(second.key, ["typescript"]);
    form.setMemberExecutionProfile(second.key, profile);

    expect(form.getState().members.map((member) => member.role)).toEqual(["Engineer", "Engineer"]);
    expect(form.getState().canSubmit).toBe(true);
  });

  it("resolves provider, model, mode, and thinking inside the selected member", () => {
    const form = openTeamProfileForm(createSnapshot());
    form.applyHostSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
    });
    form.applyProviderSnapshot({
      workspaceId: "workspace-1",
      serverId: "server-1",
      cwd: "/repo",
      entries: READY_ENTRIES,
    });
    form.addMember();
    const [first, second] = form.getState().members;

    form.setMemberModel(first!.key, "codex", "gpt-5.6-sol");

    expect(form.getState().members[0]!.executionProfile).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      modeId: "auto",
      thinkingOptionId: "high",
      featureValues: {},
    });
    expect(form.getState().members[0]!.executionProfileDisplay).toEqual({
      provider: "codex",
      model: "GPT-5.6",
      mode: "Auto",
      thinking: "High",
    });
    expect(form.getState().members[1]!.executionProfile.provider).toBeNull();
    expect(form.getState().members[1]!.key).toBe(second!.key);
  });
});
