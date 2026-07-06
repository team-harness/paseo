import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { usePathname } from "expo-router";
import { ArrowUpRight, BriefcaseBusiness } from "lucide-react-native";
import type { StatusAgentSnapshot } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore } from "@/stores/session-store";
import {
  buildStatusBarSessionList,
  navigateToStatusBarSession,
  type StatusBarSessionListItem,
  type StatusBarSessionTarget,
} from "./status-bar-session-navigation";
import {
  formatStatusBarSessionMeta,
  formatStatusBarSessionSubtitle,
  formatStatusBarSessionTitle,
  formatStatusBarSessionUsage,
} from "./status-bar-session-format";

const ThemedArrowUpRight = withUnistyles(ArrowUpRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedBriefcaseBusiness = withUnistyles(BriefcaseBusiness, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const COMPACT_SNAP_POINTS = ["45%", "85%"];

const compactTriggerStyle = ({ pressed }: { pressed: boolean }) => [
  styles.trigger,
  pressed ? styles.triggerPressed : null,
];

const desktopTriggerStyle = ({
  pressed,
  hovered,
  open,
}: {
  pressed: boolean;
  hovered: boolean;
  open: boolean;
}) => [
  styles.trigger,
  hovered || open ? styles.triggerHovered : null,
  pressed ? styles.triggerPressed : null,
];

const rowPrimaryStyle = ({ pressed, hovered = false }: { pressed: boolean; hovered?: boolean }) => [
  styles.rowPrimary,
  hovered ? styles.rowHovered : null,
  pressed ? styles.rowPressed : null,
];

const iconButtonStyle = ({ pressed, hovered = false }: { pressed: boolean; hovered?: boolean }) => [
  styles.iconButton,
  hovered ? styles.iconButtonHovered : null,
  pressed ? styles.iconButtonPressed : null,
];

interface StatusBarRunningSessionsTriggerProps {
  serverId: string;
  runningAgents: StatusAgentSnapshot[];
  needsAttentionAgents: StatusAgentSnapshot[];
  recentlyCompletedAgents: StatusAgentSnapshot[];
}

export function StatusBarRunningSessionsTrigger({
  serverId,
  runningAgents,
  needsAttentionAgents,
  recentlyCompletedAgents,
}: StatusBarRunningSessionsTriggerProps) {
  const isCompact = useIsCompactFormFactor();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sheetHeader = useMemo(() => ({ title: t("statusBar.sessions.title") }), [t]);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const liveWorkspaceIds = useMemo(() => new Set(workspaces?.keys() ?? []), [workspaces]);
  const items = useMemo(
    () =>
      buildStatusBarSessionList({
        serverId,
        needsAttentionAgents,
        runningAgents,
        recentlyCompletedAgents,
        liveWorkspaceIds,
      }),
    [liveWorkspaceIds, needsAttentionAgents, recentlyCompletedAgents, runningAgents, serverId],
  );
  const hasItems = items.length > 0;
  const attentionCount = needsAttentionAgents.length;
  const runningCount = runningAgents.length;

  useEffect(() => {
    setOpen(false);
  }, [pathname, serverId]);

  useEffect(() => {
    if (!hasItems) {
      setOpen(false);
    }
  }, [hasItems]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(hasItems ? nextOpen : false);
    },
    [hasItems],
  );

  const handleNavigate = useCallback(
    (target: StatusBarSessionTarget) => {
      setOpen(false);
      if (isCompact) {
        requestAnimationFrame(() => {
          navigateToStatusBarSession(target);
        });
        return;
      }
      navigateToStatusBarSession(target);
    },
    [isCompact],
  );
  const handleCompactOpen = useCallback(() => {
    handleOpenChange(true);
  }, [handleOpenChange]);
  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  if (!hasItems) {
    return null;
  }

  const triggerBody = (
    <TriggerContent
      attentionCount={attentionCount}
      runningCount={runningCount}
      label={t("statusBar.sessions.trigger")}
    />
  );

  if (isCompact) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("statusBar.sessions.title")}
          onPress={handleCompactOpen}
          style={compactTriggerStyle}
          testID="status-bar-sessions-trigger"
        >
          {triggerBody}
        </Pressable>
        <AdaptiveModalSheet
          header={sheetHeader}
          visible={open}
          onClose={handleClose}
          snapPoints={COMPACT_SNAP_POINTS}
          testID="status-bar-sessions-sheet"
        >
          <StatusBarSessionsList items={items} onNavigate={handleNavigate} />
        </AdaptiveModalSheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.sessions.title")}
        style={desktopTriggerStyle}
        testID="status-bar-sessions-trigger"
      >
        {triggerBody}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        width={360}
        maxHeight={420}
        scrollable
        testID="status-bar-sessions-panel"
      >
        <StatusBarSessionsList items={items} onNavigate={handleNavigate} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TriggerContent({
  attentionCount,
  label,
  runningCount,
}: {
  attentionCount: number;
  label: string;
  runningCount: number;
}) {
  return (
    <>
      <Text style={styles.triggerLabel} numberOfLines={1}>
        {label}
      </Text>
      {attentionCount > 0 ? (
        <Text style={styles.triggerAttentionValue} numberOfLines={1}>
          {attentionCount}
        </Text>
      ) : null}
      <Text style={styles.triggerValue} numberOfLines={1}>
        {runningCount}
      </Text>
    </>
  );
}

function StatusBarSessionsList({
  items,
  onNavigate,
}: {
  items: StatusBarSessionListItem[];
  onNavigate: (target: StatusBarSessionTarget) => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <View style={styles.emptyState} testID="status-bar-sessions-empty">
        <Text style={styles.emptyText}>{t("statusBar.sessions.empty")}</Text>
      </View>
    );
  }

  const groups = groupItems(items);
  return (
    <View style={styles.list} testID="status-bar-sessions-list">
      {groups.map((group) => (
        <View key={group.kind} style={styles.group}>
          <Text style={styles.groupLabel}>{getStatusBarSessionGroupLabel(group.kind, t)}</Text>
          <View style={styles.groupRows}>
            {group.items.map((item) => (
              <StatusBarSessionRow key={item.key} item={item} onNavigate={onNavigate} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function StatusBarSessionRow({
  item,
  onNavigate,
}: {
  item: StatusBarSessionListItem;
  onNavigate: (target: StatusBarSessionTarget) => void;
}) {
  const { t } = useTranslation();
  const usage = formatStatusBarSessionUsage(item.snapshot);
  const meta = [usage, formatStatusBarSessionMeta(item.snapshot)].filter(Boolean).join(" · ");
  const title = formatStatusBarSessionTitle(item.snapshot);
  const handlePrimaryPress = useCallback(() => {
    onNavigate(item.primaryTarget);
  }, [item.primaryTarget, onNavigate]);
  const handleWorkspacePress = useCallback(() => {
    if (item.workspaceTarget) {
      onNavigate(item.workspaceTarget);
    }
  }, [item.workspaceTarget, onNavigate]);
  return (
    <View style={styles.row} testID={`status-bar-session-row-${item.snapshot.agentId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.sessions.actions.openAgent", { title })}
        onPress={handlePrimaryPress}
        style={rowPrimaryStyle}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {formatStatusBarSessionSubtitle(item.snapshot)}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <ThemedArrowUpRight size={14} />
      </Pressable>
      {item.workspaceTarget ? (
        <IconButton
          accessibilityLabel={t("statusBar.sessions.actions.openWorkspace")}
          testID={`status-bar-session-workspace-${item.snapshot.agentId}`}
          onPress={handleWorkspacePress}
        >
          <ThemedBriefcaseBusiness size={14} />
        </IconButton>
      ) : null}
    </View>
  );
}

function getStatusBarSessionGroupLabel(
  group: StatusBarSessionListItem["group"],
  t: (key: string) => string,
): string {
  if (group === "attention") return t("statusBar.sessions.groups.attention");
  if (group === "running") return t("statusBar.sessions.groups.running");
  return t("statusBar.sessions.groups.recent");
}

function IconButton({
  accessibilityLabel,
  children,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      onPress={onPress}
      style={iconButtonStyle}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function groupItems(items: StatusBarSessionListItem[]) {
  const groups: Array<{
    kind: StatusBarSessionListItem["group"];
    items: StatusBarSessionListItem[];
  }> = [];
  for (const kind of ["attention", "running", "recent"] as const) {
    const groupItemsForKind = items.filter((item) => item.group === kind);
    if (groupItemsForKind.length > 0) {
      groups.push({ kind, items: groupItemsForKind });
    }
  }
  return groups;
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    minWidth: 92,
    maxWidth: 148,
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  triggerHovered: {
    borderColor: theme.colors.borderAccent,
  },
  triggerPressed: {
    opacity: theme.opacity[50],
  },
  triggerLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  triggerValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  triggerAttentionValue: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  list: {
    minWidth: 0,
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  group: {
    gap: theme.spacing[1],
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
  },
  groupRows: {
    gap: theme.spacing[1],
  },
  row: {
    minWidth: 0,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  rowPrimary: {
    minWidth: 0,
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    opacity: theme.opacity[50],
  },
  rowText: {
    minWidth: 0,
    flex: 1,
    gap: theme.spacing[0],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  iconButton: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  iconButtonPressed: {
    opacity: theme.opacity[50],
  },
  emptyState: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
