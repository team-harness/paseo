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
          actorId: "controller-user",
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
    } as unknown as TeamMission;

    expect(toMissionDetail(waivedMission).reviewGates[0]).toMatchObject({
      outcome: "waived",
      waiverId: "waiver-api",
      waiverActorId: "controller-user",
    });
    const output = missionDetailSchema.renderHuman?.(
      { type: "single", data: toMissionDetail(waivedMission), schema: missionDetailSchema },
      { format: "table", quiet: false, noHeaders: false, noColor: true },
    );
    expect(output).toContain(
      "waiver=waiver-api actor=controller-user reason=No eligible reviewer is available.",
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
});
