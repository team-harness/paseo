import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import type { TeamPanelMember } from "@/teams/team-panel-view";
import { selectMissionWorkroomView } from "./mission-workroom-view";

const TEAM = {
  id: "team-1",
  name: "Platform Team",
  leadMemberId: "member-lead",
  skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
  members: [
    {
      memberId: "member-lead",
      role: "Lead",
      level: 5,
      skillIds: ["typescript"],
      executionProfile: {
        provider: "codex",
        model: "gpt-5",
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
      executionProfileSource: null,
      mentionHandle: "lead",
    },
  ],
} as unknown as TeamV2;

const MISSION = {
  id: "mission-1",
  teamId: TEAM.id,
  workspaceId: "workspace-1",
  objective: "Ship the task room",
  status: "active",
  activeRosterSnapshotRevision: 1,
  rosterSnapshots: [
    {
      revision: 1,
      teamRevision: 1,
      leadMemberId: "member-lead",
      reason: "initial",
      skills: TEAM.skills,
      members: [
        {
          ...TEAM.members[0],
          capabilityFacts: { kind: "known", capabilityIds: [] },
        },
      ],
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  ],
  participants: [
    {
      memberId: "member-lead",
      agentId: "agent-lead",
      bindingEpoch: 1,
      joinedAt: "2026-08-16T00:00:00.000Z",
      archivedAt: null,
    },
  ],
  attentionItems: [
    {
      attentionId: "attention-1",
      kind: "lead_unavailable",
      assignmentId: null,
      summary: "Lead needs recovery",
      pathEvidence: [],
      createdAt: "2026-08-16T00:00:00.000Z",
      status: "open",
      scope: { kind: "mission" },
    },
  ],
  workstreams: [],
  assignments: [],
  reviewWaivers: [],
} as unknown as TeamMission;

describe("selectMissionWorkroomView", () => {
  it("combines the Mission header with existing member and Attention projections", () => {
    const runtimeMembers = [
      {
        memberId: "member-lead",
        agentId: "agent-lead",
        role: "Lead",
        mentionHandle: "lead",
        active: true,
        isLead: true,
        agent: {
          status: "running",
          requiresAttention: true,
          attentionReason: "permission",
          pendingPermissions: [{ id: "permission-1" }],
        },
      },
    ] as unknown as TeamPanelMember[];
    const view = selectMissionWorkroomView({
      team: TEAM,
      mission: MISSION,
      workspaceLabel: "paseo / feature",
      agentProfiles: [],
      runtimeMembers,
    } as never);

    expect(view).toMatchObject({
      missionId: "mission-1",
      objective: "Ship the task room",
      status: "active",
      workspaceId: "workspace-1",
      workspaceLabel: "paseo / feature",
      attentionCount: 1,
      members: [
        {
          memberId: "member-lead",
          role: "Lead",
          participantAgentId: "agent-lead",
          participantState: "active",
          agentLifecycleStatus: "running",
          requiresAttention: true,
          attentionReason: "permission",
          pendingPermissionCount: 1,
          needsInput: true,
        },
      ],
      attention: [
        {
          attentionId: "attention-1",
          summary: "Lead needs recovery",
          scope: "mission",
        },
      ],
      workstreams: [],
      results: [],
    });
  });

  it("uses the frozen Mission roster when the idle Team profile changed later", () => {
    const updatedTeam = {
      ...TEAM,
      leadMemberId: "member-new",
      members: [
        {
          ...TEAM.members[0],
          memberId: "member-new",
          role: "New maintainer",
          mentionHandle: "new-maintainer",
        },
      ],
    } as unknown as TeamV2;

    const view = selectMissionWorkroomView({
      team: updatedTeam,
      mission: MISSION,
      workspaceLabel: "paseo / feature",
    });

    expect(view.members).toHaveLength(1);
    expect(view.members[0]).toMatchObject({
      memberId: "member-lead",
      role: "Lead",
      mentionHandle: "lead",
      participantAgentId: "agent-lead",
    });
  });

  it("projects work, people, results, gate evidence, and direct or dependency blockers", () => {
    const reviewer = {
      ...TEAM.members[0],
      memberId: "member-reviewer",
      role: "Reviewer",
      mentionHandle: "reviewer",
    };
    const team = {
      ...TEAM,
      members: [...TEAM.members, reviewer],
    } as unknown as TeamV2;
    const mission = {
      ...MISSION,
      planRevision: 1,
      rosterSnapshots: [
        {
          ...MISSION.rosterSnapshots[0],
          members: [
            MISSION.rosterSnapshots[0]!.members[0],
            { ...reviewer, capabilityFacts: { kind: "known", capabilityIds: [] } },
          ],
        },
      ],
      participants: [
        ...MISSION.participants,
        {
          memberId: "member-reviewer",
          agentId: "agent-reviewer",
          bindingEpoch: 1,
          joinedAt: "2026-08-16T00:00:00.000Z",
          archivedAt: "2026-08-16T01:00:00.000Z",
        },
      ],
      attentionItems: [
        {
          attentionId: "attention-review",
          kind: "review_gate_reviewer_unavailable",
          assignmentId: "assignment-delivery",
          summary: "No independent reviewer",
          pathEvidence: [],
          createdAt: "2026-08-16T00:00:00.000Z",
          status: "open",
          scope: { kind: "workstream", workstreamId: "workstream-delivery", blockDependents: true },
        },
      ],
      workstreams: [
        {
          workstreamId: "workstream-delivery",
          kind: "delivery",
          title: "Build inspector",
          objective: "Show structured facts",
          ownerMemberId: "member-lead",
          dependencyWorkstreamIds: [],
          mutableScope: { kind: "paths", paths: ["packages/app"] },
          status: "blocked",
          reviewGate: {
            kind: "required",
            gateKey: { subject: { subjectAssignmentIds: ["assignment-delivery"] } },
            selection: { kind: "awaiting_reviewer" },
            outcome: { kind: "pending" },
          },
          finalVerificationGate: null,
        },
        {
          workstreamId: "workstream-integration",
          kind: "integration",
          title: "Integrate UI",
          objective: "Connect the inspector",
          ownerMemberId: "member-lead",
          dependencyWorkstreamIds: ["workstream-delivery"],
          mutableScope: { kind: "paths", paths: ["packages/app"] },
          status: "blocked",
          reviewGate: {
            kind: "required",
            gateKey: { subject: { subjectAssignmentIds: ["assignment-integration"] } },
            selection: { kind: "awaiting_reviewer" },
            outcome: { kind: "waived", waiverId: "waiver-1" },
          },
          finalVerificationGate: null,
        },
        {
          workstreamId: "workstream-verification",
          kind: "verification",
          title: "Verify delivery",
          objective: "Inspect the final result",
          ownerMemberId: "member-reviewer",
          dependencyWorkstreamIds: ["workstream-integration"],
          mutableScope: { kind: "read_only" },
          status: "blocked",
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
          finalVerificationGate: {
            fingerprint: "sha256:final",
            selection: { kind: "awaiting_capabilities" },
          },
        },
      ],
      assignments: [
        {
          assignmentId: "assignment-delivery",
          kind: "delivery",
          workstreamId: "workstream-delivery",
          assigneeMemberId: "member-lead",
          planRevision: 1,
          semanticState: "blocked",
          report: {
            status: "blocked",
            summary: "Waiting for review",
            blockers: ["No reviewer"],
            artifactPaths: ["packages/app/src/teams/mission-workroom-view.ts"],
            tests: [{ command: "vitest", passed: true }],
            decisions: [],
            handoffs: [],
          },
        },
        {
          assignmentId: "assignment-integration",
          kind: "delivery",
          workstreamId: "workstream-integration",
          assigneeMemberId: "member-lead",
          planRevision: 1,
          semanticState: "completed",
          report: {
            status: "completed",
            verdict: null,
            finalVerificationEvidence: null,
            summary: "Inspector connected",
            artifactPaths: ["packages/app/src/components/teams/mission-workroom.tsx"],
            tests: [{ command: "vitest", passed: true }],
            decisions: ["Reuse Mission snapshot"],
            handoffs: [],
          },
        },
      ],
      reviewWaivers: [
        {
          waiverId: "waiver-1",
          connectionId: "connection-1",
          selfReportedClientLabel: "Desktop",
          reason: "No eligible reviewer",
        },
      ],
    } as unknown as TeamMission;

    const view = selectMissionWorkroomView({
      team,
      mission,
      workspaceLabel: "paseo / feature",
    });

    expect(view.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "member-lead",
          currentAssignments: [
            expect.objectContaining({ assignmentId: "assignment-delivery", state: "blocked" }),
          ],
          needsInput: true,
        }),
        expect.objectContaining({
          memberId: "member-reviewer",
          participantState: "archived",
          currentAssignments: [],
        }),
      ]),
    );
    expect(view.workstreams[0]?.blockers).toEqual([
      expect.objectContaining({ sourceWorkstreamId: "workstream-delivery", direct: true }),
    ]);
    expect(view.workstreams[1]?.blockers).toEqual([
      expect.objectContaining({ sourceWorkstreamId: "workstream-delivery", direct: false }),
    ]);
    expect(view.workstreams[0]).toMatchObject({
      reviewSelection: "awaiting_reviewer",
      reviewOutcome: "pending",
    });
    expect(view.workstreams[1]?.reviewWaiver).toMatchObject({
      waiverId: "waiver-1",
      reason: "No eligible reviewer",
    });
    expect(view.workstreams[2]).toMatchObject({
      finalVerificationStatus: "awaiting_capabilities",
    });
    expect(view.results).toEqual([
      expect.objectContaining({
        workstreamId: "workstream-delivery",
        reports: [
          expect.objectContaining({
            assignmentId: "assignment-delivery",
            status: "blocked",
            tests: [{ command: "vitest", passed: true }],
          }),
        ],
      }),
      expect.objectContaining({
        workstreamId: "workstream-integration",
        reviewOutcome: "waived",
        reports: [
          expect.objectContaining({
            assignmentId: "assignment-integration",
            artifactPaths: ["packages/app/src/components/teams/mission-workroom.tsx"],
          }),
        ],
      }),
      expect.objectContaining({
        workstreamId: "workstream-verification",
        finalVerificationStatus: "awaiting_capabilities",
        reports: [],
      }),
    ]);
  });

  it("does not derive inspector facts from Room prose", () => {
    const first = selectMissionWorkroomView({
      team: TEAM,
      mission: { ...MISSION, roomMessages: [{ body: "Everything is complete" }] } as TeamMission,
      workspaceLabel: "paseo / feature",
    });
    const second = selectMissionWorkroomView({
      team: TEAM,
      mission: { ...MISSION, roomMessages: [{ body: "Everything is blocked" }] } as TeamMission,
      workspaceLabel: "paseo / feature",
    });

    expect(first).toEqual(second);
  });

  it("projects approved review and final verification evidence from structured reports", () => {
    const mission = {
      ...MISSION,
      planRevision: 2,
      workstreams: [
        {
          workstreamId: "workstream-reviewed",
          kind: "integration",
          title: "Reviewed delivery",
          objective: "Integrate reviewed work",
          ownerMemberId: "member-lead",
          dependencyWorkstreamIds: [],
          mutableScope: { kind: "paths", paths: ["packages/app"] },
          status: "accepted",
          reviewGate: {
            kind: "required",
            gateKey: { subject: { subjectAssignmentIds: ["assignment-delivery"] } },
            selection: { kind: "assigned", reviewerMemberId: "member-lead" },
            outcome: { kind: "approved", reviewAssignmentId: "assignment-review" },
          },
          finalVerificationGate: null,
        },
        {
          workstreamId: "workstream-final",
          kind: "verification",
          title: "Final verification",
          objective: "Verify the Mission",
          ownerMemberId: "member-lead",
          dependencyWorkstreamIds: ["workstream-reviewed"],
          mutableScope: { kind: "read_only" },
          status: "accepted",
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
          finalVerificationGate: {
            fingerprint: "sha256:final",
            selection: { kind: "assigned", verifierMemberId: "member-lead" },
          },
        },
      ],
      assignments: [
        {
          assignmentId: "assignment-review",
          kind: "review",
          workstreamId: "workstream-reviewed",
          assigneeMemberId: "member-lead",
          planRevision: 2,
          semanticState: "completed",
          report: {
            status: "completed",
            verdict: "approved",
            finalVerificationEvidence: null,
            summary: "Independent review approved",
            artifactPaths: [],
            tests: [],
            decisions: [],
            handoffs: [],
          },
        },
        {
          assignmentId: "assignment-final",
          kind: "verification",
          workstreamId: "workstream-final",
          assigneeMemberId: "member-lead",
          planRevision: 2,
          semanticState: "completed",
          finalVerificationGateFingerprint: "sha256:final",
          report: {
            status: "completed",
            verdict: "approved",
            finalVerificationEvidence: {
              kind: "final_verification",
              finalGateFingerprint: "sha256:final",
              verdict: "approved",
              reviewGateEvidence: [],
            },
            summary: "Final verification approved",
            artifactPaths: ["artifacts/final.json"],
            tests: [{ command: "npm run typecheck", passed: true }],
            decisions: [],
            handoffs: [],
          },
        },
      ],
    } as unknown as TeamMission;

    const view = selectMissionWorkroomView({
      team: TEAM,
      mission,
      workspaceLabel: "paseo / feature",
    });

    expect(view.results[0]).toMatchObject({
      reviewOutcome: "approved",
      reviewReport: { summary: "Independent review approved", verdict: "approved" },
    });
    expect(view.results[1]).toMatchObject({
      finalVerificationStatus: "approved",
      finalVerificationEvidence: {
        verdict: "approved",
        finalGateFingerprint: "sha256:final",
      },
      reports: [
        expect.objectContaining({
          assignmentId: "assignment-final",
          verdict: "approved",
          artifactPaths: ["artifacts/final.json"],
        }),
      ],
    });
  });
});
