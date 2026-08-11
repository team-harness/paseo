import { getTeamIdFromLabels } from "@getpaseo/protocol/agent-labels";

import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

/**
 * Closing a known root Agent tab normally archives the Agent. Delegated Agents
 * and Team participants have a lifecycle owner outside the tab strip, so their
 * tabs are layout only. A missing record is also layout-only because restored
 * tabs can be closed before the Agent directory finishes hydrating.
 */
export function resolveCloseAgentTabPolicy(
  agent: Pick<Agent, "parentAgentId" | "labels"> | null | undefined,
): CloseAgentTabPolicy {
  if (!agent || agent.parentAgentId || getTeamIdFromLabels(agent.labels) !== null) {
    return { kind: "layout-only" };
  }
  return { kind: "archive-on-close" };
}

export function closesWithoutArchiving(policy: CloseAgentTabPolicy): boolean {
  return policy.kind === "layout-only";
}
