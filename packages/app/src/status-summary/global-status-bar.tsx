import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useGlobalStatusBarView } from "./use-status-summary";
import {
  StatusBarRunningSessionsTrigger,
  StatusBarSessionHistoryTrigger,
} from "./status-bar-running-sessions";
import type { StatusBarRow, StatusBarRowId, StatusSummaryViewModel } from "./view-model";

export const GLOBAL_STATUS_BAR_CONTENT_HEIGHT = 52;

interface GlobalStatusBarProps {
  serverId: string;
  bottomInset?: number;
  chromeState: GlobalStatusBarChromeState;
}

const COMPACT_ROW_IDS: ReadonlySet<StatusBarRowId> = new Set([
  "today-tokens",
  "lifetime-tokens",
  "cost",
  "running",
  "attention",
]);
const COST_SHEET_SNAP_POINTS = ["30%", "55%"];

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
        {rows.map((row) =>
          row.id === "cost" && row.details ? (
            <StatusBarCostChip key={row.id} row={row} isCompact={isCompact} t={t} />
          ) : (
            <StatusBarChip key={row.id} row={row} t={t} />
          ),
        )}
        {hasSessionSnapshots ? (
          <StatusBarRunningSessionsTrigger
            serverId={serverId}
            runningAgents={view.runningAgents}
            needsAttentionAgents={view.needsAttentionAgents}
            recentlyCompletedAgents={view.recentlyCompletedAgents}
          />
        ) : null}
        <StatusBarSessionHistoryTrigger serverId={serverId} />
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
        {getRowLabel(row, t)}
      </Text>
      <Text style={styles.chipValue} numberOfLines={1}>
        {row.value}
      </Text>
    </View>
  );
}

function StatusBarCostChip({
  row,
  isCompact,
  t,
}: {
  row: StatusBarRow;
  isCompact: boolean;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const chipStyle = useMemo(() => [styles.chip, getToneStyle(row.tone)], [row.tone]);
  const sheetHeader = useMemo(() => ({ title: t("statusBar.cost.title") }), [t]);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const triggerStyle = useCallback(
    ({
      pressed,
      hovered,
      open: triggerOpen,
    }: {
      pressed: boolean;
      hovered: boolean;
      open: boolean;
    }) => [
      ...chipStyle,
      hovered || triggerOpen ? styles.chipHovered : null,
      pressed ? styles.chipPressed : null,
    ],
    [chipStyle],
  );
  const content = <StatusBarCostDetails row={row} t={t} />;

  if (isCompact) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("statusBar.cost.title")}
          onPress={handleOpen}
          style={chipStyle}
          testID="global-status-bar-row-cost"
        >
          <StatusBarChipContent row={row} t={t} />
        </Pressable>
        <AdaptiveModalSheet
          header={sheetHeader}
          visible={open}
          onClose={handleClose}
          snapPoints={COST_SHEET_SNAP_POINTS}
          testID="status-bar-cost-sheet"
        >
          {content}
        </AdaptiveModalSheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.cost.title")}
        style={triggerStyle}
        testID="global-status-bar-row-cost"
      >
        <StatusBarChipContent row={row} t={t} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={220} testID="status-bar-cost-panel">
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusBarChipContent({ row, t }: { row: StatusBarRow; t: (key: string) => string }) {
  return (
    <>
      <Text style={styles.chipLabel} numberOfLines={1}>
        {getRowLabel(row, t)}
      </Text>
      <Text style={styles.chipValue} numberOfLines={1}>
        {row.value}
      </Text>
    </>
  );
}

function StatusBarCostDetails({ row, t }: { row: StatusBarRow; t: (key: string) => string }) {
  return (
    <View style={styles.costDetails} testID="status-bar-cost-details">
      {row.details?.map((detail) => (
        <View key={detail.label} style={styles.costDetailRow}>
          <Text style={styles.costDetailLabel} numberOfLines={1}>
            {detail.label === "Today" ? t("statusBar.cost.today") : t("statusBar.cost.total")}
          </Text>
          <Text style={styles.costDetailValue} numberOfLines={1}>
            {detail.value}
          </Text>
        </View>
      ))}
      <Text style={styles.costDetailNote}>{t("statusBar.cost.estimateNote")}</Text>
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

function getRowLabel(row: StatusBarRow, t: (key: string) => string) {
  if (row.id === "lifetime-tokens") return t("statusBar.rows.totalTokens");
  if (row.id === "today-tokens") return t("statusBar.rows.today");
  if (row.id === "cost") {
    return row.label === "Total cost" ? t("statusBar.rows.cost") : t("statusBar.rows.costToday");
  }
  if (row.id === "running") return t("statusBar.rows.running");
  if (row.id === "attention") return t("statusBar.rows.needsAttention");
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
    backgroundColor: theme.colors.surfaceSidebar,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  content: {
    minHeight: GLOBAL_STATUS_BAR_CONTENT_HEIGHT,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
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
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipPressed: {
    opacity: theme.opacity[50],
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
  costDetails: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  costDetailRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  costDetailLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  costDetailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  costDetailNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
