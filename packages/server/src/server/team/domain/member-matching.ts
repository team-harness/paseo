import type {
  MissionMemberMatchExplanation,
  MissionMemberRuntimeSnapshot,
  MissionMutableScope,
  MissionRosterMemberSnapshot,
  TeamMemberLevel,
} from "@getpaseo/protocol/team/v2-types";

export interface WorkstreamMatchCandidate {
  profile: MissionRosterMemberSnapshot;
  openAssignments: number;
}

export interface MatchWorkstreamOwnerInput {
  candidates: ReadonlyArray<WorkstreamMatchCandidate>;
  requiredSkillIds: ReadonlyArray<string>;
  preferredSkillIds: ReadonlyArray<string>;
  requiredRuntimeCapabilityIds: ReadonlyArray<string>;
  minimumLevel: TeamMemberLevel;
  previousOwnerMemberId: string | null;
}

export interface MatchWorkstreamReviewerInput {
  candidates: ReadonlyArray<WorkstreamMatchCandidate>;
  requiredSkillIds: ReadonlyArray<string>;
  preferredSkillIds: ReadonlyArray<string>;
  requiredRuntimeCapabilityIds: ReadonlyArray<string>;
  minimumLevel: TeamMemberLevel;
  previousReviewerMemberId: string | null;
  ownerMemberId: string;
  ownerMutableScope: MissionMutableScope;
}

export type WorkstreamOwnerMatch =
  | { kind: "matched"; memberId: string; explanation: MissionMemberMatchExplanation }
  | { kind: "unmatched"; reason: "no_eligible_member" };

type EligibleMatchCandidate = WorkstreamMatchCandidate & {
  profile: MissionRosterMemberSnapshot & {
    runtimeSnapshot: MissionMemberRuntimeSnapshot;
  };
};

function isEligibleCandidate(
  candidate: WorkstreamMatchCandidate,
): candidate is EligibleMatchCandidate {
  return (
    candidate.profile.runtimeSnapshot !== null &&
    candidate.profile.runtimeSnapshot.providerAvailable
  );
}

function matchingSkillCount(
  candidate: WorkstreamMatchCandidate,
  skillIds: ReadonlyArray<string>,
): number {
  const skills = new Set(candidate.profile.skillIds);
  let coverage = 0;
  for (const skillId of new Set(skillIds)) {
    if (skills.has(skillId)) coverage += 1;
  }
  return coverage;
}

function uniqueValues(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

interface MatchWorkstreamMemberInput {
  candidates: ReadonlyArray<WorkstreamMatchCandidate>;
  requiredSkillIds: ReadonlyArray<string>;
  preferredSkillIds: ReadonlyArray<string>;
  requiredRuntimeCapabilityIds: ReadonlyArray<string>;
  minimumLevel: TeamMemberLevel;
  previousMemberId: string | null;
  excludedMemberIds: ReadonlyArray<string>;
}

function matchWorkstreamMember(input: MatchWorkstreamMemberInput): WorkstreamOwnerMatch {
  const requiredSkills = new Set(input.requiredSkillIds);
  const requiredRuntimeCapabilities = new Set(input.requiredRuntimeCapabilityIds);
  const eligible = input.candidates.filter(
    (candidate): candidate is EligibleMatchCandidate =>
      isEligibleCandidate(candidate) &&
      candidate.profile.level >= input.minimumLevel &&
      [...requiredSkills].every((skillId) => candidate.profile.skillIds.includes(skillId)) &&
      [...requiredRuntimeCapabilities].every((capabilityId) =>
        candidate.profile.runtimeSnapshot.capabilityIds.includes(capabilityId),
      ),
  );
  const excludedMemberIds = new Set(input.excludedMemberIds);
  const selectable = eligible.filter(
    (candidate) => !excludedMemberIds.has(candidate.profile.memberId),
  );
  const ranked = selectable.toSorted((left, right) => {
    const coverageDifference =
      matchingSkillCount(right, input.preferredSkillIds) -
      matchingSkillCount(left, input.preferredSkillIds);
    if (coverageDifference !== 0) return coverageDifference;
    const levelDifference = left.profile.level - right.profile.level;
    if (levelDifference !== 0) return levelDifference;
    const leftWasOwner = left.profile.memberId === input.previousMemberId;
    const rightWasOwner = right.profile.memberId === input.previousMemberId;
    if (leftWasOwner !== rightWasOwner) return leftWasOwner ? -1 : 1;
    const loadDifference = left.openAssignments - right.openAssignments;
    if (loadDifference !== 0) return loadDifference;
    return input.candidates.indexOf(left) - input.candidates.indexOf(right);
  });
  const owner = ranked[0];
  if (!owner) return { kind: "unmatched", reason: "no_eligible_member" };
  const preferredSkillIds = uniqueValues(input.preferredSkillIds);
  return {
    kind: "matched",
    memberId: owner.profile.memberId,
    explanation: {
      recommendedMemberId: owner.profile.memberId,
      requiredSkillIds: uniqueValues(input.requiredSkillIds),
      preferredSkillIds,
      matchedPreferredSkillIds: preferredSkillIds.filter((skillId) =>
        owner.profile.skillIds.includes(skillId),
      ),
      requiredRuntimeCapabilityIds: uniqueValues(input.requiredRuntimeCapabilityIds),
      minimumLevel: input.minimumLevel,
      selectedLevel: owner.profile.level,
      eligibleMemberIds: eligible.map((candidate) => candidate.profile.memberId),
      previousMemberId: input.previousMemberId,
      candidateOpenAssignments: input.candidates.map((candidate) => ({
        memberId: candidate.profile.memberId,
        openAssignments: candidate.openAssignments,
      })),
      excludedMemberIds: eligible
        .map((candidate) => candidate.profile.memberId)
        .filter((memberId) => excludedMemberIds.has(memberId)),
      continuedPreviousMember: owner.profile.memberId === input.previousMemberId,
      openAssignments: owner.openAssignments,
      rosterIndex: input.candidates.indexOf(owner),
    },
  };
}

export function matchWorkstreamOwner(input: MatchWorkstreamOwnerInput): WorkstreamOwnerMatch {
  return matchWorkstreamMember({
    ...input,
    previousMemberId: input.previousOwnerMemberId,
    excludedMemberIds: [],
  });
}

export function matchWorkstreamReviewer(input: MatchWorkstreamReviewerInput): WorkstreamOwnerMatch {
  if (input.ownerMutableScope.kind !== "read_only") {
    const distinctMatch = matchWorkstreamMember({
      ...input,
      previousMemberId: input.previousReviewerMemberId,
      excludedMemberIds: [input.ownerMemberId],
    });
    if (distinctMatch.kind === "matched") return distinctMatch;
  }
  return matchWorkstreamMember({
    ...input,
    previousMemberId: input.previousReviewerMemberId,
    excludedMemberIds: [],
  });
}
