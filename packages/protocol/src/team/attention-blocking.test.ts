import { describe, expect, it } from "vitest";

import type { TeamMission } from "./v2-types.js";
import { selectOpenWorkstreamAttentionAttributions } from "./attention-blocking.js";

describe("selectOpenWorkstreamAttentionAttributions", () => {
  it("attributes a scoped blocker to its root and transitive dependents only", () => {
    const mission = {
      workstreams: [
        { workstreamId: "api", dependencyWorkstreamIds: [] },
        { workstreamId: "integration", dependencyWorkstreamIds: ["api"] },
        { workstreamId: "verification", dependencyWorkstreamIds: ["integration"] },
        { workstreamId: "ui", dependencyWorkstreamIds: [] },
      ],
      attentionItems: [
        {
          attentionId: "attention-api",
          kind: "review_gate_reviewer_unavailable",
          scope: { kind: "workstream", workstreamId: "api", blockDependents: true },
          status: "open",
          summary: "API review is blocked",
        },
        {
          attentionId: "attention-resolved",
          kind: "review_gate_reviewer_unavailable",
          scope: { kind: "workstream", workstreamId: "ui", blockDependents: true },
          status: "resolved",
          summary: "Historical UI blocker",
        },
      ],
    } as unknown as TeamMission;

    expect(selectOpenWorkstreamAttentionAttributions(mission)).toEqual([
      {
        attentionId: "attention-api",
        kind: "review_gate_reviewer_unavailable",
        summary: "API review is blocked",
        sourceWorkstreamId: "api",
        targetWorkstreamId: "api",
        direct: true,
      },
      {
        attentionId: "attention-api",
        kind: "review_gate_reviewer_unavailable",
        summary: "API review is blocked",
        sourceWorkstreamId: "api",
        targetWorkstreamId: "integration",
        direct: false,
      },
      {
        attentionId: "attention-api",
        kind: "review_gate_reviewer_unavailable",
        summary: "API review is blocked",
        sourceWorkstreamId: "api",
        targetWorkstreamId: "verification",
        direct: false,
      },
    ]);
  });
});
