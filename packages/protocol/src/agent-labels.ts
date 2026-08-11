export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

/**
 * Team membership is an index, not the source of truth — the roster inside the
 * team record is. These labels let a client classify an agent straight from an
 * `agent_update` snapshot, and let `create_agent` inherit the caller's team.
 * They say nothing about the delegation tree, which `PARENT_AGENT_ID_LABEL`
 * still owns on its own.
 */
export const TEAM_ID_LABEL = "paseo.team-id";
export const TEAM_ROLE_LABEL = "paseo.team-role";

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

function readLabel(labels: Record<string, unknown> | null | undefined, key: string) {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, PARENT_AGENT_ID_LABEL);
}

export function getTeamIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, TEAM_ID_LABEL);
}

export function getTeamRoleFromLabels(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, TEAM_ROLE_LABEL);
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}
