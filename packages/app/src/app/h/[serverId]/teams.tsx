import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { AlertCircle, ArrowLeft, FolderOpen, Plus, RotateCw } from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HostLevelTeamList } from "@/components/teams/host-level-team-list";
import { TeamProfileFormSheet } from "@/components/teams/team-profile-form-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { getHostRuntimeStore, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  resolveTeamHubConnectionStatus,
  resolveTeamHubCreateEnabled,
  resolveTeamHubState,
} from "@/teams/team-hub-state";
import { selectHostLevelTeamRows } from "@/teams/host-level-team-rows";
import { selectTeamHubWorkspace } from "@/teams/team-hub-workspace";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildHostTeamRoute } from "@/utils/host-routes";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export default function HostTeamsRoute() {
  const serverId = useHostRouteServerId();
  const routeServerId = serverId ?? "";
  const runtime = useHostRuntimeSnapshot(routeServerId);
  const session = useSessionStore((state) => state.sessions[routeServerId]);
  const rows = useMemo(
    () => (session ? selectHostLevelTeamRows(session.teamMissionsReplica) : []),
    [session],
  );
  const workspace = useMemo(
    () => (session ? selectTeamHubWorkspace(session.workspaces) : null),
    [session],
  );
  const state = resolveTeamHubState({
    connectionStatus: resolveTeamHubConnectionStatus(
      runtime?.connectionStatus,
      Boolean(session?.serverInfo),
    ),
    features: session?.serverInfo?.features ?? null,
    teamStatus: session?.teamMissionsReplica.status ?? "checking_host",
    catalogStatus: session?.methodologyCatalogReplica.status ?? "checking_host",
  });
  useEffect(() => {
    if (routeServerId) void getHostRuntimeStore().runProbeCycleNow(routeServerId);
  }, [routeServerId]);
  const retryHost = useCallback(
    () => void getHostRuntimeStore().runProbeCycleNow(routeServerId),
    [routeServerId],
  );
  const retryTeam = useCallback(
    () => void getHostRuntimeStore().refreshTeamMissions(routeServerId),
    [routeServerId],
  );
  const retryCatalog = useCallback(
    () => getHostRuntimeStore().refreshMethodologyCatalog(routeServerId),
    [routeServerId],
  );
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/h/${routeServerId}/open-project`);
  }, [routeServerId]);

  if (!serverId) return null;

  if (state.kind !== "supported") {
    return <UnavailableHub state={state.kind} onRetry={retryHost} onBack={back} />;
  }
  return (
    <SupportedHub
      serverId={serverId}
      rows={rows}
      teamFailed={state.teamFailed}
      catalogFailed={state.catalogFailed}
      teamError={session?.teamMissionsReplica.error ?? null}
      catalogError={session?.methodologyCatalogReplica.error ?? null}
      onRetryTeam={retryTeam}
      onRetryCatalog={retryCatalog}
      workspace={workspace}
    />
  );
}

function UnavailableHub({
  state,
  onRetry,
  onBack,
}: {
  state: "waitingForHost" | "loading" | "unsupported";
  onRetry: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  if (state === "waitingForHost") {
    return (
      <HubState
        testID="team-hub-waiting"
        title={t("teams.host.hub.waiting")}
        onRetry={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === "loading") {
    return (
      <HubState
        testID="team-hub-loading"
        title={t("teams.host.hub.loading")}
        loading
        onBack={onBack}
      />
    );
  }
  return (
    <HubState
      testID="team-hub-unsupported"
      title={t("teams.host.hub.unsupported")}
      onBack={onBack}
    />
  );
}

function SupportedHub({
  serverId,
  rows,
  teamFailed,
  catalogFailed,
  teamError,
  catalogError,
  onRetryTeam,
  onRetryCatalog,
  workspace,
}: {
  serverId: string;
  rows: ReturnType<typeof selectHostLevelTeamRows>;
  teamFailed: boolean;
  catalogFailed: boolean;
  teamError: string | null;
  catalogError: string | null;
  onRetryTeam: () => void;
  onRetryCatalog: () => void;
  workspace: ReturnType<typeof selectTeamHubWorkspace>;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const openAddProject = useOpenAddProject();
  const openWorkspace = useCallback(() => {
    if (workspace) navigateToWorkspace({ serverId, workspaceId: workspace.id });
  }, [serverId, workspace]);
  const openProject = useCallback(
    () => openAddProject(serverId, { kind: "host_teams", serverId }),
    [openAddProject, serverId],
  );
  const createEnabled = resolveTeamHubCreateEnabled({
    hasLiveWorkspace: Boolean(workspace),
    teamFailed,
    catalogFailed,
  });
  const openCreate = useCallback(() => {
    if (createEnabled) setCreating(true);
  }, [createEnabled]);
  const closeCreate = useCallback(() => setCreating(false), []);
  const teamSaved = useCallback(
    (teamId: string) => {
      setCreating(false);
      router.navigate(buildHostTeamRoute(serverId, teamId));
    },
    [serverId],
  );
  return (
    <View style={styles.page} testID="team-hub-supported">
      {teamFailed ? (
        <Failure message={teamError ?? t("teams.host.hub.teamFailure")} onRetry={onRetryTeam} />
      ) : (
        <HostLevelTeamList
          serverId={serverId}
          rows={rows}
          emptyDescription={t(
            workspace
              ? "teams.host.hub.emptyWithWorkspace"
              : "teams.host.hub.emptyWithoutWorkspace",
          )}
        />
      )}
      {catalogFailed ? (
        <Failure
          message={catalogError ?? t("teams.host.hub.methodologyFailure")}
          onRetry={onRetryCatalog}
        />
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.emptyActions} testID="team-hub-empty-actions">
          <Button size="sm" leftIcon={Plus} onPress={openCreate} disabled={!createEnabled}>
            {t("teams.host.hub.create")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={FolderOpen}
            onPress={workspace ? openWorkspace : openProject}
          >
            {workspace ? t("teams.host.hub.openWorkspace") : t("teams.host.hub.addProject")}
          </Button>
        </View>
      ) : null}
      {workspace ? (
        <TeamProfileFormSheet
          serverId={serverId}
          workspaceId={workspace.id}
          cwd={workspace.workspaceDirectory}
          visible={creating}
          onClose={closeCreate}
          onSaved={teamSaved}
        />
      ) : null}
    </View>
  );
}

function HubState({
  testID,
  title,
  loading,
  onRetry,
  onBack,
}: {
  testID: string;
  title: string;
  loading?: boolean;
  onRetry?: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.state} testID={testID}>
      {loading ? <ThemedLoadingSpinner size="small" uniProps={spinnerColor} /> : null}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.actions}>
        {onRetry ? (
          <Button size="sm" leftIcon={RotateCw} onPress={onRetry}>
            {t("common.actions.retry")}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" leftIcon={ArrowLeft} onPress={onBack}>
          {t("common.actions.back")}
        </Button>
      </View>
    </View>
  );
}
function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.failure}>
      <AlertCircle size={16} />
      <Text style={styles.message}>{message}</Text>
      <Button size="sm" variant="outline" leftIcon={RotateCw} onPress={onRetry}>
        {t("common.actions.retry")}
      </Button>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.surfaceWorkspace },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
  failure: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  emptyActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  message: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
