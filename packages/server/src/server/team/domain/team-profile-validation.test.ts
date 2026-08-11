import { describe, expect, it } from "vitest";

import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { validateTeamProfile, validateTeamReadyForMission } from "./team-profile-validation.js";

function team(): TeamV2 {
  return {
    id: "team-platform",
    name: "Platform team",
    workspaceId: "workspace-platform",
    leadMemberId: "member-lead",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    members: [
      {
        memberId: "member-lead",
        role: "Software architect",
        level: 5,
        skillIds: ["typescript"],
        executionProfile: {
          provider: "codex",
          model: "gpt-5.6-sol",
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
        mentionHandle: "architect",
      },
    ],
    lifecycle: "active",
    activeMissionId: null,
    revision: 1,
    createdAt: "2026-08-07T10:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
    archivedAt: null,
  };
}

describe("team profile validation", () => {
  it("rejects a lead identity that is not in the roster", () => {
    const profile = { ...team(), leadMemberId: "member-missing" };

    expect(validateTeamProfile(profile)).toEqual({
      ok: false,
      issues: [{ kind: "lead_member_not_found", leadMemberId: "member-missing" }],
    });
  });

  it("rejects duplicate member identities and mention handles", () => {
    const profile = team();
    profile.members.push({ ...profile.members[0]! });

    expect(validateTeamProfile(profile)).toEqual({
      ok: false,
      issues: [
        { kind: "duplicate_member_id", memberId: "member-lead" },
        { kind: "duplicate_mention_handle", mentionHandle: "architect" },
      ],
    });
  });

  it("rejects mention handles that collide after resolver normalization", () => {
    const profile = team();
    profile.members.push({
      ...profile.members[0]!,
      memberId: "member-engineer",
      mentionHandle: "ARCHITECT",
    });

    expect(validateTeamProfile(profile)).toEqual({
      ok: false,
      issues: [
        {
          kind: "invalid_mention_handle",
          memberId: "member-engineer",
          mentionHandle: "ARCHITECT",
        },
        { kind: "duplicate_mention_handle", mentionHandle: "architect" },
      ],
    });
  });

  it("rejects non-token and reserved mention handles", () => {
    for (const mentionHandle of ["not addressable!", "everyone"]) {
      const profile = team();
      profile.members[0]!.mentionHandle = mentionHandle;

      expect(validateTeamProfile(profile)).toEqual({
        ok: false,
        issues: [
          {
            kind: "invalid_mention_handle",
            memberId: "member-lead",
            mentionHandle,
          },
        ],
      });
    }
  });

  it("rejects duplicate skill identities in the team catalog", () => {
    const profile = team();
    profile.skills.push({ ...profile.skills[0]! });

    expect(validateTeamProfile(profile)).toEqual({
      ok: false,
      issues: [{ kind: "duplicate_skill_id", skillId: "typescript" }],
    });
  });

  it("rejects a member skill reference that is not in the team catalog", () => {
    const profile = team();
    profile.members[0]!.skillIds.push("rust");

    expect(validateTeamProfile(profile)).toEqual({
      ok: false,
      issues: [
        {
          kind: "unknown_member_skill",
          memberId: "member-lead",
          skillId: "rust",
        },
      ],
    });
  });

  it("blocks Mission start while the Team is archived", () => {
    const profile = team();
    profile.lifecycle = "archived";

    expect(validateTeamReadyForMission(profile)).toEqual({
      ok: false,
      issues: [{ kind: "team_not_active" }],
    });
  });

  it("accepts an active Team whose full roster is ready for Mission planning", () => {
    expect(validateTeamReadyForMission(team())).toEqual({ ok: true });
  });
});
