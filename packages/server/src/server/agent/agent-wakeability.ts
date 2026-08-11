import type { StoredAgentRecord } from "./agent-storage.js";

/**
 * DEC-10's wakeable states, listed rather than derived from "not running".
 * `initializing` is busy too — AgentManager counts it as such — and an agent
 * woken there either races its own first turn or is refused outright.
 */
const WAKEABLE_LIVE_LIFECYCLES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);
const WAKEABLE_STORED_STATUSES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);

/**
 * Whether a prompt sent to this agent would be accepted rather than dropped or
 * made to interrupt a turn.
 *
 * Live state decides when there is any. Otherwise the record does, on
 * `lastStatus` — with one rescue: a record left saying `running` by a daemon
 * that died mid-turn would otherwise be unreachable forever, so a `running`
 * with no active-turn marker is treated as the crash it is. The marker is
 * stamped with the run that opened it and cleared at startup, which is what
 * makes its absence mean that here.
 *
 * The marker is not asked the other way round. It survives paths that end an
 * agent without settling its turn — closing one mid-turn leaves it behind —
 * so a present marker does not prove a turn is in flight.
 */
export function isAgentWakeable(input: {
  live: { lifecycle: string } | null | undefined;
  record: Pick<StoredAgentRecord, "archivedAt" | "activeTurn" | "lastStatus"> | null | undefined;
}): boolean {
  if (input.record?.archivedAt) return false;
  if (input.live) return WAKEABLE_LIVE_LIFECYCLES.has(input.live.lifecycle);
  // No record at all: nothing says it is busy, and the caller's own eligibility
  // rules decide whether it should be addressed.
  if (!input.record) return true;
  if (WAKEABLE_STORED_STATUSES.has(input.record.lastStatus)) return true;
  return input.record.lastStatus === "running" && !input.record.activeTurn;
}
