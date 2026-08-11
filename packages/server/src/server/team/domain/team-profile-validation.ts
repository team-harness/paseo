import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";
import { isTeamMentionToken } from "@getpaseo/protocol/team/mention-handles";

export type TeamProfileIssue =
  | { kind: "lead_member_not_found"; leadMemberId: string }
  | { kind: "duplicate_member_id"; memberId: string }
  | { kind: "invalid_mention_handle"; memberId: string; mentionHandle: string }
  | { kind: "duplicate_mention_handle"; mentionHandle: string }
  | { kind: "duplicate_skill_id"; skillId: string }
  | { kind: "unknown_member_skill"; memberId: string; skillId: string };

export type TeamProfileValidation = { ok: true } | { ok: false; issues: TeamProfileIssue[] };

export interface TeamMissionReadinessIssue {
  kind: "team_not_active";
}

export type TeamMissionReadiness =
  | { ok: true }
  | { ok: false; issues: TeamMissionReadinessIssue[] };

export function validateTeamReadyForMission(team: TeamV2): TeamMissionReadiness {
  return team.lifecycle === "active"
    ? { ok: true }
    : { ok: false, issues: [{ kind: "team_not_active" }] };
}

function duplicateValues(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const duplicates: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      continue;
    }
    if (reported.has(value)) continue;
    reported.add(value);
    duplicates.push(value);
  }
  return duplicates;
}

export function validateTeamProfile(team: TeamV2): TeamProfileValidation {
  const issues: TeamProfileIssue[] = [];
  const leadExists = team.members.some((member) => member.memberId === team.leadMemberId);
  if (!leadExists) {
    issues.push({ kind: "lead_member_not_found", leadMemberId: team.leadMemberId });
  }
  for (const memberId of duplicateValues(team.members.map((member) => member.memberId))) {
    issues.push({ kind: "duplicate_member_id", memberId });
  }
  const canonicalMentionHandles = team.members.map((member) => {
    const canonical = member.mentionHandle.trim().toLowerCase();
    if (
      member.mentionHandle !== canonical ||
      canonical === "everyone" ||
      !isTeamMentionToken(canonical)
    ) {
      issues.push({
        kind: "invalid_mention_handle",
        memberId: member.memberId,
        mentionHandle: member.mentionHandle,
      });
    }
    return canonical;
  });
  for (const mentionHandle of duplicateValues(canonicalMentionHandles)) {
    issues.push({ kind: "duplicate_mention_handle", mentionHandle });
  }
  for (const skillId of duplicateValues(team.skills.map((skill) => skill.skillId))) {
    issues.push({ kind: "duplicate_skill_id", skillId });
  }
  const knownSkillIds = new Set(team.skills.map((skill) => skill.skillId));
  for (const member of team.members) {
    for (const skillId of new Set(member.skillIds)) {
      if (!knownSkillIds.has(skillId)) {
        issues.push({ kind: "unknown_member_skill", memberId: member.memberId, skillId });
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}
