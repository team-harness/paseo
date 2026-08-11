import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TeamProfileMemberInput } from "@getpaseo/protocol/team/v2-rpc-schemas";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AcceptedTurnFact } from "../domain/assignment-contract-validation.js";
import { MissionStore } from "../persistence/mission-store.js";
import { TeamProfileStore } from "../persistence/profile-store.js";
import { TeamPersistenceReconciler } from "../persistence/reconciliation.js";
import type {
  ProviderCapabilityResolver,
  TeamAcceptedTurnFactsPort,
  TeamMemberHistoryPort,
  TeamMessagePort,
  TeamRecipientAttentionAttempt,
  TeamRecipientAttentionPort,
  TeamParticipantPort,
  TeamRoomPort,
  TeamTerminalTurnFact,
} from "./ports.js";
import { TeamCollaborationService } from "./team-collaboration-service.js";
import { TeamMissionService } from "./team-mission-service.js";
import {
  TeamOperationCoordinator,
  type TeamOperationPermit,
} from "./team-operation-coordinator.js";
import { buildLeadReplanDeliveries } from "./assignment-replan.js";

const NOW = "2026-08-08T10:00:00.000Z";

const LEAD: TeamProfileMemberInput = {
  role: "Technical lead",
  level: 5,
  skillIds: ["typescript"],
  executionProfile: {
    provider: "codex",
    model: "gpt-5.6-sol",
    modeId: "auto-review",
    thinkingOptionId: "high",
    featureValues: {},
  },
};

const MEMBER: TeamProfileMemberInput = {
  role: "Software engineer",
  level: 3,
  skillIds: ["typescript"],
  executionProfile: {
    provider: "claude",
    model: "sonnet",
    modeId: "auto",
    thinkingOptionId: null,
    featureValues: {},
  },
};

