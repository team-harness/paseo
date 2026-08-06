import type { TurnLookup } from "./team-pump.js";

/** The three facts the rule needs, without the runtime they come from. */
export interface TurnFactSource {
  /**
   * Resolves once this agent's in-flight turn-state writes have landed, and
   * rejects if one of them did not.
   */
  whenTurnStateSettled(agentId: string): Promise<void>;
  getTurnOutcome(
    agentId: string,
    turnId: string,
  ): Promise<{ turnId: string; outcome: "completed" | "failed" | "canceled" } | null>;
  getActiveTurnId(agentId: string): Promise<string | null>;
}

/**
 * The three-state rule: settled, still running, or over with no answer.
 *
 * The barrier comes first and is not optional. A turn accepted a moment ago
 * whose marker has not reached disk yet reads exactly like a turn that died
 * with its daemon — no outcome, no active marker — and settling on that would
 * tell the lead its member failed while the member is working. A barrier that
 * rejects means the record still cannot be trusted, so the assignment is left
 * where it is for the next pass rather than settled on what is readable now.
 */
export async function lookUpTurnOutcome(
  source: TurnFactSource,
  input: { agentId: string; turnId: string },
): Promise<TurnLookup> {
  try {
    await source.whenTurnStateSettled(input.agentId);
  } catch {
    return { kind: "running" };
  }

  const outcome = await source.getTurnOutcome(input.agentId, input.turnId);
  if (outcome) return { kind: "settled", outcome: outcome.outcome };

  const activeTurnId = await source.getActiveTurnId(input.agentId);
  if (activeTurnId === input.turnId) return { kind: "running" };
  return { kind: "unknown" };
}
