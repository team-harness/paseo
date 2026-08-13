import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runProfileArchiveCommand,
  runProfileCreateCommand,
  runProfileInspectCommand,
  runProfileListCommand,
  runProfileRefreshExecutionCommand,
  runProfileUpdateCommand,
} from "./profile.js";

const { connectToDaemon, client } = vi.hoisted(() => ({
  connectToDaemon: vi.fn(),
  client: {
    getLastServerInfoMessage: () => ({
      features: {
        teamMissions: true,
        globalTeamProfiles: true,
        teamMethodologies: true,
        teamProfileUpgrades: true,
      },
    }),
    createTeamProfile: vi.fn(),
    listTeamMethodologies: vi.fn(),
    listTeamProfiles: vi.fn(),
    getDaemonConfig: vi.fn(),
    inspectTeamProfile: vi.fn(),
    updateTeamProfile: vi.fn(),
    refreshTeamMemberExecution: vi.fn(),
    archiveTeamProfile: vi.fn(),
    close: vi.fn(async () => {}),
  },
}));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon,
  getDaemonHost: () => "127.0.0.1:6767",
}));

const timestamp = "2026-08-09T08:00:00.000Z";
const standard = {
  ref: {
    bundleId: "paseo/standard",
    version: "1",
    digest: "sha256:d5001287a60f868bcef21ecd3c4debb5a5237db002c5b9d0f7b0b78e98969697",
  },
  presets: [{ presetId: "lean-delivery" }],
  archetypes: [{ archetypeId: "lead" }, { archetypeId: "builder" }],
  skills: [{ skillId: "implementation" }],
  policySummary: {
    review: { operatorWaiver: "allowed_with_reason" },
    verification: { required: true },
  },
};
const team = {
  id: "team-1",
  name: "Platform",
  creationWorkspaceId: "workspace-1",
  leadMemberId: "member-lead",
  skills: [{ skillId: "ts", name: "TypeScript", description: null }],
  members: [
    {
      memberId: "member-lead",
      role: "lead",
      level: 5,
      skillIds: ["ts"],
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
      mentionHandle: "lead",
    },
  ],
  methodologyBinding: {
    ref: standard.ref,
    presetId: "lean-delivery",
    memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "lead" }],
    skillBindings: [{ teamSkillId: "ts", methodologySkillId: null }],
  },
  lifecycle: "active",
  activeMissionId: null,
  lifecycleRecoveryFailure: null,
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  connectToDaemon.mockResolvedValue(client);
  client.listTeamMethodologies.mockResolvedValue({
    methodologies: [standard],
    error: null,
    errorCode: null,
  });
  client.getDaemonConfig.mockResolvedValue({ requestId: "config", config: { agentProfiles: [] } });
});

