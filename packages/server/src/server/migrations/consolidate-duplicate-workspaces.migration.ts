// COMPAT(duplicateWorkspaceConsolidation): one-time data repair, delete after 2027-01-14
// once all supported releases include create-agent workspace reuse.
import { resolve } from "node:path";

import type { Logger } from "pino";

import type { AgentStorage } from "../agent/agent-storage.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../workspace-registry.js";

function chooseCanonicalWorkspace(
  workspaces: PersistedWorkspaceRecord[],
): PersistedWorkspaceRecord {
  return [...workspaces].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.workspaceId.localeCompare(right.workspaceId),
  )[0];
}

/**
 * Collapses active workspace records that identify the same directory. A previous
 * create-agent path minted a new workspace for every agent, so Agent ownership
 * must move before the duplicate records are archived.
 */
export async function consolidateDuplicateWorkspaces(options: {
  agentStorage: AgentStorage;
  workspaceRegistry: WorkspaceRegistry;
  logger: Logger;
}): Promise<{ archivedWorkspaces: number; reassignedAgents: number }> {
  const workspaces = await options.workspaceRegistry.list();
  const workspacesByDirectory = new Map<string, PersistedWorkspaceRecord[]>();

  for (const workspace of workspaces) {
    if (workspace.archivedAt) {
      continue;
    }
    const directory = resolve(workspace.cwd);
    const group = workspacesByDirectory.get(directory) ?? [];
    group.push(workspace);
    workspacesByDirectory.set(directory, group);
  }

  const replacements = new Map<string, string>();
  for (const group of workspacesByDirectory.values()) {
    if (group.length < 2) {
      continue;
    }
    const canonical = chooseCanonicalWorkspace(group);
    for (const workspace of group) {
      if (workspace.workspaceId !== canonical.workspaceId) {
        replacements.set(workspace.workspaceId, canonical.workspaceId);
      }
    }
  }

  if (replacements.size === 0) {
    return { archivedWorkspaces: 0, reassignedAgents: 0 };
  }

  let reassignedAgents = 0;
  for (const agent of await options.agentStorage.list()) {
    const workspaceId = agent.workspaceId ? replacements.get(agent.workspaceId) : undefined;
    if (!workspaceId) {
      continue;
    }
    await options.agentStorage.upsert({ ...agent, workspaceId });
    reassignedAgents += 1;
  }

  const archivedAt = new Date().toISOString();
  for (const workspaceId of replacements.keys()) {
    await options.workspaceRegistry.archive(workspaceId, archivedAt);
  }

  options.logger.info(
    { archivedWorkspaces: replacements.size, reassignedAgents },
    "Consolidated duplicate workspace records",
  );
  return { archivedWorkspaces: replacements.size, reassignedAgents };
}
