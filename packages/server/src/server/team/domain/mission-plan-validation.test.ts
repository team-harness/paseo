import { describe, expect, it } from "vitest";

import type { MissionMutableScope, MissionWorkstream } from "@getpaseo/protocol/team/v2-types";

import { validateMissionWorkstreams } from "./mission-plan-validation.js";

function workstream(
  workstreamId: string,
  dependencyWorkstreamIds: ReadonlyArray<string>,
  mutableScope: MissionMutableScope = { kind: "read_only" },
): MissionWorkstream {
  return {
    workstreamId,
    kind: "delivery",
    title: workstreamId,
    objective: `Complete ${workstreamId}.`,
    deliverables: [`${workstreamId} output`],
    acceptanceCriteria: [`${workstreamId} is verified`],
    requiredSkillIds: [],
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: [],
    minimumLevel: 1,
    planRevision: 1,
    rosterSnapshotRevision: 1,
    dependencyWorkstreamIds: [...dependencyWorkstreamIds],
    mutableScope,
    ownerMemberId: `member-${workstreamId}`,
    ownerMatchExplanation: {
      recommendedMemberId: `member-${workstreamId}`,
      requiredSkillIds: [],
      preferredSkillIds: [],
      matchedPreferredSkillIds: [],
      requiredRuntimeCapabilityIds: [],
      minimumLevel: 1,
      selectedLevel: 1,
      eligibleMemberIds: [`member-${workstreamId}`],
      excludedMemberIds: [],
      continuedPreviousMember: false,
      openAssignments: 0,
      rosterIndex: 0,
    },
    ownerOverrideReason: null,
    reviewPolicy: "none",
    reviewerRequirements: null,
    reviewerMemberId: null,
    reviewerMatchExplanation: null,
    reviewerOverrideReason: null,
    status: "planned",
  };
}

describe("mission workstream validation", () => {
  it("reports every workstream in a dependency cycle", () => {
    const result = validateMissionWorkstreams([
      workstream("api", ["ui"]),
      workstream("ui", ["api"]),
    ]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: "dependency_cycle", workstreamIds: ["api", "ui"] }],
    });
  });

  it("rejects overlapping path scopes that could run in parallel", () => {
    const result = validateMissionWorkstreams([
      workstream("protocol", [], {
        kind: "paths",
        pathPrefixes: ["packages/protocol"],
      }),
      workstream("team", [], {
        kind: "paths",
        pathPrefixes: ["packages/protocol/src/team"],
      }),
    ]);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "mutable_scope_conflict",
          workstreamIds: ["protocol", "team"],
          pathPrefixes: ["packages/protocol", "packages/protocol/src/team"],
        },
      ],
    });
  });

  it("allows overlapping scopes when a dependency serializes ownership", () => {
    const result = validateMissionWorkstreams([
      workstream("protocol", [], {
        kind: "paths",
        pathPrefixes: ["packages/protocol"],
      }),
      workstream("team", ["protocol"], {
        kind: "paths",
        pathPrefixes: ["packages/protocol/src/team"],
      }),
    ]);

    expect(result).toEqual({ ok: true });
  });

  it("rejects a dependency that is not part of the plan", () => {
    const result = validateMissionWorkstreams([workstream("integration", ["missing-api"])]);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_dependency",
          workstreamId: "integration",
          dependencyWorkstreamId: "missing-api",
        },
      ],
    });
  });

  it("rejects duplicate workstream identities", () => {
    const result = validateMissionWorkstreams([workstream("api", []), workstream("api", [])]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: "duplicate_workstream_id", workstreamId: "api" }],
    });
  });

  it("rejects a mutable path outside the normalized workspace namespace", () => {
    const result = validateMissionWorkstreams([
      workstream("server", [], {
        kind: "paths",
        pathPrefixes: ["../packages/server"],
      }),
    ]);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_mutable_path_prefix",
          workstreamId: "server",
          pathPrefix: "../packages/server",
        },
      ],
    });
  });

  it("rejects glob syntax because overlap checks require literal path prefixes", () => {
    const result = validateMissionWorkstreams([
      workstream("server", [], {
        kind: "paths",
        pathPrefixes: ["packages/*"],
      }),
    ]);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_mutable_path_prefix",
          workstreamId: "server",
          pathPrefix: "packages/*",
        },
      ],
    });
  });

  it("rejects Windows drive-relative prefixes", () => {
    const result = validateMissionWorkstreams([
      workstream("server", [], {
        kind: "paths",
        pathPrefixes: ["C:packages/server"],
      }),
    ]);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_mutable_path_prefix",
          workstreamId: "server",
          pathPrefix: "C:packages/server",
        },
      ],
    });
  });
});
