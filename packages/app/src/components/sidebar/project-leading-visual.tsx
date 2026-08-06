import type { ReactNode } from "react";
import { ActivityIndicator, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react-native";
import { ProjectIconView } from "@/components/project-icon-view";
import { SyncedLoader } from "@/components/synced-loader";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import {
  getProjectStatusBadgeContent,
  type ProjectStatusBadgeContent,
  type ProjectStatusBadgeDotBucket,
} from "@/utils/project-status-badge-content";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { STATUS_INDICATOR_ALERT_SIZE } from "@/utils/status-indicator-geometry";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";

// Every surfaced status shares one badge shell, so the badge never changes size or position
// between states. Only the thing inside it changes.
const STATUS_BADGE_SIZE = 12;
// How far the badge overhangs the icon's bottom-right corner. Well short of half the badge:
// centered on the corner it reads as hanging off the icon rather than sitting on it, and the
// sidebar row has no padding there to absorb the overhang.
const STATUS_BADGE_OFFSET = -4;
// Both glyphs must be EVEN. A centered glyph of size N sits at a (12 - N) / 2 offset — fractional
// for odd N, which the browser snaps to a device-pixel boundary and renders visibly off-center (an
// odd size measured 1.5 device px right and down at 3x, ~3px of asymmetry between opposite gaps).
// Even sizes divide the shell into whole pixels and land dead center with no correction.
//
// Needs-input fills the badge shell while passive failed/attention states stay smaller.
const STATUS_BADGE_DOT_SIZE = 6;
// SyncedLoader clamps its dot size at 2px, so sizes 5-10 all render the same 5x8 dot grid.
const STATUS_BADGE_LOADER_SIZE = 7;
// The dot-comet reads a hair right inside the round badge; this optical nudge centers it.
const STATUS_BADGE_LOADER_NUDGE_X = -0.67;
// Matches the workspace title's lineHeight (sidebar-workspace-row-content's
// workspaceBranchText) so the icon centers on the title rather than floating above it.
const LEADING_SLOT_HEIGHT = 20;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedSyncedLoader = withUnistyles(SyncedLoader);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});
const syncedLoaderColorMapping = (theme: Theme) => ({
  color: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
});

/**
 * Leading slot of a sidebar project row: chevron on hover, archive spinner while removing,
 * otherwise the project icon carrying the project's aggregate workspace status.
 */
