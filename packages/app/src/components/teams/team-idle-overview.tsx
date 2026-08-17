import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { History, Play, RotateCw, Settings2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import type { TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { MemberAvatar } from "@/components/teams/member-avatar";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Theme } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";

const ThemedHistory = withUnistyles(History);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TeamIdleOverviewProps {
  team: TeamV2;
  history: readonly TeamMission[];
  historyStatus: "idle" | "loading" | "ready" | "failed";
  historyError: string | null;
  canStartMission: boolean;
  workspaceAvailable: boolean;
  onStartMission?: () => void;
  onOpenSettings: () => void;
  onSelectMission: (missionId: string) => void;
  onRetryHistory: () => void;
}

/** The work entry for a Team that currently has no Mission room. */
export function TeamIdleOverview({
  team,
  history,
  historyStatus,
  historyError,
  canStartMission,
  workspaceAvailable,
  onStartMission,
  onOpenSettings,
  onSelectMission,
  onRetryHistory,
}: TeamIdleOverviewProps): ReactElement {
  const { t } = useTranslation();
  const template = team.methodologyBinding.presetId ?? team.methodologyBinding.ref.bundleId;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      testID="team-idle-overview"
    >
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.title}>{team.name}</Text>
          <Text style={styles.subtitle}>{t("teams.panel.idle")}</Text>
        </View>
        <Button
          size="sm"
          variant="outline"
          leftIcon={Settings2}
          onPress={onOpenSettings}
          testID="team-overview-settings"
        >
          {t("teams.panel.settings")}
        </Button>
      </View>

      <View style={styles.summary}>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>{t("teams.panel.template")}</Text>
          <Text style={styles.factValue}>{template}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>
            {t("teams.panel.members", { count: team.members.length })}
          </Text>
          <View style={styles.memberList}>
            {team.members.map((member) => (
              <View key={member.memberId} style={styles.member}>
                <MemberAvatar agentId={member.memberId} label={member.role} size={28} />
                <Text style={styles.memberRole} numberOfLines={1}>
                  {member.role}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.primaryAction}>
        <PrimaryAction
          team={team}
          canStartMission={canStartMission}
          workspaceAvailable={workspaceAvailable}
          onStartMission={onStartMission}
        />
      </View>

      <View style={styles.historyHeader}>
        <View style={styles.historyTitleLine}>
          <ThemedHistory size={18} uniProps={mutedIcon} />
          <Text style={styles.sectionTitle}>{t("teams.v2Settings.mission.history")}</Text>
        </View>
        {historyStatus === "failed" ? (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={RotateCw}
            onPress={onRetryHistory}
            testID="team-overview-history-retry"
          >
            {t("common.actions.retry")}
          </Button>
        ) : null}
      </View>

      <HistoryContent
        history={history}
        historyStatus={historyStatus}
        historyError={historyError}
        onSelectMission={onSelectMission}
      />
    </ScrollView>
  );
}

function PrimaryAction({
  team,
  canStartMission,
  workspaceAvailable,
  onStartMission,
}: Pick<
  TeamIdleOverviewProps,
  "team" | "canStartMission" | "workspaceAvailable" | "onStartMission"
>): ReactElement | null {
  const { t } = useTranslation();
  if (canStartMission && onStartMission) {
    return (
      <Button
        size="md"
        leftIcon={Play}
        onPress={onStartMission}
        testID="team-overview-start-mission"
      >
        {t("teams.v2Settings.mission.start")}
      </Button>
    );
  }
  if (team.lifecycle === "active" && !workspaceAvailable) {
    return <Text style={styles.hint}>{t("teams.panel.workspaceRequired")}</Text>;
  }
  return null;
}

function HistoryContent({
  history,
  historyStatus,
  historyError,
  onSelectMission,
}: Pick<
  TeamIdleOverviewProps,
  "history" | "historyStatus" | "historyError" | "onSelectMission"
>): ReactElement {
  const { t } = useTranslation();
  if (historyStatus === "loading" || historyStatus === "idle") {
    return (
      <View style={styles.historyState} testID="team-overview-history-loading">
        <ThemedLoadingSpinner size="small" uniProps={mutedIcon} />
      </View>
    );
  }
  if (historyStatus === "failed") {
    return (
      <Text style={styles.error} testID="team-overview-history-error">
        {historyError ?? t("teams.panel.historyFailed")}
      </Text>
    );
  }
  if (history.length === 0) {
    return (
      <Text style={styles.hint} testID="team-overview-history-empty">
        {t("teams.v2Settings.mission.noHistory")}
      </Text>
    );
  }
  return (
    <View style={styles.historyRows} testID="team-overview-history">
      {history.map((mission, index) => (
        <MissionHistoryRow
          key={mission.id}
          mission={mission}
          bordered={index > 0}
          onSelectMission={onSelectMission}
        />
      ))}
    </View>
  );
}

function MissionHistoryRow({
  mission,
  bordered,
  onSelectMission,
}: {
  mission: TeamMission;
  bordered: boolean;
  onSelectMission: (missionId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const selectMission = useCallback(
    () => onSelectMission(mission.id),
    [mission.id, onSelectMission],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mission.objective}
      onPress={selectMission}
      style={[styles.historyRow, bordered ? styles.historyRowBorder : null]}
      testID={`team-overview-history-${mission.id}`}
    >
      <View style={styles.historyCopy}>
        <Text style={styles.historyObjective} numberOfLines={1}>
          {mission.objective}
        </Text>
        <Text style={styles.historyMeta} numberOfLines={1}>
          {mission.workspaceId} · {formatTimeAgo(new Date(mission.updatedAt))}
        </Text>
      </View>
      <StatusBadge
        label={t(`teams.v2Settings.status.${mission.status}`)}
        variant={historyStatusVariant(mission.status)}
      />
    </Pressable>
  );
}

function historyStatusVariant(status: TeamMission["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "error" as const;
  return "muted" as const;
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  heading: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  summary: {
    gap: theme.spacing[4],
  },
  fact: {
    gap: theme.spacing[2],
  },
  factLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  factValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  memberList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  member: {
    minWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  memberRole: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  primaryAction: {
    alignItems: "flex-start",
  },
  historyHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  historyTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  historyState: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  historyRows: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  historyRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  historyRowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  historyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  historyObjective: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  historyMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
