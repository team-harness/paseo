import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import type { ChatMessage } from "@getpaseo/protocol/chat/types";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { TeamMemberRow } from "@/runtime/team-sync/selectors";
import { foldRoomMessage } from "@/teams/fold-message";
import { useRoomSubscription } from "@/teams/use-room-subscription";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TeamRoomProps {
  serverId: string;
  roomId: string | null;
  roster: readonly TeamMemberRow[];
}

export function TeamRoom({ serverId, roomId, roster }: TeamRoomProps): ReactElement {
  const { t } = useTranslation();
  const { timeline, error, loading } = useRoomSubscription(serverId, roomId);

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

  if (error) {
    return (
      <View style={styles.notice}>
        <Text style={styles.error} testID="team-room-error">
          {error}
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.notice} testID="team-room-loading">
        <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
      </View>
    );
  }

  if (timeline.messages.length === 0) {
    return (
      <View style={styles.notice}>
        <Text style={styles.muted} testID="team-room-empty">
          {t("teams.room.empty")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={timeline.messages}
      keyExtractor={keyOf}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      testID="team-room"
    />
  );
}

function keyOf(message: ChatMessage): string {
  return message.id;
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
      <Text style={styles.author}>
        {role ?? (message.author?.kind === "human" ? t("teams.room.you") : message.authorAgentId)}
      </Text>
      <Text style={styles.body}>{expanded ? message.body : folded.text}</Text>
      {folded.folded && !expanded ? (
        <Pressable
          accessibilityRole="button"
          onPress={expand}
          testID={`team-room-message-${message.id}-expand`}
        >
          <Text style={styles.expand}>
            {folded.hidden > 0
              ? t("teams.room.showMoreLines", { count: folded.hidden })
              : t("teams.room.showMore")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
  },
  listContent: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  notice: {
    padding: theme.spacing[4],
    alignItems: "center",
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
  expand: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
