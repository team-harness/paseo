import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TeamMission } from "@getpaseo/protocol/team/v2-types";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  MissionFinishConflictError,
  MissionFinishEvidenceConflictError,
  MissionFinishEvidencePendingError,
  MissionFinishStageConflictError,
  MissionIdConflictError,
  MissionStartConflictError,
  MissionStorageRevisionConflictError,
  MissionStore,
  MissionTransactionFieldConflictError,
  MissionUnreadableError,
} from "./mission-store.js";
import type {
  MissionFinishEvidence,
  MissionRecipientAttentionDelivery,
  TeamMissionFinishIntent,
} from "./schemas.js";

const NOW = "2026-08-08T07:00:00.000Z";

function mission(): Omit<TeamMission, "revision" | "createdAt" | "updatedAt" | "completedAt"> {
  return {
    id: "mission-storage",
    teamId: "team-storage",
    workspaceId: "workspace-storage",
    objective: "Implement durable Team storage",
    constraints: ["Keep persistence feature-owned"],
    acceptanceCriteria: ["Crash recovery is deterministic"],
    status: "planning",
    suspendedStatus: null,
    activeRosterSnapshotRevision: 1,
    rosterSnapshots: [
      {
        revision: 1,
        teamRevision: 1,
        leadMemberId: "member-lead",
        reason: "initial",
        skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
        members: [
          {
            memberId: "member-lead",
            role: "Lead engineer",
            level: 4,
            skillIds: ["typescript"],
            executionProfile: {
              provider: "codex",
              model: "gpt-5.6-sol",
              modeId: null,
              thinkingOptionId: "high",
              featureValues: {},
            },
            mentionHandle: "lead-engineer",
            runtimeSnapshot: {
              providerAvailable: true,
              toolIds: ["shell"],
              capabilityIds: ["filesystem"],
            },
          },
        ],
        createdAt: NOW,
      },
    ],
    planRevision: 0,
    workspaceAuditPolicy: {
      revision: 1,
      includeTrackedPaths: true,
      includeNonIgnoredUntrackedPaths: true,
      includeDeclaredArtifactPaths: true,
      excludeGitignoredPathsByDefault: true,
      excludedPathPrefixes: [".git"],
    },
    chatRoomId: "room-storage",
    participants: [
      {
        memberId: "member-lead",
        agentId: "agent-storage-lead",
        bindingEpoch: 1,
        joinedAt: NOW,
        archivedAt: null,
      },
    ],
    workstreams: [],
    workstreamPlanSnapshots: [],
    assignments: [],
    attentionItems: [],
    lifecycleRecoveryFailure: null,
  };
}

function finishIntent(): TeamMissionFinishIntent {
  return {
    intentId: "finish-mission-storage",
    idempotencyKey: "finish-key-storage",
    requestFingerprint: "finish-fingerprint-storage",
    completionEventId: "completion-mission-storage",
    kind: "canceled",
    reason: "User canceled the Mission",
    stage: "requested",
    requestedAt: NOW,
    updatedAt: NOW,
  };
}

type PendingRecipientAttention = Extract<MissionRecipientAttentionDelivery, { state: "pending" }>;

function pendingRecipientAttention(
  overrides: Partial<PendingRecipientAttention> = {},
): PendingRecipientAttention {
  return {
    deliveryId: "attention-member-lead",
    idempotencyKey: "message-key-member-lead",
    requestFingerprint: "message-fingerprint-member-lead",
    roomMessageId: "message-blocked",
    senderMemberId: "member-sender",
    senderAgentId: "agent-sender",
    recipientMemberId: "member-lead",
    bindingEpoch: 1,
    mentionHandle: "lead-engineer",
    body: "@lead-engineer The delivery is blocked",
    roomPostedAt: null,
    roomCursor: null,
    state: "pending",
    attempts: 0,
    createdAt: NOW,
    lastAttemptAt: null,
    nextEligibleAt: NOW,
    acknowledgedAt: null,
    canceledAt: null,
    cancelReason: null,
    successorDeliveryId: null,
    ...overrides,
  };
}

function workspaceBaseline(assignmentId: string) {
  return {
    baselineId: `baseline-${assignmentId}`,
    workspaceId: "workspace-storage",
    assignmentId,
    policyRevision: 1,
    capturedAt: NOW,
    entries: [],
  };
}

function completionReport() {
  return {
    status: "completed" as const,
    verdict: null,
    summary: "Completed",
    artifactPaths: [],
    tests: [],
    decisions: [],
    handoffs: [],
  };
}

type FinishEvidenceAssignments = MissionFinishEvidence["assignments"];

