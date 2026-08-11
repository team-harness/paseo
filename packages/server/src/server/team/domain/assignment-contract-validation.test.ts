import { describe, expect, it } from "vitest";

import type { MissionAssignmentContract } from "@getpaseo/protocol/team/v2-types";

import {
  type AcceptedTurnOutcome,
  validateAssignmentContract as validateStrictAssignmentContract,
} from "./assignment-contract-validation.js";

type TestAcceptedTurnOutcome = AcceptedTurnOutcome | null;

function validateAssignmentContract(input: {
  assignment: MissionAssignmentContract;
  acceptedTurnOutcome: TestAcceptedTurnOutcome;
}) {
  return validateStrictAssignmentContract({
    assignment: input.assignment,
    acceptedTurn:
      input.acceptedTurnOutcome === null
        ? null
        : {
            assignmentId: input.assignment.assignmentId,
            turnId: input.assignment.acceptedTurnId ?? "missing-turn",
            runtimeAgentId: input.assignment.runtimeAgentId ?? "missing-runtime-agent",
            outcome: input.acceptedTurnOutcome,
          },
    expectedWorkspaceId: "workspace-platform",
  });
}

function assignment(overrides: Partial<MissionAssignmentContract> = {}): MissionAssignmentContract {
  const hasDispatchEvidence =
    (overrides.dispatchState !== undefined && overrides.dispatchState !== "queued") ||
    overrides.dispatchedAt != null ||
    overrides.acceptedTurnId != null;
  return {
    assignmentId: "assignment-protocol",
    revision: 1,
    kind: "delivery",
    subjectAssignmentIds: [],
    missionId: "mission-sdk",
    workstreamId: "workstream-protocol",
    assigneeMemberId: "member-engineer",
    runtimeAgentId: hasDispatchEvidence ? "agent-engineer" : null,
    bindingEpoch: hasDispatchEvidence ? 1 : null,
    objective: "Implement the Mission protocol.",
    inputRefs: [],
    deliverables: ["Mission schemas"],
    acceptanceCriteria: ["The focused protocol test passes."],
    mutableScope: { kind: "paths", pathPrefixes: ["packages/protocol/src/team"] },
    dependencyAssignmentIds: [],
    priority: 1,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    supersededBy: null,
    terminationReason: null,
    scopeLease:
      overrides.dispatchState === "dispatched" &&
      (overrides.mutableScope ?? { kind: "paths" }).kind !== "read_only"
        ? executionLease()
        : null,
    workspaceBaseline: hasDispatchEvidence ? workspaceBaseline() : null,
    report: null,
    dispatchState: "queued",
    semanticState: "planned",
    attempt: 1,
    acceptedTurnId: null,
    createdAt: "2026-08-07T11:00:00.000Z",
    dispatchedAt: null,
    settledAt: null,
    ...overrides,
  };
}

function completedReport(): NonNullable<MissionAssignmentContract["report"]> {
  return {
    status: "completed",
    verdict: null,
    summary: "Implemented and tested the Mission protocol.",
    artifactPaths: ["packages/protocol/src/team/v2-types.ts"],
    tests: [{ command: "npx vitest run v2-types.test.ts", passed: true }],
    decisions: [],
    handoffs: [],
  };
}

function interruptedReport(
  status: "blocked" | "failed",
): NonNullable<MissionAssignmentContract["report"]> {
  return {
    status,
    summary: `${status} while implementing the Mission protocol.`,
    blockers: ["The upstream contract is unavailable."],
    artifactPaths: [],
    tests: [],
    decisions: [],
    handoffs: [],
  };
}

function reportHold(): NonNullable<MissionAssignmentContract["scopeLease"]> {
  return {
    leaseId: "lease-assignment-protocol",
    workspaceId: "workspace-platform",
    assignmentId: "assignment-protocol",
    scope: { kind: "paths", pathPrefixes: ["packages/protocol/src/team"] },
    state: "report_hold",
    acquiredAt: "2026-08-07T11:00:45.000Z",
    transitionedAt: "2026-08-07T11:05:00.000Z",
    capturedDelta: [
      {
        path: "packages/protocol/src/team/v2-types.ts",
        fingerprint: "sha256:example",
      },
    ],
    recoveryAttempts: 0,
  };
}

