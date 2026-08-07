import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreHorizontal } from "lucide-react-native";

import type {
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { resolvePermissionActions } from "@/agent-stream/permission-actions";
import { MemberAvatar } from "@/components/teams/member-avatar";
import { TeamRoom } from "@/components/teams/team-room";
import { TeamTasks } from "@/components/teams/team-tasks";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  selectMemberActivity,
  selectTeamActivity,
  selectTeamRoster,
  selectTeamStage,
  teamStageAcceptsActions,
  type TeamActivity,
  type TeamStage,
  type TeamMemberAgent,
  type TeamMemberRow,
} from "@/runtime/team-sync/selectors";
import { useSessionStore } from "@/stores/session-store";
import {
  runTeamAction,
  teamActionKeyOf,
  type TeamActionKey,
  type TeamActionState,
} from "@/teams/team-actions";
import { selectTeamPermissions, type TeamPermissionRow } from "@/teams/team-permissions";
import { useTeam } from "@/teams/use-teams";
import { useTeamTasks } from "@/teams/use-team-tasks";
import type { Theme } from "@/styles/theme";

export interface TeamPanelProps {
  serverId: string;
  teamId: string;
  /** Opens one member's own conversation. Avatars and mentions are inert without it. */
  onOpenAgent?: (agentId: string) => void;
}

/** Which of the panel's two surfaces is showing. */
type TeamTab = "chat" | "tasks";

const IDLE: TeamActionState = { status: "idle" };
const EMPTY_AGENTS: ReadonlyMap<string, TeamMemberAgent> = new Map();
const NO_TASK_IDS: readonly string[] = [];

