import { describe, expect, it } from "vitest";

import { validateMissionStatusTransition } from "./mission-status-transition.js";

describe("mission status transitions", () => {
  it.each([
    ["planning", "active", "plan_accepted"],
    ["active", "needs_attention", "attention_raised"],
    ["needs_attention", "active", "attention_resolved"],
    ["active", "verifying", "begin_verification"],
    ["verifying", "active", "changes_requested"],
    ["verifying", "needs_attention", "attention_raised"],
  ] as const)("accepts %s -> %s for %s", (from, to, intent) => {
    let suspendedStatus: "planning" | "active" | "verifying" | null = null;
    if (intent === "attention_raised") suspendedStatus = from;
    if (intent === "attention_resolved") suspendedStatus = to;
    expect(
      validateMissionStatusTransition({
        from,
        to,
        intent,
        qualityGateSatisfied: false,
        fatalFailureIntentId: null,
        suspendedStatus,
      }),
    ).toEqual({ ok: true });
  });

  it("requires the complete quality gate before completion", () => {
    expect(
      validateMissionStatusTransition({
        from: "verifying",
        to: "completed",
        intent: "quality_gate_passed",
        qualityGateSatisfied: false,
        fatalFailureIntentId: null,
        suspendedStatus: null,
      }),
    ).toEqual({
      ok: false,
      issue: { kind: "quality_gate_required", from: "verifying", to: "completed" },
    });
  });

  it("requires a durable fatal failure intent before terminal failure", () => {
    expect(
      validateMissionStatusTransition({
        from: "active",
        to: "failed",
        intent: "fatal_failure",
        qualityGateSatisfied: false,
        fatalFailureIntentId: null,
        suspendedStatus: null,
      }),
    ).toEqual({
      ok: false,
      issue: { kind: "fatal_failure_intent_required", from: "active", to: "failed" },
    });
  });

  it("keeps terminal mission states immutable", () => {
    expect(
      validateMissionStatusTransition({
        from: "completed",
        to: "active",
        intent: "attention_resolved",
        qualityGateSatisfied: true,
        fatalFailureIntentId: null,
        suspendedStatus: "active",
      }),
    ).toEqual({
      ok: false,
      issue: { kind: "terminal_mission_state", from: "completed", to: "active" },
    });
  });

  it.each(["planning", "active", "needs_attention", "verifying"] as const)(
    "allows explicit cancellation from %s",
    (from) => {
      expect(
        validateMissionStatusTransition({
          from,
          to: "canceled",
          intent: "cancel",
          qualityGateSatisfied: false,
          fatalFailureIntentId: null,
          suspendedStatus: from === "needs_attention" ? "active" : null,
        }),
      ).toEqual({ ok: true });
    },
  );

  it("allows planning to suspend for recoverable attention", () => {
    const input = {
      from: "planning",
      to: "needs_attention",
      intent: "attention_raised",
      qualityGateSatisfied: false,
      fatalFailureIntentId: null,
      suspendedStatus: "planning",
    } as const;

    expect(validateMissionStatusTransition(input)).toEqual({ ok: true });
  });

  it("does not resume attention into a status other than its durable prior state", () => {
    const input = {
      from: "needs_attention",
      to: "verifying",
      intent: "attention_resolved",
      qualityGateSatisfied: false,
      fatalFailureIntentId: null,
      suspendedStatus: "active",
    } as const;

    expect(validateMissionStatusTransition(input).ok).toBe(false);
  });
});
