import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";

import { MissionStartSheet } from "@/components/teams/mission-start-sheet";
import { TeamProfileFormSheet } from "@/components/teams/team-profile-form-sheet";
import { TeamRoom } from "@/components/teams/team-room";
import { TeamSettingsSheet } from "@/components/teams/team-settings-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { createTeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { selectTeamPanelView } from "@/teams/team-panel-view";
import type { Theme } from "@/styles/theme";

const EMPTY_AGENTS: ReadonlyMap<string, Agent> = new Map();
const EMPTY_REPLICA = createTeamMissionsReplica();
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TeamPanelProps {
  serverId: string;
  teamId: string;
  selectedMissionId?: string | null;
  onOpenAgent?: (agentId: string) => void;
}

/** A Team tab is the selected Mission room; profile and plan controls live in settings. */
export function TeamPanel({
  serverId,
  teamId,
  selectedMissionId = null,
  onOpenAgent,
}: TeamPanelProps): ReactElement {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [missionStartOpen, setMissionStartOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [localMissionId, setLocalMissionId] = useState<string | null>(selectedMissionId);
  const replica = useSessionStore(
    (state) => state.sessions[serverId]?.teamMissionsReplica ?? EMPTY_REPLICA,
  );
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents ?? EMPTY_AGENTS);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const view = useMemo(
    () => selectTeamPanelView(replica, teamId, agents, localMissionId),
    [agents, localMissionId, replica, teamId],
  );
  const retry = useCallback(() => {
    void getHostRuntimeStore().refreshTeamMissions(serverId);
  }, [serverId]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openMissionStart = useCallback(() => {
    setSettingsOpen(false);
    setMissionStartOpen(true);
  }, []);
  const closeMissionStart = useCallback(() => setMissionStartOpen(false), []);
  const missionStarted = useCallback(() => {
    setLocalMissionId(null);
    setMissionStartOpen(false);
  }, []);
  const openProfileEdit = useCallback(() => {
    setSettingsOpen(false);
    setProfileEditOpen(true);
  }, []);
  const closeProfileEdit = useCallback(() => setProfileEditOpen(false), []);
  const selectMission = useCallback((missionId: string) => {
    setLocalMissionId(missionId);
    setSettingsOpen(false);
  }, []);

  if (view.state === "checking_host" || view.state === "connecting" || view.state === "loading") {
    return (
      <View style={styles.notice} testID="team-panel-loading">
        <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
      </View>
    );
  }

  if (view.state === "update_host") {
    return (
      <View style={styles.notice}>
        <Text style={styles.muted} testID="team-panel-update-host">
          {t("teams.route.unsupported", { hostName: serverId })}
        </Text>
      </View>
    );
  }

  if (view.state === "failed") {
    return (
      <View style={styles.notice}>
        <Text style={styles.error} testID="team-panel-error">
          {replica.error ?? t("teams.list.unreadable")}
        </Text>
        <Button
          size="sm"
          variant="outline"
          leftIcon={RotateCw}
          onPress={retry}
          testID="team-panel-retry"
        >
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }

  if (view.state === "missing" || !view.team) {
    return (
      <View style={styles.notice}>
        <Text style={styles.muted} testID="team-panel-missing">
          {t("teams.panel.missing")}
        </Text>
      </View>
    );
  }

  const workspace = workspaces?.get(view.team.workspaceId);
  return (
    <View style={styles.body} testID="team-panel">
      <TeamRoom
        serverId={serverId}
        missionId={view.mission?.id ?? null}
        roster={view.members}
        readOnly={view.readOnly}
        onOpenAgent={onOpenAgent}
        onOpenSettings={openSettings}
        onStartMission={view.canStartMission ? openMissionStart : undefined}
        settingsAttentionCount={view.settingsAttentionCount}
      />
      <TeamSettingsSheet
        serverId={serverId}
        team={view.team}
        mission={view.mission}
        visible={settingsOpen}
        onClose={closeSettings}
        onEditProfile={workspace ? openProfileEdit : undefined}
        onStartMission={view.canStartMission ? openMissionStart : undefined}
        onOpenAgent={onOpenAgent}
        onSelectMission={selectMission}
      />
      <MissionStartSheet
        serverId={serverId}
        workspaceId={view.team.workspaceId}
        selectedTeamId={view.team.id}
        visible={missionStartOpen}
        onClose={closeMissionStart}
        onStarted={missionStarted}
      />
      {workspace ? (
        <TeamProfileFormSheet
          serverId={serverId}
          workspaceId={view.team.workspaceId}
          cwd={workspace.workspaceDirectory}
          profile={view.team}
          visible={profileEditOpen}
          onClose={closeProfileEdit}
          onSaved={closeProfileEdit}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    flex: 1,
  },
  notice: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
