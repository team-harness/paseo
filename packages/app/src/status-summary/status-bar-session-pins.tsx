import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { usePathname } from "expo-router";
import { ArrowUpRight, Pin } from "lucide-react-native";
import type { StatusPinnedSession } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { AgentStatusDot } from "@/components/agent-status-dot";
import {
  navigateToStatusBarSession,
  type StatusBarSessionTarget,
} from "./status-bar-session-navigation";
import {
  formatHistorySubtitle,
  formatStatusBarHistoryMeta,
  formatStatusBarHistoryStatus,
  type StatusBarSessionPinSource,
} from "./status-bar-running-sessions";

const COMPACT_SNAP_POINTS = ["45%", "85%"];

const ThemedArrowUpRight = withUnistyles(ArrowUpRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPin = withUnistyles(Pin, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const triggerStyle = ({
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

const compactTriggerStyle = ({ pressed }: { pressed: boolean }) => [
  styles.trigger,
  pressed ? styles.triggerPressed : null,
];

const rowPrimaryStyle = ({ pressed, hovered = false }: { pressed: boolean; hovered?: boolean }) => [
  styles.rowPrimary,
  hovered ? styles.rowHovered : null,
  pressed ? styles.rowPressed : null,
];

interface StatusBarSessionPinListItem {
  serverId: string;
  serverLabel?: string;
  pin: StatusPinnedSession;
}

export function StatusBarSessionPinsTrigger({
  serverId,
  sessionPinSources,
}: {
  serverId: string;
  sessionPinSources: StatusBarSessionPinSource[];
}) {
  const isCompact = useIsCompactFormFactor();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sheetHeader = useMemo(() => ({ title: t("statusBar.pins.title") }), [t]);
  const items = useMemo(
    () =>
      sessionPinSources.flatMap((source) =>
        source.canUseStatusBarSessionPins
          ? source.pinnedSessions.map((pin) => ({
              serverId: source.serverId,
              serverLabel: source.serverLabel,
              pin,
            }))
          : [],
      ),
    [sessionPinSources],
  );
  const hasPins = items.length > 0;
  const showServerLabel = sessionPinSources.length > 1;

  useEffect(() => {
    setOpen(false);
  }, [pathname, serverId]);

  const handleNavigate = useCallback(
    (item: StatusBarSessionPinListItem) => {
      const target: StatusBarSessionTarget = {
        kind: "agent",
        serverId: item.serverId,
        agentId: item.pin.agentId,
        workspaceId: item.pin.workspaceId ?? null,
      };
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
    setOpen(true);
  }, []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (!hasPins) {
    return null;
  }

  const content = (
    <StatusBarSessionPinsList
      items={items}
      onNavigate={handleNavigate}
      showServerLabel={showServerLabel}
    />
  );
  const triggerBody = (
    <>
      <ThemedPin size={12} />
      <Text style={styles.triggerLabel} numberOfLines={1}>
        {t("statusBar.pins.trigger")}
      </Text>
      <Text style={styles.triggerValue} numberOfLines={1}>
        {items.length}
      </Text>
    </>
  );

  if (isCompact) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("statusBar.pins.title")}
          onPress={handleCompactOpen}
          style={compactTriggerStyle}
          testID="status-bar-pins-trigger"
        >
          {triggerBody}
        </Pressable>
        <AdaptiveModalSheet
          header={sheetHeader}
          visible={open}
          onClose={handleClose}
          snapPoints={COMPACT_SNAP_POINTS}
          testID="status-bar-pins-sheet"
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
        accessibilityLabel={t("statusBar.pins.title")}
        style={triggerStyle}
        testID="status-bar-pins-trigger"
      >
        {triggerBody}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        width={320}
        maxHeight={360}
        scrollable
        testID="status-bar-pins-panel"
      >
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusBarSessionPinsList({
  items,
  onNavigate,
  showServerLabel,
}: {
  items: StatusBarSessionPinListItem[];
  onNavigate: (item: StatusBarSessionPinListItem) => void;
  showServerLabel: boolean;
}) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <View style={styles.emptyState} testID="status-bar-pins-empty">
        <Text style={styles.emptyText}>{t("statusBar.pins.empty")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.list} testID="status-bar-pins-list">
      {items.map((item) => (
        <StatusBarSessionPinRow
          key={`${item.serverId}:${item.pin.agentId}`}
          item={item}
          onNavigate={onNavigate}
          showServerLabel={showServerLabel}
        />
      ))}
    </View>
  );
}

function StatusBarSessionPinRow({
  item,
  onNavigate,
  showServerLabel,
}: {
  item: StatusBarSessionPinListItem;
  onNavigate: (item: StatusBarSessionPinListItem) => void;
  showServerLabel: boolean;
}) {
  const { t } = useTranslation();
  const { pin } = item;
  const title = pin.title?.trim() || t("agentList.fallbackTitle");
  const hasHistorySnapshot = Boolean(pin.provider && pin.cwd && pin.status);
  const updatedAt = parsePinUpdatedAt(pin.updatedAt);
  const subtitle = hasHistorySnapshot
    ? formatHistorySubtitle({ cwd: pin.cwd ?? "", provider: pin.provider ?? "" })
    : (pin.provider ?? pin.agentId);
  const meta = [
    showServerLabel ? item.serverLabel : null,
    updatedAt ? formatStatusBarHistoryMeta({ lastActivityAt: updatedAt }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const handlePress = useCallback(() => {
    onNavigate(item);
  }, [item, onNavigate]);

  return (
    <View style={styles.row} testID={`status-bar-pin-row-${pin.agentId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.pins.actions.openSession", { title })}
        onPress={handlePress}
        style={rowPrimaryStyle}
      >
        <ThemedPin size={14} />
        <View style={styles.rowText}>
          <View style={styles.historyTitleRow}>
            <Text style={styles.historyTitleText} numberOfLines={1}>
              {title}
            </Text>
            {hasHistorySnapshot ? <StatusBarPinnedSessionStatus pin={pin} /> : null}
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
          {meta ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <ThemedArrowUpRight size={14} />
      </Pressable>
    </View>
  );
}

function StatusBarPinnedSessionStatus({ pin }: { pin: StatusPinnedSession }) {
  const { t } = useTranslation();
  const status = pin.status ?? "closed";
  const label = formatStatusBarHistoryStatus(
    {
      status,
      requiresAttention: pin.requiresAttention,
      attentionReason: pin.attentionReason,
      pendingPermissionCount: pin.pendingPermissionCount,
    },
    t,
  );

  return (
    <View style={styles.historyStatus} testID={`status-bar-pin-status-${pin.agentId}`}>
      <AgentStatusDot
        status={status}
        requiresAttention={pin.requiresAttention}
        attentionReason={pin.attentionReason}
        pendingPermissionCount={pin.pendingPermissionCount}
        showInactive
      />
      <Text style={styles.historyStatusText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function parsePinUpdatedAt(updatedAt: string | null | undefined): Date | null {
  if (!updatedAt) {
    return null;
  }
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    minWidth: 76,
    maxWidth: 120,
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
  list: {
    minWidth: 0,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  row: {
    minWidth: 0,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "stretch",
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
  historyTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  historyTitleText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    minWidth: 0,
    flexShrink: 1,
  },
  historyStatus: {
    flexShrink: 0,
    maxWidth: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  historyStatusText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
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
  emptyState: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
