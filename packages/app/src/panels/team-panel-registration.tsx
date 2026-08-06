import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react-native";
import invariant from "tiny-invariant";

import { TeamPanel } from "@/components/teams/team-panel";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { selectTeamActivity, selectTeamRoster } from "@/runtime/team-sync/selectors";
import { useSessionStore } from "@/stores/session-store";
import { describeTeamPanel } from "@/teams/team-panel-descriptor";
import { useTeam } from "@/teams/use-teams";

function useTeamPanelDescriptor(
  target: { kind: "team"; teamId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const team = useTeam(context.serverId, target.teamId);
  const agents = useSessionStore((state) => state.sessions[context.serverId]?.agents);
  const activity = useMemo(
    () => (team ? selectTeamActivity(selectTeamRoster(team, agents ?? new Map())) : "idle"),
    [team, agents],
  );
  const description = describeTeamPanel(team, activity, target.teamId);
  const label = description.label ?? t("workspace.tabs.fallback.team");

  return {
    label,
    subtitle: description.subtitle,
    tooltip: label,
    titleState: description.titleState,
    icon: Users,
    statusBucket: description.statusBucket,
  };
}

function TeamPanelHost() {
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "team", "TeamPanel requires team target");
  return <TeamPanel serverId={serverId} teamId={target.teamId} />;
}

export const teamPanelRegistration: PanelRegistration<"team"> = {
  kind: "team",
  component: TeamPanelHost,
  useDescriptor: useTeamPanelDescriptor,
};
