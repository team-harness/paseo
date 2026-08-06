import { describe, expect, test } from "vitest";
import {
  getParentAgentIdFromLabels,
  getTeamIdFromLabels,
  getTeamRoleFromLabels,
  isDelegatedAgent,
  PARENT_AGENT_ID_LABEL,
  TEAM_ID_LABEL,
  TEAM_ROLE_LABEL,
} from "./agent-labels.js";

describe("agent label policy", () => {
  test("treats a non-empty parent agent label as delegation", () => {
    const labels = { [PARENT_AGENT_ID_LABEL]: " parent-agent \n" };

    expect(getParentAgentIdFromLabels(labels)).toBe("parent-agent");
    expect(isDelegatedAgent({ labels })).toBe(true);
  });

  test("ignores missing, empty, and non-string parent agent labels", () => {
    expect(isDelegatedAgent({ labels: {} })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } })).toBe(false);
  });
});

describe("team labels", () => {
  test("uses the paseo namespace so team membership reads like delegation", () => {
    expect(TEAM_ID_LABEL).toBe("paseo.team-id");
    expect(TEAM_ROLE_LABEL).toBe("paseo.team-role");
  });

  test("reads a trimmed team id and role", () => {
    const labels = { [TEAM_ID_LABEL]: " team-1 \n", [TEAM_ROLE_LABEL]: " reviewer " };

    expect(getTeamIdFromLabels(labels)).toBe("team-1");
    expect(getTeamRoleFromLabels(labels)).toBe("reviewer");
  });

  test("ignores missing, empty, and non-string team labels", () => {
    expect(getTeamIdFromLabels({})).toBeNull();
    expect(getTeamIdFromLabels({ [TEAM_ID_LABEL]: "   " })).toBeNull();
    expect(getTeamIdFromLabels({ [TEAM_ID_LABEL]: 42 })).toBeNull();
    expect(getTeamRoleFromLabels({})).toBeNull();
    expect(getTeamRoleFromLabels({ [TEAM_ROLE_LABEL]: "" })).toBeNull();
    expect(getTeamRoleFromLabels(null)).toBeNull();
  });

  test("keeps team membership independent of the delegation tree", () => {
    // DEC-6: a recruited member's parent is whoever created it, not the lead.
    const labels = { [TEAM_ID_LABEL]: "team-1", [PARENT_AGENT_ID_LABEL]: "agent-recruiter" };

    expect(getTeamIdFromLabels(labels)).toBe("team-1");
    expect(getParentAgentIdFromLabels(labels)).toBe("agent-recruiter");
  });
});
