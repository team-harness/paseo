import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { usePathname } from "expo-router";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  CirclePlay,
  CircleX,
  Pin,
  PinOff,
  RefreshCw,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react-native";
import type { StatusAgentSnapshot, StatusPinnedSession } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAgentHistory } from "@/hooks/use-agent-history";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { useQueryClient } from "@tanstack/react-query";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";
import { AgentStatusDot } from "@/components/agent-status-dot";
import {
  buildStatusBarSessionList,
  navigateToStatusBarSession,
  type StatusBarSessionListItem,
  type StatusBarSessionIdentity,
  type StatusBarSessionTarget,
} from "./status-bar-session-navigation";
import {
  formatStatusBarSessionMeta,
  formatStatusBarSessionSubtitle,
  formatStatusBarSessionTitle,
  formatStatusBarSessionUsage,
} from "./status-bar-session-format";

const HISTORY_LIMIT = 10;
const EMPTY_PINNED_SESSIONS: StatusPinnedSession[] = [];

const ThemedArrowUpRight = withUnistyles(ArrowUpRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedBriefcaseBusiness = withUnistyles(BriefcaseBusiness, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedRefreshCw = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTriangleAlert = withUnistyles(TriangleAlert, (theme) => ({
  color: theme.colors.statusWarning,
}));
const ThemedCirclePlay = withUnistyles(CirclePlay, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedCircleX = withUnistyles(CircleX, (theme) => ({
  color: theme.colors.palette.red[500],
}));
const ThemedPin = withUnistyles(Pin, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPinOff = withUnistyles(PinOff, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedCheckCircle2 = withUnistyles(CheckCircle2, (theme) => ({
  color: theme.colors.palette.green[500],
}));
const ThemedShieldQuestion = withUnistyles(ShieldQuestion, (theme) => ({
  color: theme.colors.statusWarning,
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

const historyRefreshButtonStyle = ({
  pressed,
  hovered = false,
}: {
  pressed: boolean;
  hovered?: boolean;
}) => [
  styles.historyRefreshButton,
  hovered ? styles.iconButtonHovered : null,
  pressed ? styles.iconButtonPressed : null,
];

const historyRefreshButtonDisabledStyle = () => [
  styles.historyRefreshButton,
  styles.iconButtonDisabled,
];
const disabledIconButtonStyle = () => [styles.iconButton, styles.iconButtonDisabled];

interface StatusBarRunningSessionsTriggerProps {
  serverId: string;
  runningAgents: StatusAgentSnapshot[];
  needsAttentionAgents: StatusAgentSnapshot[];
  recentlyCompletedAgents: StatusAgentSnapshot[];
  pinnedSessions?: StatusPinnedSession[];
  canUseStatusBarSessionPins?: boolean;
}

export function StatusBarRunningSessionsTrigger({
  runningAgents,
  needsAttentionAgents,
  recentlyCompletedAgents,
  ...interactiveProps
}: StatusBarRunningSessionsTriggerProps) {
  const hasSessionSnapshots =
    runningAgents.length > 0 ||
    needsAttentionAgents.length > 0 ||
    recentlyCompletedAgents.length > 0;

  if (!hasSessionSnapshots) {
    return <SessionStatusStaticView />;
  }

  return (
    <InteractiveRunningSessionsTrigger
      {...interactiveProps}
      runningAgents={runningAgents}
      needsAttentionAgents={needsAttentionAgents}
      recentlyCompletedAgents={recentlyCompletedAgents}
    />
  );
}

function SessionStatusStaticView() {
  const { t } = useTranslation();

  return (
    <View style={styles.trigger} testID="status-bar-sessions-static">
      <TriggerContent runningCount={0} label={t("statusBar.sessions.trigger")} />
    </View>
  );
}

function InteractiveRunningSessionsTrigger({
  serverId,
  runningAgents,
  needsAttentionAgents,
  recentlyCompletedAgents,
  pinnedSessions = EMPTY_PINNED_SESSIONS,
  canUseStatusBarSessionPins = false,
}: StatusBarRunningSessionsTriggerProps) {
  const isCompact = useIsCompactFormFactor();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sheetHeader = useMemo(() => ({ title: t("statusBar.sessions.title") }), [t]);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const liveWorkspaceIds = useMemo(() => new Set(workspaces?.keys() ?? []), [workspaces]);
  const agentHierarchy = useMemo<ReadonlyMap<string, StatusBarSessionIdentity>>(
    () =>
      new Map(
        [...(agents?.values() ?? [])].map((agent) => [
          agent.id,
          {
            agentId: agent.id,
            parentAgentId: agent.parentAgentId,
            provider: agent.provider,
            cwd: agent.cwd,
            workspaceId: agent.workspaceId ?? null,
            title: agent.title,
          },
        ]),
      ),
    [agents],
  );
  const items = useMemo(
    () =>
      buildStatusBarSessionList({
        serverId,
        needsAttentionAgents,
        runningAgents,
        recentlyCompletedAgents,
        liveWorkspaceIds,
        agentHierarchy,
      }),
    [
      agentHierarchy,
      liveWorkspaceIds,
      needsAttentionAgents,
      recentlyCompletedAgents,
      runningAgents,
      serverId,
    ],
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
          <StatusBarSessionsList
            items={items}
            onNavigate={handleNavigate}
            pinnedSessions={pinnedSessions}
            canUseStatusBarSessionPins={canUseStatusBarSessionPins}
          />
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
        <StatusBarSessionsList
          items={items}
          onNavigate={handleNavigate}
          pinnedSessions={pinnedSessions}
          canUseStatusBarSessionPins={canUseStatusBarSessionPins}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StatusBarSessionHistoryTrigger({
  serverId,
  pinnedSessions = EMPTY_PINNED_SESSIONS,
  canUseStatusBarSessionPins = false,
}: {
  serverId: string;
  pinnedSessions?: StatusPinnedSession[];
  canUseStatusBarSessionPins?: boolean;
}) {
  const isCompact = useIsCompactFormFactor();
  const pathname = usePathname();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { agents, isInitialLoad, isError, isRevalidating, refreshAll } = useAgentHistory({
    serverId,
  });
  const [open, setOpen] = useState(false);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const sheetHeader = useMemo(() => ({ title: t("statusBar.history.title") }), [t]);
  const items = useMemo(
    () => agents.filter(isStatusBarHistoryVisible).slice(0, HISTORY_LIMIT),
    [agents],
  );
  const isRefreshing = isManualRefresh || isRevalidating;

  useEffect(() => {
    setOpen(false);
  }, [pathname, serverId]);

  const refreshHistory = useCallback(() => {
    if (isInitialLoad || isRefreshing) {
      return;
    }
    setIsManualRefresh(true);
    void refreshAll().finally(() => {
      setIsManualRefresh(false);
    });
  }, [isInitialLoad, isRefreshing, refreshAll]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        refreshHistory();
      }
    },
    [refreshHistory],
  );

  const handleNavigate = useCallback(
    (agent: AggregatedAgent) => {
      setOpen(false);
      const openAgent = () => {
        navigateToAgent({
          serverId: agent.serverId,
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          pin: false,
        });
      };

      const navigate = () => {
        if (isCompact) {
          requestAnimationFrame(openAgent);
          return;
        }
        openAgent();
      };

      if (agent.archivedAt) {
        const client = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
        if (client) {
          void client
            .refreshAgent(agent.id)
            .then(() => {
              navigate();
              return queryClient.invalidateQueries({
                queryKey: agentHistoryQueryKey(agent.serverId),
              });
            })
            .catch(() => {});
          return;
        }
      }

      navigate();
    },
    [isCompact, queryClient],
  );

  const handleCompactOpen = useCallback(() => {
    handleOpenChange(true);
  }, [handleOpenChange]);

  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const triggerBody = (
    <TriggerContent count={items.length} label={t("statusBar.history.trigger")} />
  );

  if (isCompact) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("statusBar.history.title")}
          onPress={handleCompactOpen}
          style={compactTriggerStyle}
          testID="status-bar-history-trigger"
        >
          {triggerBody}
        </Pressable>
        <AdaptiveModalSheet
          header={sheetHeader}
          visible={open}
          onClose={handleClose}
          snapPoints={COMPACT_SNAP_POINTS}
          testID="status-bar-history-sheet"
        >
          <StatusBarHistoryList
            items={items}
            isLoading={isInitialLoad}
            isError={isError}
            isRefreshing={isRefreshing}
            pinnedSessions={pinnedSessions}
            canUseStatusBarSessionPins={canUseStatusBarSessionPins}
            onRefresh={refreshHistory}
            onNavigate={handleNavigate}
          />
        </AdaptiveModalSheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.history.title")}
        style={desktopTriggerStyle}
        testID="status-bar-history-trigger"
      >
        {triggerBody}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        width={360}
        maxHeight={420}
        scrollable
        testID="status-bar-history-panel"
      >
        <StatusBarHistoryList
          items={items}
          isLoading={isInitialLoad}
          isError={isError}
          isRefreshing={isRefreshing}
          pinnedSessions={pinnedSessions}
          canUseStatusBarSessionPins={canUseStatusBarSessionPins}
          onRefresh={refreshHistory}
          onNavigate={handleNavigate}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isStatusBarHistoryVisible(agent: AggregatedAgent): boolean {
  return agent.status !== "closed" && getParentAgentIdFromLabels(agent.labels) === null;
}

function TriggerContent({
  attentionCount,
  count,
  label,
  runningCount,
}: {
  attentionCount?: number;
  count?: number;
  label: string;
  runningCount?: number;
}) {
  return (
    <>
      <Text style={styles.triggerLabel} numberOfLines={1}>
        {label}
      </Text>
      {attentionCount !== undefined && attentionCount > 0 ? (
        <TriggerMetric
          kind="attention"
          value={attentionCount}
          valueStyle={styles.triggerAttentionValue}
          testID="status-bar-sessions-attention-count"
        />
      ) : null}
      {runningCount !== undefined ? (
        <TriggerMetric
          kind="running"
          value={runningCount}
          valueStyle={styles.triggerValue}
          testID="status-bar-sessions-running-count"
        />
      ) : null}
      {count !== undefined ? (
        <Text style={styles.triggerValue} numberOfLines={1}>
          {count}
        </Text>
      ) : null}
    </>
  );
}

function TriggerMetric({
  kind,
  testID,
  value,
  valueStyle,
}: {
  kind: "attention" | "running";
  testID: string;
  value: number;
  valueStyle: TextStyle;
}) {
  return (
    <View style={styles.triggerMetric} testID={testID}>
      {kind === "attention" ? <ThemedTriangleAlert size={12} /> : <ThemedCirclePlay size={12} />}
      <Text style={valueStyle} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function StatusBarSessionsList({
  items,
  onNavigate,
  pinnedSessions = EMPTY_PINNED_SESSIONS,
  canUseStatusBarSessionPins = false,
}: {
  items: StatusBarSessionListItem[];
  onNavigate: (target: StatusBarSessionTarget) => void;
  pinnedSessions?: StatusPinnedSession[];
  canUseStatusBarSessionPins?: boolean;
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
              <StatusBarSessionRow
                key={item.key}
                item={item}
                onNavigate={onNavigate}
                pinnedSessions={pinnedSessions}
                canUseStatusBarSessionPins={canUseStatusBarSessionPins}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function StatusBarHistoryList({
  items,
  isError,
  isLoading,
  isRefreshing,
  pinnedSessions,
  canUseStatusBarSessionPins,
  onRefresh,
  onNavigate,
}: {
  items: AggregatedAgent[];
  isError: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  pinnedSessions: StatusPinnedSession[];
  canUseStatusBarSessionPins: boolean;
  onRefresh: () => void;
  onNavigate: (agent: AggregatedAgent) => void;
}) {
  const { t } = useTranslation();
  const refreshDisabled = isLoading || isRefreshing;
  const refreshButtonStyle = refreshDisabled
    ? historyRefreshButtonDisabledStyle
    : historyRefreshButtonStyle;
  const refreshLabel = t(
    isRefreshing ? "statusBar.history.actions.refreshing" : "statusBar.history.actions.refresh",
  );
  const content = (() => {
    if (isLoading) {
      return (
        <View style={styles.emptyState} testID="status-bar-history-loading">
          <Text style={styles.emptyText}>{t("statusBar.history.loading")}</Text>
        </View>
      );
    }
    if (isError && items.length === 0) {
      return (
        <View style={styles.emptyState} testID="status-bar-history-error">
          <Text style={styles.emptyText}>{t("statusBar.history.error")}</Text>
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={styles.emptyState} testID="status-bar-history-empty">
          <Text style={styles.emptyText}>{t("statusBar.history.empty")}</Text>
        </View>
      );
    }

    return (
      <View style={styles.groupRows}>
        {items.map((item) => (
          <StatusBarHistoryRow
            key={`${item.serverId}:${item.id}`}
            item={item}
            onNavigate={onNavigate}
            pinnedSessions={pinnedSessions}
            canUseStatusBarSessionPins={canUseStatusBarSessionPins}
          />
        ))}
      </View>
    );
  })();

  return (
    <View style={styles.list} testID="status-bar-history-list">
      <View style={styles.group}>
        <View style={styles.historyHeader}>
          <Text style={styles.historyHeaderLabel} numberOfLines={1}>
            {t("statusBar.history.group")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={refreshLabel}
            disabled={refreshDisabled}
            hitSlop={6}
            onPress={onRefresh}
            style={refreshButtonStyle}
            testID="status-bar-history-refresh"
          >
            <ThemedRefreshCw size={14} />
          </Pressable>
        </View>
        {content}
      </View>
    </View>
  );
}

function StatusBarHistoryRow({
  item,
  onNavigate,
  pinnedSessions,
  canUseStatusBarSessionPins,
}: {
  item: AggregatedAgent;
  onNavigate: (agent: AggregatedAgent) => void;
  pinnedSessions: StatusPinnedSession[];
  canUseStatusBarSessionPins: boolean;
}) {
  const { t } = useTranslation();
  const title = item.title?.trim() || t("agentList.fallbackTitle");
  const subtitle = formatHistorySubtitle(item);
  const meta = formatStatusBarHistoryMeta(item);
  const handlePress = useCallback(() => {
    onNavigate(item);
  }, [item, onNavigate]);

  return (
    <View style={styles.row} testID={`status-bar-history-row-${item.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.history.actions.openAgent", { title })}
        onPress={handlePress}
        style={rowPrimaryStyle}
      >
        <View style={styles.rowText}>
          <View style={styles.historyTitleRow}>
            <Text style={styles.historyTitleText} numberOfLines={1}>
              {title}
            </Text>
            <StatusBarHistoryStatus agent={item} />
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <ThemedArrowUpRight size={14} />
      </Pressable>
      {canUseStatusBarSessionPins ? (
        <SessionPinButton
          serverId={item.serverId}
          agentId={item.id}
          workspaceId={item.workspaceId ?? null}
          title={title}
          provider={item.provider}
          cwd={item.cwd}
          status={item.status}
          requiresAttention={item.requiresAttention}
          attentionReason={item.attentionReason}
          pendingPermissionCount={item.pendingPermissionCount}
          updatedAt={item.lastActivityAt.toISOString()}
          pinned={pinnedSessions.some((pin) => pin.agentId === item.id)}
          testID={`status-bar-history-pin-${item.id}`}
        />
      ) : null}
    </View>
  );
}

function StatusBarHistoryStatus({ agent }: { agent: AggregatedAgent }) {
  const { t } = useTranslation();
  const label = formatStatusBarHistoryStatus(agent, t);

  return (
    <View style={styles.historyStatus} testID={`status-bar-history-status-${agent.id}`}>
      <AgentStatusDot
        status={agent.status}
        requiresAttention={agent.requiresAttention}
        attentionReason={agent.attentionReason}
        pendingPermissionCount={agent.pendingPermissionCount}
        showInactive
      />
      <Text style={styles.historyStatusText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function SessionPinButton({
  agentId,
  attentionReason,
  cwd,
  pendingPermissionCount,
  pinned,
  provider,
  requiresAttention,
  serverId,
  status,
  testID,
  title,
  updatedAt,
  workspaceId,
}: {
  agentId: string;
  attentionReason?: "finished" | "error" | "permission" | null;
  cwd: string | null;
  pendingPermissionCount?: number;
  pinned: boolean;
  provider: StatusAgentSnapshot["provider"];
  requiresAttention?: boolean;
  serverId: string;
  status: StatusAgentSnapshot["status"] | null;
  testID: string;
  title: string | null;
  updatedAt: string | null;
  workspaceId: string | null;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const nextPinned = !pinned;
  const label = t(
    pinned ? "statusBar.pins.actions.unpinSession" : "statusBar.pins.actions.pinSession",
    { title: title ?? agentId },
  );
  const handlePress = useCallback(() => {
    if (pending) {
      return;
    }
    const client = useSessionStore.getState().sessions[serverId]?.client;
    if (!client?.setStatusSessionPin) {
      return;
    }
    setPending(true);
    void client
      .setStatusSessionPin({
        agentId,
        pinned: nextPinned,
        workspaceId,
        title,
        provider,
        cwd,
        status,
        requiresAttention,
        attentionReason,
        pendingPermissionCount,
        updatedAt,
      })
      .catch(() => {})
      .finally(() => {
        setPending(false);
      });
  }, [
    agentId,
    attentionReason,
    cwd,
    nextPinned,
    pending,
    pendingPermissionCount,
    provider,
    requiresAttention,
    serverId,
    status,
    title,
    updatedAt,
    workspaceId,
  ]);

  return (
    <IconButton accessibilityLabel={label} disabled={pending} onPress={handlePress} testID={testID}>
      {pinned ? <ThemedPinOff size={14} /> : <ThemedPin size={14} />}
    </IconButton>
  );
}

function StatusBarSessionRow({
  item,
  onNavigate,
  pinnedSessions,
  canUseStatusBarSessionPins,
}: {
  item: StatusBarSessionListItem;
  onNavigate: (target: StatusBarSessionTarget) => void;
  pinnedSessions: StatusPinnedSession[];
  canUseStatusBarSessionPins: boolean;
}) {
  const { t } = useTranslation();
  const usage = formatStatusBarSessionUsage(item.snapshot);
  const statusLabel = formatStatusBarSessionStatus(item.snapshot, item.group, t);
  const meta = [statusLabel, usage, formatStatusBarSessionMeta(item.snapshot)]
    .filter(Boolean)
    .join(" · ");
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
        <SessionStatusIcon snapshot={item.snapshot} group={item.group} />
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
      {canUseStatusBarSessionPins ? (
        <SessionPinButton
          serverId={item.primaryTarget.serverId}
          agentId={item.snapshot.agentId}
          workspaceId={item.snapshot.workspaceId ?? null}
          title={title}
          provider={item.snapshot.provider}
          cwd={item.snapshot.cwd}
          status={item.snapshot.status}
          requiresAttention={Boolean(item.snapshot.attentionReason)}
          attentionReason={item.snapshot.attentionReason}
          pendingPermissionCount={0}
          updatedAt={item.snapshot.updatedAt}
          pinned={pinnedSessions.some((pin) => pin.agentId === item.snapshot.agentId)}
          testID={`status-bar-session-pin-${item.snapshot.agentId}`}
        />
      ) : null}
    </View>
  );
}

function SessionStatusIcon({
  group,
  snapshot,
}: {
  group: StatusBarSessionListItem["group"];
  snapshot: StatusAgentSnapshot;
}) {
  const icon = (() => {
    if (snapshot.attentionReason === "permission") {
      return <ThemedShieldQuestion size={14} />;
    }
    if (snapshot.attentionReason === "error" || snapshot.status === "error") {
      return <ThemedCircleX size={14} />;
    }
    if (snapshot.attentionReason === "finished") {
      return <ThemedCheckCircle2 size={14} />;
    }
    if (group === "running" || snapshot.status === "running") {
      return <ThemedCirclePlay size={14} />;
    }
    return <ThemedTriangleAlert size={14} />;
  })();

  return <View style={styles.rowStatusIcon}>{icon}</View>;
}

function formatStatusBarSessionStatus(
  snapshot: StatusAgentSnapshot,
  group: StatusBarSessionListItem["group"],
  t: (key: string) => string,
): string | null {
  if (snapshot.attentionReason === "permission") {
    return t("statusBar.sessions.status.permission");
  }
  if (snapshot.attentionReason === "error" || snapshot.status === "error") {
    return t("statusBar.sessions.status.error");
  }
  if (snapshot.attentionReason === "finished") {
    return t("statusBar.sessions.status.finished");
  }
  if (group === "running" || snapshot.status === "running") {
    return t("statusBar.sessions.status.active");
  }
  return null;
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
  disabled = false,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={disabled ? disabledIconButtonStyle : iconButtonStyle}
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

export function formatHistorySubtitle(agent: Pick<AggregatedAgent, "cwd" | "provider">): string {
  const cwd = formatCwd(agent.cwd);
  return cwd ? `${agent.provider} · ${cwd}` : agent.provider;
}

export function formatStatusBarHistoryMeta(agent: Pick<AggregatedAgent, "lastActivityAt">): string {
  return formatTimeAgo(agent.lastActivityAt);
}

export function formatStatusBarHistoryStatus(
  agent: Pick<
    AggregatedAgent,
    "attentionReason" | "pendingPermissionCount" | "requiresAttention" | "status"
  >,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const pendingPermissionCount = agent.pendingPermissionCount ?? 0;
  if (pendingPermissionCount > 0) {
    return t("agentList.badges.pending", { count: pendingPermissionCount });
  }
  if (agent.attentionReason === "permission") {
    return t("agentList.badges.attention");
  }
  if (agent.status === "error" || agent.attentionReason === "error") {
    return t("agentList.status.error");
  }
  if (agent.status === "running") {
    return t("agentList.status.running");
  }
  if (agent.requiresAttention) {
    return t("agentList.badges.attention");
  }
  if (agent.status === "initializing") {
    return t("agentList.status.initializing");
  }
  if (agent.status === "idle") {
    return t("agentList.status.idle");
  }
  return t("agentList.status.closed");
}

function formatCwd(cwd: string): string {
  const normalized = cwd.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  const segments = normalized.split("/");
  const lastSegment = segments.findLast(Boolean);
  return lastSegment ?? normalized;
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
  triggerMetric: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0],
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
  historyHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  historyHeaderLabel: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
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
  rowStatusIcon: {
    width: 14,
    alignItems: "center",
    justifyContent: "center",
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
  iconButtonDisabled: {
    opacity: theme.opacity[50],
  },
  historyRefreshButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
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
