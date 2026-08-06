import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Users } from "lucide-react-native";

import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { getStatusDotColor } from "@/utils/status-dot-color";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspaceTeamRows, type WorkspaceTeamRow } from "@/teams/workspace-team-rows";
import type { Theme } from "@/styles/theme";

const ThemedUsers = withUnistyles(Users);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The live teams of one workspace, listed under its sidebar row.
 *
 * This reads the store itself rather than widening the workspace projection.
 * A team is not a workspace and does not belong in the placement model that
 * pinning, grouping, and drag ordering all key off.
 */
export function SidebarWorkspaceTeamRows({
  workspace,
}: {
  workspace: Pick<SidebarWorkspaceEntry, "serverId" | "workspaceId" | "workspaceKey">;
}): ReactElement | null {
  const teams = useSessionStore((state) => state.sessions[workspace.serverId]?.teams);
  const agents = useSessionStore((state) => state.sessions[workspace.serverId]?.agents);
  const rows = useMemo(
    () => (teams ? selectWorkspaceTeamRows(teams, workspace.workspaceId, agents ?? new Map()) : []),
    [teams, agents, workspace.workspaceId],
  );

  if (rows.length === 0) return null;

  return (
    <View style={styles.list} testID={`sidebar-teams-${workspace.workspaceKey}`}>
      {rows.map((row) => (
        <TeamRow
          key={row.teamId}
          row={row}
          serverId={workspace.serverId}
          workspaceId={workspace.workspaceId}
        />
      ))}
    </View>
  );
}

function TeamRow({
  row,
  serverId,
  workspaceId,
}: {
  row: WorkspaceTeamRow;
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const open = useCallback(() => {
    navigateToWorkspace({
      serverId,
      workspaceId,
      target: { kind: "team", teamId: row.teamId },
    });
  }, [row.teamId, serverId, workspaceId]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={styles.row}
      testID={`sidebar-team-row-${row.teamId}`}
    >
      <ThemedUsers size={12} uniProps={mutedIcon} />
      <Text style={styles.name} numberOfLines={1}>
        {row.name}
      </Text>
      {row.statusBucket && row.statusBucket !== "done" ? (
        <TeamStatusDot bucket={row.statusBucket} teamId={row.teamId} />
      ) : null}
    </Pressable>
  );
}

/**
 * The dot goes through `getStatusDotColor` like every other status dot.
 *
 * The statusDot band is its own color family, louder than the status family it
 * shadows; restating the mapping here would put this row a shade off from the
 * workspace row above it.
 */
function TeamStatusDot({
  bucket,
  teamId,
}: {
  bucket: SidebarStateBucket;
  teamId: string;
}): ReactElement {
  return <ThemedDot bucket={bucket} testID={`sidebar-team-row-${teamId}-${bucket}`} />;
}

const ThemedDot = withUnistyles(Dot, (theme, _rt) => ({ theme }));

function Dot({
  bucket,
  theme,
  testID,
}: {
  bucket: SidebarStateBucket;
  theme: Theme;
  testID: string;
}): ReactElement {
  const color = getStatusDotColor({ theme, bucket });
  return <View style={[styles.dot, color ? { backgroundColor: color } : null]} testID={testID} />;
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[1],
    // Indented to the workspace title's rail, so a team reads as belonging to
    // the row above it rather than as a sibling workspace.
    paddingLeft: theme.spacing[6],
    paddingBottom: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingRight: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
}));
