import type {
  TeamProfileCreateMemberInput,
  TeamProfileMemberInput,
} from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { TeamMethodologyBinding } from "@getpaseo/protocol/team/v2-types";

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
  member: TeamProfileMemberInput,
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

export function testTeamCreationDependencies() {
  return {
    methodologies: new MethodologyCatalog(),
    agentProfiles: new DaemonTeamAgentProfileMaterializer({ readSnapshot: () => [] }),
  };
}
