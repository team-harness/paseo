import { describe, expect, it } from "vitest";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import {
  missionDetailSchema,
  toMissionDetail,
  toMissionRow,
  toTeamProfileDetail,
  toTeamProfileRow,
} from "./schema.js";

const timestamp = "2026-08-09T08:00:00.000Z";
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
        model: "gpt-5.6-sol",
        modeId: null,
        thinkingOptionId: "high",
        featureValues: {},
      },
      mentionHandle: "lead",
    },
  ],
  methodologyBinding: {
    ref: {
      bundleId: "paseo/standard",
      version: "1",
      digest: "sha256:d5001287a60f868bcef21ecd3c4debb5a5237db002c5b9d0f7b0b78e98969697",
    },
    presetId: "lean-delivery",
    memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "lead" }],
    skillBindings: [{ teamSkillId: "ts", methodologySkillId: null }],
  },
  lifecycle: "active",
  activeMissionId: "mission-1",
  lifecycleRecoveryFailure: null,
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
} as const satisfies TeamV2;

const mission = {
  id: "mission-1",
  teamId: team.id,
  workspaceId: team.creationWorkspaceId,
  objective: "Ship the CLI",
  constraints: ["No legacy fallback"],
  acceptanceCriteria: ["CLI tests pass"],
  status: "planning",
  revision: 2,
  planRevision: 0,
  participants: [{ memberId: "member-lead" }],
  workstreams: [],
  assignments: [],
  attentionItems: [],
  capabilityReplanRequests: [],
  chatRoomId: "room-1",
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
} as unknown as TeamMission;

describe("Team profile output", () => {
  it("keeps revision and active Mission visible in list output", () => {
    expect(toTeamProfileRow(team)).toMatchObject({
      id: "team-1",
      lifecycle: "active",
      revision: 4,
      lead: "lead",
      members: 1,
      skills: 1,
      activeMission: "mission-1",
    });
  });

  it("keeps Role, Level, Skills and execution profile in inspect output", () => {
    expect(toTeamProfileDetail(team).roster).toEqual([
      {
        memberId: "member-lead",
        role: "lead",
        level: 5,
        skillIds: ["ts"],
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: null,
        thinking: "high",
        featureValues: {},
        executionSourceKind: "inline",
        executionSource: null,
        executionSourceStatus: "inline",
        executionSourceResolver: null,
        executionSourceDigest: null,
        mention: "lead",
      },
    ]);
  });
});