describe("TeamCollaborationService queries", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-collaboration-service-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("recovers Team and Mission facts for an active participant", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);

    const teamStatus = await fixture.collaboration.teamStatus({
      callerAgentId: "agent-1",
      missionId: mission.id,
    });
    const missionStatus = await fixture.collaboration.missionStatus({
      callerAgentId: "agent-1",
      missionId: mission.id,
    });

    expect(teamStatus).toMatchObject({
      team: { id: team.id, activeMissionId: mission.id },
      missionId: mission.id,
      missionStatus: "planning",
      callerMemberId: team.leadMemberId,
      leadMemberId: team.leadMemberId,
      members: [
        {
          profile: { memberId: team.leadMemberId, role: "Technical lead" },
          participant: { agentId: "agent-1", bindingEpoch: 1 },
          load: { openAssignments: 0 },
        },
        {
          profile: { role: "Software engineer" },
          participant: null,
          load: { openAssignments: 0 },
        },
      ],
    });
    expect(missionStatus).toEqual({
      mission,
      callerMemberId: team.leadMemberId,
      blockers: [],
      artifacts: [],
      handoffs: [],
    });
  });

  test("lets the persisted Lead recover Mission facts while the start saga is still linking the Team", async () => {
    let releaseLeadCreate: (() => void) | null = null;
    const leadCreateReleased = new Promise<void>((resolve) => {
      releaseLeadCreate = resolve;
    });
    let observeLeadCreate:
      | ((input: Parameters<TeamParticipantPort["createLead"]>[0]) => void)
      | null = null;
    const leadCreateObserved = new Promise<Parameters<TeamParticipantPort["createLead"]>[0]>(
      (resolve) => {
        observeLeadCreate = resolve;
      },
    );
    const fixture = createFixture(rootDirectory, {
      beforeLeadCreate: async (input) => {
        observeLeadCreate?.(input);
        await leadCreateReleased;
      },
    });
    const team = await createTeam(fixture.lifecycle);
    const starting = fixture.lifecycle.startMission({
      idempotencyKey: "start-pending-tools",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Implement a deterministic parser",
      constraints: ["Keep the public grammar stable"],
      acceptanceCriteria: ["Parser tests pass"],
    });
    const lead = await leadCreateObserved;

    try {
      const status = await fixture.collaboration.missionStatus({
        callerAgentId: lead.agentId,
        missionId: lead.missionId,
      });
      expect(status).toMatchObject({
        mission: { id: lead.missionId, status: "planning" },
        callerMemberId: lead.memberId,
      });
    } finally {
      releaseLeadCreate?.();
      await starting;
    }
  });

  test("revalidates the caller against the persisted active participant on every query", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    await expect(
      fixture.collaboration.teamStatus({ callerAgentId: "agent-outsider", missionId: mission.id }),
    ).rejects.toMatchObject({ code: "not_mission_participant" });

    const archived = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        participants: current.participants.map((participant) => ({
          ...participant,
          archivedAt: NOW,
        })),
      }),
    });
    expect(archived.mission.participants[0]?.archivedAt).toBe(NOW);
    await expect(
      fixture.collaboration.missionStatus({ callerAgentId: "agent-1", missionId: mission.id }),
    ).rejects.toMatchObject({ code: "not_mission_participant" });
  });

  test("resolves a Member history through that Mission's participant binding", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        participants: [
          ...current.participants,
          {
            memberId: targetMemberId,
            agentId: "agent-member-history",
            bindingEpoch: 1,
            joinedAt: NOW,
            archivedAt: NOW,
          },
        ],
      }),
    });

    const history = await fixture.collaboration.teamMemberHistory({
      callerAgentId: "agent-1",
      missionId: mission.id,
      memberId: targetMemberId,
      limit: 25,
    });

    expect(fixture.historyReads).toEqual([{ agentId: "agent-member-history", limit: 25 }]);
    expect(history).toMatchObject({
      missionId: mission.id,
      member: { memberId: targetMemberId, role: "Software engineer" },
      participant: { agentId: "agent-member-history", archivedAt: NOW },
      content: "history for agent-member-history",
    });
  });

  test("does not read history for a Member outside the Mission roster", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    await expect(
      fixture.collaboration.teamMemberHistory({
        callerAgentId: "agent-1",
        missionId: mission.id,
        memberId: "member-outsider",
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: "mission_member_not_found" });
    expect(fixture.historyReads).toEqual([]);
  });

  test("lets the Lead atomically plan Workstreams and persists deterministic owner matching", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);

    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });

    expect(planned).toMatchObject({
      status: "planning",
      planRevision: 1,
      workstreams: [
        {
          workstreamId: "api",
          ownerMemberId: team.members[1]?.memberId,
          reviewerMemberId: team.leadMemberId,
          status: "planned",
        },
        {
          workstreamId: "final-verification",
          ownerMemberId: team.leadMemberId,
          dependencyWorkstreamIds: ["api"],
          status: "planned",
        },
      ],
    });
    expect(fixture.publishedMissions.at(-1)).toEqual(planned);
    expect(fixture.scheduledPermits).toEqual([]);

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: 0,
        workstreams: missionPlan(),
      }),
    ).rejects.toMatchObject({ code: "plan_revision_conflict" });
  });

  test("atomically activates an initial plan that includes complete Assignment coverage", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
      assignments: [deliveryDraft()],
    });

    expect(planned).toMatchObject({
      status: "active",
      planRevision: 1,
      assignments: [
        {
          planRevision: 1,
          workstreamId: "api",
          dependencyAssignmentIds: [],
        },
      ],
    });
    expect((await fixture.missions.get(mission.id))?.recipientAttentionOutbox).toEqual([]);
    expect(fixture.scheduledMissionIds).toEqual([mission.id]);
  });

  test("rejects a partial initial atomic plan without persisting its Plan or Assignments", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const api = missionPlan()[0]!;
    const ui = {
      ...api,
      workstreamId: "ui",
      title: "Parser UI",
      objective: "Render parser results",
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/app"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "ui"],
    };

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: mission.revision,
        expectedPlanRevision: 0,
        workstreams: [api, ui, verification],
        assignments: [deliveryDraft()],
      }),
    ).rejects.toMatchObject({ code: "mission_plan_missing_assignment_contracts" });

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: {
        status: "planning",
        planRevision: 0,
        workstreams: [],
        assignments: [],
      },
      recipientAttentionOutbox: [],
    });
    expect(fixture.scheduledMissionIds).toEqual([]);
  });

  test("lets a durable replacement Lead submit the Mission plan that closes replan Attention", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const pending = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            attentionId: "attention-lead-unavailable",
            kind: "lead_unavailable",
            status: "open",
            priorMissionStatus: "planning",
            assignmentId: null,
            summary: "The original Lead is unavailable.",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
      }),
    });
    const replacementMemberId = team.members[1]?.memberId ?? "missing";
    const replaced = await fixture.lifecycle.resolveAttention({
      idempotencyKey: "replace-lead-before-plan",
      missionId: mission.id,
      attentionId: "attention-lead-unavailable",
      expectedRevision: pending.mission.revision,
      actorId: "user-1",
      resolution: {
        kind: "replace_lead",
        replacementMemberId,
        reason: "Promote the available engineer.",
      },
    });

    expect(replaced.attentionItems).toMatchObject([
      { kind: "lead_unavailable", status: "resolved" },
      { kind: "assignment_requires_replan", status: "open" },
    ]);
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-2",
      missionId: mission.id,
      expectedRevision: replaced.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });

    expect(planned).toMatchObject({
      status: "planning",
      planRevision: 1,
      attentionItems: [
        { kind: "lead_unavailable", status: "resolved" },
        {
          kind: "assignment_requires_replan",
          status: "resolved",
          resolution: { kind: "replan", actorId: "agent-2" },
        },
      ],
    });
  });

  test("reranks independent final verifiers by skills, level, and load", async () => {
    const fixture = createFixture(rootDirectory);
    const team = await fixture.lifecycle.createTeam({
      idempotencyKey: "create-team-with-verifiers",
      name: "Compiler verification team",
      workspaceId: "workspace-sdk",
      skills: [
        { skillId: "typescript", name: "TypeScript", description: null },
        { skillId: "verification", name: "Verification", description: null },
      ],
      lead: LEAD,
      members: [
        { ...MEMBER, skillIds: ["typescript", "verification"] },
        {
          ...MEMBER,
          role: "Quality engineer",
          level: 4,
          skillIds: ["typescript", "verification"],
        },
      ],
    });
    const mission = await fixture.lifecycle.startMission({
      idempotencyKey: "start-verifier-ranking",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      objective: "Implement a deterministic parser",
      constraints: ["Keep the public grammar stable"],
      acceptanceCriteria: ["Parser tests pass"],
    });
    const [delivery, verification] = missionPlan();
    if (!delivery || !verification) throw new Error("Mission plan fixture is incomplete");

    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: [
        delivery,
        {
          ...verification,
          preferredSkillIds: ["verification"],
          minimumLevel: 3,
        },
      ],
    });

    expect(planned.workstreams).toMatchObject([
      { workstreamId: "api", ownerMemberId: team.members[1]?.memberId },
      {
        workstreamId: "final-verification",
        ownerMemberId: team.members[2]?.memberId,
        ownerMatchExplanation: { recommendedMemberId: team.members[1]?.memberId },
        ownerOverrideReason: "System-selected the highest-ranked independent final verifier",
      },
    ]);
  });

  test("rejects a plan from a non-Lead participant", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const memberId = team.members[1]?.memberId ?? "missing";
    const withMember = await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: mission.revision,
      update: (current) => ({
        ...current,
        participants: [
          ...current.participants,
          {
            memberId,
            agentId: "agent-member",
            bindingEpoch: 1,
            joinedAt: NOW,
            archivedAt: null,
          },
        ],
      }),
    });

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-member",
        missionId: mission.id,
        expectedRevision: withMember.mission.revision,
        expectedPlanRevision: 0,
        workstreams: missionPlan(),
      }),
    ).rejects.toMatchObject({ code: "lead_required" });
  });

  test("rejects a plan without a final verification Workstream", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: mission.revision,
        expectedPlanRevision: 0,
        workstreams: missionPlan().filter(
          (workstream) => workstream.workstreamId !== "final-verification",
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_mission_plan" });
    expect((await fixture.missions.get(mission.id))?.mission).toMatchObject({
      planRevision: 0,
      workstreams: [],
    });
  });

  test("creates a structured delivery Assignment batch against one plan revision", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });

    const assigned = await fixture.collaboration.assignTasks({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: planned.revision,
      expectedPlanRevision: 1,
      assignments: [deliveryDraft()],
    });

    expect(assigned.assignments).toMatchObject([
      {
        assignmentId: "assignment-1",
        kind: "delivery",
        assigneeMemberId: team.members[1]?.memberId,
        semanticState: "planned",
        dispatchState: "queued",
      },
    ]);
    expect(assigned.assignmentIdsByClientKey).toEqual({
      "api-delivery": "assignment-1",
    });
    expect((await fixture.missions.get(mission.id))?.mission.assignments).toEqual(
      assigned.assignments,
    );
    expect(fixture.scheduledPermits).toEqual([expect.objectContaining({ teamId: team.id })]);
  });

  test("rejects a stale or invalid Assignment batch without partial persistence", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });
    const draft = {
      clientKey: "api-delivery",
      kind: "delivery" as const,
      workstreamId: "api",
      subjectKeys: [],
      dependencyKeys: ["missing-assignment"],
      objective: "Implement the parser API",
      inputRefs: [],
      deliverables: ["Parser implementation"],
      acceptanceCriteria: ["Parser tests pass"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
      priority: 10,
    };

    await expect(
      fixture.collaboration.assignTasks({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: 0,
        assignments: [{ ...draft, dependencyKeys: [] }],
      }),
    ).rejects.toMatchObject({ code: "plan_revision_conflict" });
    await expect(
      fixture.collaboration.assignTasks({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: 1,
        assignments: [draft],
      }),
    ).rejects.toMatchObject({ code: "unknown_assignment_dependency_key" });
    expect((await fixture.missions.get(mission.id))?.mission.assignments).toEqual([]);
  });

  test("rejects a partial Assignment batch without persisting any contracts", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const api = missionPlan()[0]!;
    const implementation = {
      ...api,
      workstreamId: "implementation",
      title: "Parser implementation",
      objective: "Implement the parser contract",
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server/src"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "implementation"],
    };
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: [api, implementation, verification],
    });

    await expect(
      fixture.collaboration.assignTasks({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: 1,
        assignments: [deliveryDraft()],
      }),
    ).rejects.toMatchObject({ code: "assignment_batch_missing_contracts" });
    expect((await fixture.missions.get(mission.id))?.mission.assignments).toEqual([]);
  });

  test("derives Assignment dependencies from the Workstream DAG", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const api = missionPlan()[0]!;
    const implementation = {
      ...api,
      workstreamId: "implementation",
      title: "Parser implementation",
      objective: "Implement the parser contract",
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server/src"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "implementation"],
    };
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: [api, implementation, verification],
    });

    const assigned = await fixture.collaboration.assignTasks({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: planned.revision,
      expectedPlanRevision: 1,
      assignments: [
        deliveryDraft(),
        {
          clientKey: "implementation-delivery",
          kind: "delivery",
          workstreamId: "implementation",
          subjectKeys: [],
          dependencyKeys: [],
          objective: "Implement the parser contract",
          inputRefs: [],
          deliverables: ["Parser implementation"],
          acceptanceCriteria: ["Parser tests pass"],
          mutableScope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
          priority: 9,
        },
      ],
    });

    expect(assigned.assignments).toMatchObject([
      { assignmentId: "assignment-1", dependencyAssignmentIds: [] },
      { assignmentId: "assignment-2", dependencyAssignmentIds: ["assignment-1"] },
    ]);
  });

  test("rejects Assignment dependencies that contradict the Workstream DAG", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const api = missionPlan()[0]!;
    const ui = {
      ...api,
      workstreamId: "ui",
      title: "Parser UI",
      objective: "Render the parser result",
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/app"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const implementation = {
      ...api,
      workstreamId: "implementation",
      title: "Parser implementation",
      objective: "Implement the parser contract",
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server/src"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "ui", "implementation"],
    };
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: [api, ui, implementation, verification],
    });

    await expect(
      fixture.collaboration.assignTasks({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: 1,
        assignments: [
          deliveryDraft(),
          {
            ...deliveryDraft(),
            clientKey: "ui-delivery",
            workstreamId: "ui",
            objective: "Render the parser result",
            mutableScope: { kind: "paths", pathPrefixes: ["packages/app"] },
          },
          {
            ...deliveryDraft(),
            clientKey: "implementation-delivery",
            workstreamId: "implementation",
            dependencyKeys: ["ui-delivery"],
            objective: "Implement the parser contract",
            mutableScope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "assignment_dependency_workstream_mismatch" });
    expect((await fixture.missions.get(mission.id))?.mission.assignments).toEqual([]);
  });

  test("keeps an incomplete initial plan staged until one complete Assignment batch activates it", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });
    const staged = await fixture.missions.get(mission.id);

    expect(planned.status).toBe("planning");
    expect(staged).toMatchObject({
      mission: { status: "planning", planRevision: 1, assignments: [] },
      recipientAttentionOutbox: [
        {
          deliveryId: `${mission.id}:plan:1:assignment-coverage:lead`,
          state: "pending",
          attempts: 0,
        },
      ],
    });
    expect(fixture.scheduledMissionIds).toEqual([]);

    const restarted = createFixture(rootDirectory);
    await expect(restarted.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [],
    });
    expect(restarted.messagePosts).toMatchObject([
      {
        messageId: `${mission.id}:plan:1:assignment-coverage:message`,
        body: expect.stringContaining("assign_task once with the complete Assignment batch"),
      },
    ]);
    expect(restarted.attentionAttempts).toMatchObject([
      {
        deliveryId: `${mission.id}:plan:1:assignment-coverage:lead`,
        recipientAgentId: "agent-1",
        attempt: 1,
      },
    ]);

    const assigned = await restarted.collaboration.assignTasks({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: planned.revision,
      expectedPlanRevision: 1,
      assignments: [deliveryDraft()],
    });

    expect(assigned.mission.status).toBe("active");
    expect(await restarted.missions.get(mission.id)).toMatchObject({
      mission: { status: "active" },
      recipientAttentionOutbox: [
        {
          deliveryId: `${mission.id}:plan:1:assignment-coverage:lead`,
          state: "canceled",
          cancelReason: "attention_resolved",
        },
      ],
    });
    expect(restarted.scheduledMissionIds).toEqual([mission.id]);

    await expect(
      restarted.collaboration.assignTasks({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: assigned.mission.revision,
        expectedPlanRevision: 1,
        assignments: [{ ...deliveryDraft(), clientKey: "late-addition" }],
      }),
    ).rejects.toMatchObject({ code: "mission_assignment_activation_closed" });
  });

  test("cancels every staged-plan delivery binding successor when Assignments activate", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const planned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: mission.revision,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });
    const stored = await fixture.missions.get(mission.id);
    const baseDelivery = stored?.recipientAttentionOutbox[0];
    if (!stored || !baseDelivery) throw new Error("Staged plan delivery missing");
    const successorDeliveryId = `${baseDelivery.deliveryId}:binding:2`;
    const rebound = await fixture.missions.updateAggregate({
      missionId: mission.id,
      expectedRevision: planned.revision,
      update: ({ mission: current, recovery }) => ({
        mission: {
          ...current,
          participants: current.participants.map((participant) => ({
            ...participant,
            bindingEpoch: 2,
          })),
        },
        recovery: {
          ...recovery,
          recipientAttentionOutbox: [
            {
              ...baseDelivery,
              state: "canceled" as const,
              successorDeliveryId,
              nextEligibleAt: null,
              acknowledgedAt: null,
              canceledAt: NOW,
              cancelReason: "binding_replaced" as const,
            },
            {
              ...baseDelivery,
              deliveryId: successorDeliveryId,
              idempotencyKey: `${baseDelivery.idempotencyKey}:binding:2`,
              bindingEpoch: 2,
            },
          ],
        },
      }),
    });

    await fixture.collaboration.assignTasks({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: rebound.mission.revision,
      expectedPlanRevision: 1,
      assignments: [deliveryDraft()],
    });

    expect((await fixture.missions.get(mission.id))?.recipientAttentionOutbox).toMatchObject([
      { deliveryId: baseDelivery.deliveryId, state: "canceled" },
      {
        deliveryId: successorDeliveryId,
        state: "canceled",
        cancelReason: "attention_resolved",
      },
    ]);
  });

  test("atomically replans a blocked accepted Assignment with a new identity", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const blocked = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "blocked" as const,
                scopeLease: null,
                report: {
                  status: "blocked" as const,
                  summary: "The parser contract needs clarification",
                  blockers: ["The upstream contract is unavailable"],
                  artifactPaths: [],
                  tests: [],
                  decisions: [],
                  handoffs: [],
                },
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: blocked.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
      replacementAssignments: [
        {
          ...deliveryDraft(),
          clientKey: "api-recovery",
          supersedesAssignmentId: running.assignmentId,
        },
      ],
    });

    const original = replanned.assignments.find(
      (assignment) => assignment.assignmentId === running.assignmentId,
    );
    const replacement = replanned.assignments.find(
      (assignment) => assignment.assignmentId !== running.assignmentId,
    );
    expect(replanned.planRevision).toBe(2);
    expect(original).toMatchObject({
      semanticState: "canceled",
      terminationReason: "superseded",
      supersededBy: replacement?.assignmentId,
      report: { status: "blocked" },
    });
    expect(replacement).toMatchObject({
      semanticState: "planned",
      planRevision: 2,
      workstreamId: "api",
    });
    expect(replacement?.inputRefs).not.toContain(`mission-handoff:${running.assignmentId}`);
  });

  test("replans a failed daemon-owned verification without a user quality-gate draft", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const { blocked, failedVerificationId } = await createFailedDaemonOwnedVerification(
      fixture,
      running,
    );

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: blocked.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
    });

    expect(replanned.planRevision).toBe(2);
    expect(
      replanned.assignments.find((assignment) => assignment.assignmentId === failedVerificationId),
    ).toMatchObject({
      semanticState: "canceled",
      terminationReason: "superseded",
      supersededBy: "assignment:mission-1:2:final-verification:verification",
    });
    expect(replanned.assignments.filter((assignment) => assignment.planRevision === 2)).toEqual([
      expect.objectContaining({
        assignmentId: "assignment:mission-1:2:api:review",
        kind: "review",
        subjectAssignmentIds: [running.assignmentId],
        dependencyAssignmentIds: [running.assignmentId],
        semanticState: "planned",
      }),
      expect.objectContaining({
        assignmentId: "assignment:mission-1:2:final-verification:verification",
        kind: "verification",
        subjectAssignmentIds: [
          "assignment:mission-1:2:api:review",
          running.assignmentId,
        ].toSorted(),
        dependencyAssignmentIds: [
          "assignment:mission-1:2:api:review",
          running.assignmentId,
        ].toSorted(),
        semanticState: "planned",
      }),
    ]);
    expect(replanned.attentionItems).toEqual([
      expect.objectContaining({
        kind: "assignment_requires_replan",
        status: "resolved",
        resolution: expect.objectContaining({ kind: "replan", actorId: "agent-1" }),
      }),
    ]);
  });

  test("cancels a review that the replanned Workstream no longer requires", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const { blocked } = await createFailedDaemonOwnedVerification(fixture, running);
    const { stored: withReview, reviewId: oldReviewId } = await addPlannedReview(
      fixture,
      running,
      blocked.mission.revision,
    );

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: withReview.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlanWithoutRequiredReview(),
    });

    expect(
      replanned.assignments.find((assignment) => assignment.assignmentId === oldReviewId),
    ).toMatchObject({
      semanticState: "canceled",
      terminationReason: null,
      planChangeReason: "quality_gate_no_longer_required",
      supersededBy: null,
    });
    expect(replanned.assignments.filter((assignment) => assignment.planRevision === 2)).toEqual([
      expect.objectContaining({
        kind: "verification",
        subjectAssignmentIds: [running.assignmentId],
        dependencyAssignmentIds: [running.assignmentId],
      }),
    ]);
  });

  test("cancels a review when its Workstream is removed by replan", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const { blocked } = await createFailedDaemonOwnedVerification(fixture, running);
    const { stored: withReview, reviewId: oldReviewId } = await addPlannedReview(
      fixture,
      running,
      blocked.mission.revision,
    );

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: withReview.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlanReplacingApi(),
      assignments: [replacementDeliveryDraft()],
    });

    expect(
      replanned.assignments.find((assignment) => assignment.assignmentId === oldReviewId),
    ).toMatchObject({
      semanticState: "canceled",
      terminationReason: null,
      planChangeReason: "quality_gate_no_longer_required",
      supersededBy: null,
    });
    const currentDelivery = replanned.assignments.find(
      (assignment) => assignment.planRevision === 2 && assignment.kind === "delivery",
    );
    expect(currentDelivery).toMatchObject({ workstreamId: "docs", semanticState: "planned" });
    expect(
      replanned.assignments.find(
        (assignment) => assignment.planRevision === 2 && assignment.kind === "verification",
      ),
    ).toMatchObject({
      subjectAssignmentIds: [currentDelivery?.assignmentId],
      dependencyAssignmentIds: [currentDelivery?.assignmentId],
    });
  });

  test("reuses an approved historical review while superseding a failed review", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const { blocked } = await createFailedDaemonOwnedVerification(fixture, running);
    const withReviews = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: blocked.mission.revision,
      update: (mission) => {
        const delivery = mission.assignments.find((assignment) => assignment.kind === "delivery");
        const workstream = mission.workstreams.find(
          (candidate) => candidate.workstreamId === delivery?.workstreamId,
        );
        const reviewerMemberId = workstream?.reviewerMemberId;
        const reviewerParticipant = mission.participants.find(
          (participant) =>
            participant.memberId === reviewerMemberId && participant.archivedAt === null,
        );
        if (
          !delivery?.workspaceBaseline ||
          !workstream ||
          !reviewerMemberId ||
          !reviewerParticipant
        ) {
          throw new Error("Review fixture is incomplete");
        }
        const approvedReviewId = "assignment-api-review-approved";
        const approvedReview = {
          ...delivery,
          assignmentId: approvedReviewId,
          kind: "review" as const,
          subjectAssignmentIds: [delivery.assignmentId],
          assigneeMemberId: reviewerMemberId,
          runtimeAgentId: reviewerParticipant.agentId,
          objective: workstream.objective,
          inputRefs: [`assignment-report:${delivery.assignmentId}`],
          deliverables: workstream.deliverables,
          acceptanceCriteria: workstream.acceptanceCriteria,
          mutableScope: { kind: "read_only" as const },
          dependencyAssignmentIds: [delivery.assignmentId],
          workspaceBaseline: {
            ...delivery.workspaceBaseline,
            baselineId: "baseline-api-review-approved",
            assignmentId: approvedReviewId,
          },
          report: {
            status: "completed" as const,
            verdict: "approved" as const,
            summary: "The parser contract is approved",
            artifactPaths: [],
            tests: [{ command: "npm test parser", passed: true }],
            decisions: [],
            handoffs: [],
          },
          semanticState: "completed" as const,
          acceptedTurnId: "turn-api-review-approved",
        };
        const failedReviewId = "assignment-api-review-failed";
        const failedReview = {
          ...approvedReview,
          assignmentId: failedReviewId,
          workspaceBaseline: {
            ...approvedReview.workspaceBaseline,
            baselineId: "baseline-api-review-failed",
            assignmentId: failedReviewId,
          },
          report: {
            ...approvedReview.report,
            verdict: "changes_requested" as const,
            summary: "The alternate parser contract needs another pass",
          },
          semanticState: "failed" as const,
          acceptedTurnId: "turn-api-review-failed",
        };
        return {
          ...mission,
          assignments: [...mission.assignments, approvedReview, failedReview],
        };
      },
    });

    const approvedReviewId = "assignment-api-review-approved";
    const failedReviewId = "assignment-api-review-failed";
    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: withReviews.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
    });

    expect(
      replanned.assignments.find((assignment) => assignment.assignmentId === failedReviewId),
    ).toMatchObject({
      semanticState: "canceled",
      terminationReason: "superseded",
      supersededBy: approvedReviewId,
    });
    expect(replanned.assignments.filter((assignment) => assignment.planRevision === 2)).toEqual([
      expect.objectContaining({
        kind: "verification",
        subjectAssignmentIds: [approvedReviewId, running.assignmentId].toSorted(),
        dependencyAssignmentIds: [approvedReviewId, running.assignmentId].toSorted(),
      }),
    ]);
  });

  test("cleans pending quality-gate recovery but fences an accepted recovery during replan", async () => {
    const pendingFixture = createFixture(join(rootDirectory, "pending-quality-gate-recovery"));
    const pendingRunning = await createRunningDelivery(pendingFixture);
    const pendingFailure = await createFailedDaemonOwnedVerification(
      pendingFixture,
      pendingRunning,
    );
    const pendingStored = await pendingFixture.missions.get(pendingRunning.mission.id);
    if (!pendingStored) throw new Error("Pending recovery Mission disappeared");
    await pendingFixture.missions.updateRecoveryState({
      missionId: pendingRunning.mission.id,
      expectedStorageRevision: pendingStored.storageRevision,
      update: (recovery) => ({
        ...recovery,
        assignmentReportRecoveryOutbox: [
          reportRecoveryDelivery(pendingRunning.mission.id, pendingFailure.failedVerificationId),
        ],
      }),
    });

    await pendingFixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: pendingRunning.mission.id,
      expectedRevision: pendingFailure.blocked.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
    });
    expect(
      (await pendingFixture.missions.get(pendingRunning.mission.id))
        ?.assignmentReportRecoveryOutbox,
    ).toEqual([]);

    const dispatchedFixture = createFixture(
      join(rootDirectory, "dispatched-quality-gate-recovery"),
    );
    const dispatchedRunning = await createRunningDelivery(dispatchedFixture);
    const dispatchedFailure = await createFailedDaemonOwnedVerification(
      dispatchedFixture,
      dispatchedRunning,
    );
    const dispatchedStored = await dispatchedFixture.missions.get(dispatchedRunning.mission.id);
    if (!dispatchedStored) throw new Error("Dispatched recovery Mission disappeared");
    const withDispatchedRecovery = await dispatchedFixture.missions.updateRecoveryState({
      missionId: dispatchedRunning.mission.id,
      expectedStorageRevision: dispatchedStored.storageRevision,
      update: (recovery) => ({
        ...recovery,
        assignmentReportRecoveryOutbox: [
          {
            ...reportRecoveryDelivery(
              dispatchedRunning.mission.id,
              dispatchedFailure.failedVerificationId,
            ),
            state: "dispatched" as const,
            turnId: "turn-report-recovery-accepted",
            nextEligibleAt: null,
            dispatchedAt: NOW,
          },
        ],
      }),
    });

    await expect(
      dispatchedFixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: dispatchedRunning.mission.id,
        expectedRevision: dispatchedFailure.blocked.mission.revision,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
      }),
    ).rejects.toMatchObject({ code: "mission_replan_has_unsettled_assignments" });
    expect(await dispatchedFixture.missions.get(dispatchedRunning.mission.id)).toEqual(
      withDispatchedRecovery,
    );
  });

  test("rejects user-authored review and verification Assignment Contracts", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: mission.revision,
        expectedPlanRevision: 0,
        workstreams: missionPlan(),
        assignments: [
          {
            ...deliveryDraft(),
            clientKey: "manual-review",
            kind: "review",
            workstreamId: "api",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "quality_gate_assignment_daemon_owned" });

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: { planRevision: 0, assignments: [] },
    });
  });

  test("rejects a replan that leaves a delivery Workstream without an Assignment Contract", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const blocked = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "blocked" as const,
                scopeLease: null,
                report: {
                  status: "blocked" as const,
                  summary: "The parser contract needs clarification",
                  blockers: ["Whitespace semantics conflict with the acceptance test"],
                  artifactPaths: [],
                  tests: [],
                  decisions: [],
                  handoffs: [],
                },
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    const api = missionPlan()[0]!;
    const implementation = {
      ...api,
      workstreamId: "implementation",
      title: "Parser implementation",
      objective: "Implement the clarified parser contract",
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server/src"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "implementation"],
    };

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: blocked.mission.revision,
        expectedPlanRevision: 1,
        workstreams: [api, implementation, verification],
        replacementAssignments: [
          {
            ...deliveryDraft(),
            clientKey: "contract-recovery",
            supersedesAssignmentId: running.assignmentId,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "mission_plan_missing_assignment_contracts" });

    expect((await fixture.missions.get(running.mission.id))?.mission).toMatchObject({
      planRevision: 1,
      assignments: [
        expect.objectContaining({
          assignmentId: running.assignmentId,
          semanticState: "blocked",
          supersededBy: null,
        }),
      ],
    });
  });

  test("atomically replans with replacement and additional Assignment Contracts", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const blocked = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "blocked" as const,
                scopeLease: null,
                report: {
                  status: "blocked" as const,
                  summary: "The parser contract needs clarification",
                  blockers: ["Whitespace semantics conflict with the acceptance test"],
                  artifactPaths: [],
                  tests: [],
                  decisions: [],
                  handoffs: [],
                },
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    const api = missionPlan()[0]!;
    const implementation = {
      ...api,
      workstreamId: "implementation",
      title: "Parser implementation",
      objective: "Implement the clarified parser contract",
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server/src"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "implementation"],
    };

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: blocked.mission.revision,
      expectedPlanRevision: 1,
      workstreams: [api, implementation, verification],
      replacementAssignments: [
        {
          ...deliveryDraft(),
          clientKey: "contract-recovery",
          supersedesAssignmentId: running.assignmentId,
        },
      ],
      assignments: [
        {
          clientKey: "implementation-retry",
          kind: "delivery",
          workstreamId: "implementation",
          subjectKeys: [],
          dependencyKeys: ["contract-recovery"],
          objective: "Implement the clarified parser contract",
          inputRefs: [],
          deliverables: ["Parser implementation"],
          acceptanceCriteria: ["Parser tests pass"],
          mutableScope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
          priority: 9,
        },
      ],
    });

    const replacement = replanned.assignments.find(
      (assignment) => assignment.planRevision === 2 && assignment.workstreamId === "api",
    );
    const additional = replanned.assignments.find(
      (assignment) => assignment.planRevision === 2 && assignment.workstreamId === "implementation",
    );
    expect(replanned.planRevision).toBe(2);
    expect(replacement).toMatchObject({ semanticState: "planned" });
    expect(additional).toMatchObject({
      semanticState: "planned",
      dependencyAssignmentIds: [replacement?.assignmentId],
    });
  });

  test("cancels every Lead notification binding successor when its blocker is replanned", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const attentionId = `${running.mission.id}:${running.assignmentId}:requires-replan`;
    const roster = running.mission.rosterSnapshots.find(
      (snapshot) => snapshot.revision === running.mission.activeRosterSnapshotRevision,
    );
    const lead = roster?.members.find((member) => member.memberId === roster.leadMemberId);
    const assignment = running.mission.assignments.find(
      (candidate) => candidate.assignmentId === running.assignmentId,
    );
    if (!lead || !assignment) throw new Error("Running Mission has no Lead or Assignment");

    const blocked = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        status: "needs_attention" as const,
        suspendedStatus: "active" as const,
        attentionItems: [
          {
            attentionId,
            kind: "assignment_requires_replan" as const,
            status: "open" as const,
            priorMissionStatus: "active" as const,
            assignmentId: running.assignmentId,
            summary: "The accepted Assignment requires replanning",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
        assignments: mission.assignments.map((candidate) =>
          candidate.assignmentId === running.assignmentId
            ? {
                ...candidate,
                dispatchState: "settled" as const,
                semanticState: "blocked" as const,
                scopeLease: null,
                report: {
                  status: "blocked" as const,
                  summary: "The parser contract needs clarification",
                  blockers: ["The upstream contract is unavailable"],
                  artifactPaths: [],
                  tests: [],
                  decisions: [],
                  handoffs: [],
                },
                settledAt: NOW,
              }
            : candidate,
        ),
      }),
    });
    const baseDeliveryId = `${attentionId}:lead`;
    const successorDeliveryId = `${baseDeliveryId}:binding:2`;
    await fixture.missions.updateRecoveryState({
      missionId: running.mission.id,
      expectedStorageRevision: blocked.storageRevision,
      update: (recovery) => ({
        ...recovery,
        recipientAttentionOutbox: [
          {
            deliveryId: baseDeliveryId,
            idempotencyKey: attentionId,
            requestFingerprint: "blocked-assignment",
            roomMessageId: `${attentionId}:message`,
            senderMemberId: assignment.assigneeMemberId,
            senderAgentId: assignment.runtimeAgentId ?? "agent-member",
            recipientMemberId: lead.memberId,
            bindingEpoch: 1,
            mentionHandle: lead.mentionHandle,
            body: `@${lead.mentionHandle} Replan the blocked Assignment.`,
            roomPostedAt: NOW,
            roomCursor: 1,
            attempts: 1,
            createdAt: NOW,
            successorDeliveryId,
            state: "canceled" as const,
            lastAttemptAt: NOW,
            nextEligibleAt: null,
            acknowledgedAt: null,
            canceledAt: NOW,
            cancelReason: "binding_replaced" as const,
          },
          {
            deliveryId: successorDeliveryId,
            idempotencyKey: `${attentionId}:binding:2`,
            requestFingerprint: "blocked-assignment",
            roomMessageId: `${attentionId}:message`,
            senderMemberId: assignment.assigneeMemberId,
            senderAgentId: assignment.runtimeAgentId ?? "agent-member",
            recipientMemberId: lead.memberId,
            bindingEpoch: 2,
            mentionHandle: lead.mentionHandle,
            body: `@${lead.mentionHandle} Replan the blocked Assignment.`,
            roomPostedAt: NOW,
            roomCursor: 1,
            attempts: 0,
            createdAt: NOW,
            successorDeliveryId: null,
            state: "pending" as const,
            lastAttemptAt: null,
            nextEligibleAt: NOW,
            acknowledgedAt: null,
            canceledAt: null,
            cancelReason: null,
          },
        ],
      }),
    });

    await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: blocked.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
      replacementAssignments: [
        {
          ...deliveryDraft(),
          clientKey: "api-recovery",
          supersedesAssignmentId: running.assignmentId,
        },
      ],
    });

    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        { deliveryId: baseDeliveryId, state: "canceled" },
        {
          deliveryId: successorDeliveryId,
          state: "canceled",
          cancelReason: "attention_resolved",
        },
      ],
    });
  });

  test("validates a new batch after reusing completed work from an earlier plan", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const completed = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "completed" as const,
                scopeLease: null,
                report: completedDeliveryReport(),
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    const api = missionPlan()[0]!;
    const ui = {
      ...api,
      workstreamId: "ui",
      title: "Parser UI",
      objective: "Render parser results",
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/app"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    };
    const verification = {
      ...missionPlan()[1]!,
      dependencyWorkstreamIds: ["api", "ui"],
    };
    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: completed.mission.revision,
      expectedPlanRevision: 1,
      workstreams: [api, ui, verification],
      assignments: [
        {
          ...deliveryDraft(),
          clientKey: "ui-follow-up",
          workstreamId: "ui",
          objective: "Render parser results",
          mutableScope: { kind: "paths", pathPrefixes: ["packages/app"] },
        },
      ],
    });

    expect(replanned).toMatchObject({
      status: "active",
      assignments: [
        { assignmentId: running.assignmentId, planRevision: 1, workstreamId: "api" },
        {
          planRevision: 2,
          workstreamId: "ui",
          dependencyAssignmentIds: [running.assignmentId],
        },
      ],
    });
  });

  test("rejects historical completed work when the runtime turn fact is missing", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const completed = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "completed" as const,
                scopeLease: null,
                report: completedDeliveryReport(),
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    fixture.turnFactState.omittedTurnIds.add("turn-1");

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: completed.mission.revision,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
      }),
    ).rejects.toMatchObject({ code: "mission_plan_missing_assignment_contracts" });
  });

  test("retains a completed Assignment after more than 100 unrelated terminal turns", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    fixture.scheduledMissionIds.length = 0;
    const completed = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "completed" as const,
                scopeLease: null,
                report: completedDeliveryReport(),
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    const missionList = vi.spyOn(fixture.missions, "list");
    await fixture.turnFactState.terminalFactListener?.({
      missionId: running.mission.id,
      turnId: "turn-1",
      runtimeAgentId: "agent-member",
      outcome: "completed",
    });
    for (let index = 0; index < 101; index += 1) {
      await fixture.turnFactState.terminalFactListener?.({
        missionId: running.mission.id,
        turnId: `unrelated-turn-${index}`,
        runtimeAgentId: "agent-member",
        outcome: "completed",
      });
    }
    fixture.turnFactState.omittedTurnIds.add("turn-1");

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: completed.mission.revision,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
      }),
    ).resolves.toMatchObject({ planRevision: 2 });
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      acceptedTurnFacts: [
        {
          assignmentId: running.assignmentId,
          turnId: "turn-1",
          runtimeAgentId: "agent-member",
          outcome: "completed",
        },
      ],
    });
    expect(missionList).not.toHaveBeenCalled();
    expect(fixture.scheduledMissionIds).toEqual([running.mission.id, running.mission.id]);
  });

  test("backfills a missed terminal event during startup message reconciliation", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const completed = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "completed" as const,
                scopeLease: null,
                report: completedDeliveryReport(),
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });

    await expect(fixture.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [],
    });
    fixture.turnFactState.omittedTurnIds.add("turn-1");

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: completed.mission.revision,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
      }),
    ).resolves.toMatchObject({ planRevision: 2 });
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      acceptedTurnFacts: [{ assignmentId: running.assignmentId, turnId: "turn-1" }],
    });
  });

  test("atomically hands off a needs-report hold during replan", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const needsReport = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "needs_report" as const,
                scopeLease: assignment.scopeLease
                  ? {
                      ...assignment.scopeLease,
                      state: "report_hold" as const,
                      transitionedAt: NOW,
                      capturedDelta: [
                        { path: "packages/server/src/parser.ts", fingerprint: "delta-1" },
                      ],
                    }
                  : null,
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    const stored = await fixture.missions.get(running.mission.id);
    if (!stored) throw new Error("Mission disappeared");
    await fixture.missions.updateRecoveryState({
      missionId: running.mission.id,
      expectedStorageRevision: stored.storageRevision,
      update: (state) => ({
        ...state,
        ownershipIntervals: [
          {
            intervalId: "interval-report-hold",
            workspaceId: running.mission.workspaceId,
            assignmentId: running.assignmentId,
            scope: { kind: "paths", pathPrefixes: ["packages/server"] },
            startedAt: NOW,
            state: "open",
            endedAt: null,
            closure: null,
          },
        ],
      }),
    });

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: needsReport.mission.revision,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
        replacementAssignments: [
          {
            ...deliveryDraft(),
            clientKey: "api-report-recovery-wrong-scope",
            mutableScope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
            supersedesAssignmentId: running.assignmentId,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "report_hold_scope_mismatch" });
    expect((await fixture.missions.get(running.mission.id))?.mission.revision).toBe(
      needsReport.mission.revision,
    );

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: needsReport.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
      replacementAssignments: [
        {
          ...deliveryDraft(),
          clientKey: "api-report-recovery",
          supersedesAssignmentId: running.assignmentId,
        },
      ],
    });
    const persisted = await fixture.missions.get(running.mission.id);
    const memberStatus = await fixture.collaboration.missionStatus({
      callerAgentId: "agent-member",
      missionId: running.mission.id,
    });

    expect(replanned.assignments[0]).toMatchObject({
      assignmentId: running.assignmentId,
      semanticState: "canceled",
      scopeLease: null,
      terminationReason: "superseded",
    });
    expect(persisted?.ownershipIntervals).toEqual([
      expect.objectContaining({
        assignmentId: running.assignmentId,
        state: "closed",
        closure: "handoff",
        endedAt: NOW,
      }),
    ]);
    expect(persisted?.assignmentDeltaHandoffs).toEqual([
      {
        sourceAssignmentId: running.assignmentId,
        replacementAssignmentId: replanned.assignments[1]?.assignmentId,
        reportHoldLeaseId: "lease-1",
        capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "delta-1" }],
        createdAt: NOW,
      },
    ]);
    expect(replanned.assignments[1]?.inputRefs).toContain(
      `mission-handoff:${running.assignmentId}`,
    );
    expect(memberStatus.handoffs).toEqual([
      {
        sourceAssignmentId: running.assignmentId,
        replacementAssignmentId: replanned.assignments[1]?.assignmentId,
        capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "delta-1" }],
        createdAt: NOW,
      },
    ]);
  });

  test("hands off a report hold even when its captured delta is empty", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const needsReport = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "needs_report" as const,
                scopeLease: assignment.scopeLease
                  ? {
                      ...assignment.scopeLease,
                      state: "report_hold" as const,
                      transitionedAt: NOW,
                      capturedDelta: [],
                    }
                  : null,
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: needsReport.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
      replacementAssignments: [
        {
          ...deliveryDraft(),
          clientKey: "api-empty-delta-recovery",
          supersedesAssignmentId: running.assignmentId,
        },
      ],
    });

    expect((await fixture.missions.get(running.mission.id))?.assignmentDeltaHandoffs).toEqual([
      {
        sourceAssignmentId: running.assignmentId,
        replacementAssignmentId: replanned.assignments[1]?.assignmentId,
        reportHoldLeaseId: "lease-1",
        capturedDelta: [],
        createdAt: NOW,
      },
    ]);
    expect(replanned.assignments[1]?.inputRefs).toContain(
      `mission-handoff:${running.assignmentId}`,
    );
  });

  test("hands off terminal delta evidence after an unknown accepted turn clears its live lease", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const capturedDelta = [
      { path: "packages/server/src/parser.ts", fingerprint: "terminal-delta-1" },
    ];
    fixture.turnFactState.omittedTurnIds.add("turn-1");
    await fixture.missions.recordAcceptedTurnFacts({
      missionId: running.mission.id,
      facts: [
        {
          assignmentId: running.assignmentId,
          turnId: "turn-1",
          runtimeAgentId: "agent-member",
          outcome: "unknown",
          recordedAt: NOW,
        },
      ],
    });
    const settled = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                revision: assignment.revision + 1,
                dispatchState: "settled" as const,
                semanticState: "failed" as const,
                terminationReason: "turn_unknown" as const,
                scopeLease: null,
                settledAt: NOW,
                terminalEvidence: {
                  assignmentId: running.assignmentId,
                  acceptedTurn: {
                    turnId: "turn-1",
                    runtimeAgentId: "agent-member",
                    outcome: "unknown" as const,
                    recordedAt: NOW,
                  },
                  capturedDelta,
                  ownershipViolations: [],
                  report: null,
                  handoffs: [],
                  capturedAt: NOW,
                },
              }
            : assignment,
        ),
      }),
    });

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: settled.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
      replacementAssignments: [
        {
          ...deliveryDraft(),
          clientKey: "api-terminal-evidence-recovery",
          supersedesAssignmentId: running.assignmentId,
        },
      ],
    });
    const replacement = replanned.assignments[1];
    const persisted = await fixture.missions.get(running.mission.id);

    expect(
      replacement?.inputRefs.filter(
        (inputRef) => inputRef === `mission-handoff:${running.assignmentId}`,
      ),
    ).toEqual([`mission-handoff:${running.assignmentId}`]);
    expect(persisted?.assignmentDeltaHandoffs).toEqual([
      {
        sourceAssignmentId: running.assignmentId,
        replacementAssignmentId: replacement?.assignmentId,
        reportHoldLeaseId: null,
        capturedDelta,
        createdAt: NOW,
      },
    ]);
  });

  test("persists one directed room message and notifies the recipient", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });

    const first = await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-api-owner",
      recipient: "@software-engineer",
      body: "Please implement the parser API.",
    });
    const replay = await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-api-owner",
      recipient: targetMemberId,
      body: "Please implement the parser API.",
    });

    expect(replay).toEqual(first);
    expect(fixture.messagePosts).toEqual([
      {
        messageId: "message-1",
        roomId: mission.chatRoomId,
        senderAgentId: "agent-1",
        body: "@software-engineer Please implement the parser API.",
      },
    ]);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        {
          deliveryId: "delivery-1",
          idempotencyKey: "message-api-owner",
          roomMessageId: "message-1",
          senderMemberId: team.leadMemberId,
          recipientMemberId: targetMemberId,
          bindingEpoch: 1,
          roomPostedAt: NOW,
          attempts: 1,
          state: "notified",
        },
      ],
    });
    expect(fixture.attentionAttempts).toEqual([
      {
        deliveryId: "delivery-1",
        missionId: mission.id,
        recipientAgentId: "agent-member",
        bindingEpoch: 1,
        attempt: 1,
      },
    ]);
  });

  test("waits for a busy recipient to settle without replacing its turn", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    fixture.attentionState.outcomes.push("busy", "notified");

    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-busy-recipient",
      recipient: targetMemberId,
      body: "Read this after your current turn.",
    });
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [{ state: "pending", attempts: 0 }],
    });

    const missionList = vi.spyOn(fixture.missions, "list");
    await fixture.attentionState.eligibilityListener?.("agent-member");

    expect(missionList).not.toHaveBeenCalled();
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [{ state: "notified", attempts: 1 }],
    });
    expect(fixture.attentionAttempts).toHaveLength(2);
  });

  test("targets scheduler-created Lead notifications without retrying prepass busy delivery", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const stored = await fixture.missions.get(running.mission.id);
    const assignment = stored?.mission.assignments.find(
      (candidate) => candidate.assignmentId === running.assignmentId,
    );
    if (!stored || !assignment) throw new Error("Running Assignment missing");
    const deliveries = buildLeadReplanDeliveries({
      mission: stored.mission,
      existing: stored.recipientAttentionOutbox,
      transitions: [{ assignment, fact: { outcome: "failed" } }],
      now: NOW,
    });
    expect(deliveries).toHaveLength(1);
    const existingDelivery = deliveries[0];
    if (!existingDelivery) throw new Error("Lead delivery missing");
    await fixture.missions.updateAggregate({
      missionId: stored.mission.id,
      expectedRevision: stored.mission.revision,
      update: (current) => ({
        ...current,
        recovery: {
          ...current.recovery,
          recipientAttentionOutbox: [
            ...current.recovery.recipientAttentionOutbox,
            existingDelivery,
          ],
        },
      }),
    });

    fixture.attentionState.outcomes.push("busy");
    await expect(fixture.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [],
    });
    expect(fixture.attentionAttempts.map((attempt) => attempt.deliveryId)).toEqual([
      existingDelivery.deliveryId,
    ]);

    const afterPrepass = await fixture.missions.get(running.mission.id);
    if (!afterPrepass) throw new Error("Mission missing after prepass");
    const schedulerDelivery = {
      ...existingDelivery,
      deliveryId: `${existingDelivery.deliveryId}:scheduler`,
      idempotencyKey: `${existingDelivery.idempotencyKey}:scheduler`,
      requestFingerprint: `${existingDelivery.requestFingerprint}:scheduler`,
      roomMessageId: `${existingDelivery.roomMessageId}:scheduler`,
    };
    await fixture.missions.updateRecoveryState({
      missionId: afterPrepass.mission.id,
      expectedStorageRevision: afterPrepass.storageRevision,
      update: (recovery) => ({
        ...recovery,
        recipientAttentionOutbox: [...recovery.recipientAttentionOutbox, schedulerDelivery],
      }),
    });

    fixture.attentionState.outcomes.push("busy");
    await expect(
      fixture.collaboration.reconcilePendingMessageDeliveries({
        missionId: running.mission.id,
        deliveryIds: [schedulerDelivery.deliveryId],
      }),
    ).resolves.toEqual({ failures: [] });
    expect(fixture.attentionAttempts.map((attempt) => attempt.deliveryId)).toEqual([
      existingDelivery.deliveryId,
      schedulerDelivery.deliveryId,
    ]);
    expect(fixture.messagePosts).toHaveLength(2);

    const missionList = vi.spyOn(fixture.missions, "list");
    fixture.attentionState.outcomes.push("notified", "notified");
    await fixture.attentionState.eligibilityListener?.("agent-1");

    expect(missionList).not.toHaveBeenCalled();
    expect(fixture.attentionAttempts).toHaveLength(4);
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        {
          deliveryId: `${running.mission.id}:plan:1:assignment-coverage:lead`,
          state: "canceled",
          cancelReason: "attention_resolved",
        },
        { deliveryId: existingDelivery.deliveryId, state: "notified", attempts: 1 },
        { deliveryId: schedulerDelivery.deliveryId, state: "notified", attempts: 1 },
      ],
    });
  });

  test("raises durable participant attention when the recipient is unavailable", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    fixture.attentionState.outcomes.push("unavailable");

    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-unavailable-recipient",
      recipient: targetMemberId,
      body: "Escalate this unavailable recipient.",
    });

    const pending = await fixture.missions.get(mission.id);
    expect(pending).toMatchObject({
      mission: {
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            kind: "participant_unavailable",
            status: "open",
            priorMissionStatus: "planning",
          },
        ],
      },
      recipientAttentionOutbox: [{ state: "pending", attempts: 0 }],
    });

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: mission.id,
      expectedRevision: pending?.mission.revision ?? -1,
      expectedPlanRevision: 0,
      workstreams: missionPlan(),
    });

    expect(replanned).toMatchObject({
      status: "planning",
      suspendedStatus: null,
      planRevision: 1,
      attentionItems: [
        {
          kind: "participant_unavailable",
          status: "resolved",
          resolution: { kind: "replan", actorId: "agent-1" },
        },
      ],
    });
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        {
          deliveryId: "delivery-1",
          state: "canceled",
          cancelReason: "attention_resolved",
        },
        {
          deliveryId: `${mission.id}:plan:1:assignment-coverage:lead`,
          state: "pending",
          attempts: 0,
        },
      ],
    });

    fixture.attentionState.outcomes.push("unavailable");
    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-unavailable-recipient-again",
      recipient: targetMemberId,
      body: "Escalate the next unavailable delivery independently.",
    });
    const secondPending = await fixture.missions.get(mission.id);
    expect(secondPending?.mission.attentionItems).toMatchObject([
      { attentionId: "participant:delivery-1", status: "resolved" },
      { attentionId: "participant:delivery-2", status: "open" },
    ]);

    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: secondPending?.mission.revision ?? -1,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
        assignments: [deliveryDraft()],
      }),
    ).resolves.toMatchObject({
      planRevision: 2,
      attentionItems: [
        { attentionId: "participant:delivery-1", status: "resolved" },
        { attentionId: "participant:delivery-2", status: "resolved" },
      ],
    });
  });

  test("does not retry an unacknowledged notification before its durable backoff expires", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });

    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-notification-backoff",
      recipient: targetMemberId,
      body: "Do not retry this immediately.",
    });
    await fixture.collaboration.reconcilePendingMessages();

    expect(fixture.attentionAttempts).toHaveLength(1);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [{ state: "notified", attempts: 1 }],
    });
  });

  test("raises durable attention after three unacknowledged notifications", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });

    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-unacknowledged",
      recipient: targetMemberId,
      body: "Please acknowledge this message.",
    });
    fixture.clockState.current = "2026-08-08T10:01:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();
    fixture.clockState.current = "2026-08-08T10:02:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: {
        status: "needs_attention",
        suspendedStatus: "planning",
        attentionItems: [
          {
            kind: "notification_unacknowledged",
            status: "open",
            priorMissionStatus: "planning",
          },
        ],
      },
      recipientAttentionOutbox: [{ state: "notified", attempts: 3 }],
    });
  });

  test("creates a new delivery generation for each notification recovery cycle", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });

    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-notification-generations",
      recipient: targetMemberId,
      body: "Recover this notification more than once.",
    });
    fixture.clockState.current = "2026-08-08T10:01:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();
    fixture.clockState.current = "2026-08-08T10:02:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();
    const firstPending = await fixture.missions.get(mission.id);
    const firstAttention = firstPending?.mission.attentionItems.find(
      (item) => item.status === "open",
    );
    if (!firstPending || !firstAttention) throw new Error("First notification attention missing");

    await fixture.lifecycle.resolveAttention({
      idempotencyKey: "restore-notification-generation-1",
      missionId: mission.id,
      attentionId: firstAttention.attentionId,
      expectedRevision: firstPending.mission.revision,
      actorId: "user-1",
      resolution: { kind: "restore_notification", reason: "Retry generation one." },
    });
    fixture.clockState.current = "2026-08-08T10:03:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();
    fixture.clockState.current = "2026-08-08T10:04:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();
    fixture.clockState.current = "2026-08-08T10:05:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();
    const secondPending = await fixture.missions.get(mission.id);
    const secondAttention = secondPending?.mission.attentionItems.find(
      (item) => item.status === "open",
    );
    if (!secondPending || !secondAttention)
      throw new Error("Second notification attention missing");

    expect(secondAttention.attentionId).toBe("notification:delivery-1:recovery");
    const resolved = await fixture.lifecycle.resolveAttention({
      idempotencyKey: "restore-notification-generation-2",
      missionId: mission.id,
      attentionId: secondAttention.attentionId,
      expectedRevision: secondPending.mission.revision,
      actorId: "user-1",
      resolution: { kind: "restore_notification", reason: "Retry generation two." },
    });

    expect(resolved.attentionItems).toMatchObject([
      { attentionId: "notification:delivery-1", status: "resolved" },
      { attentionId: "notification:delivery-1:recovery", status: "resolved" },
    ]);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        {
          deliveryId: "delivery-1",
          state: "canceled",
          successorDeliveryId: "delivery-1:recovery",
        },
        {
          deliveryId: "delivery-1:recovery",
          state: "canceled",
          successorDeliveryId: "delivery-1:recovery:recovery",
        },
        { deliveryId: "delivery-1:recovery:recovery", state: "pending", attempts: 0 },
      ],
    });
  });

  test("cancels an old binding and notifies one deterministic successor", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    const withParticipant = await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-binding-successor",
      recipient: targetMemberId,
      body: "Follow the active Member binding.",
    });
    await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: withParticipant.mission.revision,
      update: (current) => ({
        ...current,
        participants: [
          ...current.participants.map((participant) =>
            participant.memberId === targetMemberId && participant.archivedAt === null
              ? { ...participant, archivedAt: NOW }
              : participant,
          ),
          {
            memberId: targetMemberId,
            agentId: "agent-member-new",
            bindingEpoch: 2,
            joinedAt: NOW,
            archivedAt: null,
          },
        ],
      }),
    });

    await fixture.collaboration.reconcilePendingMessages();
    fixture.clockState.current = "2026-08-08T10:01:00.000Z";
    await fixture.collaboration.reconcilePendingMessages();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        {
          deliveryId: "delivery-1",
          state: "canceled",
          cancelReason: "binding_replaced",
          successorDeliveryId: "delivery-1:binding:2",
        },
        {
          deliveryId: "delivery-1:binding:2",
          bindingEpoch: 2,
          state: "notified",
          attempts: 2,
        },
      ],
    });
    expect(fixture.attentionAttempts.at(-1)).toMatchObject({
      deliveryId: "delivery-1:binding:2",
      recipientAgentId: "agent-member-new",
      bindingEpoch: 2,
    });
  });

  test("cancels pending recipient attention when the Member leaves", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    const withParticipant = await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    fixture.attentionState.outcomes.push("busy");
    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-recipient-left",
      recipient: targetMemberId,
      body: "This delivery must not outlive the binding.",
    });
    await fixture.missions.update({
      missionId: mission.id,
      expectedRevision: withParticipant.mission.revision,
      update: (current) => ({
        ...current,
        participants: current.participants.map((participant) =>
          participant.memberId === targetMemberId
            ? { ...participant, archivedAt: NOW }
            : participant,
        ),
      }),
    });

    await fixture.collaboration.reconcilePendingMessages();

    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [
        { deliveryId: "delivery-1", state: "canceled", cancelReason: "recipient_left" },
      ],
    });
  });

  test("rejects additional mentions and an unprovisioned recipient before writing", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);

    await expect(
      fixture.collaboration.sendTeamMessage({
        callerAgentId: "agent-1",
        missionId: mission.id,
        idempotencyKey: "message-unprovisioned",
        recipient: "@software-engineer",
        body: "Please start now.",
      }),
    ).rejects.toMatchObject({ code: "mission_member_not_provisioned" });
    await expect(
      fixture.collaboration.sendTeamMessage({
        callerAgentId: "agent-1",
        missionId: mission.id,
        idempotencyKey: "message-extra-mention",
        recipient: "@technical-lead",
        body: "Ask @software-engineer too.",
      }),
    ).rejects.toMatchObject({ code: "additional_mentions_not_allowed" });
    expect(fixture.messagePosts).toEqual([]);
    expect((await fixture.missions.get(mission.id))?.recipientAttentionOutbox).toEqual([]);
  });

  test("rejects Mission mutations after the Mission reaches a terminal state", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    const canceled = await fixture.lifecycle.cancelMission({
      idempotencyKey: "cancel-terminal-tools",
      missionId: mission.id,
      expectedRevision: mission.revision,
      reason: "Stop the Mission",
    });

    await expect(
      fixture.collaboration.sendTeamMessage({
        callerAgentId: "agent-1",
        missionId: mission.id,
        idempotencyKey: "message-after-cancel",
        recipient: "@technical-lead",
        body: "This must not be posted.",
      }),
    ).rejects.toMatchObject({ code: "mission_terminal" });
    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: mission.id,
        expectedRevision: canceled.revision,
        expectedPlanRevision: canceled.planRevision,
        workstreams: missionPlan(),
      }),
    ).rejects.toMatchObject({ code: "mission_terminal" });
    expect(fixture.messagePosts).toEqual([]);
  });

  test("fences collaboration side effects during the archive barrier and after restart", async () => {
    let releaseArchive: (() => void) | null = null;
    const archiveReleased = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    let observeArchive: (() => void) | null = null;
    const archiveObserved = new Promise<void>((resolve) => {
      observeArchive = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeArchiveParticipant: async () => {
        observeArchive?.();
        await archiveReleased;
      },
    });
    const running = await createRunningDelivery(fixture);
    await markAssignmentNeedsReport(fixture, running);
    fixture.attentionState.outcomes.push("recipient_busy");
    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      idempotencyKey: "message-before-finish-fence",
      recipient: "@software-engineer",
      body: "This delivery is already pending.",
    });
    expect(fixture.attentionAttempts).toHaveLength(1);

    const beforeCancel = await fixture.missions.get(running.mission.id);
    const canceling = fixture.lifecycle.cancelMission({
      idempotencyKey: "cancel-with-archive-barrier",
      missionId: running.mission.id,
      expectedRevision: beforeCancel?.mission.revision ?? -1,
      reason: "Stop all further collaboration",
    });
    await archiveObserved;
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      mission: { status: "needs_attention" },
      finishIntent: { stage: "dispatch_stopped" },
      recipientAttentionOutbox: [
        {
          deliveryId: `${running.mission.id}:plan:1:assignment-coverage:lead`,
          state: "canceled",
        },
        { state: "pending" },
      ],
    });

    const stopped = await fixture.missions.get(running.mission.id);
    await expect(
      fixture.collaboration.planMission({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: stopped?.mission.revision ?? -1,
        expectedPlanRevision: 1,
        workstreams: missionPlan(),
      }),
    ).rejects.toMatchObject({ code: "mission_dispatch_stopped" });
    await expect(
      fixture.collaboration.assignTasks({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        expectedRevision: stopped?.mission.revision ?? -1,
        expectedPlanRevision: 1,
        assignments: [deliveryDraft()],
      }),
    ).rejects.toMatchObject({ code: "mission_dispatch_stopped" });
    await expect(
      fixture.collaboration.sendTeamMessage({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        idempotencyKey: "message-after-finish-fence",
        recipient: "@software-engineer",
        body: "This must not be posted.",
      }),
    ).rejects.toMatchObject({ code: "mission_dispatch_stopped" });

    fixture.clockState.current = "2026-08-08T10:01:00.000Z";
    await expect(fixture.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [],
    });
    await fixture.attentionState.eligibilityListener?.("agent-member");
    fixture.scheduledMissionIds.length = 0;
    await fixture.turnFactState.terminalFactListener?.({
      missionId: running.mission.id,
      turnId: "turn-1",
      runtimeAgentId: "agent-member",
      outcome: "completed",
    });
    expect(fixture.messagePosts).toHaveLength(1);
    expect(fixture.attentionAttempts).toHaveLength(1);
    expect(fixture.scheduledMissionIds).toEqual([]);

    const beforeReport = await fixture.missions.get(running.mission.id);
    const reported = await fixture.collaboration.reportAssignment({
      callerAgentId: "agent-member",
      missionId: running.mission.id,
      assignmentId: running.assignmentId,
      expectedRevision: beforeReport?.mission.revision ?? -1,
      expectedAssignmentRevision: 1,
      report: completedDeliveryReport(),
    });
    expect(reported.assignment).toMatchObject({
      semanticState: "completed",
      report: { status: "completed" },
    });
    await expect(
      fixture.collaboration.reportAssignment({
        callerAgentId: "agent-member",
        missionId: running.mission.id,
        assignmentId: running.assignmentId,
        expectedRevision: reported.mission.revision,
        expectedAssignmentRevision: reported.assignment.revision,
        report: completedDeliveryReport(),
      }),
    ).resolves.toEqual(reported);
    expect(fixture.scheduledMissionIds).toEqual([]);

    const restarted = createFixture(rootDirectory);
    restarted.clockState.current = "2026-08-08T10:01:00.000Z";
    await expect(restarted.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [],
    });
    await restarted.attentionState.eligibilityListener?.("agent-member");
    expect(restarted.messagePosts).toEqual([]);
    expect(restarted.attentionAttempts).toEqual([]);

    releaseArchive?.();
    await expect(canceling).rejects.toThrow("finish evidence is pending");
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      mission: {
        assignments: [
          expect.objectContaining({
            assignmentId: running.assignmentId,
            semanticState: "completed",
            report: expect.objectContaining({ status: "completed" }),
          }),
        ],
      },
    });
  });

  test("accepts a running Assignment report while participant archive is blocked", async () => {
    let releaseArchive: (() => void) | null = null;
    const archiveReleased = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    let observeArchive: (() => void) | null = null;
    const archiveObserved = new Promise<void>((resolve) => {
      observeArchive = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeArchiveParticipant: async () => {
        observeArchive?.();
        await archiveReleased;
      },
    });
    const running = await createRunningDelivery(fixture);
    fixture.scheduledMissionIds.length = 0;
    const canceling = fixture.lifecycle.cancelMission({
      idempotencyKey: "cancel-running-report-barrier",
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      reason: "Stop after the accepted turn reports",
    });
    await archiveObserved;

    try {
      const beforeReport = await fixture.missions.get(running.mission.id);
      const reported = await fixture.collaboration.reportAssignment({
        callerAgentId: "agent-member",
        missionId: running.mission.id,
        assignmentId: running.assignmentId,
        expectedRevision: beforeReport?.mission.revision ?? -1,
        expectedAssignmentRevision: 1,
        report: completedDeliveryReport(),
      });
      expect(reported.assignment).toMatchObject({
        semanticState: "running",
        report: { status: "completed" },
      });
      expect(fixture.scheduledMissionIds).toEqual([]);
    } finally {
      releaseArchive?.();
      await canceling.catch(() => undefined);
    }
  });

  test("serializes a room post before a concurrent Mission cancellation", async () => {
    let releasePost: (() => void) | null = null;
    const postReleased = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let observePost: (() => void) | null = null;
    const postObserved = new Promise<void>((resolve) => {
      observePost = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeMessagePost: async () => {
        observePost?.();
        await postReleased;
      },
    });
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    const withParticipant = await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });

    const send = fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-before-cancel",
      recipient: targetMemberId,
      body: "This lands before cancellation.",
    });
    await postObserved;
    let cancelSettled = false;
    const cancel = fixture.lifecycle
      .cancelMission({
        idempotencyKey: "cancel-after-message",
        missionId: mission.id,
        expectedRevision: withParticipant.mission.revision,
        reason: "Stop after the accepted message",
      })
      .then((result) => {
        cancelSettled = true;
        return result;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelSettled).toBe(false);

    releasePost?.();
    await send;
    await expect(cancel).resolves.toMatchObject({ status: "canceled" });
    expect(fixture.messagePosts).toHaveLength(1);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      mission: { status: "canceled" },
      recipientAttentionOutbox: [{ state: "canceled", cancelReason: "mission_terminal" }],
    });
  });

  test("serializes a recovered room post before a concurrent Mission cancellation", async () => {
    let releasePost: (() => void) | null = null;
    const postReleased = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let observePost: (() => void) | null = null;
    const postObserved = new Promise<void>((resolve) => {
      observePost = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeMessagePost: async () => {
        observePost?.();
        await postReleased;
      },
    });
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    fixture.messageState.failNext = true;
    await expect(
      fixture.collaboration.sendTeamMessage({
        callerAgentId: "agent-1",
        missionId: mission.id,
        idempotencyKey: "message-before-recovery-cancel",
        recipient: targetMemberId,
        body: "Recover before cancellation.",
      }),
    ).rejects.toThrow("simulated room post crash");

    const recovery = fixture.collaboration.reconcilePendingMessages();
    await postObserved;
    const current = await fixture.missions.get(mission.id);
    let cancelSettled = false;
    const cancel = fixture.lifecycle
      .cancelMission({
        idempotencyKey: "cancel-after-recovery",
        missionId: mission.id,
        expectedRevision: current?.mission.revision ?? -1,
        reason: "Stop after recovered delivery",
      })
      .then((result) => {
        cancelSettled = true;
        return result;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelSettled).toBe(false);

    releasePost?.();
    await expect(recovery).resolves.toEqual({ failures: [] });
    await expect(cancel).resolves.toMatchObject({ status: "canceled" });
    expect(fixture.messagePosts).toHaveLength(1);
  });

  test("serializes an eligibility notification before a concurrent Mission cancellation", async () => {
    let gateAttention = false;
    let releaseAttention: (() => void) | null = null;
    const attentionReleased = new Promise<void>((resolve) => {
      releaseAttention = resolve;
    });
    let observeAttention: (() => void) | null = null;
    const attentionObserved = new Promise<void>((resolve) => {
      observeAttention = resolve;
    });
    const fixture = createFixture(rootDirectory, {
      beforeAttentionAttempt: async () => {
        if (!gateAttention) return;
        observeAttention?.();
        await attentionReleased;
      },
    });
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    await fixture.collaboration.sendTeamMessage({
      callerAgentId: "agent-1",
      missionId: mission.id,
      idempotencyKey: "message-before-eligibility-cancel",
      recipient: targetMemberId,
      body: "Notify before cancellation.",
    });
    fixture.clockState.current = "2026-08-08T10:01:00.000Z";
    gateAttention = true;

    const eligibility = fixture.attentionState.eligibilityListener?.("agent-member");
    await attentionObserved;
    const current = await fixture.missions.get(mission.id);
    let cancelSettled = false;
    const cancel = fixture.lifecycle
      .cancelMission({
        idempotencyKey: "cancel-after-eligibility",
        missionId: mission.id,
        expectedRevision: current?.mission.revision ?? -1,
        reason: "Stop after eligibility notification",
      })
      .then((result) => {
        cancelSettled = true;
        return result;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelSettled).toBe(false);

    releaseAttention?.();
    await eligibility;
    await expect(cancel).resolves.toMatchObject({ status: "canceled" });
    expect(fixture.attentionAttempts).toHaveLength(2);
  });

  test("replays a room post from the durable outbox after a crash", async () => {
    const fixture = createFixture(rootDirectory);
    const { team, mission } = await createMission(fixture.lifecycle);
    const targetMemberId = team.members[1]?.memberId ?? "missing";
    await addParticipant(fixture.missions, mission.id, mission.revision, {
      memberId: targetMemberId,
      agentId: "agent-member",
    });
    fixture.messageState.failNext = true;

    await expect(
      fixture.collaboration.sendTeamMessage({
        callerAgentId: "agent-1",
        missionId: mission.id,
        idempotencyKey: "message-crash-replay",
        recipient: targetMemberId,
        body: "Recover this message.",
      }),
    ).rejects.toThrow("simulated room post crash");
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [{ state: "pending", roomPostedAt: null }],
    });

    fixture.messageState.failNext = true;
    await expect(fixture.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [
        {
          missionId: mission.id,
          deliveryId: "delivery-1",
          error: "simulated room post crash",
        },
      ],
    });
    expect(fixture.messagePosts).toEqual([]);

    await expect(fixture.collaboration.reconcilePendingMessages()).resolves.toEqual({
      failures: [],
    });

    expect(fixture.messagePosts).toHaveLength(1);
    expect(await fixture.missions.get(mission.id)).toMatchObject({
      recipientAttentionOutbox: [{ state: "notified", attempts: 1, roomPostedAt: NOW }],
    });
  });

  test("records a structured report without completing an accepted turn that is still running", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);

    const reported = await fixture.collaboration.reportAssignment({
      callerAgentId: "agent-member",
      missionId: running.mission.id,
      assignmentId: running.assignmentId,
      expectedRevision: running.mission.revision,
      expectedAssignmentRevision: 1,
      report: completedDeliveryReport(),
    });

    expect(reported.assignment).toMatchObject({
      assignmentId: running.assignmentId,
      revision: 2,
      semanticState: "running",
      report: { status: "completed", summary: "Implemented the parser API" },
    });
    expect(reported.mission.status).toBe("active");
  });

  test("rebases a report when only the Mission revision changes before persistence", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const updateAggregate = fixture.missions.updateAggregate.bind(fixture.missions);
    let injectRevisionChange = true;
    const updateSpy = vi
      .spyOn(fixture.missions, "updateAggregate")
      .mockImplementation(async (input) => {
        if (injectRevisionChange) {
          injectRevisionChange = false;
          await fixture.missions.update({
            missionId: running.mission.id,
            expectedRevision: input.expectedRevision,
            update: (mission) => ({
              ...mission,
              constraints: [...mission.constraints, "Record an unrelated scheduler fact"],
            }),
          });
        }
        return updateAggregate(input);
      });

    const reported = await fixture.collaboration.reportAssignment({
      callerAgentId: "agent-member",
      missionId: running.mission.id,
      assignmentId: running.assignmentId,
      expectedRevision: running.mission.revision,
      expectedAssignmentRevision: 1,
      report: completedDeliveryReport(),
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(reported.assignment).toMatchObject({
      revision: 2,
      semanticState: "running",
      report: { status: "completed" },
    });
    expect(reported.mission.constraints).toContain("Record an unrelated scheduler fact");
  });

  test("rejects a rebased report when the Assignment revision changed", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const updateAggregate = fixture.missions.updateAggregate.bind(fixture.missions);
    let injectAssignmentChange = true;
    vi.spyOn(fixture.missions, "updateAggregate").mockImplementation(async (input) => {
      if (injectAssignmentChange) {
        injectAssignmentChange = false;
        await fixture.missions.update({
          missionId: running.mission.id,
          expectedRevision: input.expectedRevision,
          update: (mission) => {
            const changed = structuredClone(mission);
            let assignment: (typeof changed.assignments)[number] | undefined;
            for (const candidate of changed.assignments) {
              if (candidate.assignmentId === running.assignmentId) assignment = candidate;
            }
            if (!assignment) throw new Error("Assignment disappeared during the race");
            assignment.revision += 1;
            return changed;
          },
        });
      }
      return updateAggregate(input);
    });

    await expect(
      fixture.collaboration.reportAssignment({
        callerAgentId: "agent-member",
        missionId: running.mission.id,
        assignmentId: running.assignmentId,
        expectedRevision: running.mission.revision,
        expectedAssignmentRevision: 1,
        report: completedDeliveryReport(),
      }),
    ).rejects.toMatchObject({ code: "assignment_revision_conflict" });
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      mission: {
        assignments: [
          expect.objectContaining({
            assignmentId: running.assignmentId,
            revision: 2,
            report: null,
          }),
        ],
      },
    });
  });

  test("rejects a rebased report when the participant binding changed", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const assigneeMemberId = running.mission.assignments.find(
      (candidate) => candidate.assignmentId === running.assignmentId,
    )?.assigneeMemberId;
    if (!assigneeMemberId) throw new Error("Running Assignment has no assignee");
    const updateAggregate = fixture.missions.updateAggregate.bind(fixture.missions);
    let injectBindingChange = true;
    vi.spyOn(fixture.missions, "updateAggregate").mockImplementation(async (input) => {
      if (injectBindingChange) {
        injectBindingChange = false;
        await fixture.missions.update({
          missionId: running.mission.id,
          expectedRevision: input.expectedRevision,
          update: (mission) => {
            const changed = structuredClone(mission);
            for (const participant of changed.participants) {
              if (participant.agentId === "agent-member") participant.archivedAt = NOW;
            }
            changed.participants.push({
              memberId: assigneeMemberId,
              agentId: "agent-member-replacement",
              bindingEpoch: 2,
              joinedAt: NOW,
              archivedAt: null,
            });
            return changed;
          },
        });
      }
      return updateAggregate(input);
    });

    await expect(
      fixture.collaboration.reportAssignment({
        callerAgentId: "agent-member",
        missionId: running.mission.id,
        assignmentId: running.assignmentId,
        expectedRevision: running.mission.revision,
        expectedAssignmentRevision: 1,
        report: completedDeliveryReport(),
      }),
    ).rejects.toMatchObject({ code: "not_mission_participant" });
    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      mission: {
        assignments: [
          expect.objectContaining({
            assignmentId: running.assignmentId,
            revision: 1,
            report: null,
          }),
        ],
      },
    });
  });

  test("rejects a report from a participant that does not own the Assignment binding", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);

    await expect(
      fixture.collaboration.reportAssignment({
        callerAgentId: "agent-1",
        missionId: running.mission.id,
        assignmentId: running.assignmentId,
        expectedRevision: running.mission.revision,
        expectedAssignmentRevision: 1,
        report: completedDeliveryReport(),
      }),
    ).rejects.toMatchObject({ code: "assignment_assignee_required" });
  });

  test("accepts a late report and atomically releases its report hold", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    fixture.scheduledMissionIds.length = 0;
    const needsReport = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: running.mission.revision,
      update: (mission) => ({
        ...mission,
        status: "needs_attention" as const,
        suspendedStatus: "active" as const,
        attentionItems: [
          {
            attentionId: `${mission.id}:${running.assignmentId}:missing-report`,
            kind: "missing_report" as const,
            status: "open" as const,
            priorMissionStatus: "active" as const,
            assignmentId: running.assignmentId,
            summary: "The Assignment report is missing",
            pathEvidence: [{ path: "packages/server/src/parser.ts", fingerprint: "delta-1" }],
            createdAt: NOW,
            resolution: null,
          },
        ],
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === running.assignmentId
            ? {
                ...assignment,
                dispatchState: "settled" as const,
                semanticState: "needs_report" as const,
                scopeLease: assignment.scopeLease
                  ? {
                      ...assignment.scopeLease,
                      state: "report_hold" as const,
                      transitionedAt: NOW,
                      capturedDelta: [
                        { path: "packages/server/src/parser.ts", fingerprint: "delta-1" },
                      ],
                    }
                  : null,
                settledAt: NOW,
              }
            : assignment,
        ),
      }),
    });
    const recovery = await fixture.missions.get(running.mission.id);
    if (!recovery) throw new Error("Mission disappeared");
    await fixture.missions.updateRecoveryState({
      missionId: running.mission.id,
      expectedStorageRevision: recovery.storageRevision,
      update: (state) => ({
        ...state,
        ownershipIntervals: [
          {
            intervalId: "interval-1",
            workspaceId: running.mission.workspaceId,
            assignmentId: running.assignmentId,
            scope: { kind: "paths", pathPrefixes: ["packages/server"] },
            startedAt: NOW,
            state: "open",
            endedAt: null,
            closure: null,
          },
        ],
      }),
    });

    const reported = await fixture.collaboration.reportAssignment({
      callerAgentId: "agent-member",
      missionId: running.mission.id,
      assignmentId: running.assignmentId,
      expectedRevision: needsReport.mission.revision,
      expectedAssignmentRevision: 1,
      report: completedDeliveryReport(),
    });
    const persisted = await fixture.missions.get(running.mission.id);

    expect(reported.assignment).toMatchObject({
      revision: 2,
      semanticState: "completed",
      scopeLease: null,
      report: { status: "completed" },
    });
    expect(persisted?.ownershipIntervals).toEqual([
      expect.objectContaining({
        assignmentId: running.assignmentId,
        state: "closed",
        endedAt: NOW,
        closure: "report",
      }),
    ]);
    expect(reported.mission).toMatchObject({
      status: "active",
      suspendedStatus: null,
      attentionItems: [
        {
          attentionId: `${running.mission.id}:${running.assignmentId}:missing-report`,
          status: "resolved",
          resolution: {
            kind: "report_received",
            actorId: "agent-member",
            reason: "Assignment report received",
            resolvedAt: NOW,
          },
        },
      ],
    });
    expect(fixture.scheduledMissionIds).toEqual([running.mission.id]);
  });

  test("returns a late blocked report to Lead replanning after the turn already settled", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const needsReport = await markAssignmentNeedsReport(fixture, running);

    await fixture.collaboration.reportAssignment({
      callerAgentId: "agent-member",
      missionId: running.mission.id,
      assignmentId: running.assignmentId,
      expectedRevision: needsReport.mission.revision,
      expectedAssignmentRevision: 1,
      report: {
        status: "blocked",
        summary: "The parser contract needs clarification",
        blockers: ["The upstream contract is unavailable"],
        artifactPaths: [],
        tests: [],
        decisions: [],
        handoffs: [],
      },
    });

    expect(await fixture.missions.get(running.mission.id)).toMatchObject({
      mission: {
        status: "needs_attention",
        suspendedStatus: "active",
        assignments: [
          expect.objectContaining({
            assignmentId: running.assignmentId,
            semanticState: "blocked",
          }),
        ],
        attentionItems: [
          expect.objectContaining({
            kind: "missing_report",
            status: "resolved",
          }),
          expect.objectContaining({
            kind: "assignment_requires_replan",
            status: "open",
            assignmentId: running.assignmentId,
          }),
        ],
      },
      recipientAttentionOutbox: [
        expect.objectContaining({
          deliveryId: `${running.mission.id}:plan:1:assignment-coverage:lead`,
          state: "canceled",
        }),
        expect.objectContaining({
          idempotencyKey: `${running.mission.id}:${running.assignmentId}:requires-replan`,
          state: "notified",
        }),
      ],
    });
    expect(fixture.attentionAttempts).toHaveLength(1);
  });

  test("fails and supersedes a quality gate that reports late changes requested", async () => {
    const fixture = createFixture(rootDirectory);
    const running = await createRunningDelivery(fixture);
    const { blocked, failedVerificationId } = await createFailedDaemonOwnedVerification(
      fixture,
      running,
    );
    const needsReport = await fixture.missions.update({
      missionId: running.mission.id,
      expectedRevision: blocked.mission.revision,
      update: (mission) => ({
        ...mission,
        attentionItems: [
          {
            attentionId: `${mission.id}:${failedVerificationId}:missing-report`,
            kind: "missing_report" as const,
            status: "open" as const,
            priorMissionStatus: "verifying" as const,
            assignmentId: failedVerificationId,
            summary: "The verification report is missing",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
        assignments: mission.assignments.map((assignment) =>
          assignment.assignmentId === failedVerificationId
            ? {
                ...assignment,
                report: null,
                semanticState: "needs_report" as const,
              }
            : assignment,
        ),
      }),
    });
    const verification = needsReport.mission.assignments.find(
      (assignment) => assignment.assignmentId === failedVerificationId,
    );
    if (!verification) throw new Error("Verification fixture is incomplete");

    const reported = await fixture.collaboration.reportAssignment({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      assignmentId: failedVerificationId,
      expectedRevision: needsReport.mission.revision,
      expectedAssignmentRevision: verification.revision,
      report: {
        status: "completed",
        verdict: "changes_requested",
        summary: "The implementation needs another pass",
        artifactPaths: [],
        tests: [{ command: "npm test parser", passed: false }],
        decisions: [],
        handoffs: [],
      },
    });

    expect(reported.assignment).toMatchObject({
      semanticState: "failed",
      report: { status: "completed", verdict: "changes_requested" },
    });
    expect(reported.mission.attentionItems).toEqual([
      expect.objectContaining({ kind: "missing_report", status: "resolved" }),
      expect.objectContaining({
        kind: "assignment_requires_replan",
        status: "open",
        assignmentId: failedVerificationId,
      }),
    ]);

    const replanned = await fixture.collaboration.planMission({
      callerAgentId: "agent-1",
      missionId: running.mission.id,
      expectedRevision: reported.mission.revision,
      expectedPlanRevision: 1,
      workstreams: missionPlan(),
    });

    expect(
      replanned.assignments.find((assignment) => assignment.assignmentId === failedVerificationId),
    ).toMatchObject({
      semanticState: "canceled",
      terminationReason: "superseded",
      supersededBy: "assignment:mission-1:2:final-verification:verification",
    });
  });

  test("reads Team chat immediately and acknowledges deliveries through the returned cursor", async () => {
    const fixture = createFixture(rootDirectory);
    const { mission } = await createMission(fixture.lifecycle);
    fixture.messageState.readPage = {
      messages: [
        {
          id: "message-for-lead",
          roomId: mission.chatRoomId,
          authorAgentId: "agent-member",
          author: { kind: "agent", id: "agent-member" },
          body: "@technical-lead API is ready for review.",
          replyToMessageId: null,
          mentionAgentIds: ["technical-lead"],
          createdAt: NOW,
        },
      ],
      cursor: 7,
      hasMore: false,
    };
    const stored = await fixture.missions.get(mission.id);
    if (!stored) throw new Error("Mission disappeared");
    await fixture.missions.updateRecoveryState({
      missionId: mission.id,
      expectedStorageRevision: stored.storageRevision,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: [
          {
            deliveryId: "delivery-for-lead",
            idempotencyKey: "message-for-lead",
            requestFingerprint: "fingerprint-for-lead",
            roomMessageId: "message-for-lead",
            senderMemberId: "member-2",
            senderAgentId: "agent-member",
            recipientMemberId: mission.rosterSnapshots[0]?.leadMemberId ?? "missing",
            bindingEpoch: 1,
            mentionHandle: "technical-lead",
            body: "@technical-lead API is ready for review.",
            roomPostedAt: NOW,
            roomCursor: 6,
            attempts: 1,
            createdAt: NOW,
            successorDeliveryId: null,
            state: "notified",
            lastAttemptAt: NOW,
            nextEligibleAt: NOW,
            acknowledgedAt: null,
            canceledAt: null,
            cancelReason: null,
          },
        ],
      }),
    });

    const page = await fixture.collaboration.readTeamChat({
      callerAgentId: "agent-1",
      missionId: mission.id,
      afterCursor: 4,
      limit: 20,
    });
    const persisted = await fixture.missions.get(mission.id);

    expect(page).toMatchObject({ cursor: 7, hasMore: false });
    expect(fixture.messageReads).toEqual([
      { roomId: mission.chatRoomId, afterCursor: 4, limit: 20 },
    ]);
    expect(persisted).toMatchObject({
      recipientChatCursors: [
        {
          memberId: mission.rosterSnapshots[0]?.leadMemberId,
          cursor: 7,
          updatedAt: NOW,
        },
      ],
      recipientAttentionOutbox: [
        {
          deliveryId: "delivery-for-lead",
          state: "acknowledged",
          acknowledgedAt: NOW,
        },
      ],
    });
  });
});