function executionLease(): NonNullable<MissionAssignmentContract["scopeLease"]> {
  return {
    leaseId: "lease-assignment-protocol",
    workspaceId: "workspace-platform",
    assignmentId: "assignment-protocol",
    scope: { kind: "paths", pathPrefixes: ["packages/protocol/src/team"] },
    state: "execution",
    acquiredAt: "2026-08-07T11:00:45.000Z",
    transitionedAt: null,
    capturedDelta: [],
    recoveryAttempts: 0,
  };
}

function workspaceBaseline(): NonNullable<MissionAssignmentContract["workspaceBaseline"]> {
  return {
    baselineId: "baseline-assignment-protocol",
    workspaceId: "workspace-platform",
    assignmentId: "assignment-protocol",
    policyRevision: 1,
    capturedAt: "2026-08-07T11:00:50.000Z",
    entries: [],
  };
}

describe("mission assignment contract validation", () => {
  it("requires subjects only for review and verification work", () => {
    expect(
      validateAssignmentContract({
        assignment: assignment({ kind: "delivery", subjectAssignmentIds: ["assignment-source"] }),
        acceptedTurnOutcome: null,
      }),
    ).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["delivery_subjects_must_be_empty"],
        },
      ],
    });

    for (const kind of ["review", "verification"] as const) {
      expect(
        validateAssignmentContract({
          assignment: assignment({ kind, subjectAssignmentIds: [] }),
          acceptedTurnOutcome: null,
        }),
      ).toEqual({
        ok: false,
        issues: [
          {
            kind: "invalid_assignment_state",
            assignmentId: "assignment-protocol",
            violations: ["subject_assignment_required"],
          },
        ],
      });
    }
  });

  it("rejects completed semantics without a report and successful accepted turn", () => {
    const result = validateAssignmentContract({
      assignment: assignment({ semanticState: "completed" }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: [
            "dispatch_state_must_be_settled",
            "completed_report_required",
            "accepted_turn_required",
            "accepted_turn_must_be_completed",
            "dispatched_at_required",
            "settled_at_required",
          ],
        },
      ],
    });
  });

  it("accepts completion when both the report and successful turn are durable", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        dispatchState: "settled",
        semanticState: "completed",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({ ok: true });
  });

  it("binds completion to the exact Assignment, accepted turn, and runtime agent", () => {
    const contract = assignment({
      report: completedReport(),
      dispatchState: "settled",
      semanticState: "completed",
      acceptedTurnId: "turn-1",
      dispatchedAt: "2026-08-07T11:01:00.000Z",
      settledAt: "2026-08-07T11:05:00.000Z",
    });

    const result = validateStrictAssignmentContract({
      assignment: contract,
      acceptedTurn: {
        assignmentId: "assignment-other",
        turnId: "turn-other",
        runtimeAgentId: "agent-other",
        outcome: "completed",
      },
      expectedWorkspaceId: "workspace-platform",
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          violations: [
            "accepted_turn_assignment_mismatch",
            "accepted_turn_id_mismatch",
            "accepted_turn_runtime_agent_mismatch",
          ],
        },
      ],
    });
  });

  it.each(["review", "verification"] as const)(
    "accepts a completed changes-requested report as failed %s evidence",
    (kind) => {
      const result = validateAssignmentContract({
        assignment: assignment({
          kind,
          subjectAssignmentIds: ["assignment-source"],
          report: { ...completedReport(), verdict: "changes_requested" },
          dispatchState: "settled",
          semanticState: "failed",
          acceptedTurnId: "turn-1",
          dispatchedAt: "2026-08-07T11:01:00.000Z",
          settledAt: "2026-08-07T11:05:00.000Z",
        }),
        acceptedTurnOutcome: "completed",
      });

      expect(result).toEqual({ ok: true });
    },
  );

  it("does not treat a delivery changes-requested report as failed evidence", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: { ...completedReport(), verdict: "changes_requested" },
        dispatchState: "settled",
        semanticState: "failed",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["failed_report_or_reason_required", "delivery_verdict_must_be_absent"],
        },
      ],
    });
  });

  it("does not treat an approved review report as failed evidence", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        kind: "review",
        subjectAssignmentIds: ["assignment-source"],
        report: { ...completedReport(), verdict: "approved" },
        dispatchState: "settled",
        semanticState: "failed",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["failed_report_or_reason_required"],
        },
      ],
    });
  });

  it("binds baseline and lease evidence to the Mission workspace", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: { ...executionLease(), workspaceId: "workspace-other" },
        workspaceBaseline: { ...workspaceBaseline(), workspaceId: "workspace-other" },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          violations: ["workspace_baseline_workspace_mismatch", "scope_lease_workspace_mismatch"],
        },
      ],
    });
  });

  it("requires review and verification reports to carry an explicit verdict", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        kind: "review",
        subjectAssignmentIds: ["assignment-source"],
        mutableScope: { kind: "read_only" },
        report: completedReport(),
        dispatchState: "settled",
        semanticState: "completed",
        acceptedTurnId: "turn-review",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ violations: ["completion_verdict_required"] }],
    });
  });

  it("requires a replan cancellation to identify its replacement", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        semanticState: "canceled",
        terminationReason: "superseded",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ violations: ["superseded_by_required"] }],
    });
  });

  it("rejects running semantics without an accepted active turn", () => {
    const result = validateAssignmentContract({
      assignment: assignment({ semanticState: "running" }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: [
            "dispatch_state_must_be_dispatched",
            "accepted_turn_required",
            "accepted_turn_must_be_running",
            "dispatched_at_required",
          ],
        },
      ],
    });
  });

  it("requires a runtime agent after dispatch", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        runtimeAgentId: null,
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["runtime_agent_required"],
        },
      ],
    });
  });

  it("requires the participant binding epoch after dispatch", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        bindingEpoch: null,
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["binding_epoch_required"],
        },
      ],
    });
  });

  it("rejects a participant binding before dispatch", () => {
    const result = validateAssignmentContract({
      assignment: assignment({ bindingEpoch: 1 }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["binding_epoch_must_be_absent"],
        },
      ],
    });
  });

  it("requires a workspace baseline after dispatch", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        mutableScope: { kind: "read_only" },
        workspaceBaseline: null,
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["workspace_baseline_required"],
        },
      ],
    });
  });

  it("rejects a workspace baseline before dispatch", () => {
    const result = validateAssignmentContract({
      assignment: assignment({ workspaceBaseline: workspaceBaseline() }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["workspace_baseline_must_be_absent"],
        },
      ],
    });
  });

  it("requires an execution lease while writable work is running", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: null,
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["execution_scope_lease_required"],
        },
      ],
    });
  });

  it("rejects an execution lease after the accepted turn settles", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: executionLease(),
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["report_hold_required"],
        },
      ],
    });
  });

  it("rejects baseline and lease evidence owned by another assignment", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: {
          ...executionLease(),
          assignmentId: "assignment-other",
          workspaceId: "workspace-other",
          scope: { kind: "workspace" },
        },
        workspaceBaseline: {
          ...workspaceBaseline(),
          assignmentId: "assignment-other",
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: [
            "workspace_baseline_assignment_mismatch",
            "scope_lease_assignment_mismatch",
            "scope_lease_scope_mismatch",
            "scope_lease_workspace_mismatch",
          ],
        },
      ],
    });
  });

  it("rejects a baseline path outside the normalized workspace namespace", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        mutableScope: { kind: "read_only" },
        workspaceBaseline: {
          ...workspaceBaseline(),
          entries: [
            {
              path: "../outside.txt",
              fingerprint: "sha256:outside",
              classification: "non_ignored_untracked",
            },
          ],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["invalid_workspace_baseline_path"],
        },
      ],
    });
  });

  it("accepts concrete tracked file paths containing route brackets", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        mutableScope: { kind: "read_only" },
        workspaceBaseline: {
          ...workspaceBaseline(),
          entries: [
            {
              path: "packages/app/src/app/h/[serverId]/agent/[agentId].tsx",
              fingerprint: "sha256:route",
              classification: "tracked",
            },
          ],
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-route",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects report and handoff artifacts outside the workspace namespace", () => {
    const report = completedReport();
    report.artifactPaths = ["../outside.txt"];
    report.handoffs = [
      {
        targetWorkstreamId: "workstream-next",
        summary: "Consume the generated artifact.",
        artifactPaths: ["/tmp/generated.txt"],
      },
    ];
    const result = validateAssignmentContract({
      assignment: assignment({
        report,
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-artifacts",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a workspace baseline captured after dispatch", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        mutableScope: { kind: "read_only" },
        workspaceBaseline: {
          ...workspaceBaseline(),
          capturedAt: "2026-08-07T11:02:00.000Z",
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["workspace_baseline_after_dispatch"],
        },
      ],
    });
  });

  it("requires durable transition metadata on a report hold", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: { ...reportHold(), transitionedAt: null },
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["report_hold_transition_required"],
        },
      ],
    });
  });

  it("limits report recovery in the domain while the wire remains forward-compatible", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: { ...reportHold(), recoveryAttempts: 3 },
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-needs-report",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ violations: ["report_hold_recovery_attempts_exceeded"] }],
    });
  });

  it("rejects report-recovery metadata on an execution lease", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        scopeLease: {
          ...executionLease(),
          transitionedAt: "2026-08-07T11:00:55.000Z",
          recoveryAttempts: 1,
        },
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: [
            "execution_lease_transition_must_be_absent",
            "execution_lease_recovery_attempts_must_be_zero",
          ],
        },
      ],
    });
  });

  it("rejects runtime facts on an assignment that is still planned", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: [
            "report_must_be_absent",
            "dispatched_at_must_be_absent",
            "settled_at_must_be_absent",
          ],
        },
      ],
    });
  });

  it("rejects a settled timestamp while the assignment is still running", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["settled_at_must_be_absent"],
        },
      ],
    });
  });

  it("rejects needs_report after both completion facts are durable", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        scopeLease: reportHold(),
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-1",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["report_must_be_absent"],
        },
      ],
    });
  });

  it("rejects needs_report after a recorded completion report settles with a failed turn", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        scopeLease: executionLease(),
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-failed-after-report",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "failed",
    });

    expect(result.ok).toBe(false);
  });

  it("requires a durable report hold when writable work settles without a report", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        dispatchState: "settled",
        semanticState: "needs_report",
        acceptedTurnId: "turn-needs-report",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["report_hold_required"],
        },
      ],
    });
  });

  it("accepts a durable completion report while its accepted turn is still running", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        dispatchState: "dispatched",
        semanticState: "running",
        acceptedTurnId: "turn-reporting",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
      }),
      acceptedTurnOutcome: "running",
    });

    expect(result).toEqual({ ok: true });
  });

  it("requires blocked and failed states to carry their matching reports", () => {
    for (const [semanticState, reportStatus, violation] of [
      ["blocked", "failed", "blocked_report_required"],
      ["failed", "blocked", "failed_report_or_reason_required"],
    ] as const) {
      const result = validateAssignmentContract({
        assignment: assignment({
          report: interruptedReport(reportStatus),
          dispatchState: "settled",
          semanticState,
          acceptedTurnId: "turn-1",
          dispatchedAt: "2026-08-07T11:01:00.000Z",
          settledAt: "2026-08-07T11:05:00.000Z",
        }),
        acceptedTurnOutcome: "completed",
      });

      expect(result).toEqual({
        ok: false,
        issues: [
          {
            kind: "invalid_assignment_state",
            assignmentId: "assignment-protocol",
            violations: [violation],
          },
        ],
      });
    }
  });

  it("keeps blocked and failed reports in running state until their turns settle", () => {
    for (const status of ["blocked", "failed"] as const) {
      const result = validateAssignmentContract({
        assignment: assignment({
          report: interruptedReport(status),
          dispatchState: "dispatched",
          semanticState: "running",
          acceptedTurnId: `turn-reporting-${status}`,
          dispatchedAt: "2026-08-07T11:01:00.000Z",
        }),
        acceptedTurnOutcome: "running",
      });

      expect(result).toEqual({ ok: true });
    }
  });

  it("rejects blocked and failed semantics before their accepted turns settle", () => {
    for (const status of ["blocked", "failed"] as const) {
      const result = validateAssignmentContract({
        assignment: assignment({
          report: interruptedReport(status),
          dispatchState: "dispatched",
          semanticState: status,
          acceptedTurnId: `turn-reporting-${status}`,
          dispatchedAt: "2026-08-07T11:01:00.000Z",
        }),
        acceptedTurnOutcome: "running",
      });

      expect(result).toEqual({
        ok: false,
        issues: [
          {
            kind: "invalid_assignment_state",
            assignmentId: "assignment-protocol",
            violations: [
              "dispatch_state_must_be_settled",
              "accepted_turn_must_be_settled",
              "settled_at_required",
              "scope_lease_must_be_absent",
            ],
          },
        ],
      });
    }
  });

  it("requires canceled work to be settled without a member report", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        report: completedReport(),
        semanticState: "canceled",
        terminationReason: "mission_canceled",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["report_must_be_absent", "settled_at_required"],
        },
      ],
    });
  });

  it("accepts canceling queued work without fabricated runtime evidence", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        runtimeAgentId: null,
        bindingEpoch: null,
        workspaceBaseline: null,
        dispatchState: "queued",
        semanticState: "canceled",
        terminationReason: "mission_canceled",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({ ok: true });
  });

  it("accepts canceling queued work when its Mission fails fatally", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        runtimeAgentId: null,
        bindingEpoch: null,
        workspaceBaseline: null,
        dispatchState: "queued",
        semanticState: "canceled",
        terminationReason: "mission_failed",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects plan-change cancellation for delivery work", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        runtimeAgentId: null,
        bindingEpoch: null,
        workspaceBaseline: null,
        dispatchState: "queued",
        semanticState: "canceled",
        terminationReason: null,
        planChangeReason: "quality_gate_no_longer_required",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["plan_change_reason_must_be_absent"],
        },
      ],
    });
  });

  it("accepts canceling an unneeded queued review after replan", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        kind: "review",
        subjectAssignmentIds: ["assignment-source"],
        runtimeAgentId: null,
        bindingEpoch: null,
        workspaceBaseline: null,
        dispatchState: "queued",
        semanticState: "canceled",
        terminationReason: null,
        planChangeReason: "quality_gate_no_longer_required",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects combining plan-change cancellation with supersession metadata", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        kind: "review",
        subjectAssignmentIds: ["assignment-source"],
        runtimeAgentId: null,
        bindingEpoch: null,
        workspaceBaseline: null,
        dispatchState: "queued",
        semanticState: "canceled",
        terminationReason: "superseded",
        planChangeReason: "quality_gate_no_longer_required",
        supersededBy: "assignment-replacement",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: ["termination_reason_must_be_absent", "superseded_by_must_be_absent"],
        },
      ],
    });
  });

  it("accepts canceling queued work when its participant becomes unavailable", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        runtimeAgentId: null,
        bindingEpoch: null,
        workspaceBaseline: null,
        dispatchState: "queued",
        semanticState: "canceled",
        terminationReason: "participant_unavailable",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: null,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects participant-unavailable cancellation after a turn was accepted", () => {
    const result = validateAssignmentContract({
      assignment: assignment({
        dispatchState: "settled",
        semanticState: "canceled",
        terminationReason: "participant_unavailable",
        acceptedTurnId: "turn-accepted-before-participant-loss",
        dispatchedAt: "2026-08-07T11:01:00.000Z",
        settledAt: "2026-08-07T11:05:00.000Z",
      }),
      acceptedTurnOutcome: "completed",
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_assignment_state",
          assignmentId: "assignment-protocol",
          violations: [
            "dispatch_state_must_be_queued",
            "accepted_turn_must_be_absent",
            "dispatched_at_must_be_absent",
          ],
        },
      ],
    });
  });

  it("accepts every canonical non-completed state", () => {
    const cases: Array<{
      contract: MissionAssignmentContract;
      outcome: TestAcceptedTurnOutcome;
    }> = [
      { contract: assignment(), outcome: null },
      {
        contract: assignment({
          dispatchState: "dispatched",
          semanticState: "running",
          acceptedTurnId: "turn-running",
          dispatchedAt: "2026-08-07T11:01:00.000Z",
        }),
        outcome: "running",
      },
      {
        contract: assignment({
          dispatchState: "settled",
          semanticState: "needs_report",
          scopeLease: reportHold(),
          acceptedTurnId: "turn-needs-report",
          dispatchedAt: "2026-08-07T11:01:00.000Z",
          settledAt: "2026-08-07T11:05:00.000Z",
        }),
        outcome: "completed",
      },
      ...(["blocked", "failed"] as const).map((status) => ({
        contract: assignment({
          report: interruptedReport(status),
          dispatchState: "settled",
          semanticState: status,
          acceptedTurnId: `turn-${status}`,
          dispatchedAt: "2026-08-07T11:01:00.000Z",
          settledAt: "2026-08-07T11:05:00.000Z",
        }),
        outcome: status === "blocked" ? ("completed" as const) : ("failed" as const),
      })),
      {
        contract: assignment({
          runtimeAgentId: null,
          bindingEpoch: null,
          workspaceBaseline: null,
          dispatchState: "queued",
          semanticState: "canceled",
          terminationReason: "mission_canceled",
          settledAt: "2026-08-07T11:05:00.000Z",
        }),
        outcome: null,
      },
    ];

    for (const { contract, outcome } of cases) {
      expect(
        validateAssignmentContract({ assignment: contract, acceptedTurnOutcome: outcome }),
      ).toEqual({ ok: true });
    }
  });
});
