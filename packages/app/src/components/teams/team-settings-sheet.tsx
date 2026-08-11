import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronRight,
  CircleAlert,
  ClipboardList,
  ListTree,
  Settings,
  Users,
} from "lucide-react-native";

import type {
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { resolvePermissionActions } from "@/agent-stream/permission-actions";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import {
  TeamAttentionSettingsPage,
  TeamMembersSettingsPage,
  TeamMissionSettingsPage,
  TeamOverviewSettingsPage,
  TeamPlanSettingsPage,
  teamAttentionActionKey,
  type TeamSettingsAttentionResolution,
  type TeamSettingsPageActions,
} from "@/components/teams/team-settings-pages";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import type { PendingPermission } from "@/types/shared";
import { confirmDialog } from "@/utils/confirm-dialog";

type TeamSettingsPage = "root" | "team" | "members" | "mission" | "plan" | "attention";

interface TeamPendingPermission {
  readonly memberId: string;
  readonly role: string;
  readonly permission: PendingPermission;
}

export interface TeamSettingsSheetProps {
  readonly serverId: string;
  readonly team: TeamV2;
  readonly mission: TeamMission | null;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onEditProfile?: () => void;
  readonly onStartMission?: () => void;
  readonly onOpenAgent?: (agentId: string) => void;
  readonly onSelectMission?: (missionId: string) => void;
}

export function TeamSettingsSheet(props: TeamSettingsSheetProps): ReactElement | null {
  if (!props.visible) return null;
  return <OpenTeamSettingsSheet key={props.team.id} {...props} />;
}

function OpenTeamSettingsSheet({
  serverId,
  team,
  mission,
  visible,
  onClose,
  onEditProfile,
  onStartMission,
  onOpenAgent,
  onSelectMission,
}: TeamSettingsSheetProps): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [page, setPage] = useState<TeamSettingsPage>("root");
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionGeneration = useRef(0);
  const replica = useSessionStore((state) => state.sessions[serverId]?.teamMissionsReplica);
  const pendingPermissions = useSessionStore(
    (state) => state.sessions[serverId]?.pendingPermissions ?? EMPTY_PERMISSIONS,
  );
  const historyRead = replica?.historyReads.get(team.id);
  const history = useMemo(
    () =>
      (historyRead?.missionIds ?? [])
        .map((missionId) => replica?.missions.get(missionId))
        .filter((candidate): candidate is TeamMission => Boolean(candidate)),
    [historyRead?.missionIds, replica?.missions],
  );
  const permissions = useMemo(
    () => selectMissionPermissions(team, mission, pendingPermissions),
    [mission, pendingPermissions, team],
  );

  useEffect(() => {
    if (page !== "mission") return;
    void getHostRuntimeStore().readTeamMissionHistory(serverId, team.id);
  }, [page, serverId, team.id]);

  useEffect(
    () => () => {
      actionGeneration.current += 1;
    },
    [],
  );

  const run = useCallback(
    async (key: string, operation: () => Promise<{ error: string | null }>) => {
      if (!client) {
        setActionError(t("common.errors.daemonClientUnavailable"));
        return;
      }
      const generation = actionGeneration.current + 1;
      actionGeneration.current = generation;
      setPendingActionKey(key);
      setActionError(null);
      try {
        const result = await operation();
        if (actionGeneration.current === generation && result.error) {
          setActionError(result.error);
        }
      } catch (cause: unknown) {
        if (actionGeneration.current === generation) {
          setActionError(
            cause instanceof Error ? cause.message : t("common.errors.daemonClientUnavailable"),
          );
        }
      } finally {
        if (actionGeneration.current === generation) setPendingActionKey(null);
      }
    },
    [client, t],
  );

  const cancelMission = useCallback(() => {
    if (!mission || !client) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("teams.v2Settings.mission.cancel"),
        message: t("teams.v2Settings.mission.cancelConfirm"),
        confirmLabel: t("teams.v2Settings.mission.cancel"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      await run("cancel-mission", () =>
        client.cancelTeamMission({
          missionId: mission.id,
          expectedRevision: mission.revision,
          idempotencyKey: actionId("cancel", mission.id, mission.revision),
          reason: t("teams.v2Settings.mission.cancelReason"),
        }),
      );
    })();
  }, [client, mission, run, t]);

  const archiveTeam = useCallback(() => {
    if (!client) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("teams.v2Settings.lifecycle.archiveAction"),
        message: t("teams.v2Settings.lifecycle.archiveConfirm"),
        confirmLabel: t("teams.v2Settings.lifecycle.archiveAction"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      await run("archive-team", () =>
        client.archiveTeamProfile({
          teamId: team.id,
          expectedRevision: team.revision,
          idempotencyKey: actionId("archive", team.id, team.revision),
        }),
      );
    })();
  }, [client, run, t, team.id, team.revision]);

  const resolveAttention = useCallback(
    (attentionId: string, resolution: TeamSettingsAttentionResolution) => {
      if (!client || !mission) return;
      const key = teamAttentionActionKey(attentionId, resolution);
      void run(key, () =>
        client.resolveTeamMissionAttention({
          missionId: mission.id,
          attentionId,
          expectedRevision: mission.revision,
          idempotencyKey: actionId(resolution.kind, attentionId, mission.revision),
          resolution,
        }),
      );
    },
    [client, mission, run],
  );

  const actions = useMemo<TeamSettingsPageActions>(
    () => ({
      onEditProfile,
      onStartMission,
      onOpenAgent,
      onSelectMission,
      onCancelMission: client && mission ? cancelMission : undefined,
      onArchiveTeam: client ? archiveTeam : undefined,
      onResolveAttention: client && mission ? resolveAttention : undefined,
      pendingActionKey,
      actionError,
    }),
    [
      actionError,
      archiveTeam,
      cancelMission,
      client,
      mission,
      onEditProfile,
      onOpenAgent,
      onSelectMission,
      onStartMission,
      pendingActionKey,
      resolveAttention,
    ],
  );
  const permissionRowsNode = useMemo(
    () => (
      <View style={styles.permissionList}>
        {permissions.map((row) => (
          <PermissionRow key={row.permission.key} row={row} client={client} />
        ))}
      </View>
    ),
    [client, permissions],
  );
  const header = useMemo<SheetHeader>(
    () => ({
      title:
        page === "root" ? t("teams.v2Settings.title") : t(`teams.v2Settings.navigation.${page}`),
      back:
        page === "root"
          ? undefined
          : {
              onPress: () => setPage("root"),
              accessibilityLabel: t("common.actions.back"),
            },
    }),
    [page, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      presentation={page === "root" ? undefined : "push"}
      snapPoints={["72%", "92%"]}
      testID="team-settings-sheet"
    >
      {page === "root" ? (
        <SettingsNavigation
          team={team}
          mission={mission}
          permissionCount={permissions.length}
          onSelect={setPage}
        />
      ) : null}
      {page === "team" ? (
        <TeamOverviewSettingsPage team={team} mission={mission} actions={actions} />
      ) : null}
      {page === "members" ? (
        <TeamMembersSettingsPage team={team} mission={mission} actions={actions} />
      ) : null}
      {page === "mission" ? (
        <TeamMissionSettingsPage
          team={team}
          mission={mission}
          history={history}
          historyStatus={historyRead?.status ?? "idle"}
          actions={actions}
        />
      ) : null}
      {page === "plan" ? (
        <TeamPlanSettingsPage team={team} mission={mission} actions={actions} />
      ) : null}
      {page === "attention" ? (
        <TeamAttentionSettingsPage
          team={team}
          mission={mission}
          actions={actions}
          pendingPermissionCount={permissions.length}
          permissionRows={permissionRowsNode}
        />
      ) : null}
    </AdaptiveModalSheet>
  );
}

