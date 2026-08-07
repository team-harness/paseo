import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

/** What a team action is doing right now. Rendered, not inferred. */
export type TeamActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failure"; message: string };

export interface TeamActionGateway {
  archiveTeam(input: {
    teamId: string;
  }): Promise<{ team: TeamSnapshot | null; error: string | null }>;
  removeTeamMember(input: {
    teamId: string;
    agentId: string;
  }): Promise<{ team: TeamSnapshot | null; error: string | null }>;
}

export type TeamActionKey = { kind: "archive" } | { kind: "remove"; agentId: string };

/**
 * What to say when the daemon refuses without saying why.
 *
 * Injected rather than written here: this module has no language, and a
 * hard-coded English sentence reaches a Japanese user's screen unchanged.
 */
export interface TeamActionLabels {
  archiveRefused: string;
  removeRefused: string;
}

export function teamActionKeyOf(action: TeamActionKey): string {
  return action.kind === "archive" ? "archive" : `remove:${action.agentId}`;
}

/**
 * Runs one team action and reports what happened.
 *
 * Success is not a state this holds: the team snapshot the daemon answers with
 * is broadcast to every client anyway, so the panel learns the outcome from the
 * store. Keeping a local "done" beside that is how the two come to disagree —
 * a stale success badge over a roster that has already moved on.
 */
export async function runTeamAction(
  action: TeamActionKey,
  teamId: string,
  gateway: TeamActionGateway,
  labels: TeamActionLabels,
  onState: (state: TeamActionState) => void,
): Promise<void> {
  onState({ status: "pending" });
  try {
    const payload =
      action.kind === "archive"
        ? await gateway.archiveTeam({ teamId })
        : await gateway.removeTeamMember({ teamId, agentId: action.agentId });

    if (!payload.team) {
      onState({ status: "failure", message: payload.error ?? describeRefusal(action, labels) });
      return;
    }
    onState({ status: "idle" });
  } catch (error) {
    onState({
      status: "failure",
      message: error instanceof Error ? error.message : describeRefusal(action, labels),
    });
  }
}

function describeRefusal(action: TeamActionKey, labels: TeamActionLabels): string {
  return action.kind === "archive" ? labels.archiveRefused : labels.removeRefused;
}
