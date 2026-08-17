import { describe, expect, test } from "vitest";

import type { TeamMission } from "@getpaseo/protocol/team/v2-types";

import type { MissionRecipientAttentionDelivery } from "../persistence/schemas.js";
import { buildCapabilityReplanBindingDeliveries } from "./assignment-replan.js";

const NOW = "2026-08-14T08:00:00.000Z";

describe("buildCapabilityReplanBindingDeliveries", () => {
  test("rearms an unconsumed request for a replacement Lead after the old delivery was acknowledged", () => {
    const mission = capabilityReplanMission();
    const oldDelivery = capabilityDelivery({
      deliveryId: "capability-request:delivery",
      bindingEpoch: 1,
      state: "acknowledged",
    });

    expect(
      buildCapabilityReplanBindingDeliveries({
        mission,
        existing: [oldDelivery],
        now: NOW,
      }),
    ).toEqual([
      expect.objectContaining({
        deliveryId: "capability-request:delivery:binding:1",
        idempotencyKey: "capability-refresh:binding:1",
        bindingEpoch: 1,
        recipientMemberId: "member-new-lead",
        mentionHandle: "new-lead",
        body: expect.stringContaining("@new-lead"),
        state: "pending",
        attempts: 0,
        nextEligibleAt: NOW,
      }),
    ]);
  });

  test("repeated reconciliation does not append after the current binding already has a delivery", () => {
    const mission = capabilityReplanMission();
    const currentDelivery = {
      ...capabilityDelivery({
        deliveryId: "capability-request:delivery:binding:1",
        bindingEpoch: 1,
        state: "acknowledged",
      }),
      recipientMemberId: "member-new-lead",
    };

    expect(
      buildCapabilityReplanBindingDeliveries({
        mission,
        existing: [
          capabilityDelivery({
            deliveryId: "capability-request:delivery",
            bindingEpoch: 1,
            state: "acknowledged",
          }),
          currentDelivery,
        ],
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("consumed requests never rearm", () => {
    const mission = capabilityReplanMission();
    mission.capabilityReplanRequests[0]!.consumedAt = NOW;

    expect(
      buildCapabilityReplanBindingDeliveries({
        mission,
        existing: [
          capabilityDelivery({
            deliveryId: "capability-request:delivery",
            bindingEpoch: 1,
            state: "acknowledged",
          }),
        ],
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("derives a unique successor after a canceled delivery for the current binding", () => {
    const mission = capabilityReplanMission();
    const canceled = {
      ...capabilityDelivery({
        deliveryId: "capability-request:delivery:binding:1",
        bindingEpoch: 1,
        state: "acknowledged",
      }),
      recipientMemberId: "member-new-lead",
      state: "canceled" as const,
      acknowledgedAt: null,
      canceledAt: NOW,
      cancelReason: "recipient_left" as const,
    };

    expect(
      buildCapabilityReplanBindingDeliveries({
        mission,
        existing: [
          capabilityDelivery({
            deliveryId: "capability-request:delivery",
            bindingEpoch: 1,
            state: "acknowledged",
          }),
          canceled,
        ],
        now: NOW,
      }),
    ).toEqual([
      expect.objectContaining({
        deliveryId: "capability-request:delivery:binding:1:binding:1",
        recipientMemberId: "member-new-lead",
        bindingEpoch: 1,
        state: "pending",
      }),
    ]);
  });
});

function capabilityReplanMission(): TeamMission {
  return {
    id: "mission-1",
    teamId: "team-1",
    workspaceId: "workspace-1",
    objective: "Recover capability replanning",
    constraints: [],
    acceptanceCriteria: ["The replacement Lead receives the request"],
    status: "active",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 2,
    rosterSnapshots: [
      {
        revision: 1,
        teamRevision: 1,
        leadMemberId: "member-old-lead",
        reason: "initial",
        skills: [],
        members: [missionMember("member-old-lead", "old-lead")],
        createdAt: NOW,
      },
      {
        revision: 2,
        teamRevision: 1,
        leadMemberId: "member-new-lead",
        reason: "replan",
        skills: [],
        members: [missionMember("member-new-lead", "new-lead")],
        createdAt: NOW,
      },
    ],
    capabilityReplanRequests: [
      {
        requestId: "capability-request",
        idempotencyKey: "capability-refresh",
        requestFingerprint: "request-fingerprint",
        sourceAttentionIds: ["attention-review"],
        rosterSnapshotRevision: 2,
        deliveryId: "capability-request:delivery",
        createdAt: NOW,
        consumedAt: null,
      },
    ],
    methodologySnapshot: {
      schemaVersion: 1,
      ref: { id: "paseo/standard", version: "1" },
      digest: "a".repeat(64),
      teamRevision: 1,
      rosterSnapshotRevision: 1,
      missionPolicy: {
        review: { required: false },
        finalVerification: { required: false },
      },
      promptSections: [],
    },
    methodologyCompiledAt: NOW,
    planRevision: 1,
    revision: 1,
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [],
    },
    chatRoomId: "room-1",
    participants: [
      {
        memberId: "member-old-lead",
        agentId: "agent-old",
        bindingEpoch: 1,
        joinedAt: NOW,
        archivedAt: NOW,
      },
      {
        memberId: "member-new-lead",
        agentId: "agent-new",
        bindingEpoch: 1,
        joinedAt: NOW,
        archivedAt: null,
      },
    ],
    workstreams: [],
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

function missionMember(memberId: string, mentionHandle: string) {
  return {
    memberId,
    name: "Lead",
    role: "lead" as const,
    level: 5,
    skillIds: [],
    runtimeCapabilityIds: [],
    capabilityKnowledge: "known" as const,
    mentionHandle,
    executionProfile: {
      provider: "claude",
      model: "claude-opus-4-1",
      thinking: "high" as const,
      mode: "default",
    },
    executionProfileSource: null,
  };
}

function capabilityDelivery(input: {
  deliveryId: string;
  bindingEpoch: number;
  state: "acknowledged";
}): MissionRecipientAttentionDelivery {
  return {
    deliveryId: input.deliveryId,
    idempotencyKey: "capability-refresh",
    requestFingerprint: "request-fingerprint",
    roomMessageId: "capability-request:message",
    senderMemberId: "member-old-lead",
    senderAgentId: "agent-old",
    recipientMemberId: "member-old-lead",
    bindingEpoch: input.bindingEpoch,
    mentionHandle: "lead",
    body: "@lead submit a replacement plan",
    roomPostedAt: NOW,
    roomCursor: 1,
    attempts: 1,
    createdAt: NOW,
    successorDeliveryId: null,
    state: input.state,
    lastAttemptAt: NOW,
    nextEligibleAt: null,
    acknowledgedAt: NOW,
    canceledAt: null,
    cancelReason: null,
  };
}
