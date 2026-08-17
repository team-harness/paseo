import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronRight,
  FolderOpen,
  MoreVertical,
  Plus,
  Settings2,
  Users,
} from "lucide-react-native";
import { router } from "expo-router";

import { MemberAvatar } from "@/components/teams/member-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { HostLevelTeamRow } from "@/teams/host-level-team-rows";
import type { Theme } from "@/styles/theme";
import { buildHostTeamRoute, buildHostTeamSettingsRoute } from "@/utils/host-routes";

const ThemedUsers = withUnistyles(Users);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedSettings = withUnistyles(Settings2);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const settingsMenuLeading = <ThemedSettings size={16} uniProps={mutedIcon} />;

export function HostLevelTeamList({
  serverId,
  rows,
  emptyDescription,
  createDisabled = false,
  onCreate,
  onOpenWorkspace,
  workspaceAvailable = false,
  showEmptyState = true,
}: {
  serverId: string;
  rows: readonly HostLevelTeamRow[];
  emptyDescription?: string;
  createDisabled?: boolean;
  onCreate: () => void;
  onOpenWorkspace: () => void;
  workspaceAvailable?: boolean;
  showEmptyState?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();

  return (
    <View style={styles.page} testID="host-level-team-list">
      <View style={styles.header}>
        <View style={styles.heading}>
          <ThemedUsers size={20} uniProps={mutedIcon} />
          <Text style={styles.title}>{t("teams.host.title")}</Text>
        </View>
        <View style={styles.headerActions}>
          <Button
            size="sm"
            variant="outline"
            leftIcon={FolderOpen}
            onPress={onOpenWorkspace}
            testID="team-hub-open-workspace"
          >
            {t(workspaceAvailable ? "teams.host.hub.openWorkspace" : "teams.host.hub.addProject")}
          </Button>
          <Button
            size="sm"
            leftIcon={Plus}
            onPress={onCreate}
            disabled={createDisabled}
            testID="team-hub-create"
          >
            {t("teams.host.hub.create")}
          </Button>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {rows.length === 0 && showEmptyState ? (
          <View style={styles.empty} testID="host-level-team-list-empty">
            <Text style={styles.emptyTitle}>{t("teams.host.hub.emptyTitle")}</Text>
            {emptyDescription ? (
              <Text style={styles.emptyDescription}>{emptyDescription}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.rows}>
            {rows.map((row, index) => (
              <HostTeamRow
                key={row.teamId}
                serverId={serverId}
                row={row}
                showBorder={index > 0}
                compact={isCompact}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function HostTeamRow({
  serverId,
  row,
  showBorder,
  compact,
}: {
  serverId: string;
  row: HostLevelTeamRow;
  showBorder: boolean;
  compact: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => {
    router.navigate(buildHostTeamRoute(serverId, row.teamId));
  }, [row.teamId, serverId]);
  const openSettings = useCallback(() => {
    router.navigate(buildHostTeamSettingsRoute(serverId, row.teamId));
  }, [row.teamId, serverId]);

  return (
    <View style={[styles.rowContainer, showBorder ? styles.rowBorder : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.name}
        onPress={open}
        style={styles.row}
        testID={`host-team-row-${row.teamId}`}
      >
        <Text style={styles.name} numberOfLines={1}>
          {row.name}
        </Text>
        <View style={[styles.rowMeta, compact ? styles.rowMetaCompact : null]}>
          <Text style={styles.template} numberOfLines={1}>
            {t("teams.host.hub.template", { template: row.template })}
          </Text>
          <View style={styles.members}>
            {row.members.slice(0, 4).map((member) => (
              <MemberAvatar
                key={member.memberId}
                agentId={member.memberId}
                label={member.role}
                size={24}
                testID={`host-team-member-${row.teamId}-${member.memberId}`}
              />
            ))}
            <Text style={styles.memberCount}>
              {t("teams.host.hub.memberCount", { count: row.members.length })}
            </Text>
          </View>
        </View>
        <View style={[styles.missionLine, compact ? styles.missionLineCompact : null]}>
          <View style={styles.missionCopy}>
            <Text style={styles.missionTitle} numberOfLines={1}>
              {row.mission?.objective ??
                t(row.missionPending ? "common.states.loading" : "teams.host.hub.noActiveMission")}
            </Text>
            {row.mission ? (
              <Text style={styles.workspace} numberOfLines={1}>
                {row.mission.workspaceLabel}
              </Text>
            ) : null}
          </View>
          <View style={[styles.missionStatus, compact ? styles.missionStatusCompact : null]}>
            {row.mission ? (
              <StatusBadge
                label={t(`teams.v2Settings.status.${row.mission.status}`)}
                variant={statusVariant(row.mission.status)}
              />
            ) : null}
            {row.mission && row.mission.openAttentionCount > 0 ? (
              <Text style={styles.attention}>
                {t("teams.host.hub.attentionCount", {
                  count: row.mission.openAttentionCount,
                })}
              </Text>
            ) : null}
            <View style={styles.nextAction}>
              <Text style={styles.actionLabel}>{t(actionKey(row.action))}</Text>
              {row.action !== "loading" ? (
                <ThemedChevronRight size={16} uniProps={mutedIcon} />
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
      <View style={styles.menu}>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            accessibilityRole={isNative ? "button" : undefined}
            accessibilityLabel={t("teams.panel.settings")}
            style={styles.menuTrigger}
            testID={`host-team-menu-${row.teamId}`}
          >
            <ThemedMoreVertical size={18} uniProps={mutedIcon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={220} sheetTitle={row.name}>
            <DropdownMenuItem
              leading={settingsMenuLeading}
              onSelect={openSettings}
              testID={`host-team-settings-${row.teamId}`}
            >
              {t("teams.panel.settings")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </View>
  );
}

function actionKey(action: HostLevelTeamRow["action"]): string {
  if (action === "enter_room") return "teams.host.hub.enterRoom";
  if (action === "view_history") return "teams.host.hub.viewHistory";
  if (action === "loading") return "common.states.loading";
  return "teams.host.hub.startMission";
}

function statusVariant(status: NonNullable<HostLevelTeamRow["mission"]>["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "needs_attention") return "error" as const;
  return "muted" as const;
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: theme.spacing[4],
  },
  rows: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    backgroundColor: theme.colors.surface1,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyDescription: {
    maxWidth: 440,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  rowContainer: {
    position: "relative",
  },
  row: {
    minHeight: 112,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingRight: theme.spacing[12],
    paddingVertical: theme.spacing[3],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  name: {
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rowMetaCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  template: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  members: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  memberCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  missionLine: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  missionLineCompact: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  missionCopy: {
    flex: 1,
    minWidth: 0,
  },
  missionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  workspace: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  missionStatus: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  missionStatusCompact: {
    justifyContent: "space-between",
  },
  attention: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  nextAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  actionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  menu: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
  },
  menuTrigger: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
}));
