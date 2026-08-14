import { describe, expect, test } from "vitest";
import type {
  MissionAttentionItem,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";
import { buildMissionReviewGate } from "./mission-review-gate.js";
import {
  applyMissionAttentionTransition,
  FinalVerificationWaiverRejectedError,
} from "./mission-attention-transition.js";

const NOW = "2026-08-14T00:00:00.000Z";

function workstream(workstreamId: string, dependencyWorkstreamIds: string[]): MissionWorkstream {
  return {
    workstreamId,
    kind: "delivery",
    title: workstreamId,
    objective: workstreamId,
    deliverables: [workstreamId],
    acceptanceCriteria: [workstreamId],
    requiredSkillIds: [],
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: [],
    minimumLevel: 1,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    methodologySnapshotRevision: 1,
    dependencyWorkstreamIds,
    mutableScope: { kind: "read_only" },
    ownerMemberId: "member-1",
    ownerMatchExplanation: {
      recommendedMemberId: "member-1",
      requiredSkillIds: [],
      preferredSkillIds: [],
      matchedPreferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 1,
      selectedLevel: 1,
      eligibleMemberIds: ["member-1"],
      excludedMemberIds: [],
      previousMemberId: null,
      candidateOpenAssignments: [{ memberId: "member-1", openAssignments: 0 }],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 0,
    },
    ownerOverrideReason: null,
    reviewGate: { kind: "none", outcome: { kind: "not_required" } },
    status: "ready",
  };
}

function mission(): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Ship scoped attention",
    constraints: [],
    acceptanceCriteria: ["Independent branch continues"],
    status: "active",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [] as TeamMission["rosterSnapshots"],
    methodologySnapshot: {} as TeamMission["methodologySnapshot"],
    methodologyCompiledAt: NOW,
    planRevision: 1,
    revision: 1,
    workspaceAuditPolicy: {} as TeamMission["workspaceAuditPolicy"],
    chatRoomId: "room-1",
    participants: [] as TeamMission["participants"],
    workstreams: [
      workstream("blocked-root", []),
      workstream("blocked-child", ["blocked-root"]),
      workstream("independent", []),
    ],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    reviewWaivers: [],
    lifecycleRecoveryFailure: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function missionItem(attentionId: string): MissionAttentionItem {
  return {
    attentionId,
    kind: "provider_unavailable",
    scope: { kind: "mission" },
    status: "open",
    priorMissionStatus: "active",
    assignmentId: null,
    summary: attentionId,
    pathEvidence: [],
    createdAt: NOW,
    resolution: null,
  };
}

function workstreamItem(attentionId: string): MissionAttentionItem {
  return {
    attentionId,
    kind: "review_gate_reviewer_unavailable",
    scope: { kind: "workstream", workstreamId: "blocked-root", blockDependents: true },
    status: "open",
    priorMissionStatus: null,
    assignmentId: null,
    summary: attentionId,
    pathEvidence: [],
    createdAt: NOW,
    resolution: null,
    reviewGateDetails: {
      gateKey: {
        subject: { workstreamId: "blocked-root", subjectAssignmentIds: [] },
        planRevision: 1,
      },
      gateKeyFingerprint: `sha256:${"1".repeat(64)}`,
      subjectFingerprint: `sha256:${"2".repeat(64)}`,
    },
  };
}

function finalVerifierItem(attentionId: string): MissionAttentionItem {
  return {
    attentionId,
    kind: "final_verifier_unavailable",
    scope: { kind: "workstream", workstreamId: "blocked-root", blockDependents: true },
    status: "open",
    priorMissionStatus: null,
    assignmentId: null,
    summary: attentionId,
    pathEvidence: [],
    createdAt: NOW,
    resolution: null,
    finalVerificationGateDetails: {
      gateKey: {
        workstreamId: "blocked-root",
        planRevision: 1,
        methodologySnapshotRevision: 1,
        subjectAssignmentIds: [],
        reviewGateFingerprints: [],
        requirements: {
          requiredSkillIds: [],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: [],
          minimumLevel: 1,
        },
      },
      gateFingerprint: `sha256:${"3".repeat(64)}`,
    },
  };
}

describe("applyMissionAttentionTransition", () => {
  test("suspends once for Mission scope and restores from the Mission suspended status", () => {
    const first = applyMissionAttentionTransition(mission(), {
      kind: "raise",
      item: missionItem("attention-1"),
    });
    const second = applyMissionAttentionTransition(first, {
      kind: "raise",
      item: missionItem("attention-2"),
    });
    const firstResolved = applyMissionAttentionTransition(second, {
      kind: "resolve",
      attentionId: "attention-1",
      resolution: {
        kind: "resume_provider",
        actorId: "operator",
        reason: "Provider recovered",
        resolvedAt: NOW,
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
      },
    });

    expect(first.status).toBe("needs_attention");
    expect(first.suspendedStatus).toBe("active");
    expect(second.attentionItems.map((item) => item.priorMissionStatus)).toEqual([
      "active",
      "active",
    ]);
    expect(firstResolved.status).toBe("needs_attention");

    const allResolved = applyMissionAttentionTransition(firstResolved, {
      kind: "resolve",
      attentionId: "attention-2",
      resolution: {
        kind: "resume_provider",
        actorId: "operator",
        reason: "Provider recovered",
        resolvedAt: NOW,
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
      },
    });
    expect(allResolved.status).toBe("active");
    expect(allResolved.suspendedStatus).toBeNull();
  });

  test("blocks only the Workstream dependency closure without changing Mission status", () => {
    const source = mission();
    source.workstreams[0]!.reviewGate = buildMissionReviewGate({
      workstreamId: "blocked-root",
      planRevision: 1,
      subjectAssignmentIds: [],
      requirements: {
        requiredSkillIds: [],
        preferredSkillIds: [],
        requiredRuntimeCapabilityIds: [],
        minimumLevel: 1,
      },
      selection: { kind: "awaiting_reviewer" },
      outcome: { kind: "pending" },
    });
    source.workstreams[0]!.status = "review";
    const raised = applyMissionAttentionTransition(source, {
      kind: "raise",
      item: workstreamItem("attention-workstream"),
    });

    expect(raised.status).toBe("active");
    expect(raised.suspendedStatus).toBeNull();
    expect(raised.workstreams.map(({ workstreamId, status }) => [workstreamId, status])).toEqual([
      ["blocked-root", "blocked"],
      ["blocked-child", "blocked"],
      ["independent", "ready"],
    ]);

    const resolved = applyMissionAttentionTransition(raised, {
      kind: "resolve",
      attentionId: "attention-workstream",
      resolution: {
        kind: "replan",
        actorId: "operator",
        reason: "Capabilities refreshed",
        resolvedAt: NOW,
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
      },
    });
    expect(resolved.status).toBe("active");
    expect(resolved.suspendedStatus).toBeNull();
    expect(resolved.workstreams.map(({ workstreamId, status }) => [workstreamId, status])).toEqual([
      ["blocked-root", "review"],
      ["blocked-child", "planned"],
      ["independent", "ready"],
    ]);
  });

  test("rejects attempts to waive a final verifier Attention explicitly", () => {
    const source = applyMissionAttentionTransition(mission(), {
      kind: "raise",
      item: finalVerifierItem("attention-final-verifier"),
    });

    let failure: unknown;
    try {
      applyMissionAttentionTransition(source, {
        kind: "resolve",
        attentionId: "attention-final-verifier",
        resolution: {
          kind: "waive_review",
          actorId: "operator",
          connectionId: "connection-1",
          selfReportedClientLabel: "paseo-app",
          reason: "Skip final verification",
          resolvedAt: NOW,
          ownerAssignmentId: null,
          recoveryAssignmentId: null,
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(FinalVerificationWaiverRejectedError);
    expect(failure).toMatchObject({
      missionId: "mission-1",
      attentionId: "attention-final-verifier",
    });
  });

  test("resolving the final Mission item restores status while Workstream attention remains open", () => {
    const withWorkstream = applyMissionAttentionTransition(mission(), {
      kind: "raise",
      item: workstreamItem("attention-workstream"),
    });
    const mixed = applyMissionAttentionTransition(withWorkstream, {
      kind: "raise",
      item: missionItem("attention-mission"),
    });
    const resolved = applyMissionAttentionTransition(mixed, {
      kind: "resolve",
      attentionId: "attention-mission",
      resolution: {
        kind: "resume_provider",
        actorId: "operator",
        reason: "Provider recovered",
        resolvedAt: NOW,
        ownerAssignmentId: null,
        recoveryAssignmentId: null,
      },
    });

    expect(resolved.status).toBe("active");
    expect(resolved.suspendedStatus).toBeNull();
    expect(
      resolved.attentionItems.find((item) => item.attentionId === "attention-workstream")?.status,
    ).toBe("open");
    expect(resolved.workstreams.find((item) => item.workstreamId === "blocked-root")?.status).toBe(
      "blocked",
    );
  });
});