const MenuGlyph = withUnistyles(MoreHorizontal, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function TeamPanel({ serverId, teamId, onOpenAgent }: TeamPanelProps): ReactElement {
  const { t } = useTranslation();
  const team = useTeam(serverId, teamId);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const pending = useSessionStore((state) => state.sessions[serverId]?.pendingPermissions);
  const client = useHostRuntimeClient(serverId);
  const tasks = useTeamTasks(serverId, teamId);
  const [actions, setActions] = useState<Record<string, TeamActionState>>({});
  const [tab, setTab] = useState<TeamTab>("chat");
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);

  const roster = useMemo<TeamMemberRow[]>(
    () => (team ? selectTeamRoster(team, agents ?? EMPTY_AGENTS) : []),
    [team, agents],
  );
  const activity = useMemo(() => selectTeamActivity(roster), [roster]);
  const activeCount = useMemo(
    () => roster.filter((entry) => entry.entry.state === "active").length,
    [roster],
  );
  // Agents mid-turn lose that turn. A count of members does not say that, and
  // the difference is the whole reason someone would hesitate.
  const runningCount = useMemo(
    () =>
      roster.filter(
        (row) => row.entry.state === "active" && selectMemberActivity(row.agent) === "running",
      ).length,
    [roster],
  );
  const permissions = useMemo<TeamPermissionRow[]>(
    () => (team ? selectTeamPermissions(team, pending ?? new Map()) : []),
    [team, pending],
  );

  // Only ids the client actually holds. A `#id` for a task this client has not
  // read yet stays plain text rather than becoming a chip that opens nothing.
  const taskIds = useMemo(
    () =>
      tasks.status === "loaded" || tasks.status === "failed"
        ? tasks.tasks.map((task) => task.taskId)
        : NO_TASK_IDS,
    [tasks],
  );

  const run = useCallback(
    (action: TeamActionKey) => {
      const key = teamActionKeyOf(action);
      if (!client) {
        // A confirmed destructive action that does nothing, silently, is read
        // as one that worked.
        setActions((current) => ({
          ...current,
          [key]: { status: "failure", message: t("common.errors.daemonClientUnavailable") },
        }));
        return;
      }
      void runTeamAction(
        action,
        teamId,
        client,
        {
          archiveRefused: t("teams.panel.archiveRefused"),
          removeRefused: t("teams.panel.removeRefused"),
        },
        (state) => {
          setActions((current) => ({ ...current, [key]: state }));
        },
      );
    },
    [client, t, teamId],
  );

  const archive = useCallback(() => {
    // Archiving ends every agent on the team and there is no unarchive for a
    // team. Red on the page is not consent; the confirmation is.
    void (async () => {
      const warning =
        runningCount > 0 ? ` ${t("teams.panel.archiveRunning", { count: runningCount })}` : "";
      const confirmed = await confirmDialog({
        title: t("teams.panel.archiveTitle"),
        message: `${t("teams.panel.archiveMessage", { count: activeCount })}${warning}`,
        confirmLabel: t("teams.panel.archiveConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (confirmed) run({ kind: "archive" });
    })();
  }, [activeCount, runningCount, run, t]);

  // A task chip in the room names a row on the other tab. Switching without
  // marking which row would answer the tap with thirty of them.
  const openTask = useCallback((taskId: string) => {
    setHighlightTaskId(taskId);
    setTab("tasks");
  }, []);

  const tabOptions = useMemo(
    () => [
      { value: "chat" as const, label: t("teams.tabs.chat"), testID: "team-tab-chat" },
      { value: "tasks" as const, label: t("teams.tabs.tasks"), testID: "team-tab-tasks" },
    ],
    [t],
  );

  if (!team) {
    // The team is gone, or this client has not been told about it yet. Either
    // way there is no roster to draw, and drawing an empty one would read as a
    // team with nobody on it.
    return (
      <View style={styles.body}>
        <Text style={styles.muted} testID="team-panel-missing">
          {t("teams.panel.missing")}
        </Text>
      </View>
    );
  }

  const archiveState = actions.archive ?? IDLE;
  // A team on its way out, or already gone, still draws its roster — that is
  // the record of who was on it. What it stops drawing is the buttons, because
  // the daemon has stopped taking them and a button that does nothing reads as
  // one that failed.
  const stage = selectTeamStage(team);
  const actionable = teamStageAcceptsActions(stage);
  const hasTasks = tasks.status !== "unsupported";
  // A daemon with no ledger has one surface, and a control with one option is
  // a label that looks pressable.
  const showing: TeamTab = hasTasks ? tab : "chat";

  return (
    <View style={styles.body} testID="team-panel">
      <View style={styles.head}>
        <Header
          team={team}
          activity={activity}
          stage={stage}
          actionable={actionable}
          archiving={archiveState.status === "pending"}
          onArchive={archive}
        />

        {/* Who is on the team, at the top, because the conversation below is
            theirs. Pressing one opens that agent's own conversation; the rest
            of what can be done to a member is behind its menu. */}
        <View style={styles.strip} testID="team-panel-roster">
          {roster.map((row) => (
            <MemberChip
              key={row.entry.agentId}
              row={row}
              state={
                actions[teamActionKeyOf({ kind: "remove", agentId: row.entry.agentId })] ?? IDLE
              }
              onRemove={run}
              onOpen={onOpenAgent}
              actionable={actionable}
            />
          ))}
        </View>

        {archiveState.status === "failure" ? (
          <Text style={styles.error} testID="team-panel-archive-error">
            {archiveState.message}
          </Text>
        ) : null}

        {/* No heading: the header already says the team is waiting on you, and
            repeating the same words six pixels below reads as a duplicated
            element rather than as a section. */}
        {permissions.length > 0 ? (
          <View style={styles.section} testID="team-panel-permissions">
            {permissions.map((row) => (
              <PermissionRow key={row.permission.key} row={row} client={client} />
            ))}
          </View>
        ) : null}

        {hasTasks ? (
          <SegmentedControl
            options={tabOptions}
            value={showing}
            onValueChange={setTab}
            size="sm"
            style={styles.tabs}
            testID="team-panel-tabs"
          />
        ) : null}
      </View>

      {showing === "chat" ? (
        <TeamRoom
          serverId={serverId}
          roomId={team.chatRoomId}
          roster={roster}
          taskIds={taskIds}
          readOnly={!actionable}
          onOpenAgent={onOpenAgent}
          onOpenTask={openTask}
        />
      ) : (
        <TeamTasks
          state={tasks}
          roster={roster}
          onOpenAgent={onOpenAgent}
          highlightTaskId={highlightTaskId}
        />
      )}
    </View>
  );
}

function Header({
  team,
  activity,
  stage,
  actionable,
  archiving,
  onArchive,
}: {
  team: TeamSnapshot;
  activity: TeamActivity;
  stage: TeamStage;
  actionable: boolean;
  archiving: boolean;
  onArchive: () => void;
}): ReactElement {
  const { t } = useTranslation();
  // Where the team is in its own life outranks what its members are doing:
  // "Working" under a roster that is being torn down describes the agents
  // truthfully and the team not at all.
  const label = stage === "active" ? ACTIVITY_LABEL[activity] : STAGE_LABEL[stage];
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title} testID="team-panel-name">
          {team.name}
        </Text>
        <Text style={styles.muted} testID="team-panel-activity">
          {t(label)}
        </Text>
      </View>
      {actionable ? (
        <DropdownMenu>
          <DropdownMenuTrigger style={triggerStyle} testID="team-panel-menu">
            <MenuGlyph size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" minWidth={200}>
            <DropdownMenuItem
              destructive
              status={archiving ? "pending" : undefined}
              onSelect={onArchive}
              testID="team-panel-archive"
            >
              {t("teams.panel.archiveAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

function triggerStyle({ hovered }: { hovered: boolean }) {
  return hovered ? styles.menuTriggerHovered : styles.menuTrigger;
}

const STAGE_LABEL: Record<TeamStage, string> = {
  creating: "teams.panel.creating",
  active: "teams.panel.idle",
  archiving: "teams.panel.archiving",
  ended: "teams.panel.ended",
};

const ACTIVITY_LABEL: Record<TeamActivity, string> = {
  needs_input: "teams.panel.waitingOnYou",
  running: "teams.panel.working",
  idle: "teams.panel.idle",
};

function PermissionRow({
  row,
  client,
}: {
  row: TeamPermissionRow;
  client: ReturnType<typeof useHostRuntimeClient>;
}): ReactElement {
  const { t } = useTranslation();
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = row.permission.request;

  // Most providers send no `actions` at all — rendering only what the request
  // carries would draw an ordinary tool permission with no way to answer it.
  const actions = useMemo(
    () =>
      resolvePermissionActions(request, {
        deny: t("agentStream.permission.deny"),
        accept: t("agentStream.permission.accept"),
        implement: t("agentStream.permission.implement"),
      }),
    [request, t],
  );

  const answer = useCallback(
    (action: AgentPermissionAction) => {
      if (!client) {
        // Silence here reads as "answered". The daemon is gone, and the agent
        // is still sitting on this request.
        setError(t("common.errors.daemonClientUnavailable"));
        return;
      }
      setAnswering(action.id);
      setError(null);
      // The request's own action, by id. An invented Allow and Deny answers an
      // N-way question with option one, and a request whose options carry
      // bespoke ids is resolved as cancelled rather than as what was pressed.
      const response: AgentPermissionResponse =
        action.behavior === "allow"
          ? { behavior: "allow", selectedActionId: action.id }
          : {
              behavior: "deny",
              selectedActionId: action.id,
              message: t("agentStream.permission.deny"),
            };
      client
        .respondToPermissionAndWait(row.agentId, request.id, response, 15_000)
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error ? cause.message : t("common.errors.daemonClientUnavailable"),
          );
        })
        .finally(() => setAnswering(null));
    },
    [client, request.id, row.agentId, t],
  );

  return (
    <View style={styles.permission} testID={`team-permission-${row.agentId}`}>
      <Text style={styles.muted}>{`${row.role}: ${request.title ?? request.name}`}</Text>
      {actions.map((action) => (
        <PermissionAction
          key={action.id}
          action={action}
          answering={answering === action.id}
          onPress={answer}
          testID={`team-permission-${row.agentId}-${action.id}`}
        />
      ))}
      {error ? (
        <Text style={styles.error} testID={`team-permission-${row.agentId}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function PermissionAction({
  action,
  answering,
  onPress,
  testID,
}: {
  action: AgentPermissionAction;
  answering: boolean;
  onPress: (action: AgentPermissionAction) => void;
  testID: string;
}): ReactElement {
  const press = useCallback(() => onPress(action), [action, onPress]);
  return (
    <Button
      size="sm"
      variant={action.behavior === "allow" ? "default" : "secondary"}
      loading={answering}
      onPress={press}
      testID={testID}
    >
      {action.label}
    </Button>
  );
}

/**
 * One member of the team, in the strip above the room.
 *
 * Pressing opens that agent's own conversation, which is the thing anyone comes
 * to a roster to do. Removing is a long press or a right click away, because it
 * is not undoable and a button next to the face makes it a slip.
 */
function MemberChip({
  row,
  state,
  onRemove,
  onOpen,
  actionable,
}: {
  row: TeamMemberRow;
  state: TeamActionState;
  onRemove: (action: TeamActionKey) => void;
  onOpen?: (agentId: string) => void;
  actionable: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const removable = actionable && row.entry.state === "active" && !row.isLead;

  const remove = useCallback(() => {
    // Removing a member ends its membership, and nothing in the panel puts it
    // back. Ask before, not after.
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("teams.panel.removeTitle"),
        message: t("teams.panel.removeMessage", { role: row.entry.role }),
        confirmLabel: t("teams.panel.removeConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (confirmed) onRemove({ kind: "remove", agentId: row.entry.agentId });
    })();
  }, [onRemove, row.entry.agentId, row.entry.role, t]);

  const open = useCallback(() => {
    onOpen?.(row.entry.agentId);
  }, [onOpen, row.entry.agentId]);

  const role =
    row.isLead && row.entry.role !== "lead"
      ? `${row.entry.role} (${t("teams.panel.lead")})`
      : row.entry.role;
  // The circle cannot carry a tag, so the fact that someone left rides on the
  // label a screen reader gets and on the fill everyone else sees.
  const name =
    row.entry.state === "removed"
      ? `${role} (${t("teams.panel.left")})`
      : `${role} — ${describeMember(row.agent, t("teams.panel.notLoaded"))}`;

  return (
    <View style={styles.chip}>
      <ContextMenu>
        <ContextMenuTrigger
          enabled={removable}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={name}
          style={row.entry.state === "removed" ? styles.chipLeft : undefined}
          testID={`team-member-${row.entry.agentId}`}
        >
          <MemberAvatar
            agentId={row.entry.agentId}
            label={row.entry.role}
            status={row.agent?.status}
            requiresAttention={row.agent?.requiresAttention}
            attentionReason={row.agent?.attentionReason}
            pendingPermissionCount={row.agent?.pendingPermissions?.length ?? 0}
          />
        </ContextMenuTrigger>
        <ContextMenuContent minWidth={200} sheetTitle={role}>
          <ContextMenuLabel>{role}</ContextMenuLabel>
          <ContextMenuItem
            destructive
            status={state.status === "pending" ? "pending" : undefined}
            onSelect={remove}
            testID={`team-member-${row.entry.agentId}-remove`}
          >
            {t("teams.panel.removeAction")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {state.status === "failure" ? (
        <Text style={styles.error} testID={`team-member-${row.entry.agentId}-error`}>
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

/** A member whose agent has not loaded is still a member; say so rather than blank. */
function describeMember(agent: TeamMemberAgent | null, notLoaded: string): string {
  if (!agent) return notLoaded;
  return agent.title?.trim() || agent.status;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    flex: 1,
  },
  head: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  headerText: {
    flex: 1,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  menuTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  menuTriggerHovered: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    gap: theme.spacing[1],
  },
  chipLeft: {
    // Someone who left is still part of the record of who was on this team.
    // Dimmed rather than dropped, so the strip does not quietly shrink.
    opacity: 0.4,
  },
  tabs: {
    alignSelf: "flex-start",
  },
  section: {
    gap: theme.spacing[1],
  },
  permission: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
}));
