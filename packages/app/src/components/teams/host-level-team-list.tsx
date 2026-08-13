import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, Users } from "lucide-react-native";
import { router } from "expo-router";

import type { HostLevelTeamRow } from "@/teams/host-level-team-rows";
import type { Theme } from "@/styles/theme";
import { buildHostTeamRoute } from "@/utils/host-routes";

const ThemedUsers = withUnistyles(Users);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function HostLevelTeamList({
  serverId,
  rows,
  emptyDescription,
}: {
  serverId: string;
  rows: readonly HostLevelTeamRow[];
  emptyDescription?: string;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <View style={styles.page} testID="host-level-team-list">
      <View style={styles.header}>
        <ThemedUsers size={20} uniProps={mutedIcon} />
        <Text style={styles.title}>{t("teams.host.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {rows.length === 0 ? (
          <View style={styles.empty} testID="host-level-team-list-empty">
            <Text style={styles.emptyTitle}>{t("teams.host.hub.emptyTitle")}</Text>
            {emptyDescription ? (
              <Text style={styles.emptyDescription}>{emptyDescription}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.rows}>
            {rows.map((row, index) => (
              <HostTeamRow key={row.teamId} serverId={serverId} row={row} showBorder={index > 0} />
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
}: {
  serverId: string;
  row: HostLevelTeamRow;
  showBorder: boolean;
}): ReactElement {
  const open = useCallback(() => {
    router.navigate(buildHostTeamRoute(serverId, row.teamId));
  }, [row.teamId, serverId]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.name}
      onPress={open}
      style={[styles.row, showBorder ? styles.rowBorder : null]}
      testID={`host-team-row-${row.teamId}`}
    >
      <Text style={styles.name} numberOfLines={1}>
        {row.name}
      </Text>
      <ThemedChevronRight size={16} uniProps={mutedIcon} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
