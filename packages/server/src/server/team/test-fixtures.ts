import type { TeamProfileCreateMemberInput } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type {
  MissionMethodologySnapshot,
  TeamExecutionProfile,
  TeamMethodologyBinding,
} from "@getpaseo/protocol/team/v2-types";

import { DaemonTeamAgentProfileMaterializer } from "./application/team-agent-profile-materializer.js";
import { MethodologyCatalog } from "./methodology/catalog.js";

export const TEST_STANDARD_METHODOLOGY_REF = {
  bundleId: "paseo/standard",
  version: "1",
  digest: "sha256:d5001287a60f868bcef21ecd3c4debb5a5237db002c5b9d0f7b0b78e98969697",
} as const;

export function testTeamMethodologyBinding(
  memberIds: readonly string[],
  skillIds: readonly string[],
): TeamMethodologyBinding {
  return {
    ref: TEST_STANDARD_METHODOLOGY_REF,
    presetId: "lean-delivery",
    memberArchetypeBindings: memberIds.map((memberId) => ({ memberId, archetypeId: null })),
    skillBindings: skillIds.map((teamSkillId) => ({
      teamSkillId,
      methodologySkillId: null,
    })),
  };
}

export function testCreateMethodologyBinding(
  clientMemberKeys: readonly string[],
  skillIds: readonly string[],
) {
  return {
    ref: TEST_STANDARD_METHODOLOGY_REF,
    presetId: "lean-delivery",
    memberArchetypeBindings: clientMemberKeys.map((clientMemberKey) => ({
      clientMemberKey,
      archetypeId: null,
    })),
    skillBindings: skillIds.map((teamSkillId) => ({
      teamSkillId,
      methodologySkillId: null,
    })),
  };
}

export function testCreateMember(
  clientMemberKey: string,
  member: TestInlineTeamMemberInput,
): TeamProfileCreateMemberInput {
  return {
    clientMemberKey,
    role: member.role,
    level: member.level,
    skillIds: member.skillIds,
    executionProfileSelection: {
      kind: "inline",
      executionProfile: member.executionProfile,
    },
  };
}

export interface TestInlineTeamMemberInput {
  role: string;
  level: 1 | 2 | 3 | 4 | 5;
  skillIds: string[];
  executionProfile: TeamExecutionProfile;
}

export function testTeamCreationDependencies() {
  return {
    methodologies: new MethodologyCatalog(),
    agentProfiles: new DaemonTeamAgentProfileMaterializer({ readSnapshot: () => [] }),
  };
}

export function testMissionMethodologySnapshot(
  teamRevision: number,
  rosterSnapshotRevision: number,
): MissionMethodologySnapshot {
  const digest = `sha256:${"0".repeat(64)}`;
  return {
    revision: 1,
    ref: TEST_STANDARD_METHODOLOGY_REF,
    compilerVersion: 1,
    teamRevision,
    rosterSnapshotRevision,
    hardPolicy: {
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
    promptSections: [],
    hardPolicyDigest: digest,
    promptDigest: digest,
    compiledDigest: digest,
  };
}
