import type { StoredAgentRecord } from "./agent-storage.js";

/**
 * DEC-10's wakeable states, listed rather than derived from "not running".
 * `initializing` is busy too — AgentManager counts it as such — and an agent
 * woken there either races its own first turn or is refused outright.
 */
const WAKEABLE_LIVE_LIFECYCLES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);

/**
 * Whether a prompt sent to this agent would be accepted rather than dropped or
 * made to interrupt a turn.
 *
 * Live state decides when there is any. Otherwise the record does, and what it
 * is asked is whether a turn is in flight — not what `lastStatus` says. That
 * field is display text and survives a crash: an agent whose daemon died
 * mid-turn keeps `lastStatus: "running"` forever, and reading it would leave
 * that agent unreachable until something happened to load it. `activeTurn` is
 * stamped with the daemon run that opened it and cleared at startup, so its
 * absence means what this needs to know.
 */
export function isAgentWakeable(input: {
  live: { lifecycle: string } | null | undefined;
  record: Pick<StoredAgentRecord, "archivedAt" | "activeTurn"> | null | undefined;
}): boolean {
  if (input.record?.archivedAt) return false;
  if (input.live) return WAKEABLE_LIVE_LIFECYCLES.has(input.live.lifecycle);
  // No record and no live agent: nothing says it is busy, and the caller's own
  // eligibility rules decide whether it should be addressed at all.
  return !input.record?.activeTurn;
}
