import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw, SendHorizontal } from "lucide-react-native";

import type { ChatMessage } from "@getpaseo/protocol/chat/types";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { TeamMemberRow } from "@/runtime/team-sync/selectors";
import { foldRoomMessage } from "@/teams/fold-message";
import { postRoomMessage, type PostRoomMessageState } from "@/teams/post-room-message";
import { useRoomSubscription } from "@/teams/use-room-subscription";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TeamRoomProps {
  serverId: string;
  roomId: string | null;
  roster: readonly TeamMemberRow[];
  /** A room nobody can post to any more — the team is archiving or over. */
  readOnly?: boolean;
}

export function TeamRoom({
  serverId,
  roomId,
  roster,
  readOnly = false,
}: TeamRoomProps): ReactElement {
  const { t } = useTranslation();
  const { timeline, error, loading, retry } = useRoomSubscription(serverId, roomId);

  // Whoever posted, named the way the roster names them. An agent id in a
  // transcript is unreadable, and the roster is the only place that knows a
  // member is "reviewer".
  const roles = useMemo(() => {
    const byAgentId = new Map<string, string>();
    for (const row of roster) byAgentId.set(row.entry.agentId, row.entry.role);
    return byAgentId;
  }, [roster]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <RoomMessage message={item} role={roles.get(item.authorAgentId) ?? null} />
    ),
    [roles],
  );

  const composer =
    readOnly || !roomId ? null : <RoomComposer serverId={serverId} roomId={roomId} />;

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.notice}>
          <Text style={styles.error} testID="team-room-error">
            {error}
          </Text>
          <Button
            size="sm"
            variant="outline"
            leftIcon={RotateCw}
            onPress={retry}
            testID="team-room-retry"
          >
            {t("common.actions.retry")}
          </Button>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.notice} testID="team-room-loading">
          <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {timeline.messages.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.muted} testID="team-room-empty">
            {t("teams.room.empty")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={timeline.messages}
          keyExtractor={keyOf}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          testID="team-room"
        />
      )}
      {composer}
    </View>
  );
}

function keyOf(message: ChatMessage): string {
  return message.id;
}

/**
 * Where a person says something in the room.
 *
 * Nothing is appended locally: the daemon broadcasts the post back over the
 * same subscription that carries everyone else's, and a local copy would sit
 * next to the real one when it arrived. The composer clears on success, and
 * keeps what was typed on failure.
 */
function RoomComposer({ serverId, roomId }: { serverId: string; roomId: string }): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [body, setBody] = useState("");
  const [state, setState] = useState<PostRoomMessageState>({ status: "idle" });

  const send = useCallback(() => {
    const sent = body;
    void postRoomMessage(
      { roomId, body, client },
      { refused: t("teams.room.notPosted"), offline: t("common.errors.daemonClientUnavailable") },
      (next) => {
        setState(next);
        // Only clear once the daemon has it. Clearing on send loses the message
        // when the post is refused.
        if (next.status === "idle") setBody((current) => (current === sent ? "" : current));
      },
    );
  }, [body, client, roomId, t]);

  return (
    <View style={styles.composer}>
      {state.status === "failure" ? (
        <Text style={styles.error} testID="team-room-post-error">
          {state.message}
        </Text>
      ) : null}
      <View style={styles.composerRow}>
        <ThemedTextInput
          value={body}
          onChangeText={setBody}
          onSubmitEditing={send}
          placeholder={t("teams.room.placeholder")}
          style={styles.input}
          editable={state.status !== "pending"}
          testID="team-room-composer"
        />
        <Button
          size="sm"
          leftIcon={SendHorizontal}
          loading={state.status === "pending"}
          disabled={body.trim().length === 0}
          onPress={send}
          testID="team-room-send"
        >
          {t("teams.room.send")}
        </Button>
      </View>
    </View>
  );
}

function RoomMessage({
  message,
  role,
}: {
  message: ChatMessage;
  role: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const folded = useMemo(() => foldRoomMessage(message.body), [message.body]);
  const expand = useCallback(() => setExpanded(true), []);

  return (
    <View style={styles.message} testID={`team-room-message-${message.id}`}>
      <Text style={styles.author}>{describeAuthor(message, role, t("teams.room.person"))}</Text>
      <Text style={styles.body}>{expanded ? message.body : folded.text}</Text>
      {folded.folded && !expanded ? (
        <View style={styles.expandRow}>
          <Button
            size="sm"
            variant="ghost"
            onPress={expand}
            testID={`team-room-message-${message.id}-expand`}
          >
            {folded.hidden > 0
              ? t("teams.room.showMoreLines", { count: folded.hidden })
              : t("teams.room.showMore")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Who said it.
 *
 * The roster role wins, because "reviewer" is what the rest of the panel calls
 * that member. A human poster's `authorAgentId` is a client id, which names
 * nothing to a reader — and it is not necessarily this client, so "You" would
 * be wrong for a message from the user's other device.
 */
function describeAuthor(message: ChatMessage, role: string | null, personLabel: string): string {
  if (role) return role;
  return message.author?.kind === "human" ? personLabel : message.authorAgentId;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    // Fills from the bottom, the way every other chat surface in the app does.
    // Without this a room with three messages in it pins them to the top of an
    // empty column and reads as a rendering fault.
    flexGrow: 1,
    justifyContent: "flex-end",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  notice: {
    flex: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    gap: theme.spacing[1],
  },
  author: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  expandRow: {
    flexDirection: "row",
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  composer: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
