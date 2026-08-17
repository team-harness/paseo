import type {
  MissionMethodologySnapshot,
  TeamMethodologyBinding,
} from "@getpaseo/protocol/team/v2-types";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";

export const TEST_METHODOLOGY: MethodologyDescriptor = {
  ref: {
    bundleId: "paseo/standard",
    version: "1",
    digest: `sha256:${"0".repeat(64)}`,
  },
  name: "Paseo Standard",
  description: "Test Methodology",
  license: "MIT-0",
  skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
  archetypes: [
    {
      archetypeId: "engineer",
      name: "Engineer",
      description: "Engineer",
      maxMembers: null,
      playbookIds: [],
      suggestedLevel: 4,
      suggestedSkillIds: ["typescript"],
    },
  ],
  presets: [
    {
      presetId: "standard",
      name: "Standard",
      description: "Standard Team",
      leadSlotId: "engineer",
      skillIds: ["typescript"],
      slots: [
        {
          slotId: "engineer",
          archetypeId: "engineer",
          suggestedRole: "Engineer",
          suggestedLevel: 4,
          suggestedSkillIds: ["typescript"],
        },
      ],
    },
  ],
  policySummary: {
    review: {
      writableWorkstreams: "lead_discretion",
      independentMeans: "different_from_subject_owner",
      unavailable: "review_gate_reviewer_unavailable_attention",
      unknownCapabilities: "review_gate_capability_unknown_attention",
      operatorWaiver: "allowed_with_reason",
    },
    verification: {
      required: true,
      mutableScope: "read_only",
      reviewerSelection: "prefer_independent_record_exception",
      operatorWaiver: "forbidden",
    },
  },
  playbooks: [],
};

export function testTeamMethodologyBinding(
  memberIds: readonly string[] = [],
  skillIds: readonly string[] = [],
): TeamMethodologyBinding {
  return {
    ref: {
      ...TEST_METHODOLOGY.ref,
    },
    presetId: "standard",
    memberArchetypeBindings: memberIds.map((memberId) => ({ memberId, archetypeId: null })),
    skillBindings: skillIds.map((teamSkillId) => ({
      teamSkillId,
      methodologySkillId: null,
    })),
  };
}

export function testMissionMethodologySnapshot(
  teamRevision: number,
  rosterSnapshotRevision: number,
): MissionMethodologySnapshot {
  const digest = `sha256:${"0".repeat(64)}`;
  return {
    revision: 1,
    ref: { ...TEST_METHODOLOGY.ref },
    compilerVersion: 1,
    teamRevision,
    rosterSnapshotRevision,
    hardPolicy: TEST_METHODOLOGY.policySummary,
    promptSections: [],
    hardPolicyDigest: digest,
    promptDigest: digest,
    compiledDigest: digest,
  };
}