export function ProjectLeadingVisual({
  displayName,
  iconDataUri,
  statusBucket,
  projectViewKey,
  backdrop,
  chevron = null,
  showChevron = false,
  isArchiving = false,
}: {
  displayName: string;
  iconDataUri: string | null;
  /** Aggregate status of the project's workspaces; null when it shouldn't be surfaced. */
  statusBucket: SidebarStateBucket | null;
  projectViewKey: string;
  /** The row's current background, so the status badge can knock out of it. */
  backdrop: SurfaceBackdrop;
  chevron?: "expand" | "collapse" | null;
  showChevron?: boolean;
  isArchiving?: boolean;
}) {
  if (showChevron && chevron !== null) {
    return (
      <View style={styles.projectLeadingVisualSlot}>
        <ProjectInlineChevron chevron={chevron} />
      </View>
    );
  }

  if (isArchiving) {
    return (
      <View style={styles.projectLeadingVisualSlot} testID="project-status-indicator-archiving">
        <ThemedActivityIndicator size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  return (
    <ProjectStatusIndicator
      iconDataUri={iconDataUri}
      displayName={displayName}
      projectViewKey={projectViewKey}
      statusBucket={statusBucket}
      backdrop={backdrop}
    />
  );
}

// The project icon (the lettered box) is what marks a row as a *project* rather than a
// workspace, so it always stays and status annotates it instead of replacing it. Every
// surfaced bucket lands in the identical corner badge — a synchronized loader for running,
// an amber alert glyph for needs_input, colored dots for failed/attention, and nothing for
// done — so the badge reads as one fixed shell and only its contents change.
export function ProjectStatusIndicator({
  iconDataUri,
  displayName,
  projectViewKey,
  statusBucket,
  backdrop,
  loading = false,
  loadingAccessibilityLabel = "Loading",
  testID,
}: {
  iconDataUri: string | null;
  displayName: string;
  projectViewKey: string;
  statusBucket: SidebarStateBucket | null;
  /** The row's current background, so the status badge can knock out of it. */
  backdrop: SurfaceBackdrop;
  loading?: boolean;
  loadingAccessibilityLabel?: string;
  testID?: string;
}) {
  const placeholderInitial = projectIconPlaceholderLabelFromDisplayName(displayName)
    .charAt(0)
    .toUpperCase();
  const badgeContent = getProjectStatusBadgeContent(statusBucket);
  const accessibilityLabel = getProjectStatusAccessibilityLabel({
    loading,
    loadingAccessibilityLabel,
    statusBucket,
  });
  const indicatorTestID = getProjectStatusIndicatorTestID({ loading, statusBucket, testID });
  const statusBadge = renderProjectStatusBadge({ loading, badgeContent, backdrop });

  return (
    <View
      role={accessibilityLabel ? "status" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={styles.projectLeadingVisualSlot}
      testID={indicatorTestID}
    >
      <View style={styles.projectIconBox}>
        <ProjectIcon
          iconDataUri={iconDataUri}
          placeholderInitial={placeholderInitial}
          projectViewKey={projectViewKey}
        />
        {statusBadge}
      </View>
    </View>
  );
}

function getProjectStatusAccessibilityLabel({
  loading,
  loadingAccessibilityLabel,
  statusBucket,
}: {
  loading: boolean;
  loadingAccessibilityLabel: string;
  statusBucket: SidebarStateBucket | null;
}): string | undefined {
  if (loading) return loadingAccessibilityLabel;
  if (statusBucket) return STATUS_BUCKET_LABELS[statusBucket];
  return undefined;
}

function getProjectStatusIndicatorTestID({
  loading,
  statusBucket,
  testID,
}: {
  loading: boolean;
  statusBucket: SidebarStateBucket | null;
  testID?: string;
}): string {
  if (testID) return testID;
  if (loading) return "project-status-indicator-loading";
  if (statusBucket && statusBucket !== "done") {
    return `project-status-indicator-${statusBucket}`;
  }
  return "project-icon-only";
}

function renderProjectStatusBadge({
  loading,
  badgeContent,
  backdrop,
}: {
  loading: boolean;
  badgeContent: ProjectStatusBadgeContent | null;
  backdrop: SurfaceBackdrop;
}): ReactNode {
  if (loading) {
    return (
      <ProjectStatusBadge backdrop={backdrop}>
        <View testID="sidebar-status-visual-loading-spinner">
          <ThemedActivityIndicator size={8} uniProps={foregroundMutedColorMapping} />
        </View>
      </ProjectStatusBadge>
    );
  }
  if (badgeContent === null) return null;
  return (
    <ProjectStatusBadge backdrop={backdrop}>
      {renderProjectStatusBadgeContent(badgeContent)}
    </ProjectStatusBadge>
  );
}

function ProjectStatusBadge({
  children,
  backdrop,
}: {
  children: ReactNode;
  backdrop: SurfaceBackdrop;
}) {
  return (
    <View
      style={[styles.statusBadge, getStatusBadgeBackdropStyle(backdrop)]}
      testID="project-status-badge"
    >
      {children}
    </View>
  );
}

function renderProjectStatusBadgeContent(content: ProjectStatusBadgeContent): ReactNode {
  switch (content.kind) {
    case "loader":
      return (
        <View style={styles.runningLoaderNudge} testID="sidebar-status-visual-synced-loader">
          <ThemedSyncedLoader size={STATUS_BADGE_LOADER_SIZE} uniProps={syncedLoaderColorMapping} />
        </View>
      );
    case "alert":
      return (
        <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputColorMapping} />
      );
    case "dot":
      return <View testID="project-status-dot" style={getStatusDotColorStyle(content.bucket)} />;
  }
}

function getStatusBadgeBackdropStyle(backdrop: SurfaceBackdrop): ViewStyle {
  switch (backdrop) {
    case "surfaceSidebarHover":
      return styles.statusBadgeOnSidebarHover;
    case "surface2":
      return styles.statusBadgeOnSurface2;
    default:
      return styles.statusBadgeOnSidebar;
  }
}

function ProjectIcon({
  iconDataUri,
  placeholderInitial,
  projectViewKey,
}: {
  iconDataUri: string | null;
  placeholderInitial: string;
  projectViewKey: string;
}) {
  return (
    <ProjectIconView
      iconDataUri={iconDataUri}
      initial={placeholderInitial}
      projectViewKey={projectViewKey}
      size={ICON_SIZE.md}
      textStyle={styles.projectIconFallbackText}
    />
  );
}

function ProjectInlineChevron({ chevron }: { chevron: "expand" | "collapse" | null }) {
  if (chevron === null) {
    return null;
  }
  if (chevron === "collapse") {
    return <ChevronDown size={14} color="#9ca3af" />;
  }
  return <ChevronRight size={14} color="#9ca3af" />;
}

function getStatusDotColorStyle(bucket: ProjectStatusBadgeDotBucket): ViewStyle {
  return bucket === "failed" ? styles.statusDotFailed : styles.statusDotAttention;
}

const styles = StyleSheet.create((theme) => {
  // Dot statuses sit *inside* the shell rather than replacing it, so they carry the same ring
  // the alert does. The geometry is shared here and baked into each colored variant so the
  // style prop stays a single stable object; the colors come from the one bucket-to-color map
  // so this badge can't drift from the status dots everywhere else.
  const statusDot = (bucket: ProjectStatusBadgeDotBucket) =>
    ({
      width: STATUS_BADGE_DOT_SIZE,
      height: STATUS_BADGE_DOT_SIZE,
      borderRadius: theme.borderRadius.full,
      backgroundColor: getStatusDotColor({ theme, bucket }) ?? undefined,
    }) as const;

  return {
    // The slot is as tall as the title's line box, not as tall as the icon, and centers the
    // icon inside it. Rows lay their leading visual out with alignItems:flex-start, so a
    // 16pt slot next to a 20pt line box puts the icon 2pt above the title and the kebab —
    // which is why the workspace status indicator is also 20 tall. Keep the two in step.
    projectLeadingVisualSlot: {
      width: theme.iconSize.md,
      height: LEADING_SLOT_HEIGHT,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    // Anchors the corner badge to the icon rather than to the taller slot.
    projectIconBox: {
      position: "relative",
      width: theme.iconSize.md,
      height: theme.iconSize.md,
    },
    projectIconFallbackText: {
      fontSize: 9,
    },
    // The shell the alert and dot statuses share. It straddles the icon's bottom-right corner
    // (half in, half out) so the lettered project box stays readable. The shell is a knockout:
    // it is filled with the colour of the row behind it, which is what makes the ring around the
    // dot read as a gap in the icon rather than as a white halo drawn on top of it.
    statusBadge: {
      position: "absolute",
      right: STATUS_BADGE_OFFSET,
      bottom: STATUS_BADGE_OFFSET,
      width: STATUS_BADGE_SIZE,
      height: STATUS_BADGE_SIZE,
      borderRadius: theme.borderRadius.full,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    runningLoaderNudge: {
      transform: [{ translateX: STATUS_BADGE_LOADER_NUDGE_X }],
    },
    statusBadgeOnSidebar: { backgroundColor: theme.colors.surfaceSidebar },
    statusBadgeOnSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
    statusBadgeOnSurface2: { backgroundColor: theme.colors.surface2 },
    statusDotFailed: statusDot("failed"),
    statusDotAttention: statusDot("attention"),
  };
});
