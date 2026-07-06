import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useGlobalStatusBarView } from "./use-status-summary";
import { StatusBarRunningSessionsTrigger } from "./status-bar-running-sessions";
import type { StatusBarRow, StatusBarRowId, StatusSummaryViewModel } from "./view-model";

export const GLOBAL_STATUS_BAR_CONTENT_HEIGHT = 36;

interface GlobalStatusBarProps {
  serverId: string;
  bottomInset?: number;
  chromeState: GlobalStatusBarChromeState;
}

const COMPACT_ROW_IDS: ReadonlySet<StatusBarRowId> = new Set([
  "today-tokens",
  "lifetime-tokens",
  "running",
  "attention",
]);

export interface GlobalStatusBarChromeState {
  view: StatusSummaryViewModel;
  isVisible: boolean;
}

export function useGlobalStatusBarChromeState(serverId: string): GlobalStatusBarChromeState {
  const view = useGlobalStatusBarView(serverId);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const isVisible = !isFocusModeEnabled && view.kind !== "hidden" && view.kind !== "unsupported";

  return useMemo(() => ({ view, isVisible }), [view, isVisible]);
}

export function GlobalStatusBar({ serverId, bottomInset = 0, chromeState }: GlobalStatusBarProps) {
  const { view } = chromeState;
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const barStyle = useMemo(() => [styles.root, { paddingBottom: bottomInset }], [bottomInset]);

  if (!chromeState.isVisible) {
    return null;
  }

  return (
    <View style={barStyle} testID="global-status-bar">
      <View style={styles.content}>
        <StatusBarContent serverId={serverId} view={view} isCompact={isCompact} t={t} />
      </View>
    </View>
  );
}

function StatusBarContent({
  serverId,
  view,
  isCompact,
  t,
}: {
  serverId: string;
  view: StatusSummaryViewModel;
  isCompact: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (view.kind === "ready") {
    const hasSessionSnapshots =
      view.runningAgents.length > 0 ||
      view.needsAttentionAgents.length > 0 ||
      view.recentlyCompletedAgents.length > 0;
    let rows = hasSessionSnapshots
      ? view.primaryRows.filter((row) => row.id !== "running" && row.id !== "attention")
      : view.primaryRows;
    if (isCompact) {
      rows = rows.filter((row) => COMPACT_ROW_IDS.has(row.id));
    }

    return (
      <View style={styles.rowGroup} testID="global-status-bar-ready">
        {rows.map((row) => (
          <StatusBarChip key={row.id} row={row} t={t} />
        ))}
        {hasSessionSnapshots ? (
          <StatusBarRunningSessionsTrigger
            serverId={serverId}
            runningAgents={view.runningAgents}
            needsAttentionAgents={view.needsAttentionAgents}
            recentlyCompletedAgents={view.recentlyCompletedAgents}
          />
        ) : null}
      </View>
    );
  }
  if (view.kind === "hidden") {
    return null;
  }

  const message = getStateMessage(view, t);
  return (
    <View style={styles.stateRow} testID={`global-status-bar-${view.kind}`}>
      <Text style={styles.stateText} numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

function StatusBarChip({ row, t }: { row: StatusBarRow; t: (key: string) => string }) {
  const chipStyle = useMemo(() => [styles.chip, getToneStyle(row.tone)], [row.tone]);

  return (
    <View style={chipStyle} testID={`global-status-bar-row-${row.id}`}>
      <Text style={styles.chipLabel} numberOfLines={1}>
        {getRowLabel(row.id, t)}
      </Text>
      <Text style={styles.chipValue} numberOfLines={1}>
        {row.value}
      </Text>
    </View>
  );
}

function getStateMessage(
  view: Exclude<StatusSummaryViewModel, { kind: "ready" | "hidden" }>,
  t: (key: string) => string,
) {
  if (view.kind === "loading") {
    return t("statusBar.states.loading");
  }
  if (view.kind === "offline") {
    return t("statusBar.states.offline");
  }
  if (view.kind === "unsupported") {
    return t("statusBar.states.unsupported");
  }
  return view.message ?? t("statusBar.states.unavailable");
}

function getRowLabel(rowId: StatusBarRowId, t: (key: string) => string) {
  if (rowId === "lifetime-tokens") return t("statusBar.rows.totalTokens");
  if (rowId === "today-tokens") return t("statusBar.rows.today");
  if (rowId === "cost") return t("statusBar.rows.cost");
  if (rowId === "running") return t("statusBar.rows.running");
  if (rowId === "attention") return t("statusBar.rows.needsAttention");
  return t("statusBar.rows.errors");
}

function getToneStyle(tone: StatusBarRow["tone"]) {
  if (tone === "ok") return styles.chipOk;
  if (tone === "warning") return styles.chipWarning;
  if (tone === "danger") return styles.chipDanger;
  return styles.chipDefault;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flexShrink: 0,
    backgroundColor: theme.colors.surface0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  content: {
    minHeight: GLOBAL_STATUS_BAR_CONTENT_HEIGHT,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
  },
  rowGroup: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    overflow: "hidden",
  },
  stateRow: {
    minWidth: 0,
    justifyContent: "center",
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  chip: {
    minWidth: 0,
    maxWidth: 148,
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  chipDefault: {
    borderColor: theme.colors.border,
  },
  chipOk: {
    borderColor: theme.colors.statusSuccess,
  },
  chipWarning: {
    borderColor: theme.colors.statusWarning,
  },
  chipDanger: {
    borderColor: theme.colors.statusDanger,
  },
  chipLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  chipValue: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
}));
