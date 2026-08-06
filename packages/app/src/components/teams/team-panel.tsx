import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { TeamSnapshot } from "@getpaseo/protocol/team/types";

import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  selectTeamActivity,
  selectTeamRoster,
  type TeamActivity,
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

export function TeamPanel({ serverId, teamId }: TeamPanelProps): ReactElement {
  const team = useTeam(serverId, teamId);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const pending = useSessionStore((state) => state.sessions[serverId]?.pendingPermissions);
  const client = useHostRuntimeClient(serverId);
  const [actions, setActions] = useState<Record<string, TeamActionState>>({});

  const roster = useMemo<TeamMemberRow[]>(
    () => (team ? selectTeamRoster(team, (agents ?? new Map()) as never) : []),
    [team, agents],
  );
  const activity = useMemo(() => selectTeamActivity(roster), [roster]);
  const permissions = useMemo<TeamPermissionRow[]>(
    () => (team ? selectTeamPermissions(team, pending ?? new Map()) : []),
    [team, pending],
  );

  const run = useCallback(
    (action: TeamActionKey) => {
      if (!client) return;
      const key = teamActionKeyOf(action);
      void runTeamAction(action, teamId, client, (state) => {
        setActions((current) => ({ ...current, [key]: state }));
      });
    },
    [client, teamId],
  );

  const archive = useCallback(() => run({ kind: "archive" }), [run]);

  if (!team) {
    // The team is gone, or this client has not been told about it yet. Either
    // way there is no roster to draw, and drawing an empty one would read as a
    // team with nobody on it.
    return (
      <View style={styles.body}>
        <Text style={styles.muted} testID="team-panel-missing">
          This team is no longer here.
        </Text>
      </View>
    );
  }

  const archiveState = actions.archive ?? IDLE;

  return (
    <View style={styles.body} testID="team-panel">
      <Header team={team} activity={activity} />

      {permissions.length > 0 ? (
        <View style={styles.section} testID="team-panel-permissions">
          <Text style={styles.sectionTitle}>Waiting on you</Text>
          {permissions.map((row) => (
            <PermissionRow key={row.permission.key} row={row} serverId={serverId} />
          ))}
        </View>
      ) : null}

      <View style={styles.section} testID="team-panel-roster">
        {roster.map((row) => (
          <MemberRow
            key={row.entry.agentId}
            row={row}
            state={actions[teamActionKeyOf({ kind: "remove", agentId: row.entry.agentId })] ?? IDLE}
            onRemove={run}
          />
        ))}
      </View>

      {archiveState.status === "failure" ? (
        <Text style={styles.error} testID="team-panel-archive-error">
          {archiveState.message}
        </Text>
      ) : null}
      <Button
        variant="destructive"
        loading={archiveState.status === "pending"}
        onPress={archive}
        testID="team-panel-archive"
      >
        Archive team
      </Button>
    </View>
  );
}

function Header({ team, activity }: { team: TeamSnapshot; activity: TeamActivity }): ReactElement {
  return (
    <View style={styles.header}>
      <Text style={styles.title} testID="team-panel-name">
        {team.name}
      </Text>
      <Text style={styles.muted} testID="team-panel-activity">
        {ACTIVITY_LABEL[activity]}
      </Text>
    </View>
  );
}

const ACTIVITY_LABEL: Record<TeamActivity, string> = {
  needs_input: "Waiting on you",
  running: "Working",
  idle: "Idle",
};

function PermissionRow({
  row,
  serverId,
}: {
  row: TeamPermissionRow;
  serverId: string;
}): ReactElement {
  const client = useHostRuntimeClient(serverId);
  const [answering, setAnswering] = useState(false);

  const answer = useCallback(
    (behavior: "allow" | "deny") => {
      if (!client) return;
      setAnswering(true);
      // Each row answers its own request. Two members blocked at once are two
      // decisions, and one button for both would answer a question the user was
      // never shown.
      void client
        .respondToPermission(row.agentId, row.permission.request.id, { behavior } as never)
        .finally(() => setAnswering(false));
    },
    [client, row.agentId, row.permission.request.id],
  );

  const allow = useCallback(() => answer("allow"), [answer]);
  const deny = useCallback(() => answer("deny"), [answer]);

  return (
    <View style={styles.permission} testID={`team-permission-${row.agentId}`}>
      <Text style={styles.muted}>{`${row.role}: ${row.permission.request.name}`}</Text>
      <Button
        size="sm"
        loading={answering}
        onPress={allow}
        testID={`team-permission-${row.agentId}-allow`}
      >
        Allow
      </Button>
      <Button
        size="sm"
        variant="secondary"
        loading={answering}
        onPress={deny}
        testID={`team-permission-${row.agentId}-deny`}
      >
        Deny
      </Button>
    </View>
  );
}

function MemberRow({
  row,
  state,
  onRemove,
}: {
  row: TeamMemberRow;
  state: TeamActionState;
  onRemove: (action: TeamActionKey) => void;
}): ReactElement {
  const remove = useCallback(
    () => onRemove({ kind: "remove", agentId: row.entry.agentId }),
    [onRemove, row.entry.agentId],
  );
  const label = describeMember(row.agent);

  return (
    <View style={styles.member} testID={`team-member-${row.entry.agentId}`}>
      <Text style={styles.memberRole}>
        {row.isLead ? `${row.entry.role} (lead)` : row.entry.role}
      </Text>
      <Text style={styles.muted}>{label}</Text>
      {state.status === "failure" ? (
        <Text style={styles.error} testID={`team-member-${row.entry.agentId}-error`}>
          {state.message}
        </Text>
      ) : null}
      {row.entry.state === "active" && !row.isLead ? (
        <Button
          size="sm"
          variant="ghost"
          loading={state.status === "pending"}
          onPress={remove}
          testID={`team-member-${row.entry.agentId}-remove`}
        >
          Remove
        </Button>
      ) : null}
    </View>
  );
}

/** A member whose agent has not loaded is still a member; say so rather than blank. */
function describeMember(agent: TeamMemberAgent | null): string {
  if (!agent) return "Not loaded";
  return agent.title?.trim() || agent.status;
}

const styles = StyleSheet.create((theme) => ({
  body: {
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
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
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