function createFixture(
  rootDirectory: string,
  options?: {
    beforeLeadCreate?: (input: Parameters<TeamParticipantPort["createLead"]>[0]) => Promise<void>;
    beforeMessagePost?: (input: Parameters<TeamMessagePort["post"]>[0]) => Promise<void>;
    beforeArchiveParticipant?: (
      input: Parameters<TeamParticipantPort["archiveParticipant"]>[0],
    ) => Promise<void>;
    beforeAttentionAttempt?: (
      input: Parameters<TeamRecipientAttentionPort["attempt"]>[0],
    ) => Promise<void>;
  },
) {
  const logger = createTestLogger();
  const profiles = new TeamProfileStore({
    directory: join(rootDirectory, "profiles"),
    logger,
    now: () => NOW,
  });
  const missions = new MissionStore({
    directory: join(rootDirectory, "missions"),
    logger,
    now: () => NOW,
  });
  const rooms: TeamRoomPort = { createMissionRoom: async () => undefined };
  const participants: TeamParticipantPort = {
    createLead: async (input) => options?.beforeLeadCreate?.(input),
    archiveParticipant: async (input) => options?.beforeArchiveParticipant?.(input),
  };
  const capabilities: ProviderCapabilityResolver = {
    resolve: async () => ({
      providerAvailable: true,
      toolIds: ["team_status", "mission_status", "team_member_history"],
      capabilityIds: ["structured-tools"],
    }),
  };
  const ids = new Map<string, number>();
  const operations = new TeamOperationCoordinator();
  const clockState = { current: NOW };
  const lifecycle = new TeamMissionService({
    profiles,
    missions,
    recovery: new TeamPersistenceReconciler({ profiles, missions, logger }),
    rooms,
    participants,
    capabilities,
    events: { publishTeam: async () => undefined, publishMission: async () => undefined },
    clock: { now: () => clockState.current },
    ids: {
      next: (kind) => {
        const value = (ids.get(kind) ?? 0) + 1;
        ids.set(kind, value);
        return `${kind}-${value}`;
      },
    },
    operations,
    finishQuiescence: { prepareEvidence: async () => undefined },
  });
  const historyReads: Array<{ agentId: string; limit: number }> = [];
  const messagePosts: Array<Parameters<TeamMessagePort["post"]>[0]> = [];
  const messageReads: Array<Parameters<TeamMessagePort["read"]>[0]> = [];
  const attentionAttempts: Array<Parameters<TeamRecipientAttentionPort["attempt"]>[0]> = [];
  const attentionState: {
    outcomes: TeamRecipientAttentionAttempt[];
    eligibilityListener: ((agentId: string) => Promise<void>) | null;
  } = { outcomes: [], eligibilityListener: null };
  const turnFactState: {
    omittedTurnIds: Set<string>;
    terminalFactListener: ((fact: TeamTerminalTurnFact) => Promise<void>) | null;
  } = { omittedTurnIds: new Set<string>(), terminalFactListener: null };
  const turnFacts: TeamAcceptedTurnFactsPort = {
    read: async (turns) => {
      const facts = new Map<string, AcceptedTurnFact>();
      for (const turn of turns) {
        if (turnFactState.omittedTurnIds.has(turn.turnId)) continue;
        facts.set(turn.turnId, {
          assignmentId: turn.assignmentId,
          turnId: turn.turnId,
          runtimeAgentId: turn.runtimeAgentId,
          outcome: turn.semanticState === "running" ? "running" : "completed",
        });
      }
      return facts;
    },
    onTerminalFact: (listener) => {
      turnFactState.terminalFactListener = listener;
    },
  };
  const recipientAttention: TeamRecipientAttentionPort = {
    attempt: async (input) => {
      await options?.beforeAttentionAttempt?.(input);
      attentionAttempts.push(structuredClone(input));
      return attentionState.outcomes.shift() ?? "notified";
    },
    onEligibilityChange: (listener) => {
      attentionState.eligibilityListener = listener;
    },
  };
  const messageState: {
    failNext: boolean;
    readPage: Awaited<ReturnType<TeamMessagePort["read"]>>;
  } = {
    failNext: false,
    readPage: { messages: [], cursor: 0, hasMore: false },
  };
  const messages: TeamMessagePort = {
    post: async (input) => {
      if (messageState.failNext) {
        messageState.failNext = false;
        throw new Error("simulated room post crash");
      }
      await options?.beforeMessagePost?.(input);
      messagePosts.push(structuredClone(input));
      return { messageId: input.messageId, cursor: 1 };
    },
    read: async (input) => {
      messageReads.push(structuredClone(input));
      return structuredClone(messageState.readPage);
    },
  };
  const publishedMissions: Array<Awaited<ReturnType<TeamMissionService["inspectMission"]>>> = [];
  const scheduledMissionIds: string[] = [];
  const scheduledPermits: Array<TeamOperationPermit | undefined> = [];
  const memberHistory: TeamMemberHistoryPort = {
    read: async (input) => {
      historyReads.push(input);
      return {
        agentId: input.agentId,
        updateCount: 4,
        totalActivities: 4,
        shownActivities: 4,
        currentModeId: "auto",
        content: `history for ${input.agentId}`,
      };
    },
  };
  return {
    profiles,
    missions,
    lifecycle,
    collaboration: new TeamCollaborationService({
      profiles,
      missions,
      memberHistory,
      messages,
      turnFacts,
      recipientAttention,
      events: {
        publishTeam: async () => undefined,
        publishMission: async (mission) => {
          publishedMissions.push(structuredClone(mission));
        },
      },
      clock: { now: () => clockState.current },
      ids: {
        next: (kind) => {
          const value = (ids.get(kind) ?? 0) + 1;
          ids.set(kind, value);
          return `${kind}-${value}`;
        },
      },
      scheduler: {
        reconcileMission: async (missionId, permit) => {
          scheduledMissionIds.push(missionId);
          scheduledPermits.push(permit);
        },
      },
      operations,
    }),
    historyReads,
    messagePosts,
    messageReads,
    messageState,
    attentionAttempts,
    attentionState,
    turnFactState,
    clockState,
    publishedMissions,
    scheduledMissionIds,
    scheduledPermits,
  };
}

