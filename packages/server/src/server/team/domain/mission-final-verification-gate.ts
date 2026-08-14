import { createHash } from "node:crypto";

import type {
  MissionFinalVerificationGate,
  MissionFinalVerificationGateSelection,
  MissionMemberRequirements,
} from "@getpaseo/protocol/team/v2-types";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalValues(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].toSorted();
}

export function buildMissionFinalVerificationGate(input: {
  workstreamId: string;
  planRevision: number;
  methodologySnapshotRevision: 1;
  subjectAssignmentIds: ReadonlyArray<string>;
  reviewGateFingerprints: ReadonlyArray<string>;
  requirements: MissionMemberRequirements;
  selection: MissionFinalVerificationGateSelection;
}): MissionFinalVerificationGate {
  const key = {
    workstreamId: input.workstreamId,
    planRevision: input.planRevision,
    methodologySnapshotRevision: input.methodologySnapshotRevision,
    subjectAssignmentIds: canonicalValues(input.subjectAssignmentIds),
    reviewGateFingerprints: canonicalValues(input.reviewGateFingerprints),
    requirements: structuredClone(input.requirements) as MissionMemberRequirements,
  };
  return {
    key,
    fingerprint: fingerprint(key),
    selection: structuredClone(input.selection) as MissionFinalVerificationGateSelection,
  };
}
