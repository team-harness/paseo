import { createHash } from "node:crypto";

import type { MissionAttentionItem, TeamMission } from "@getpaseo/protocol/team/v2-types";

import { applyMissionAttentionTransition } from "./mission-attention-transition.js";

export function carryStructuralGateAttentions(input: {
  previous: TeamMission;
  candidate: TeamMission;
  createdAt: string;
}): TeamMission {
  let projected = input.candidate;
  for (const workstream of input.candidate.workstreams) {
    const previousAttention = input.previous.attentionItems.find(
      (item) =>
        item.status === "open" &&
        item.scope.kind === "workstream" &&
        item.scope.workstreamId === workstream.workstreamId,
    );
    if (!previousAttention) continue;
    const successor = successorAttention(
      input.candidate.id,
      workstream,
      previousAttention,
      input.createdAt,
    );
    if (
      !successor ||
      projected.attentionItems.some((item) => item.attentionId === successor.attentionId)
    ) {
      continue;
    }
    projected = applyMissionAttentionTransition(projected, { kind: "raise", item: successor });
  }
  return projected;
}

function successorAttention(
  missionId: string,
  workstream: TeamMission["workstreams"][number],
  previous: MissionAttentionItem,
  createdAt: string,
): MissionAttentionItem | null {
  const reviewGate = workstream.reviewGate;
  if (
    previous.kind.startsWith("review_gate_") &&
    reviewGate.kind === "required" &&
    reviewGate.outcome.kind === "pending" &&
    reviewGate.selection.kind !== "assigned"
  ) {
    const kind =
      reviewGate.selection.kind === "awaiting_reviewer"
        ? "review_gate_reviewer_unavailable"
        : "review_gate_capability_unknown";
    return {
      attentionId: reviewGateAttentionId(missionId, reviewGate.gateKeyFingerprint, kind),
      kind,
      scope: { kind: "workstream", workstreamId: workstream.workstreamId, blockDependents: true },
      reviewGateDetails: {
        gateKey: reviewGate.gateKey,
        gateKeyFingerprint: reviewGate.gateKeyFingerprint,
        subjectFingerprint: reviewGate.subjectFingerprint,
      },
      status: "open",
      priorMissionStatus: null,
      assignmentId: null,
      summary:
        kind === "review_gate_reviewer_unavailable"
          ? `No structurally eligible reviewer is available for Workstream ${workstream.workstreamId}`
          : `Reviewer capabilities are unknown for Workstream ${workstream.workstreamId}`,
      pathEvidence: [],
      createdAt,
      resolution: null,
    };
  }
  const finalGate = workstream.finalVerificationGate;
  if (
    (previous.kind === "final_verifier_unavailable" ||
      previous.kind === "final_verifier_capability_unknown") &&
    finalGate &&
    finalGate.selection.kind !== "assigned"
  ) {
    const kind =
      finalGate.selection.kind === "awaiting_verifier"
        ? "final_verifier_unavailable"
        : "final_verifier_capability_unknown";
    return {
      attentionId: finalVerifierAttentionId(missionId, finalGate.fingerprint, kind),
      kind,
      scope: { kind: "workstream", workstreamId: workstream.workstreamId, blockDependents: true },
      finalVerificationGateDetails: {
        gateKey: finalGate.key,
        gateFingerprint: finalGate.fingerprint,
      },
      status: "open",
      priorMissionStatus: null,
      assignmentId: null,
      summary:
        kind === "final_verifier_unavailable"
          ? `No structurally eligible final verifier is available for Workstream ${workstream.workstreamId}`
          : `Final verifier capabilities are unknown for Workstream ${workstream.workstreamId}`,
      pathEvidence: [],
      createdAt,
      resolution: null,
    };
  }
  return null;
}

export function reviewGateAttentionId(
  missionId: string,
  gateKeyFingerprint: string,
  kind: "review_gate_reviewer_unavailable" | "review_gate_capability_unknown",
): string {
  return `review-gate:${createHash("sha256")
    .update(`${missionId}\0${gateKeyFingerprint}\0${kind}`)
    .digest("hex")}`;
}

export function finalVerifierAttentionId(
  missionId: string,
  gateFingerprint: string,
  kind: "final_verifier_unavailable" | "final_verifier_capability_unknown",
): string {
  return `final-verifier:${createHash("sha256")
    .update(`${missionId}\0${gateFingerprint}\0${kind}`)
    .digest("hex")}`;
}
