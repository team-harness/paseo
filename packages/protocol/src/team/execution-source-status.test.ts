import { describe, expect, it } from "vitest";

import {
  normalizeAgentProfileExecutionProfile,
  selectTeamMemberExecutionSourceStatus,
} from "./execution-source-status.js";
import type { TeamMemberProfile } from "./v2-types.js";

const executionProfile = {
  provider: "claude" as const,
  model: "claude-opus-5",
  modeId: null,
  thinkingOptionId: null,
  featureValues: {},
};

function member(overrides: Partial<TeamMemberProfile> = {}): TeamMemberProfile {
  return {
    memberId: "member-1",
    role: "implementer",
    level: 3,
    skillIds: ["server"],
    executionProfile,
    mentionHandle: "implementer",
    ...overrides,
  };
}

const sourced = member({
  executionProfileSource: {
    kind: "agent_profile",
    profileId: "profile-1",
    resolverVersion: 1,
    appliedDigest: `sha256:${"0".repeat(64)}`,
  },
});

describe("normalizeAgentProfileExecutionProfile", () => {
  it("maps absent optional catalog fields to the null execution shape", () => {
    expect(normalizeAgentProfileExecutionProfile({ id: "profile-1", provider: "claude" })).toEqual({
      provider: "claude",
      model: null,
      modeId: null,
      thinkingOptionId: null,
      featureValues: {},
    });
  });

  it("returns null when the catalog entry cannot drive a Team Member", () => {
    expect(
      normalizeAgentProfileExecutionProfile({ id: "profile-1", provider: "claude", model: "" }),
    ).toBeNull();
  });
});

describe("selectTeamMemberExecutionSourceStatus", () => {
  it("reports inline members that carry no Agent Profile source", () => {
    expect(selectTeamMemberExecutionSourceStatus(member(), [])).toEqual({ kind: "inline" });
  });

  it("reports current when the catalog still materializes the stored snapshot", () => {
    expect(
      selectTeamMemberExecutionSourceStatus(sourced, [
        { id: "profile-1", provider: "claude", model: "claude-opus-5" },
      ]),
    ).toEqual({ kind: "current", profileId: "profile-1" });
  });

  it("ignores presentation-only Agent Profile fields", () => {
    expect(
      selectTeamMemberExecutionSourceStatus(sourced, [
        {
          id: "profile-1",
          provider: "claude",
          model: "claude-opus-5",
          name: "Reviewer",
          icon: "eye",
          color: "#fff",
          notes: "read only",
        },
      ]),
    ).toEqual({ kind: "current", profileId: "profile-1" });
  });

  it("reports update_available when the Agent Profile changed execution facts", () => {
    expect(
      selectTeamMemberExecutionSourceStatus(sourced, [
        { id: "profile-1", provider: "claude", model: "claude-sonnet-5" },
      ]),
    ).toEqual({ kind: "update_available", profileId: "profile-1" });
  });

  it("reports update_available when the Agent Profile no longer materializes", () => {
    expect(
      selectTeamMemberExecutionSourceStatus(sourced, [
        { id: "profile-1", provider: "claude", model: "" },
      ]),
    ).toEqual({ kind: "update_available", profileId: "profile-1" });
  });

  it("reports missing when the Agent Profile was deleted", () => {
    expect(
      selectTeamMemberExecutionSourceStatus(sourced, [{ id: "profile-2", provider: "claude" }]),
    ).toEqual({ kind: "missing", profileId: "profile-1" });
  });

  it("reports ambiguous without picking a duplicate by position", () => {
    expect(
      selectTeamMemberExecutionSourceStatus(sourced, [
        { id: "profile-1", provider: "claude", model: "claude-opus-5" },
        { id: "profile-1", provider: "codex", model: "gpt-5.4" },
      ]),
    ).toEqual({ kind: "ambiguous", profileId: "profile-1" });
  });
});