describe("Mission output", () => {
  it("makes lifecycle and revision fields machine-readable", () => {
    expect(toMissionRow(mission)).toMatchObject({
      id: "mission-1",
      teamId: "team-1",
      status: "planning",
      revision: 2,
      participants: 1,
      workstreams: 0,
    });
  });

  it("keeps constraints and acceptance criteria in inspect output", () => {
    expect(toMissionDetail(mission)).toMatchObject({
      constraints: ["No legacy fallback"],
      acceptanceCriteria: ["CLI tests pass"],
      room: "room-1",
      assignments: 0,
      attentionItems: 0,
      reviewGates: [],
    });
  });

  it("exposes the persisted waiver controller in Mission inspect output", () => {
    const digest = `sha256:${"1".repeat(64)}`;
    const waivedMission = {
      ...mission,
      workstreams: [
        {
          workstreamId: "workstream-api",
          reviewGate: {
            kind: "required",
            gateKey: {
              subject: {
                workstreamId: "workstream-api",
                subjectAssignmentIds: ["assignment-api"],
              },
              planRevision: 1,
            },
            selection: { kind: "awaiting_reviewer" },
            outcome: { kind: "waived", waiverId: "waiver-api" },
          },
        },
      ],
      reviewWaivers: [
        {
          waiverId: "waiver-api",
          attentionId: "attention-review-api",
          gateKey: {
            subject: {
              workstreamId: "workstream-api",
              subjectAssignmentIds: ["assignment-api"],
            },
            planRevision: 1,
          },
          gateKeyFingerprint: digest,
          subjectFingerprint: digest,
          connectionId: "connection-1",
          selfReportedClientLabel: "paseo-cli",
          reason: "No eligible reviewer is available.",
          createdAt: timestamp,
        },
      ],
      capabilityReplanRequests: [],
    } as unknown as TeamMission;

    expect(toMissionDetail(waivedMission).reviewGates[0]).toMatchObject({
      outcome: "waived",
      waiverId: "waiver-api",
      waiverConnectionId: "connection-1",
      waiverSelfReportedClientLabel: "paseo-cli",
    });
    const output = missionDetailSchema.renderHuman?.(
      { type: "single", data: toMissionDetail(waivedMission), schema: missionDetailSchema },
      { format: "table", quiet: false, noHeaders: false, noColor: true },
    );
    expect(output).toContain(
      "waiver=waiver-api connection=connection-1 self-reported-client=paseo-cli reason=No eligible reviewer is available.",
    );
  });

  it("renders approved review report evidence in human Mission output", () => {
    const reportFingerprint = `sha256:${"2".repeat(64)}`;
    const approvedMission = {
      ...mission,
      workstreams: [
        {
          workstreamId: "workstream-api",
          reviewGate: {
            kind: "required",
            gateKey: {
              subject: {
                workstreamId: "workstream-api",
                subjectAssignmentIds: ["assignment-api"],
              },
              planRevision: 1,
            },
            selection: { kind: "assigned", reviewerMemberId: "member-reviewer" },
            outcome: {
              kind: "approved",
              reviewAssignmentId: "assignment-review-api",
              reportFingerprint,
            },
          },
        },
      ],
      assignments: [
        {
          assignmentId: "assignment-review-api",
          report: {
            status: "completed",
            verdict: "approved",
            summary: "Review evidence is complete.",
          },
        },
      ],
      reviewWaivers: [],
      capabilityReplanRequests: [],
    } as unknown as TeamMission;
    const detail = toMissionDetail(approvedMission);

    const output = missionDetailSchema.renderHuman?.(
      { type: "single", data: detail, schema: missionDetailSchema },
      { format: "table", quiet: false, noHeaders: false, noColor: true },
    );

    expect(output).toContain(
      `report=${reportFingerprint} assignment=assignment-review-api status=completed verdict=approved summary=Review evidence is complete.`,
    );
  });

  it("attributes scoped blockers without pausing independent Workstreams", () => {
    const scopedMission = {
      ...mission,
      status: "active",
      workstreams: [
        {
          workstreamId: "workstream-api",
          title: "API",
          status: "blocked",
          dependencyWorkstreamIds: [],
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        },
        {
          workstreamId: "workstream-integration",
          title: "Integration",
          status: "blocked",
          dependencyWorkstreamIds: ["workstream-api"],
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        },
        {
          workstreamId: "workstream-ui",
          title: "UI",
          status: "ready",
          dependencyWorkstreamIds: [],
          reviewGate: { kind: "none", outcome: { kind: "not_required" } },
        },
      ],
      attentionItems: [
        {
          attentionId: "attention-api",
          kind: "review_gate_capability_unknown",
          scope: {
            kind: "workstream",
            workstreamId: "workstream-api",
            blockDependents: true,
          },
          status: "open",
          summary: "API capability facts are unknown",
        },
      ],
      capabilityReplanRequests: [],
    } as unknown as TeamMission;

    const detail = toMissionDetail(scopedMission);
    expect(detail).toMatchObject({
      status: "active",
      workstreamStates: [
        {
          workstreamId: "workstream-api",
          status: "blocked",
          blockers: [
            { attentionId: "attention-api", sourceWorkstreamId: "workstream-api", direct: true },
          ],
        },
        {
          workstreamId: "workstream-integration",
          status: "blocked",
          blockers: [
            { attentionId: "attention-api", sourceWorkstreamId: "workstream-api", direct: false },
          ],
        },
        { workstreamId: "workstream-ui", status: "ready", blockers: [] },
      ],
      attentions: [
        {
          attentionId: "attention-api",
          scope: "workstream",
          workstreamId: "workstream-api",
        },
      ],
    });
    const output = missionDetailSchema.renderHuman?.(
      { type: "single", data: detail, schema: missionDetailSchema },
      { format: "table", quiet: false, noHeaders: false, noColor: true },
    );
    expect(output).toContain(
      "workstream API [workstream-api]: blocked blockers=attention-api@workstream-api:direct",
    );
    expect(output).toContain(
      "workstream Integration [workstream-integration]: blocked blockers=attention-api@workstream-api:dependency",
    );
    expect(output).toContain("workstream UI [workstream-ui]: ready blockers=-");
    expect(output).toContain(
      "attention attention-api: review_gate_capability_unknown scope=workstream:workstream-api",
    );
    expect(output).not.toContain("paused");
  });

  it("renders final verification from the gate and typed evidence", () => {
    const aggregate = structuredClone(mission);
    aggregate.planRevision = 1;
    const fingerprint = `sha256:${"a".repeat(64)}`;
    aggregate.workstreams.push({
      workstreamId: "workstream-final-verification",
      kind: "verification",
      title: "Final verification",
      ownerMemberId: "member-lead",
      reviewGate: { kind: "none", outcome: { kind: "not_required" } },
      dependencyWorkstreamIds: [],
      status: "active",
      finalVerificationGate: {
        key: {
          workstreamId: "workstream-final-verification",
          planRevision: 1,
          methodologySnapshotRevision: 1,
          subjectAssignmentIds: ["assignment-api"],
          reviewGateFingerprints: [],
          requirements: {
            requiredSkillIds: ["verification"],
            preferredSkillIds: [],
            requiredRuntimeCapabilityIds: [],
            minimumLevel: 3,
          },
        },
        fingerprint,
        selection: {
          kind: "assigned",
          verifierMemberId: "member-verifier",
          matchExplanation: {} as never,
          independenceExceptionReason: null,
        },
      },
    } as TeamMission["workstreams"][number]);
    aggregate.assignments.push({
      assignmentId: "assignment-final-verification",
      kind: "verification",
      workstreamId: "workstream-final-verification",
      planRevision: 1,
      semanticState: "completed",
      assigneeMemberId: "member-verifier",
      finalVerificationGateFingerprint: fingerprint,
      reviewGateEvidence: [],
      report: {
        status: "completed",
        verdict: "changes_requested",
        finalVerificationEvidence: {
          kind: "final_verification",
          finalGateFingerprint: fingerprint,
          verdict: "changes_requested",
          reviewGateEvidence: [],
        },
        summary: "Integration proof is incomplete",
        artifactPaths: [],
        tests: [],
        decisions: [],
        handoffs: [],
      },
    } as TeamMission["assignments"][number]);

    const detail = toMissionDetail(aggregate);
    expect(detail.finalVerification).toMatchObject({
      status: "changes_requested",
      coordinatorMemberId: "member-lead",
      verifierMemberId: "member-verifier",
      fingerprint,
      assignmentId: "assignment-final-verification",
      evidence: { verdict: "changes_requested", finalGateFingerprint: fingerprint },
    });
    const output = missionDetailSchema.renderHuman?.(
      { type: "single", data: detail, schema: missionDetailSchema },
      { format: "table", quiet: false, noHeaders: false, noColor: true },
    );
    expect(output).toContain(
      `final verification: changes_requested verifier=member-verifier fingerprint=${fingerprint}`,
    );
  });
});
