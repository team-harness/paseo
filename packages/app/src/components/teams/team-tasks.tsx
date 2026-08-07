import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import type { TeamTask } from "@getpaseo/protocol/team/task-types";

import { MemberAvatar } from "@/components/teams/member-avatar";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { TeamMemberRow } from "@/runtime/team-sync/selectors";
import { describeTeamTaskRow } from "@/teams/team-task-row";
import type { TeamTasksLoadState } from "@/teams/team-tasks-load-state";
import type { Theme } from "@/styles/theme";
import { formatDuration } from "@/utils/time";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TeamTasksProps {
  state: TeamTasksLoadState;
  roster: readonly TeamMemberRow[];
  /** Opens the assignee's own conversation. Assignees are inert without it. */
  onOpenAgent?: (agentId: string) => void;
  /** The task a chip in the room asked for, drawn with a ring around it. */
  highlightTaskId?: string | null;
}

/**
 * What the lead has handed out.
 *
 * Read-only: everything here is created by the lead's `assign_task` and settled
 * by the assignee's own turn, so a button that cancelled one from the client
 * would be racing the daemon rather than driving it.
 */
export function TeamTasks({
  state,
  roster,
  onOpenAgent,
  highlightTaskId,
}: TeamTasksProps): ReactElement | null {
  const { t } = useTranslation();

  const members = useMemo(() => {
    const byAgentId = new Map<string, TeamMemberRow>();
    for (const row of roster) byAgentId.set(row.entry.agentId, row);
    return byAgentId;
  }, [roster]);

  const renderItem = useCallback(
    ({ item }: { item: TeamTask }) => (
      <TaskRow
        task={item}
        member={members.get(item.assigneeAgentId) ?? null}
        onOpenAgent={onOpenAgent}
        highlighted={item.taskId === highlightTaskId}
      />
    ),
    [members, onOpenAgent, highlightTaskId],
  );

  if (state.status === "unsupported") return null;

  if (state.status === "loading") {
    return (
      <View style={styles.notice} testID="team-tasks-loading">
        <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {state.status === "failed" ? (
        <Text style={styles.error} testID="team-tasks-error">
          {state.message}
        </Text>
      ) : null}
      {state.tasks.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.muted} testID="team-tasks-empty">
            {t("teams.tasks.empty")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={state.tasks}
          keyExtractor={keyOf}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          testID="team-tasks"
        />
      )}
    </View>
  );
}

function keyOf(task: TeamTask): string {
  return task.taskId;
}

function TaskRow({
  task,
  member,
  onOpenAgent,
  highlighted,
}: {
  task: TeamTask;
  member: TeamMemberRow | null;
  onOpenAgent?: (agentId: string) => void;
  highlighted: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const view = useMemo(() => describeTeamTaskRow(task), [task]);
  const agent = member?.agent ?? null;
  const role = member?.entry.role ?? task.assigneeAgentId;

  const open = useMemo(
    () => (onOpenAgent ? () => onOpenAgent(task.assigneeAgentId) : undefined),
    [onOpenAgent, task.assigneeAgentId],
  );

  // A task still in flight has a start, not a duration; a settled one has a
  // duration that will never move again. The hook has to run either way.
  const elapsed = useCompactTimeAgo(view.durationMs === null ? view.startedAt : null);
  const duration = view.durationMs === null ? elapsed : formatDuration(view.durationMs);

  return (
    <View
      style={highlighted ? styles.rowHighlighted : styles.row}
      testID={`team-task-${task.taskId}`}
    >
      <MemberAvatar
        agentId={task.assigneeAgentId}
        label={role}
        size={24}
        status={agent?.status}
        requiresAttention={agent?.requiresAttention}
        attentionReason={agent?.attentionReason}
        pendingPermissionCount={agent?.pendingPermissions?.length ?? 0}
        onPress={open}
        testID={`team-task-${task.taskId}-assignee`}
      />
      <View style={styles.rowBody}>
        <Text style={styles.prompt} numberOfLines={2}>
          {task.prompt}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.muted}>{role}</Text>
          {duration ? (
            <Text style={styles.muted} testID={`team-task-${task.taskId}-duration`}>
              {duration}
            </Text>
          ) : null}
        </View>
      </View>
      <StatusBadge label={t(view.statusKey)} variant={view.tone} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  notice: {
    flex: 1,
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  rowHighlighted: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    // Tapping a `#id` in the room lands here; without a mark the tab switches
    // and nothing tells you which of thirty rows you asked for.
    borderColor: theme.colors.accentBright,
    backgroundColor: theme.colors.surface1,
  },
  rowBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  prompt: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
  },
}));
