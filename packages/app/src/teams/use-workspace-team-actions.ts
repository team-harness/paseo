import { useCallback, useMemo, useState } from "react";
import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorkspaceTeamActions {
  supported: boolean;
  cwd: string;
  profiles: TeamV2[];
  newTeam: {
    visible: boolean;
    open: () => void;
    close: () => void;
  };
  startMission: {
    visible: boolean;
    selectedTeamId: string | null;
    open: (teamId?: string) => void;
    close: () => void;
  };
  onTeamCreated: (teamId: string) => void;
  onMissionStarted: (teamId: string) => void;
}

/** Owns the two workspace-level Team Mission entry points and their focused Team tab result. */
export function useWorkspaceTeamActions(input: {
  serverId: string;
  workspaceId: string;
  persistenceKey: string | null;
  workspaceDirectory: string | null | undefined;
  routeFocused: boolean;
  openWorkspaceTabFocused: (workspaceKey: string, target: WorkspaceTabTarget) => string | null;
}): WorkspaceTeamActions {
  const supported = useHostFeature(input.serverId, "teamMissions");
  const profileMap = useSessionStore(
    (state) => state.sessions[input.serverId]?.teamMissionsReplica.profiles,
  );
  const profiles = useMemo(
    () =>
      supported
        ? [...(profileMap?.values() ?? [])].filter(
            (profile) =>
              profile.workspaceId === input.workspaceId && profile.lifecycle !== "archived",
          )
        : [],
    [input.workspaceId, profileMap, supported],
  );
  const [newTeamVisible, setNewTeamVisible] = useState(false);
  const [missionTarget, setMissionTarget] = useState<{
    visible: boolean;
    teamId: string | null;
  }>({ visible: false, teamId: null });

  const openNewTeam = useCallback(() => {
    setMissionTarget({ visible: false, teamId: null });
    setNewTeamVisible(true);
  }, []);
  const closeNewTeam = useCallback(() => setNewTeamVisible(false), []);
  const openMission = useCallback((teamId?: string) => {
    setNewTeamVisible(false);
    setMissionTarget({ visible: true, teamId: teamId ?? null });
  }, []);
  const closeMission = useCallback(() => setMissionTarget({ visible: false, teamId: null }), []);

  const { persistenceKey, openWorkspaceTabFocused } = input;
  const focusTeam = useCallback(
    (teamId: string) => {
      if (!persistenceKey) return;
      openWorkspaceTabFocused(persistenceKey, { kind: "team", teamId });
    },
    [openWorkspaceTabFocused, persistenceKey],
  );
  const onTeamCreated = useCallback(
    (teamId: string) => {
      setNewTeamVisible(false);
      focusTeam(teamId);
    },
    [focusTeam],
  );
  const onMissionStarted = useCallback(
    (teamId: string) => {
      setMissionTarget({ visible: false, teamId: null });
      focusTeam(teamId);
    },
    [focusTeam],
  );

  return {
    supported,
    cwd: input.workspaceDirectory ?? "",
    profiles,
    newTeam: {
      visible: supported && newTeamVisible && input.routeFocused,
      open: openNewTeam,
      close: closeNewTeam,
    },
    startMission: {
      visible: supported && missionTarget.visible && input.routeFocused,
      selectedTeamId: missionTarget.teamId,
      open: openMission,
      close: closeMission,
    },
    onTeamCreated,
    onMissionStarted,
  };
}
