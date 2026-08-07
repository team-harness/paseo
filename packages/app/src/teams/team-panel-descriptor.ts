import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { selectTeamStage, type TeamActivity } from "@/runtime/team-sync/selectors";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface TeamPanelDescription {
  label: string | null;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

/**
 * What a team's tab says about itself.
 *
 * `label` is null until the team arrives; the caller supplies the placeholder,
 * because only it knows the user's language. The tab is `loading` until then
 * rather than showing a generic name it will immediately replace — a tab that
 * renames itself twice on open reads as two tabs.
 */
export function describeTeamPanel(
  team: TeamSnapshot | null,
  activity: TeamActivity,
  teamId: string,
): TeamPanelDescription {
  if (!team) {
    return { label: null, subtitle: teamId, titleState: "loading", statusBucket: null };
  }

  return {
    label: team.name,
    subtitle: teamId,
    titleState: "ready",
    statusBucket: bucketOf(team, activity),
  };
}

function bucketOf(team: TeamSnapshot, activity: TeamActivity): SidebarStateBucket | null {
  if (team.lifecycle === "failed") return "failed";
  // Teardown outranks what the members happen to be doing. A spinner on a team
  // that is ending describes the agents and not the team.
  const stage = selectTeamStage(team);
  if (stage === "archiving" || stage === "ended") return "done";
  if (activity === "needs_input") return "needs_input";
  if (activity === "running") return "running";
  return null;
}
