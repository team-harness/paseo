import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react-native";
import invariant from "tiny-invariant";

import { TeamPanel } from "@/components/teams/team-panel";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { describeTeamPanel } from "@/teams/team-panel-descriptor";

function useTeamPanelDescriptor(
  target: { kind: "team"; teamId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const team = useSessionStore(
    (state) =>
      state.sessions[context.serverId]?.teamMissionsReplica.profiles.get(target.teamId) ?? null,
  );
  const mission = useSessionStore((state) => {
    const replica = state.sessions[context.serverId]?.teamMissionsReplica;
    const missionId = replica?.profiles.get(target.teamId)?.activeMissionId;
    return missionId ? (replica?.missions.get(missionId) ?? null) : null;
  });
  const description = describeTeamPanel(team, mission, target.teamId);
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
  const { serverId, target, openTab } = usePaneContext();
  invariant(target.kind === "team", "TeamPanel requires team target");
  // A member's conversation is an ordinary agent tab. The panel knows who was
  // pressed; only the pane knows where a tab goes.
  const openAgent = useCallback(
    (agentId: string) => openTab({ kind: "agent", agentId }),
    [openTab],
  );
  return <TeamPanel serverId={serverId} teamId={target.teamId} onOpenAgent={openAgent} />;
}

export const teamPanelRegistration: PanelRegistration<"team"> = {
  kind: "team",
  component: TeamPanelHost,
  useDescriptor: useTeamPanelDescriptor,
};