async function addParticipant(
  missions: MissionStore,
  missionId: string,
  expectedRevision: number,
  participant: { memberId: string; agentId: string },
) {
  return missions.update({
    missionId,
    expectedRevision,
    update: (current) => ({
      ...current,
      participants: [
        ...current.participants,
        {
          ...participant,
          bindingEpoch: 1,
          joinedAt: NOW,
          archivedAt: null,
        },
      ],
    }),
  });
}

async function createMission(service: TeamMissionService) {
  const team = await createTeam(service);
  const mission = await service.startMission({
    idempotencyKey: "start-mission",
    teamId: team.id,
    expectedTeamRevision: team.revision,
    objective: "Implement a deterministic parser",
    constraints: ["Keep the public grammar stable"],
    acceptanceCriteria: ["Parser tests pass"],
  });
  return { team, mission };
}

function createTeam(service: TeamMissionService) {
  return service.createTeam({
    idempotencyKey: "create-team",
    name: "Compiler team",
    workspaceId: "workspace-sdk",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    lead: LEAD,
    members: [MEMBER],
  });
}

function missionPlan() {
  return [
    {
      workstreamId: "api",
      kind: "delivery" as const,
      title: "Parser API",
      objective: "Implement the parser API",
      deliverables: ["Parser implementation"],
      acceptanceCriteria: ["Parser tests pass"],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 3 as const,
      dependencyWorkstreamIds: [],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
      reviewPolicy: "required" as const,
      reviewerRequirements: {
        requiredSkillIds: ["typescript"],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: ["structured-tools"],
        minimumLevel: 4 as const,
      },
    },
    {
      workstreamId: "final-verification",
      kind: "verification" as const,
      title: "Final verification",
      objective: "Verify the Mission end to end",
      deliverables: ["Verification report"],
      acceptanceCriteria: ["All Mission criteria pass"],
      requiredSkillIds: ["typescript"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4 as const,
      dependencyWorkstreamIds: ["api"],
      mutableScope: { kind: "read_only" as const },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    },
  ];
}

function missionPlanWithoutRequiredReview() {
  const [delivery, verification] = missionPlan();
  if (!delivery || !verification) throw new Error("Mission plan fixture is incomplete");
  return [
    {
      ...delivery,
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    },
    verification,
  ];
}

function missionPlanReplacingApi() {
  const [delivery, verification] = missionPlan();
  if (!delivery || !verification) throw new Error("Mission plan fixture is incomplete");
  return [
    {
      ...delivery,
      workstreamId: "docs",
      title: "Parser documentation",
      objective: "Document the parser API",
      deliverables: ["Parser documentation"],
      acceptanceCriteria: ["Parser documentation is complete"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["docs"] },
      reviewPolicy: "none" as const,
      reviewerRequirements: null,
    },
    {
      ...verification,
      dependencyWorkstreamIds: ["docs"],
    },
  ];
}

async function createRunningDelivery(fixture: ReturnType<typeof createFixture>) {
  const { team, mission } = await createMission(fixture.lifecycle);
  const memberId = team.members[1]?.memberId ?? "missing";
  const withParticipant = await addParticipant(fixture.missions, mission.id, mission.revision, {
    memberId,
    agentId: "agent-member",
  });
  const planned = await fixture.collaboration.planMission({
    callerAgentId: "agent-1",
    missionId: mission.id,
    expectedRevision: withParticipant.mission.revision,
    expectedPlanRevision: 0,
    workstreams: missionPlan(),
  });
  const assigned = await fixture.collaboration.assignTasks({
    callerAgentId: "agent-1",
    missionId: mission.id,
    expectedRevision: planned.revision,
    expectedPlanRevision: 1,
    assignments: [
      {
        clientKey: "api-delivery",
        kind: "delivery",
        workstreamId: "api",
        subjectKeys: [],
        dependencyKeys: [],
        objective: "Implement the parser API",
        inputRefs: [],
        deliverables: ["Parser implementation"],
        acceptanceCriteria: ["Parser tests pass"],
        mutableScope: { kind: "paths", pathPrefixes: ["packages/server"] },
        priority: 10,
      },
    ],
  });
  const assignmentId = assigned.assignments[0]?.assignmentId ?? "missing";
  const running = await fixture.missions.update({
    missionId: mission.id,
    expectedRevision: assigned.mission.revision,
    update: (current) => ({
      ...current,
      assignments: current.assignments.map((assignment) =>
        assignment.assignmentId === assignmentId
          ? {
              ...assignment,
              runtimeAgentId: "agent-member",
              bindingEpoch: 1,
              scopeLease: {
                leaseId: "lease-1",
                workspaceId: current.workspaceId,
                assignmentId,
                scope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
                state: "execution" as const,
                acquiredAt: NOW,
                transitionedAt: null,
                capturedDelta: [],
                recoveryAttempts: 0,
              },
              workspaceBaseline: {
                baselineId: "baseline-1",
                workspaceId: current.workspaceId,
                assignmentId,
                policyRevision: current.workspaceAuditPolicy.revision,
                capturedAt: NOW,
                entries: [],
              },
              dispatchState: "dispatched" as const,
              semanticState: "running" as const,
              acceptedTurnId: "turn-1",
              dispatchedAt: NOW,
            }
          : assignment,
      ),
    }),
  });
  return { mission: running.mission, assignmentId };
}

async function createFailedDaemonOwnedVerification(
  fixture: ReturnType<typeof createFixture>,
  running: Awaited<ReturnType<typeof createRunningDelivery>>,
) {
  const failedVerificationId = "assignment-final-verification-failed";
  const blocked = await fixture.missions.update({
    missionId: running.mission.id,
    expectedRevision: running.mission.revision,
    update: (mission) => {
      const delivery = mission.assignments.find(
        (assignment) => assignment.assignmentId === running.assignmentId,
      );
      const verificationWorkstream = mission.workstreams.find(
        (workstream) => workstream.kind === "verification",
      );
      if (!delivery || !verificationWorkstream) throw new Error("Mission plan is incomplete");
      return {
        ...mission,
        status: "needs_attention" as const,
        suspendedStatus: "verifying" as const,
        workstreams: mission.workstreams.map((workstream) => ({
          ...workstream,
          status: workstream.kind === "verification" ? ("blocked" as const) : ("accepted" as const),
        })),
        assignments: [
          {
            ...delivery,
            scopeLease: null,
            report: completedDeliveryReport(),
            dispatchState: "settled" as const,
            semanticState: "completed" as const,
            settledAt: NOW,
          },
          {
            ...delivery,
            assignmentId: failedVerificationId,
            kind: "verification" as const,
            subjectAssignmentIds: [delivery.assignmentId],
            workstreamId: verificationWorkstream.workstreamId,
            assigneeMemberId: mission.rosterSnapshots[0]!.leadMemberId,
            runtimeAgentId: "agent-1",
            objective: verificationWorkstream.objective,
            inputRefs: [`assignment-report:${delivery.assignmentId}`],
            deliverables: verificationWorkstream.deliverables,
            acceptanceCriteria: verificationWorkstream.acceptanceCriteria,
            mutableScope: { kind: "read_only" as const },
            dependencyAssignmentIds: [delivery.assignmentId],
            workspaceBaseline: {
              ...delivery.workspaceBaseline!,
              baselineId: "baseline-final-verification-failed",
              assignmentId: failedVerificationId,
            },
            report: {
              status: "completed" as const,
              verdict: "changes_requested" as const,
              summary: "The implementation needs another pass",
              artifactPaths: [],
              tests: [{ command: "npm test parser", passed: false }],
              decisions: [],
              handoffs: [],
            },
            dispatchState: "settled" as const,
            semanticState: "failed" as const,
            acceptedTurnId: "turn-final-verification-failed",
            settledAt: NOW,
          },
        ],
        attentionItems: [
          {
            attentionId: `${mission.id}:${failedVerificationId}:requires-replan`,
            kind: "assignment_requires_replan" as const,
            status: "open" as const,
            priorMissionStatus: "verifying" as const,
            assignmentId: failedVerificationId,
            summary: "Final verification requested changes",
            pathEvidence: [],
            createdAt: NOW,
            resolution: null,
          },
        ],
      };
    },
  });
  return { blocked, failedVerificationId };
}

async function addPlannedReview(
  fixture: ReturnType<typeof createFixture>,
  running: Awaited<ReturnType<typeof createRunningDelivery>>,
  expectedRevision: number,
) {
  const reviewId = "assignment-api-review-no-longer-required";
  const stored = await fixture.missions.update({
    missionId: running.mission.id,
    expectedRevision,
    update: (mission) => {
      const delivery = mission.assignments.find(
        (assignment) => assignment.assignmentId === running.assignmentId,
      );
      const workstream = mission.workstreams.find(
        (candidate) => candidate.workstreamId === delivery?.workstreamId,
      );
      if (!delivery || !workstream?.reviewerMemberId) {
        throw new Error("Review fixture is incomplete");
      }
      return {
        ...mission,
        assignments: [
          ...mission.assignments,
          {
            ...delivery,
            assignmentId: reviewId,
            kind: "review" as const,
            subjectAssignmentIds: [delivery.assignmentId],
            assigneeMemberId: workstream.reviewerMemberId,
            runtimeAgentId: null,
            bindingEpoch: null,
            objective: workstream.objective,
            inputRefs: [`assignment-report:${delivery.assignmentId}`],
            deliverables: workstream.deliverables,
            acceptanceCriteria: workstream.acceptanceCriteria,
            mutableScope: { kind: "read_only" as const },
            dependencyAssignmentIds: [delivery.assignmentId],
            supersededBy: null,
            terminationReason: null,
            scopeLease: null,
            workspaceBaseline: null,
            report: null,
            dispatchState: "queued" as const,
            semanticState: "planned" as const,
            acceptedTurnId: null,
            dispatchedAt: null,
            settledAt: null,
          },
        ],
      };
    },
  });
  return { stored, reviewId };
}

function reportRecoveryDelivery(missionId: string, assignmentId: string) {
  return {
    deliveryId: `${missionId}:${assignmentId}:report-recovery:1`,
    assignmentId,
    agentId: "agent-1",
    bindingEpoch: 1,
    attempt: 1,
    messageId: `team-mission:${missionId}:assignment:${assignmentId}:report-recovery:1`,
    createdAt: NOW,
    dispatchAttempts: 0,
    lastFailureKind: null,
    lastFailureReason: null,
    state: "pending" as const,
    turnId: null,
    nextEligibleAt: NOW,
    dispatchedAt: null,
    settledAt: null,
  };
}

async function markAssignmentNeedsReport(
  fixture: ReturnType<typeof createFixture>,
  running: Awaited<ReturnType<typeof createRunningDelivery>>,
) {
  return fixture.missions.update({
    missionId: running.mission.id,
    expectedRevision: running.mission.revision,
    update: (mission) => ({
      ...mission,
      status: "needs_attention" as const,
      suspendedStatus: "active" as const,
      attentionItems: [
        {
          attentionId: `${mission.id}:${running.assignmentId}:missing-report`,
          kind: "missing_report" as const,
          status: "open" as const,
          priorMissionStatus: "active" as const,
          assignmentId: running.assignmentId,
          summary: "The Assignment report is missing",
          pathEvidence: [],
          createdAt: NOW,
          resolution: null,
        },
      ],
      assignments: mission.assignments.map((assignment) =>
        assignment.assignmentId === running.assignmentId
          ? {
              ...assignment,
              dispatchState: "settled" as const,
              semanticState: "needs_report" as const,
              scopeLease: assignment.scopeLease
                ? { ...assignment.scopeLease, state: "report_hold" as const, transitionedAt: NOW }
                : null,
              settledAt: NOW,
            }
          : assignment,
      ),
    }),
  });
}

function completedDeliveryReport() {
  return {
    status: "completed" as const,
    verdict: null,
    summary: "Implemented the parser API",
    artifactPaths: ["packages/server/src/parser.ts"],
    tests: [{ command: "npm test parser", passed: true }],
    decisions: ["Use a table-driven parser"],
    handoffs: [],
  };
}

function deliveryDraft() {
  return {
    clientKey: "api-delivery",
    kind: "delivery" as const,
    workstreamId: "api",
    subjectKeys: [],
    dependencyKeys: [],
    objective: "Implement the parser API",
    inputRefs: [],
    deliverables: ["Parser implementation"],
    acceptanceCriteria: ["Parser tests pass"],
    mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
    priority: 10,
  };
}

function replacementDeliveryDraft() {
  return {
    ...deliveryDraft(),
    clientKey: "docs-delivery",
    workstreamId: "docs",
    objective: "Document the parser API",
    deliverables: ["Parser documentation"],
    acceptanceCriteria: ["Parser documentation is complete"],
    mutableScope: { kind: "paths" as const, pathPrefixes: ["docs"] },
  };
}