function openAssignment(
  assignmentId: string,
  semanticState: "planned" | "running" | "needs_report",
): TeamMission["assignments"][number] {
  const accepted = semanticState !== "planned";
  let dispatchState: "queued" | "dispatched" | "settled" = "queued";
  if (semanticState === "running") dispatchState = "dispatched";
  if (semanticState === "needs_report") dispatchState = "settled";
  return {
    assignmentId,
    revision: 1,
    kind: "delivery",
    subjectAssignmentIds: [],
    missionId: "mission-storage",
    workstreamId: "workstream-storage",
    assigneeMemberId: "member-lead",
    runtimeAgentId: accepted ? "agent-storage-lead" : null,
    bindingEpoch: accepted ? 1 : null,
    objective: `Run ${assignmentId}`,
    inputRefs: [],
    deliverables: ["Implementation"],
    acceptanceCriteria: ["Work is complete"],
    mutableScope: { kind: "read_only" },
    dependencyAssignmentIds: [],
    priority: 10,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: accepted ? workspaceBaseline(assignmentId) : null,
    report: null,
    dispatchState,
    semanticState,
    attempt: 1,
    acceptedTurnId: accepted ? `turn-${assignmentId}` : null,
    createdAt: NOW,
    dispatchedAt: accepted ? NOW : null,
    settledAt: semanticState === "needs_report" ? NOW : null,
  };
}

async function createPreparedMissionWithEvidence(directory: string): Promise<MissionStore> {
  const store = new MissionStore({
    directory,
    logger: createTestLogger(),
    now: () => NOW,
  });
  const aggregate = mission();
  aggregate.assignments = [openAssignment("assignment-evidence", "running")];
  await store.createIfAbsent({
    idempotencyKey: "start-key-evidence",
    requestFingerprint: "start-fingerprint-evidence",
    mission: aggregate,
  });
  const withFact = await store.recordAcceptedTurnFacts({
    missionId: "mission-storage",
    facts: [
      {
        assignmentId: "assignment-evidence",
        turnId: "turn-assignment-evidence",
        runtimeAgentId: "agent-storage-lead",
        outcome: "completed",
        recordedAt: NOW,
      },
    ],
  });
  const withEvidence = await store.update({
    missionId: "mission-storage",
    expectedRevision: withFact.mission.revision,
    update: (current) => ({
      ...current,
      assignments: current.assignments.map((assignment) => ({
        ...assignment,
        revision: assignment.revision + 1,
        dispatchState: "settled" as const,
        semanticState: "needs_report" as const,
        settledAt: NOW,
        terminalEvidence: {
          assignmentId: assignment.assignmentId,
          acceptedTurn: structuredClone(withFact.acceptedTurnFacts[0]!),
          capturedDelta: [{ path: "feature.ts", fingerprint: "sha256:feature" }],
          ownershipViolations: [{ path: "outside.ts", fingerprint: "sha256:outside" }],
          report: null,
          handoffs: [],
          capturedAt: NOW,
        },
      })),
    }),
  });
  await store.beginFinish({
    missionId: "mission-storage",
    expectedRevision: withEvidence.mission.revision,
    intent: finishIntent(),
  });
  for (const [from, to] of [
    ["requested", "dispatch_stopped"],
    ["dispatch_stopped", "participants_archived"],
  ] as const) {
    await store.advanceFinish({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
      from,
      to,
    });
  }
  await store.prepareFinishEvidence({
    missionId: "mission-storage",
    intentId: "finish-mission-storage",
  });
  return store;
}

