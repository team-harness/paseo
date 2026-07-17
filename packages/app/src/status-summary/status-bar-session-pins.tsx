import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { usePathname } from "expo-router";
import { ArrowUpRight, Pin } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { splitPinnedSidebarGroups, usePinnedSidebarKeys } from "@/hooks/use-sidebar-pins";
import {
  useSidebarWorkspacesList,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useHosts } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

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

export function StatusBarSessionPinsTrigger({ serverId }: { serverId: string }) {
  const isCompact = useIsCompactFormFactor();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { projects } = useSidebarWorkspacesList();
  const pinnedKeys = usePinnedSidebarKeys(projects);
  const { pinnedChats } = useMemo(
    () => splitPinnedSidebarGroups({ projects, keys: pinnedKeys }),
    [pinnedKeys, projects],
  );
  const hosts = useHosts();
  const [open, setOpen] = useState(false);
  const sheetHeader = useMemo(() => ({ title: t("statusBar.pins.title") }), [t]);
  const hostLabelByServerId = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label?.trim() || host.serverId])),
    [hosts],
  );
  const showHostLabel = new Set(pinnedChats.map((workspace) => workspace.serverId)).size > 1;

  useEffect(() => {
    setOpen(false);
  }, [pathname, serverId]);

  const handleNavigate = useCallback(
    (workspace: SidebarWorkspacePlacement) => {
      setOpen(false);
      const openWorkspace = () => {
        navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
      };
      if (isCompact) {
        requestAnimationFrame(openWorkspace);
        return;
      }
      openWorkspace();
    },
    [isCompact],
  );
  const handleCompactOpen = useCallback(() => {
    setOpen(true);
  }, []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (pinnedChats.length === 0) {
    return null;
  }

  const content = (
    <StatusBarSessionPinsList
      hostLabelByServerId={hostLabelByServerId}
      items={pinnedChats}
      showHostLabel={showHostLabel}
      onNavigate={handleNavigate}
    />
  );
  const triggerBody = (
    <>
      <ThemedPin size={12} />
      <Text style={styles.triggerLabel} numberOfLines={1}>
        {t("statusBar.pins.trigger")}
      </Text>
      <Text style={styles.triggerValue} numberOfLines={1}>
        {pinnedChats.length}
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
  hostLabelByServerId,
  items,
  showHostLabel,
  onNavigate,
}: {
  hostLabelByServerId: ReadonlyMap<string, string>;
  items: SidebarWorkspacePlacement[];
  showHostLabel: boolean;
  onNavigate: (workspace: SidebarWorkspacePlacement) => void;
}) {
  return (
    <View style={styles.list} testID="status-bar-pins-list">
      {items.map((workspace) => (
        <StatusBarSessionPinRow
          hostLabel={hostLabelByServerId.get(workspace.serverId) ?? workspace.serverId}
          key={workspace.workspaceKey}
          workspace={workspace}
          showHostLabel={showHostLabel}
          onNavigate={onNavigate}
        />
      ))}
    </View>
  );
}

function StatusBarSessionPinRow({
  hostLabel,
  workspace,
  showHostLabel,
  onNavigate,
}: {
  hostLabel: string;
  workspace: SidebarWorkspacePlacement;
  showHostLabel: boolean;
  onNavigate: (workspace: SidebarWorkspacePlacement) => void;
}) {
  const { t } = useTranslation();
  const subtitle = showHostLabel
    ? `${workspace.projectName} · ${hostLabel}`
    : workspace.projectName;
  const handlePress = useCallback(() => {
    onNavigate(workspace);
  }, [onNavigate, workspace]);

  return (
    <View style={styles.row} testID={`status-bar-pin-row-${workspace.workspaceId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("statusBar.pins.actions.openSession", { title: workspace.name })}
        onPress={handlePress}
        style={rowPrimaryStyle}
      >
        <ThemedPin size={14} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {workspace.name}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <ThemedArrowUpRight size={14} />
      </Pressable>
    </View>
  );
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
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
