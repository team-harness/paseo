import { TEAM_ERROR_CODES } from "@getpaseo/protocol/team/rpc-schemas";
import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { TeamFormModel } from "./team-form-model";

export interface TeamCreateGateway {
  createTeam(input: {
    idempotencyKey: string;
    name: string;
    workspaceId: string;
    task: string;
    lead: { role: string; provider: string };
    members: Array<{ role: string; provider: string; briefing?: string }>;
    templateId?: string;
  }): Promise<{ team: TeamSnapshot | null; error: string | null; errorCode?: string | null }>;
}

/** The role the daemon gives a lead, whatever the request calls it. */
const LEAD_ROLE = "lead";

function toMemberSpec(member: { role: string; provider: string; briefing: string }) {
  const briefing = member.briefing.trim();
  // Omitted rather than sent empty: an empty briefing is not a briefing, and
  // the daemon would put it in the prompt as one.
  return briefing
    ? { role: member.role.trim(), provider: member.provider, briefing }
    : { role: member.role.trim(), provider: member.provider };
}

/**
 * What to say when the daemon refuses without saying why.
 *
 * Injected, like the team panel's: this module has no language, and an English
 * sentence written here reaches a Japanese user's screen unchanged.
 */
export interface TeamFormLabels {
  /** The key was already spent on different work. */
  keyReused: string;
  /** Anything else that went wrong with no message attached. */
  refused: string;
}

export function describeFailure(
  payload: { error: string | null; errorCode?: string | null },
  labels: TeamFormLabels,
): string {
  if (payload.errorCode === TEAM_ERROR_CODES.idempotencyConflict) {
    return labels.keyReused;
  }
  return payload.error ?? labels.refused;
}

/**
 * Runs one create attempt and drives the form through it.
 *
 * The only judgement here is whether the next attempt may reuse the key. A
 * refusal the daemon sent is a decision — it built nothing, and reusing the key
 * would keep asking about the attempt that failed. A throw is the other case:
 * nobody learned what happened, the daemon may already have built the team, and
 * the same key is what gets that one back instead of a second.
 */
export async function submitTeamForm(
  form: TeamFormModel,
  gateway: TeamCreateGateway,
  labels: TeamFormLabels,
): Promise<void> {
  const state = form.getState();
  if (!state.canSubmit) return;
  form.submitStarted();

  try {
    const payload = await gateway.createTeam({
      idempotencyKey: state.idempotencyKey,
      name: state.name.trim(),
      workspaceId: state.workspaceId,
      task: state.task.trim(),
      lead: { role: LEAD_ROLE, provider: state.leadProvider },
      members: state.members.map(toMemberSpec),
      // Carried through so the team records what it was built from; the wire
      // has had the field since ITEM-1.
      ...(state.templateId ? { templateId: state.templateId } : {}),
    });

    if (!payload.team) {
      form.submitFailed({ message: describeFailure(payload, labels), retryable: false });
      return;
    }
    // A team is only built when it says so. Retrying under the same key gets
    // back whatever that key already produced — including a team whose
    // creation failed — and reporting that as success hands the caller a dead
    // id and keeps the key pointing at it forever.
    if (payload.team.lifecycle !== "active" && payload.team.lifecycle !== "creating") {
      form.submitFailed({
        message: `The team could not be created (${payload.team.lifecycle}).`,
        retryable: false,
      });
      return;
    }
    form.submitSucceeded(payload.team.id);
  } catch (error) {
    form.submitFailed({
      message: error instanceof Error ? error.message : labels.refused,
      retryable: true,
    });
  }
}
