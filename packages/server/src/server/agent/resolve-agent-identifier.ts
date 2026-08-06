import type { ManagedAgent } from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";

export type ResolveAgentIdentifierResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

export interface ResolveAgentIdentifierInput {
  identifier: string;
  storedAgents: StoredAgentRecord[];
  liveAgents: ManagedAgent[];
}

function summarizeAmbiguity(ids: string[]): string {
  const shown = ids.slice(0, 5).map((id) => id.slice(0, 8));
  return `${shown.join(", ")}${ids.length > 5 ? ", …" : ""}`;
}

/**
 * Turns whatever a human or an agent typed into an agent id: a full id, a
 * unique id prefix, or an exact title. Ambiguity is an error rather than a
 * guess — picking one of several matching agents silently sends work to the
 * wrong one.
 *
 * Internal agents are invisible here: they are Paseo's own machinery, not
 * something a caller can name.
 */
export function resolveAgentIdentifier(
  input: ResolveAgentIdentifierInput,
): ResolveAgentIdentifierResult {
  const trimmed = input.identifier.trim();
  if (!trimmed) {
    return { ok: false, error: "Agent identifier cannot be empty" };
  }

  const storedRecords = input.storedAgents.filter((record) => !record.internal);
  const knownIds = new Set<string>();
  for (const record of storedRecords) {
    knownIds.add(record.id);
  }
  for (const agent of input.liveAgents) {
    knownIds.add(agent.id);
  }

  if (knownIds.has(trimmed)) {
    return { ok: true, agentId: trimmed };
  }

  const prefixMatches = Array.from(knownIds).filter((id) => id.startsWith(trimmed));
  if (prefixMatches.length === 1) {
    return { ok: true, agentId: prefixMatches[0] };
  }
  if (prefixMatches.length > 1) {
    return {
      ok: false,
      error: `Agent identifier "${trimmed}" is ambiguous (${summarizeAmbiguity(prefixMatches)})`,
    };
  }

  const titleMatches = storedRecords.filter((record) => record.title === trimmed);
  if (titleMatches.length === 1) {
    return { ok: true, agentId: titleMatches[0].id };
  }
  if (titleMatches.length > 1) {
    return {
      ok: false,
      error: `Agent title "${trimmed}" is ambiguous (${summarizeAmbiguity(
        titleMatches.map((record) => record.id),
      )})`,
    };
  }

  return { ok: false, error: `Agent not found: ${trimmed}` };
}
