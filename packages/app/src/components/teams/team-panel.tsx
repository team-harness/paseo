import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";

import { useAgentProfiles } from "@/agent-profiles/internal/use-agent-profiles";
import { MissionStartSheet } from "@/components/teams/mission-start-sheet";
import { MissionWorkroom } from "@/components/teams/mission-workroom";
import { TeamIdleOverview } from "@/components/teams/team-idle-overview";
import { TeamProfileFormSheet } from "@/components/teams/team-profile-form-sheet";
import { TeamSettingsSheet, type TeamSettingsPage } from "@/components/teams/team-settings-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { createTeamMissionsReplica } from "@/runtime/team-missions-sync/replica";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { selectMissionWorkroomView } from "@/teams/mission-workroom-view";
import { selectTeamPanelView } from "@/teams/team-panel-view";
import type { Theme } from "@/styles/theme";

const EMPTY_AGENTS: ReadonlyMap<string, Agent> = new Map();
const EMPTY_REPLICA = createTeamMissionsReplica();
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function profileEditAction(supported: boolean, open: () => void): (() => void) | undefined {
  return supported ? open : undefined;
}

export interface TeamPanelProps {
  serverId: string;
  workspaceId: string | null;
  teamId: string;
  selectedMissionId?: string | null;
  initialSettingsOpen?: boolean;
  onOpenAgent?: (agentId: string) => void;
}