describe("Team profile commands", () => {
  it("creates same-Role members from independent declaration keys", async () => {
    client.createTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });

    await runProfileCreateCommand(
      "Platform",
      {
        workspace: "workspace-1",
        skill: ["ts=TypeScript"],
        lead: ["lead=coordinator"],
        member: ["api=implementer", "web=implementer"],
        level: ["lead=5", "api=4", "web=2"],
        memberSkill: ["lead=ts", "api=ts", "web=ts"],
        provider: ["lead=codex", "api=codex"],
        model: ["api=gpt-5.6-sol"],
        agentProfile: ["web=profile-web"],
        preset: "lean-delivery",
        archetype: ["lead=lead", "api=builder", "web=builder"],
        methodologySkill: ["ts=implementation"],
        idempotencyKey: "create-key",
      },
      null as never,
    );

    expect(client.createTeamProfile).toHaveBeenCalledWith({
      idempotencyKey: "create-key",
      name: "Platform",
      creationWorkspaceId: "workspace-1",
      skills: team.skills,
      members: [
        {
          clientMemberKey: "lead",
          role: "coordinator",
          level: 5,
          skillIds: ["ts"],
          executionProfileSelection: expect.objectContaining({
            kind: "inline",
            executionProfile: expect.objectContaining({ provider: "codex" }),
          }),
        },
        expect.objectContaining({
          clientMemberKey: "api",
          role: "implementer",
          level: 4,
          executionProfileSelection: expect.objectContaining({
            kind: "inline",
            executionProfile: expect.objectContaining({
              provider: "codex",
              model: "gpt-5.6-sol",
            }),
          }),
        }),
        {
          clientMemberKey: "web",
          role: "implementer",
          level: 2,
          skillIds: ["ts"],
          executionProfileSelection: {
            kind: "agent_profile",
            profileId: "profile-web",
          },
        },
      ],
      leadClientMemberKey: "lead",
      methodologyBinding: {
        ref: standard.ref,
        presetId: "lean-delivery",
        memberArchetypeBindings: [
          { clientMemberKey: "lead", archetypeId: "lead" },
          { clientMemberKey: "api", archetypeId: "builder" },
          { clientMemberKey: "web", archetypeId: "builder" },
        ],
        skillBindings: [{ teamSkillId: "ts", methodologySkillId: "implementation" }],
      },
    });
  });

  it("rejects repeated lead declarations instead of silently taking the last one", async () => {
    await expect(
      runProfileCreateCommand(
        "Platform",
        {
          workspace: "workspace-1",
          skill: ["ts=TypeScript"],
          lead: ["primary=coordinator", "backup=coordinator"],
          level: ["primary=5", "backup=4"],
          memberSkill: ["primary=ts", "backup=ts"],
          provider: ["primary=codex", "backup=claude"],
        },
        null as never,
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_LEAD_DECLARATION" });
    expect(client.createTeamProfile).not.toHaveBeenCalled();
  });

  it("rejects mixed Agent Profile and inline execution declarations", async () => {
    await expect(
      runProfileCreateCommand(
        "Platform",
        {
          workspace: "workspace-1",
          skill: ["ts=TypeScript"],
          lead: ["lead=coordinator"],
          level: ["lead=5"],
          memberSkill: ["lead=ts"],
          provider: ["lead=codex"],
          agentProfile: ["lead=profile-lead"],
        },
        null as never,
      ),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_EXECUTION_SELECTION" });
    expect(connectToDaemon).not.toHaveBeenCalled();
  });

  it.each([
    {
      override: { archetype: ["lead=missing"] },
      code: "METHODOLOGY_ARCHETYPE_NOT_FOUND",
    },
    {
      override: { methodologySkill: ["ts=missing"] },
      code: "METHODOLOGY_SKILL_NOT_FOUND",
    },
  ])("rejects invalid catalog binding with $code before create", async ({ override, code }) => {
    await expect(
      runProfileCreateCommand(
        "Platform",
        {
          workspace: "workspace-1",
          skill: ["ts=TypeScript"],
          lead: ["lead=coordinator"],
          level: ["lead=5"],
          memberSkill: ["lead=ts"],
          provider: ["lead=codex"],
          preset: "lean-delivery",
          archetype: ["lead=lead"],
          ...override,
        },
        null as never,
      ),
    ).rejects.toMatchObject({ code });
    expect(client.createTeamProfile).not.toHaveBeenCalled();
  });

  it("uses only v2 SDK methods for list and inspect", async () => {
    client.listTeamProfiles.mockResolvedValue({ teams: [team], error: null, errorCode: null });
    client.inspectTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });

    const list = await runProfileListCommand({ all: true }, null as never);
    const inspect = await runProfileInspectCommand("team-1", {}, null as never);

    expect(client.listTeamProfiles).toHaveBeenCalledWith({ includeArchived: true });
    expect(client.inspectTeamProfile).toHaveBeenCalledWith({ teamId: "team-1" });
    expect(list.data[0]).toMatchObject({ id: "team-1", revision: 4 });
    expect(inspect.data.roster[0]).toMatchObject({ role: "lead", level: 5 });
  });

  it("updates every mutable profile field and archives by revision", async () => {
    client.updateTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });
    client.archiveTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });

    await runProfileUpdateCommand(
      "team-1",
      {
        expectedRevision: "4",
        name: "Platform v2",
        leadMember: "member-reviewer",
        skill: ["ts=TypeScript"],
        addMember: ["api=builder", "web=builder"],
        addLevel: ["api=4", "web=2"],
        addSkill: ["api=ts", "web=ts"],
        addProvider: ["api=codex", "web=claude"],
        addModel: ["api=gpt-5.6-sol", "web=sonnet"],
        updateRole: ["member-reviewer=review lead"],
        updateLevel: ["member-reviewer=5"],
        updateSkill: ["member-reviewer=ts"],
        updateProvider: ["member-reviewer=claude"],
        updateModel: ["member-reviewer=opus"],
        removeMember: ["member-old"],
        idempotencyKey: "update-key",
      },
      null as never,
    );
    await runProfileArchiveCommand(
      "team-1",
      { expectedRevision: "5", idempotencyKey: "archive-key" },
      null as never,
    );

    expect(client.updateTeamProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "update-key",
        teamId: "team-1",
        expectedRevision: 4,
        name: "Platform v2",
        skills: team.skills,
        leadMemberId: "member-reviewer",
        memberAdds: [
          expect.objectContaining({
            role: "builder",
            level: 4,
            executionProfileSelection: expect.objectContaining({
              kind: "inline",
              executionProfile: expect.objectContaining({
                provider: "codex",
                model: "gpt-5.6-sol",
              }),
            }),
          }),
          expect.objectContaining({
            role: "builder",
            level: 2,
            executionProfileSelection: expect.objectContaining({
              kind: "inline",
              executionProfile: expect.objectContaining({ provider: "claude", model: "sonnet" }),
            }),
          }),
        ],
        memberUpdates: [
          expect.objectContaining({
            memberId: "member-reviewer",
            role: "review lead",
            level: 5,
            skillIds: ["ts"],
            executionProfileSelection: expect.objectContaining({
              kind: "inline",
              executionProfile: expect.objectContaining({ provider: "claude", model: "opus" }),
            }),
          }),
        ],
        memberRemovals: ["member-old"],
      }),
    );
    expect(client.archiveTeamProfile).toHaveBeenCalledWith({
      idempotencyKey: "archive-key",
      teamId: "team-1",
      expectedRevision: 5,
    });
  });

  it("allows a profile update without adding members", async () => {
    client.updateTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });

    await runProfileUpdateCommand(
      "team-1",
      { expectedRevision: "4", name: "Renamed", idempotencyKey: "rename-key" },
      null as never,
    );

    expect(client.updateTeamProfile).toHaveBeenCalledWith({
      idempotencyKey: "rename-key",
      teamId: "team-1",
      expectedRevision: 4,
      name: "Renamed",
    });
  });

  it("rebinds and detaches Member execution sources explicitly", async () => {
    client.updateTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });

    await runProfileUpdateCommand(
      "team-1",
      {
        expectedRevision: "4",
        updateAgentProfile: ["member-lead=profile-reviewer"],
        idempotencyKey: "rebind-key",
      },
      null as never,
    );
    await runProfileUpdateCommand(
      "team-1",
      {
        expectedRevision: "4",
        updateProvider: ["member-lead=codex"],
        idempotencyKey: "detach-key",
      },
      null as never,
    );

    expect(client.updateTeamProfile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        memberUpdates: [
          {
            memberId: "member-lead",
            executionProfileSelection: {
              kind: "agent_profile",
              profileId: "profile-reviewer",
            },
          },
        ],
      }),
    );
    expect(client.updateTeamProfile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        memberUpdates: [
          {
            memberId: "member-lead",
            executionProfileSelection: expect.objectContaining({ kind: "inline" }),
          },
        ],
      }),
    );
  });

  it("upgrades an exact Methodology with complete binding arrays", async () => {
    const next = {
      ...standard,
      ref: { ...standard.ref, version: "2", digest: `sha256:${"a".repeat(64)}` },
    };
    client.inspectTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });
    client.listTeamMethodologies.mockResolvedValue({
      methodologies: [standard, next],
      error: null,
      errorCode: null,
    });
    client.updateTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });

    await runProfileUpdateCommand(
      "team-1",
      {
        expectedRevision: "4",
        methodology: "paseo/standard@2",
        yes: true,
        archetype: ["member-lead=lead"],
        idempotencyKey: "methodology-key",
      },
      null as never,
    );

    expect(client.updateTeamProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        methodologyUpgrade: {
          expectedRef: standard.ref,
          ref: next.ref,
          presetId: "lean-delivery",
          memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "lead" }],
          skillBindings: [{ teamSkillId: "ts", methodologySkillId: null }],
        },
      }),
    );
  });

  it("prints the exact Methodology preview and requires confirmation before mutation", async () => {
    const next = {
      ...standard,
      ref: { ...standard.ref, version: "2", digest: `sha256:${"a".repeat(64)}` },
      policySummary: {
        ...standard.policySummary,
        review: { operatorWaiver: "forbidden" },
      },
    };
    client.inspectTeamProfile.mockResolvedValue({ team, error: null, errorCode: null });
    client.listTeamMethodologies.mockResolvedValue({
      methodologies: [standard, next],
      error: null,
      errorCode: null,
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      runProfileUpdateCommand(
        "team-1",
        {
          expectedRevision: "4",
          methodology: "paseo/standard@2",
          archetype: ["member-lead=lead"],
          idempotencyKey: "unconfirmed-methodology",
        },
        null as never,
      ),
    ).rejects.toMatchObject({
      code: "METHODOLOGY_CONFIRMATION_REQUIRED",
      details: expect.stringContaining("Policy after:"),
    });
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Member bindings: member-lead (lead)=lead"),
    );
    expect(client.updateTeamProfile).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("refreshes a sourced Member through the dedicated RPC", async () => {
    const sourcedTeam = {
      ...team,
      members: [
        {
          ...team.members[0],
          executionProfile: { ...team.members[0].executionProfile, model: "gpt-5.6-sol" },
          executionProfileSource: {
            kind: "agent_profile" as const,
            profileId: "profile-lead",
            resolverVersion: 1,
            appliedDigest: `sha256:${"0".repeat(64)}`,
          },
        },
      ],
    };
    client.refreshTeamMemberExecution.mockResolvedValue({
      disposition: "updated",
      team: sourcedTeam,
      error: null,
      errorCode: null,
    });
    client.getDaemonConfig.mockResolvedValue({
      requestId: "config-after-refresh",
      config: {
        agentProfiles: [{ id: "profile-lead", provider: "codex", model: "gpt-5.6-sol" }],
      },
    });

    const result = await runProfileRefreshExecutionCommand(
      "team-1",
      "member-lead",
      { expectedRevision: "4", idempotencyKey: "refresh-key" },
      null as never,
    );

    expect(client.refreshTeamMemberExecution).toHaveBeenCalledWith({
      teamId: "team-1",
      memberId: "member-lead",
      expectedTeamRevision: 4,
      idempotencyKey: "refresh-key",
    });
    expect(client.getDaemonConfig).toHaveBeenCalledOnce();
    expect(client.getDaemonConfig.mock.invocationCallOrder[0]).toBeLessThan(
      client.refreshTeamMemberExecution.mock.invocationCallOrder[0]!,
    );
    expect(result.data.roster[0]).toMatchObject({
      executionSource: "profile-lead",
      executionSourceStatus: "current",
    });
  });

  it("does not send a refresh when the Agent Profile catalog cannot be read", async () => {
    client.getDaemonConfig.mockRejectedValueOnce(new Error("config unavailable"));

    await expect(
      runProfileRefreshExecutionCommand(
        "team-1",
        "member-lead",
        { expectedRevision: "4", idempotencyKey: "refresh-config-failed" },
        null as never,
      ),
    ).rejects.toMatchObject({
      code: "TEAM_PROFILE_REFRESH_FAILED",
      message: expect.stringContaining("config unavailable"),
    });
    expect(client.refreshTeamMemberExecution).not.toHaveBeenCalled();
  });
});
