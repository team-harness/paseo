import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type {
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { resolvePermissionActions } from "@/agent-stream/permission-actions";
import { Button } from "@/components/ui/button";
import { TeamRoom } from "@/components/teams/team-room";
import { useIsCompactFormFactor } from "@/constants/layout";
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

export interface TeamPanelProps {
  serverId: string;
  teamId: string;
}

const IDLE: TeamActionState = { status: "idle" };
const EMPTY_AGENTS: ReadonlyMap<string, TeamMemberAgent> = new Map();

export function TeamPanel({ serverId, teamId }: TeamPanelProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const team = useTeam(serverId, teamId);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const pending = useSessionStore((state) => state.sessions[serverId]?.pendingPermissions);
  const client = useHostRuntimeClient(serverId);
  const [actions, setActions] = useState<Record<string, TeamActionState>>({});

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

  const side = (
    <View style={isCompact ? styles.sideCompact : styles.side}>
      <View style={styles.section} testID="team-panel-roster">
        {roster.map((row) => (
          <MemberRow
            key={row.entry.agentId}
            row={row}
            state={actions[teamActionKeyOf({ kind: "remove", agentId: row.entry.agentId })] ?? IDLE}
            onRemove={run}
            actionable={actionable}
          />
        ))}
      </View>

      {archiveState.status === "failure" ? (
        <Text style={styles.error} testID="team-panel-archive-error">
          {archiveState.message}
        </Text>
      ) : null}
      {actionable ? (
        <View style={styles.archiveRow}>
          <Button
            size="sm"
            variant="outline"
            loading={archiveState.status === "pending"}
            onPress={archive}
            testID="team-panel-archive"
          >
            {t("teams.panel.archiveAction")}
          </Button>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.body} testID="team-panel">
      <View style={styles.head}>
        <Header team={team} activity={activity} stage={stage} />

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
      </View>

      {/* The room is the panel's main surface: what the team said is what
          someone came here to read. The roster sits beside it on a wide screen
          and beneath it on a narrow one, where a fixed side column would take
          the room's width and leave a stripe. */}
      <View style={isCompact ? styles.columnsCompact : styles.columns}>
        <View style={styles.roomColumn}>
          <TeamRoom
            serverId={serverId}
            roomId={team.chatRoomId}
            roster={roster}
            readOnly={!actionable}
          />
        </View>
        {side}
      </View>
    </View>
  );
}

function Header({
  team,
  activity,
  stage,
}: {
  team: TeamSnapshot;
  activity: TeamActivity;
  stage: TeamStage;
}): ReactElement {
  const { t } = useTranslation();
  // Where the team is in its own life outranks what its members are doing:
  // "Working" under a roster that is being torn down describes the agents
  // truthfully and the team not at all.
  const label = stage === "active" ? ACTIVITY_LABEL[activity] : STAGE_LABEL[stage];
  return (
    <View style={styles.header}>
      <Text style={styles.title} testID="team-panel-name">
        {team.name}
      </Text>
      <Text style={styles.muted} testID="team-panel-activity">
        {t(label)}
      </Text>
    </View>
  );
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

function MemberRow({
  row,
  state,
  onRemove,
  actionable,
}: {
  row: TeamMemberRow;
  state: TeamActionState;
  onRemove: (action: TeamActionKey) => void;
  actionable: boolean;
}): ReactElement {
  const { t } = useTranslation();
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
  const label = describeMember(row.agent, t("teams.panel.notLoaded"));

  return (
    <View style={styles.member} testID={`team-member-${row.entry.agentId}`}>
      <Text style={styles.memberRole}>
        {row.isLead && row.entry.role !== "lead"
          ? `${row.entry.role} (${t("teams.panel.lead")})`
          : row.entry.role}
      </Text>
      <Text style={styles.muted}>{label}</Text>
      {row.entry.state === "removed" ? (
        <Text style={styles.muted} testID={`team-member-${row.entry.agentId}-removed`}>
          {t("teams.panel.left")}
        </Text>
      ) : null}
      {state.status === "failure" ? (
        <Text style={styles.error} testID={`team-member-${row.entry.agentId}-error`}>
          {state.message}
        </Text>
      ) : null}
      {actionable && row.entry.state === "active" && !row.isLead ? (
        <Button
          size="sm"
          variant="ghost"
          loading={state.status === "pending"}
          onPress={remove}
          testID={`team-member-${row.entry.agentId}-remove`}
        >
          {t("teams.panel.removeAction")}
        </Button>
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
  columns: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[4],
  },
  columnsCompact: {
    flex: 1,
    flexDirection: "column",
  },
  roomColumn: {
    flex: 1,
    minWidth: 0,
  },
  side: {
    width: 260,
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  sideCompact: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  header: {
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  section: {
    gap: theme.spacing[1],
  },
  permission: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  archiveRow: {
    flexDirection: "row",
    paddingTop: theme.spacing[2],
  },
  memberRole: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
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