describe("MissionStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "mission-store-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("persists a Mission aggregate and server-only recovery state", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    const created = await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });

    expect(created).toEqual({
      storageRevision: 1,
      mission: {
        ...mission(),
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: null,
      },
      startIdempotencyKey: "start-key-storage",
      startRequestFingerprint: "start-fingerprint-storage",
      leadReplacementIntent: null,
      finishIntent: null,
      finishEvidence: null,
      ownershipIntervals: [],
      acceptedTurnFacts: [],
      assignmentDeltaHandoffs: [],
      assignmentDispatchIntents: [],
      assignmentReportRecoveryOutbox: [],
      recipientChatCursors: [],
      recipientAttentionOutbox: [],
      completionOutbox: [],
    });
    expect(JSON.parse(await readFile(join(directory, "mission-storage.json"), "utf8"))).toEqual(
      created,
    );

    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => "2026-08-08T08:00:00.000Z",
    });
    expect(await restarted.get("mission-storage")).toEqual(created);
  });

  test("persists one finish intent and advances its stages monotonically", async () => {
    let now = NOW;
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });

    const requested = await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    expect(requested).toMatchObject({
      storageRevision: 2,
      mission: { revision: 1, updatedAt: NOW },
      finishIntent: finishIntent(),
    });
    expect(
      await store.beginFinish({
        missionId: "mission-storage",
        expectedRevision: 1,
        intent: finishIntent(),
      }),
    ).toEqual(requested);
    await expect(
      store.beginFinish({
        missionId: "mission-storage",
        expectedRevision: 1,
        intent: {
          ...finishIntent(),
          intentId: "finish-competing",
          idempotencyKey: "finish-key-competing",
          requestFingerprint: "finish-fingerprint-competing",
        },
      }),
    ).rejects.toBeInstanceOf(MissionFinishConflictError);
    await expect(
      store.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from: "requested",
        to: "participants_archived",
      }),
    ).rejects.toBeInstanceOf(MissionFinishStageConflictError);

    now = "2026-08-08T07:10:00.000Z";
    const stopped = await store.advanceFinish({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
      from: "requested",
      to: "dispatch_stopped",
    });
    expect(stopped).toMatchObject({
      storageRevision: 3,
      mission: { revision: 1, updatedAt: NOW },
      finishIntent: { stage: "dispatch_stopped", updatedAt: now },
    });
  });

  test("fences dispatch without destroying unfinished Assignment evidence", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const aggregate = mission();
    aggregate.assignments = [
      openAssignment("assignment-planned", "planned"),
      openAssignment("assignment-running", "running"),
      openAssignment("assignment-report", "needs_report"),
    ];
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: aggregate,
    });
    await store.updateRecoveryState({
      missionId: "mission-storage",
      expectedStorageRevision: 1,
      update: (state) => ({
        ...state,
        ownershipIntervals: [
          {
            intervalId: "lease-running",
            workspaceId: "workspace-storage",
            assignmentId: "assignment-running",
            scope: { kind: "workspace" },
            startedAt: NOW,
            state: "open",
            endedAt: null,
            closure: null,
          },
        ],
        assignmentDispatchIntents: [
          {
            assignmentId: "assignment-running",
            runtimeAgentId: "agent-storage-lead",
            bindingEpoch: 1,
            scopeLease: null,
            workspaceBaseline: workspaceBaseline("assignment-running"),
            messageId: "dispatch-running",
            preparedAt: NOW,
            attempts: 1,
            nextEligibleAt: NOW,
            lastFailureKind: null,
            lastFailureReason: null,
          },
        ],
        assignmentReportRecoveryOutbox: [
          {
            deliveryId: "report-recovery-1",
            assignmentId: "assignment-report",
            agentId: "agent-storage-lead",
            bindingEpoch: 1,
            attempt: 1,
            messageId: "report-recovery-message-1",
            createdAt: NOW,
            dispatchAttempts: 1,
            lastFailureKind: null,
            lastFailureReason: null,
            state: "dispatched",
            turnId: "turn-report-recovery-1",
            nextEligibleAt: null,
            dispatchedAt: NOW,
            settledAt: null,
          },
        ],
      }),
    });

    const finishing = await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: finishIntent(),
    });

    expect(finishing.mission.assignments).toEqual(aggregate.assignments);
    expect(finishing.ownershipIntervals).toEqual([
      expect.objectContaining({ state: "open", endedAt: null, closure: null }),
    ]);
    expect(finishing.assignmentDispatchIntents).toHaveLength(1);
    expect(finishing.assignmentReportRecoveryOutbox).toHaveLength(1);
  });

  test("prepares finish only after exact terminal and delta state is durable", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const aggregate = mission();
    aggregate.assignments = [openAssignment("assignment-running", "running")];
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: aggregate,
    });
    await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    await store.advanceFinish({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
      from: "requested",
      to: "dispatch_stopped",
    });
    await store.advanceFinish({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
      from: "dispatch_stopped",
      to: "participants_archived",
    });

    await expect(
      store.prepareFinishEvidence({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidencePendingError);

    const withFact = await store.recordAcceptedTurnFacts({
      missionId: "mission-storage",
      facts: [
        {
          assignmentId: "assignment-running",
          turnId: "turn-assignment-running",
          runtimeAgentId: "agent-storage-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });
    await store.update({
      missionId: "mission-storage",
      expectedRevision: withFact.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((assignment) => ({
          ...assignment,
          revision: assignment.revision + 1,
          dispatchState: "settled",
          semanticState: "needs_report",
          settledAt: NOW,
          terminalEvidence: {
            assignmentId: assignment.assignmentId,
            acceptedTurn: {
              turnId: "turn-assignment-running",
              runtimeAgentId: "agent-storage-lead",
              outcome: "completed" as const,
              recordedAt: NOW,
            },
            capturedDelta: [
              { path: "packages/server/src/feature.ts", fingerprint: "sha256:feature" },
            ],
            ownershipViolations: [],
            report: null,
            handoffs: [],
            capturedAt: NOW,
          },
        })),
      }),
    });

    const prepared = await store.prepareFinishEvidence({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
    });
    expect(prepared.finishIntent).toMatchObject({ stage: "evidence_prepared" });
    expect(prepared.finishEvidence).toEqual({
      intentId: "finish-mission-storage",
      preparedAt: NOW,
      assignments: [prepared.mission.assignments[0]?.terminalEvidence],
    });
    expect(
      await store.prepareFinishEvidence({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).toEqual(prepared);

    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => "2026-08-08T08:00:00.000Z",
    });
    await expect(
      restarted.prepareFinishEvidence({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).resolves.toEqual(prepared);

    const finalized = await restarted.finalize({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
    });
    expect(finalized.mission.assignments[0]).toMatchObject({
      semanticState: "canceled",
      terminationReason: "mission_canceled",
      scopeLease: null,
      terminalEvidence: prepared.mission.assignments[0]?.terminalEvidence,
    });
    expect(finalized.finishEvidence).toEqual(prepared.finishEvidence);
  });

  test("accepts an exact unknown turn fact as durable finish evidence", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const aggregate = mission();
    const terminalEvidence = {
      assignmentId: "assignment-unknown",
      acceptedTurn: {
        turnId: "turn-assignment-unknown",
        runtimeAgentId: "agent-storage-lead",
        outcome: "unknown" as const,
        recordedAt: NOW,
      },
      capturedDelta: [],
      ownershipViolations: [],
      report: null,
      handoffs: [],
      capturedAt: NOW,
    };
    aggregate.assignments = [
      {
        ...openAssignment("assignment-unknown", "running"),
        dispatchState: "settled",
        semanticState: "failed",
        terminationReason: "turn_unknown",
        settledAt: NOW,
      },
    ];
    await store.createIfAbsent({
      idempotencyKey: "start-key-unknown",
      requestFingerprint: "start-fingerprint-unknown",
      mission: aggregate,
    });
    const withFact = await store.recordAcceptedTurnFacts({
      missionId: "mission-storage",
      facts: [
        {
          assignmentId: "assignment-unknown",
          turnId: "turn-assignment-unknown",
          runtimeAgentId: "agent-storage-lead",
          outcome: "unknown",
          recordedAt: NOW,
        },
      ],
    });
    const withEvidence = await store.update({
      missionId: "mission-storage",
      expectedRevision: withFact.mission.revision,
      update: (current) => ({
        ...current,
        assignments: current.assignments.map((assignment) => ({
          ...assignment,
          revision: assignment.revision + 1,
          terminalEvidence,
        })),
      }),
    });
    await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: withEvidence.mission.revision,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
    ] as const) {
      await store.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from,
        to,
      });
    }

    await expect(
      store.prepareFinishEvidence({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).resolves.toMatchObject({ finishIntent: { stage: "evidence_prepared" } });
  });

  test.each([
    ["missing", null],
    ["foreign intent", { intentId: "finish-foreign", preparedAt: NOW, assignments: [] }],
  ])("refuses to finalize with %s finish evidence", async (_case, finishEvidence) => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
      ["participants_archived", "evidence_prepared"],
    ] as const) {
      await store.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from,
        to,
      });
    }
    const filePath = join(directory, "mission-storage.json");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    await writeFile(filePath, JSON.stringify({ ...persisted, finishEvidence }), "utf8");

    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await expect(
      restarted.finalize({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidenceConflictError);
  });

  test("rejects terminal evidence that does not match its Assignment and accepted fact", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const aggregate = mission();
    aggregate.assignments = [openAssignment("assignment-running", "running")];
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: aggregate,
    });
    const withFact = await store.recordAcceptedTurnFacts({
      missionId: "mission-storage",
      facts: [
        {
          assignmentId: "assignment-running",
          turnId: "turn-assignment-running",
          runtimeAgentId: "agent-storage-lead",
          outcome: "completed",
          recordedAt: NOW,
        },
      ],
    });

    await expect(
      store.update({
        missionId: "mission-storage",
        expectedRevision: withFact.mission.revision,
        update: (current) => ({
          ...current,
          assignments: current.assignments.map((assignment) => ({
            ...assignment,
            revision: assignment.revision + 1,
            dispatchState: "settled" as const,
            semanticState: "completed" as const,
            settledAt: NOW,
            terminalEvidence: {
              assignmentId: "assignment-foreign",
              acceptedTurn: {
                turnId: "turn-foreign",
                runtimeAgentId: "agent-foreign",
                outcome: "failed" as const,
                recordedAt: NOW,
              },
              capturedDelta: [],
              ownershipViolations: [],
              report: null,
              handoffs: [],
              capturedAt: NOW,
            },
          })),
        }),
      }),
    ).rejects.toThrow(/terminal evidence/i);
  });

  test.each([
    ["missing", (_assignments: FinishEvidenceAssignments) => []],
    ["duplicate", (assignments: FinishEvidenceAssignments) => [assignments[0]!, assignments[0]!]],
    [
      "foreign",
      (assignments: FinishEvidenceAssignments) => [
        ...assignments,
        { ...assignments[0]!, assignmentId: "assignment-foreign" },
      ],
    ],
    [
      "turn",
      (assignments: FinishEvidenceAssignments) => [
        {
          ...assignments[0]!,
          acceptedTurn: { ...assignments[0]!.acceptedTurn, turnId: "turn-foreign" },
        },
      ],
    ],
    [
      "runtime",
      (assignments: FinishEvidenceAssignments) => [
        {
          ...assignments[0]!,
          acceptedTurn: { ...assignments[0]!.acceptedTurn, runtimeAgentId: "agent-foreign" },
        },
      ],
    ],
    [
      "outcome",
      (assignments: FinishEvidenceAssignments) => [
        {
          ...assignments[0]!,
          acceptedTurn: { ...assignments[0]!.acceptedTurn, outcome: "failed" as const },
        },
      ],
    ],
    [
      "report",
      (assignments: FinishEvidenceAssignments) => [
        { ...assignments[0]!, report: completionReport() },
      ],
    ],
    [
      "handoffs",
      (assignments: FinishEvidenceAssignments) => [
        {
          ...assignments[0]!,
          handoffs: [
            {
              targetWorkstreamId: "workstream-foreign",
              summary: "Foreign handoff",
              artifactPaths: [],
            },
          ],
        },
      ],
    ],
    [
      "delta",
      (assignments: FinishEvidenceAssignments) => [
        {
          ...assignments[0]!,
          capturedDelta: [{ path: "foreign.ts", fingerprint: "sha256:foreign" }],
        },
      ],
    ],
    [
      "violations",
      (assignments: FinishEvidenceAssignments) => [
        {
          ...assignments[0]!,
          ownershipViolations: [{ path: "foreign.ts", fingerprint: "sha256:foreign" }],
        },
      ],
    ],
  ])("rejects %s finish evidence drift on replay and finalize", async (_case, mutate) => {
    const store = await createPreparedMissionWithEvidence(directory);
    const filePath = join(directory, "mission-storage.json");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    const assignments = mutate(structuredClone(persisted.finishEvidence.assignments));
    await writeFile(
      filePath,
      JSON.stringify({
        ...persisted,
        finishEvidence: { ...persisted.finishEvidence, assignments },
      }),
      "utf8",
    );
    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    await expect(
      restarted.prepareFinishEvidence({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidenceConflictError);
    await expect(
      restarted.finalize({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidenceConflictError);
    expect((await store.get("mission-storage"))?.mission.status).not.toBe("canceled");
  });

  test("rejects drift through advanceFinish evidence replay", async () => {
    await createPreparedMissionWithEvidence(directory);
    const filePath = join(directory, "mission-storage.json");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    await writeFile(
      filePath,
      JSON.stringify({
        ...persisted,
        finishEvidence: { ...persisted.finishEvidence, assignments: [] },
      }),
      "utf8",
    );
    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    await expect(
      restarted.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from: "participants_archived",
        to: "evidence_prepared",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidenceConflictError);
  });

  test("rejects drift through finalized finish and prepare replays", async () => {
    const store = await createPreparedMissionWithEvidence(directory);
    await store.finalize({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
    });
    const filePath = join(directory, "mission-storage.json");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    await writeFile(
      filePath,
      JSON.stringify({
        ...persisted,
        finishEvidence: { ...persisted.finishEvidence, assignments: [] },
      }),
      "utf8",
    );
    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    await expect(
      restarted.finalize({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidenceConflictError);
    await expect(
      restarted.prepareFinishEvidence({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).rejects.toBeInstanceOf(MissionFinishEvidenceConflictError);
  });

  test("finalizes the Mission and completion outbox in one idempotent write", async () => {
    let now = NOW;
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
      ["participants_archived", "evidence_prepared"],
    ] as const) {
      const advanced = await store.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from,
        to,
      });
      expect(
        await store.advanceFinish({
          missionId: "mission-storage",
          intentId: "finish-mission-storage",
          from,
          to,
        }),
      ).toEqual(advanced);
    }
    now = "2026-08-08T07:20:00.000Z";

    const finalized = await store.finalize({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
    });

    expect(finalized).toMatchObject({
      storageRevision: 6,
      mission: {
        revision: 2,
        status: "canceled",
        suspendedStatus: null,
        updatedAt: now,
        completedAt: now,
      },
      finishIntent: { stage: "finalized", updatedAt: now },
      completionOutbox: [
        {
          eventId: "completion-mission-storage",
          missionStatus: "canceled",
          state: "pending",
          attempts: 0,
          createdAt: now,
          lastAttemptAt: null,
          acknowledgedAt: null,
        },
      ],
    });
    expect(
      await store.finalize({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
      }),
    ).toEqual(finalized);
  });

  test("marks unresolved Assignments as mission_failed for a fatal Mission", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const aggregate = mission();
    aggregate.assignments = [openAssignment("assignment-planned", "planned")];
    await store.createIfAbsent({
      idempotencyKey: "start-key-failed",
      requestFingerprint: "start-fingerprint-failed",
      mission: aggregate,
    });
    await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: {
        ...finishIntent(),
        kind: "failed",
        reason: "Unrecoverable persistence failure",
      },
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
      ["participants_archived", "evidence_prepared"],
    ] as const) {
      await store.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from,
        to,
      });
    }

    const finalized = await store.finalize({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
    });

    expect(finalized.mission).toMatchObject({
      status: "failed",
      assignments: [
        {
          assignmentId: "assignment-planned",
          semanticState: "canceled",
          terminationReason: "mission_failed",
        },
      ],
    });
  });

  test("cancels unresolved recipient attention in the terminal write", async () => {
    let now = NOW;
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    await store.updateRecoveryState({
      missionId: "mission-storage",
      expectedStorageRevision: 1,
      update: (state) => ({
        ...state,
        recipientAttentionOutbox: [
          pendingRecipientAttention({
            deliveryId: "attention-before-finish",
            idempotencyKey: "message-key-before-finish",
            requestFingerprint: "message-fingerprint-before-finish",
            roomMessageId: "message-before-finish",
          }),
        ],
      }),
    });
    await store.beginFinish({
      missionId: "mission-storage",
      expectedRevision: 1,
      intent: finishIntent(),
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
      ["participants_archived", "evidence_prepared"],
    ] as const) {
      await store.advanceFinish({
        missionId: "mission-storage",
        intentId: "finish-mission-storage",
        from,
        to,
      });
    }
    now = "2026-08-08T07:25:00.000Z";

    const finalized = await store.finalize({
      missionId: "mission-storage",
      intentId: "finish-mission-storage",
    });

    expect(finalized.recipientAttentionOutbox).toEqual([
      {
        ...pendingRecipientAttention({
          deliveryId: "attention-before-finish",
          idempotencyKey: "message-key-before-finish",
          requestFingerprint: "message-fingerprint-before-finish",
          roomMessageId: "message-before-finish",
        }),
        state: "canceled",
        nextEligibleAt: null,
        canceledAt: now,
        cancelReason: "mission_terminal",
      },
    ]);
  });

  test("resolves every open Mission Attention in the terminal write", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const aggregate = mission();
    aggregate.status = "needs_attention";
    aggregate.suspendedStatus = "planning";
    aggregate.attentionItems = [
      {
        attentionId: "runtime-scheduler:mission-storage",
        kind: "lead_unavailable",
        status: "open",
        priorMissionStatus: "planning",
        assignmentId: null,
        summary: "The Lead is unavailable.",
        pathEvidence: [],
        createdAt: NOW,
        resolution: null,
      },
      {
        attentionId: "notification:delivery-before-finish",
        kind: "notification_unacknowledged",
        status: "open",
        priorMissionStatus: "planning",
        assignmentId: null,
        summary: "The notification was not acknowledged.",
        pathEvidence: [],
        createdAt: NOW,
        resolution: null,
      },
    ];
    const created = await store.createIfAbsent({
      idempotencyKey: "start-key-attention-finish",
      requestFingerprint: "start-fingerprint-attention-finish",
      mission: aggregate,
    });
    const intent = finishIntent();
    await store.beginFinish({
      missionId: aggregate.id,
      expectedRevision: created.mission.revision,
      intent,
    });
    for (const [from, to] of [
      ["requested", "dispatch_stopped"],
      ["dispatch_stopped", "participants_archived"],
      ["participants_archived", "evidence_prepared"],
    ] as const) {
      await store.advanceFinish({
        missionId: aggregate.id,
        intentId: intent.intentId,
        from,
        to,
      });
    }

    const finalized = await store.finalize({
      missionId: aggregate.id,
      intentId: intent.intentId,
    });

    expect(finalized.mission.attentionItems).toEqual(
      aggregate.attentionItems.map((attention) =>
        Object.assign({}, attention, {
          status: "resolved",
          resolution: {
            kind: "cancel_mission",
            actorId: "team-runtime",
            reason: intent.reason,
            resolvedAt: NOW,
            ownerAssignmentId: null,
            recoveryAssignmentId: null,
          },
        }),
      ),
    );
    expect(finalized.mission.attentionItems.filter((item) => item.status === "open")).toEqual([]);
  });

  test("updates recovery state with storage CAS without changing the wire revision", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });

    const attempts = await Promise.allSettled([
      store.updateRecoveryState({
        missionId: "mission-storage",
        expectedStorageRevision: 1,
        update: (state) => ({
          ...state,
          ownershipIntervals: [
            {
              intervalId: "ownership-assignment-api",
              workspaceId: "workspace-storage",
              assignmentId: "assignment-api",
              scope: { kind: "paths", pathPrefixes: ["packages/server"] },
              state: "open",
              startedAt: NOW,
              endedAt: null,
              closure: null,
            },
          ],
          recipientAttentionOutbox: [pendingRecipientAttention()],
        }),
      }),
      store.updateRecoveryState({
        missionId: "mission-storage",
        expectedStorageRevision: 1,
        update: (state) => ({ ...state, ownershipIntervals: [] }),
      }),
    ]);

    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await store.get("mission-storage")).toMatchObject({
      storageRevision: 2,
      mission: { revision: 1, updatedAt: NOW },
    });
  });

  test("persists recovery state when the updater mutates its input", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    const delivery = pendingRecipientAttention();

    await store.updateRecoveryState({
      missionId: "mission-storage",
      expectedStorageRevision: 1,
      update: (state) => {
        state.recipientAttentionOutbox.push(delivery);
        return state;
      },
    });

    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    expect(await restarted.get("mission-storage")).toMatchObject({
      storageRevision: 2,
      recipientAttentionOutbox: [delivery],
    });
  });

  test("keeps accepted turn facts in an append-only Mission ledger across restart", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    const fact = {
      assignmentId: "assignment-api",
      turnId: "turn-api",
      runtimeAgentId: "agent-storage-lead",
      outcome: "completed" as const,
      recordedAt: NOW,
    };

    await store.recordAcceptedTurnFacts({ missionId: "mission-storage", facts: [fact] });
    await store.recordAcceptedTurnFacts({
      missionId: "mission-storage",
      facts: [{ ...fact, recordedAt: "2026-08-08T07:01:00.000Z" }],
    });

    const restarted = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => "2026-08-08T08:00:00.000Z",
    });
    expect(await restarted.get("mission-storage")).toMatchObject({
      storageRevision: 2,
      acceptedTurnFacts: [fact],
    });
  });

  test("deduplicates a retried start and rejects key reuse with different input", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const first = await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    const replay = await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: { ...mission(), objective: "Ignored replay input" },
    });

    expect(replay).toEqual(first);
    await expect(
      store.createIfAbsent({
        idempotencyKey: "start-key-storage",
        requestFingerprint: "different-fingerprint",
        mission: { ...mission(), id: "mission-other" },
      }),
    ).rejects.toBeInstanceOf(MissionStartConflictError);
    expect(await store.list()).toEqual([first]);
  });

  test("initializes the start-key index once across concurrent keys", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const persistedList = store.list.bind(store);
    let listCalls = 0;
    let releaseSecondLoad!: () => void;
    const secondLoadGate = new Promise<void>((resolve) => {
      releaseSecondLoad = resolve;
    });
    store.list = async () => {
      listCalls += 1;
      if (listCalls === 2) await secondLoadGate;
      return [];
    };

    const firstPromise = store.createIfAbsent({
      idempotencyKey: "start-a",
      requestFingerprint: "fingerprint-a",
      mission: { ...mission(), id: "mission-a" },
    });
    const secondPromise = store.createIfAbsent({
      idempotencyKey: "start-b",
      requestFingerprint: "fingerprint-b",
      mission: { ...mission(), id: "mission-b" },
    });
    const first = await firstPromise;
    releaseSecondLoad();
    await secondPromise;

    const replay = await store.createIfAbsent({
      idempotencyKey: "start-a",
      requestFingerprint: "fingerprint-a",
      mission: { ...mission(), id: "mission-a-retry" },
    });
    expect(replay).toEqual(first);
    expect(await persistedList()).toHaveLength(2);
  });

  test("serializes different start keys that target the same preallocated id", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const attempts = await Promise.allSettled([
      store.createIfAbsent({
        idempotencyKey: "start-a",
        requestFingerprint: "fingerprint-a",
        mission: mission(),
      }),
      store.createIfAbsent({
        idempotencyKey: "start-b",
        requestFingerprint: "fingerprint-b",
        mission: mission(),
      }),
    ]);

    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(MissionIdConflictError) });
    expect(await store.list()).toHaveLength(1);
  });

  test("uses Mission revision compare-and-swap for concurrent aggregate changes", async () => {
    let now = NOW;
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => now,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    now = "2026-08-08T07:05:00.000Z";

    const changes = await Promise.allSettled([
      store.update({
        missionId: "mission-storage",
        expectedRevision: 1,
        update: (aggregate) => ({ ...aggregate, objective: "Build the Team stores" }),
      }),
      store.update({
        missionId: "mission-storage",
        expectedRevision: 1,
        update: (aggregate) => ({ ...aggregate, objective: "Recover every crash window" }),
      }),
    ]);

    expect(changes.map((change) => change.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await store.get("mission-storage")).toMatchObject({
      storageRevision: 2,
      mission: { revision: 2, updatedAt: now },
    });
  });

  test("fences a Mission update against server-only finish state changes", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const created = await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    await store.beginFinish({
      missionId: created.mission.id,
      expectedRevision: created.mission.revision,
      intent: finishIntent(),
    });

    await expect(
      store.update({
        missionId: created.mission.id,
        expectedRevision: created.mission.revision,
        expectedStorageRevision: created.storageRevision,
        update: (aggregate) => ({ ...aggregate, objective: "Stale recovery mutation" }),
      }),
    ).rejects.toBeInstanceOf(MissionStorageRevisionConflictError);
    expect(await store.get(created.mission.id)).toMatchObject({
      storageRevision: created.storageRevision + 1,
      mission: { objective: created.mission.objective, revision: created.mission.revision },
      finishIntent: { intentId: finishIntent().intentId, stage: "requested" },
    });
  });

  test("rejects entering a terminal state through the generic Mission update", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });

    await expect(
      store.update({
        missionId: "mission-storage",
        expectedRevision: 1,
        update: (aggregate) => ({
          ...aggregate,
          status: "canceled",
          completedAt: NOW,
        }),
      }),
    ).rejects.toBeInstanceOf(MissionTransactionFieldConflictError);
    expect(await store.get("mission-storage")).toMatchObject({
      mission: { status: "planning", revision: 1, completedAt: null },
      finishIntent: null,
      completionOutbox: [],
    });
  });

  test("rejects an updater that mutates terminal state before returning a copy", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });

    await expect(
      store.update({
        missionId: "mission-storage",
        expectedRevision: 1,
        update: (aggregate) => {
          aggregate.status = "canceled";
          aggregate.completedAt = NOW;
          return { ...aggregate };
        },
      }),
    ).rejects.toBeInstanceOf(MissionTransactionFieldConflictError);
    expect(await store.get("mission-storage")).toMatchObject({
      mission: { status: "planning", revision: 1, completedAt: null },
      finishIntent: null,
      completionOutbox: [],
    });
  });

  test("isolates a corrupt Mission and refuses to overwrite it", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const healthy = await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    const brokenPath = join(directory, "mission-broken.json");
    await writeFile(brokenPath, "{not-json", "utf8");

    expect(await store.list()).toEqual([healthy]);
    await expect(store.get("mission-broken")).rejects.toBeInstanceOf(MissionUnreadableError);
    await expect(
      store.createIfAbsent({
        idempotencyKey: "start-key-broken",
        requestFingerprint: "start-fingerprint-broken",
        mission: { ...mission(), id: "mission-broken" },
      }),
    ).rejects.toBeInstanceOf(MissionUnreadableError);
    expect(await readFile(brokenPath, "utf8")).toBe("{not-json");
  });

  test("rejects a Mission whose stored identity does not match its file name", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });
    const healthy = await store.createIfAbsent({
      idempotencyKey: "start-key-storage",
      requestFingerprint: "start-fingerprint-storage",
      mission: mission(),
    });
    await writeFile(join(directory, "mission-alias.json"), JSON.stringify(healthy), "utf8");

    expect(await store.list()).toEqual([healthy]);
    await expect(store.get("mission-alias")).rejects.toBeInstanceOf(MissionUnreadableError);
  });

  test("rejects ids that could escape the Mission directory", async () => {
    const store = new MissionStore({
      directory,
      logger: createTestLogger(),
      now: () => NOW,
    });

    await expect(store.get("../outside")).rejects.toThrow("Invalid Mission id");
  });
});
