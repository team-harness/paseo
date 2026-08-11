import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface TeamPanelDescription {
  label: string | null;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

/** The stable tab description for one Team profile and its selected Mission. */
export function describeTeamPanel(
  team: TeamV2 | null,
  mission: TeamMission | null,
  teamId: string,
): TeamPanelDescription {
  if (!team) {
    return { label: null, subtitle: teamId, titleState: "loading", statusBucket: null };
  }

  return {
    label: team.name,
    subtitle: mission?.objective ?? teamId,
    titleState: "ready",
    statusBucket: bucketOf(team, mission),
  };
}

function bucketOf(team: TeamV2, mission: TeamMission | null): SidebarStateBucket | null {
  if (team.lifecycle === "archived") return "done";
  if (!mission) return null;
  switch (mission.status) {
    case "needs_attention":
      return "needs_input";
    case "planning":
    case "active":
    case "verifying":
      return "running";
    case "failed":
      return "failed";
    case "completed":
    case "canceled":
      return "done";
  }
}