/** A Team tab is the selected Mission room; profile and plan controls live in settings. */
export function TeamPanel({
  serverId,
  workspaceId,
  teamId,
  selectedMissionId = null,
  initialSettingsOpen = false,
  onOpenAgent,
}: TeamPanelProps): ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [settingsPage, setSettingsPage] = useState<TeamSettingsPage>("root");
  const [missionStartOpen, setMissionStartOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [localMissionId, setLocalMissionId] = useState<string | null>(selectedMissionId);
  const replica = useSessionStore(
    (state) => state.sessions[serverId]?.teamMissionsReplica ?? EMPTY_REPLICA,
  );
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents ?? EMPTY_AGENTS);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const profileUpgradesSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.teamProfileUpgrades === true,
  );
  const { profiles: agentProfiles } = useAgentProfiles(serverId);
  const view = useMemo(
    () => selectTeamPanelView(replica, teamId, agents, localMissionId),
    [agents, localMissionId, replica, teamId],
  );
  const workroomView = useMemo(() => {
    if (view.state !== "ready" || !view.team || !view.mission) return null;
    const workspace = workspaces?.get(view.mission.workspaceId);
    return selectMissionWorkroomView({
      team: view.team,
      mission: view.mission,
      workspaceLabel:
        workspace?.title?.trim() ||
        workspace?.name ||
        workspace?.workspaceDirectory ||
        view.mission.workspaceId,
      agentProfiles: agentProfiles ?? [],
      runtimeMembers: view.members,
    });
  }, [agentProfiles, view, workspaces]);
  const retry = useCallback(() => {
    void getHostRuntimeStore().refreshTeamMissions(serverId);
  }, [serverId]);
  const openSettings = useCallback(() => {
    setSettingsPage("root");
    setSettingsOpen(true);
  }, []);
  const openAttention = useCallback(() => {
    setSettingsPage("attention");
    setSettingsOpen(true);
  }, []);
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
  const editProfile = profileEditAction(profileUpgradesSupported, openProfileEdit);
  const selectMission = useCallback((missionId: string) => {
    setLocalMissionId(missionId);
    setSettingsOpen(false);
  }, []);
  const retryHistory = useCallback(() => {
    void getHostRuntimeStore().readTeamMissionHistory(serverId, teamId);
  }, [serverId, teamId]);
  const exitReplay = useCallback(() => setLocalMissionId(null), []);

  useEffect(() => {
    setLocalMissionId(selectedMissionId);
  }, [selectedMissionId, teamId]);

  useEffect(() => {
    if (
      view.state !== "ready" ||
      !view.team ||
      view.mission ||
      localMissionId ||
      view.historyStatus !== "idle"
    ) {
      return;
    }
    void getHostRuntimeStore().readTeamMissionHistory(serverId, teamId);
  }, [localMissionId, serverId, teamId, view]);

  if (view.state !== "ready" || !view.team) {
    return (
      <TeamPanelBoundary
        state={view.state}
        error={replica.error}
        serverId={serverId}
        onRetry={retry}
      />
    );
  }

  const creationWorkspace = workspaces?.get(view.team.creationWorkspaceId);
  const canStartMission = workspaceId !== null && view.canStartMission;
  return (
    <View style={styles.body} testID="team-panel">
      {view.mission && workroomView ? (
        <MissionWorkroom
          serverId={serverId}
          view={workroomView}
          roster={view.members}
          readOnly={view.readOnly}
          onOpenAgent={onOpenAgent}
          onOpenAttention={openAttention}
          onOpenSettings={openSettings}
          onStartMission={canStartMission ? openMissionStart : undefined}
          onExitReplay={localMissionId ? exitReplay : undefined}
          settingsAttentionCount={view.settingsAttentionCount}
        />
      ) : (
        <TeamIdleOverview
          team={view.team}
          history={view.history}
          historyStatus={view.historyStatus}
          historyError={view.historyError}
          canStartMission={canStartMission}
          workspaceAvailable={workspaceId !== null}
          onStartMission={canStartMission ? openMissionStart : undefined}
          onOpenSettings={openSettings}
          onSelectMission={selectMission}
          onRetryHistory={retryHistory}
        />
      )}
      <TeamSettingsSheet
        serverId={serverId}
        team={view.team}
        mission={view.mission}
        visible={settingsOpen}
        initialPage={settingsPage}
        onClose={closeSettings}
        onEditProfile={editProfile}
        onStartMission={canStartMission ? openMissionStart : undefined}
        onOpenAgent={onOpenAgent}
        onSelectMission={selectMission}
      />
      {workspaceId ? (
        <MissionStartSheet
          serverId={serverId}
          workspaceId={workspaceId}
          selectedTeamId={view.team.id}
          visible={missionStartOpen}
          onClose={closeMissionStart}
          onStarted={missionStarted}
        />
      ) : null}
      <TeamProfileFormSheet
        serverId={serverId}
        workspaceId={view.team.creationWorkspaceId}
        cwd={creationWorkspace?.workspaceDirectory}
        profile={view.team}
        agentProfiles={agentProfiles ?? []}
        visible={profileEditOpen && profileUpgradesSupported}
        onClose={closeProfileEdit}
        onSaved={closeProfileEdit}
      />
    </View>
  );
}

function TeamPanelBoundary({
  state,
  error,
  serverId,
  onRetry,
}: {
  state: ReturnType<typeof selectTeamPanelView>["state"];
  error: string | null;
  serverId: string;
  onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  if (state === "checking_host" || state === "connecting" || state === "loading") {
    return (
      <View style={styles.notice} testID="team-panel-loading">
        <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
      </View>
    );
  }
  if (state === "update_host") {
    return (
      <View style={styles.notice}>
        <Text style={styles.muted} testID="team-panel-update-host">
          {t("teams.route.unsupported", { hostName: serverId })}
        </Text>
      </View>
    );
  }
  if (state === "failed") {
    return (
      <View style={styles.notice}>
        <Text style={styles.error} testID="team-panel-error">
          {error ?? t("teams.list.unreadable")}
        </Text>
        <Button
          size="sm"
          variant="outline"
          leftIcon={RotateCw}
          onPress={onRetry}
          testID="team-panel-retry"
        >
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.notice}>
      <Text style={styles.muted} testID="team-panel-missing">
        {t("teams.panel.missing")}
      </Text>
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