function SettingsNavigation({
  team,
  mission,
  permissionCount,
  onSelect,
}: {
  team: TeamV2;
  mission: TeamMission | null;
  permissionCount: number;
  onSelect: (page: TeamSettingsPage) => void;
}): ReactElement {
  const { t } = useTranslation();
  const openAttention =
    mission?.attentionItems.filter((item) => item.status === "open").length ?? 0;
  const rows: Array<{
    key: Exclude<TeamSettingsPage, "root">;
    hint: string;
    icon: typeof ThemedSettings;
  }> = [
    { key: "team", hint: team.name, icon: ThemedSettings },
    {
      key: "members",
      hint: t("teams.v2Settings.navigation.membersHint", { count: team.members.length }),
      icon: ThemedUsers,
    },
    {
      key: "mission",
      hint: mission?.objective ?? t("teams.v2Settings.mission.none"),
      icon: ThemedClipboardList,
    },
    {
      key: "plan",
      hint: t("teams.v2Settings.navigation.planHint", {
        count: mission?.workstreams.length ?? 0,
      }),
      icon: ThemedListTree,
    },
    {
      key: "attention",
      hint: t("teams.v2Settings.navigation.attentionHint", {
        count: openAttention + permissionCount,
      }),
      icon: ThemedCircleAlert,
    },
  ];
  return (
    <View style={settingsStyles.card} testID="team-settings-navigation">
      {rows.map((row, index) => (
        <SettingsNavigationRow
          key={row.key}
          page={row.key}
          hint={row.hint}
          icon={row.icon}
          bordered={index > 0}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function PermissionRow({
  row,
  client,
}: {
  row: TeamPendingPermission;
  client: ReturnType<typeof useHostRuntimeClient>;
}): ReactElement {
  const { t } = useTranslation();
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = row.permission.request;
  const actions = useMemo(
    () =>
      resolvePermissionActions(request, {
        deny: t("agentStream.permission.deny"),
        accept: t("agentStream.permission.accept"),
        implement: t("agentStream.permission.implement"),
      }),
    [request, t],
  );
  const answer = useCallback(
    (action: AgentPermissionAction) => {
      if (!client) {
        setError(t("common.errors.daemonClientUnavailable"));
        return;
      }
      const response: AgentPermissionResponse =
        action.behavior === "allow"
          ? { behavior: "allow", selectedActionId: action.id }
          : {
              behavior: "deny",
              selectedActionId: action.id,
              message: t("agentStream.permission.deny"),
            };
      setAnswering(action.id);
      setError(null);
      void client
        .respondToPermissionAndWait(row.permission.agentId, request.id, response, 15_000)
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error ? cause.message : t("common.errors.daemonClientUnavailable"),
          );
        })
        .finally(() => setAnswering(null));
    },
    [client, request.id, row.permission.agentId, t],
  );
  return (
    <View style={settingsStyles.card} testID={`team-permission-${row.permission.key}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{request.title ?? request.name}</Text>
          <Text style={settingsStyles.rowHint}>{row.role}</Text>
          {error ? <Text style={settingsStyles.rowError}>{error}</Text> : null}
        </View>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.permissionActions]}>
        {actions.map((action) => (
          <PermissionActionButton
            key={action.id}
            action={action}
            answering={answering === action.id}
            onAnswer={answer}
          />
        ))}
      </View>
    </View>
  );
}

function SettingsNavigationRow({
  page,
  hint,
  icon: Icon,
  bordered,
  onSelect,
}: {
  page: Exclude<TeamSettingsPage, "root">;
  hint: string;
  icon: typeof ThemedSettings;
  bordered: boolean;
  onSelect: (page: TeamSettingsPage) => void;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => onSelect(page), [onSelect, page]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}
      testID={`team-settings-nav-${page}`}
    >
      <View style={styles.navigationIcon}>
        <Icon size={18} />
      </View>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t(`teams.v2Settings.navigation.${page}`)}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <ThemedChevronRight size={16} />
    </Pressable>
  );
}

function PermissionActionButton({
  action,
  answering,
  onAnswer,
}: {
  action: AgentPermissionAction;
  answering: boolean;
  onAnswer: (action: AgentPermissionAction) => void;
}): ReactElement {
  const press = useCallback(() => onAnswer(action), [action, onAnswer]);
  return (
    <Button
      size="sm"
      variant={action.behavior === "allow" ? "default" : "secondary"}
      loading={answering}
      onPress={press}
    >
      {action.label}
    </Button>
  );
}

function selectMissionPermissions(
  team: TeamV2,
  mission: TeamMission | null,
  pending: ReadonlyMap<string, PendingPermission>,
): TeamPendingPermission[] {
  if (!mission) return [];
  const memberByAgent = new Map(
    mission.participants
      .filter((participant) => participant.archivedAt === null)
      .map((participant) => [participant.agentId, participant.memberId]),
  );
  const memberById = new Map(team.members.map((member) => [member.memberId, member]));
  return Array.from(pending.values()).flatMap((permission) => {
    const memberId = memberByAgent.get(permission.agentId);
    const member = memberId ? memberById.get(memberId) : null;
    return memberId && member
      ? [{ memberId, role: member.role, permission } satisfies TeamPendingPermission]
      : [];
  });
}

function actionId(action: string, entityId: string, revision: number): string {
  return `team-ui:${action}:${entityId}:${revision}`;
}

const EMPTY_PERMISSIONS = new Map<string, PendingPermission>();
const mutedIcon = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedChevronRight = withUnistyles(ChevronRight, mutedIcon);
const ThemedSettings = withUnistyles(Settings, mutedIcon);
const ThemedUsers = withUnistyles(Users, mutedIcon);
const ThemedClipboardList = withUnistyles(ClipboardList, mutedIcon);
const ThemedListTree = withUnistyles(ListTree, mutedIcon);
const ThemedCircleAlert = withUnistyles(CircleAlert, mutedIcon);

const styles = StyleSheet.create((theme) => ({
  navigationIcon: {
    width: 28,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  permissionList: {
    gap: theme.spacing[3],
  },
  permissionActions: {
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
