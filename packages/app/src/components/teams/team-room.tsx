import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw, SendHorizontal, Settings2 } from "lucide-react-native";

import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

import { MemberAvatar } from "@/components/teams/member-avatar";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { foldRoomMessage } from "@/teams/fold-message";
import { postRoomMessage, type PostRoomMessageState } from "@/teams/post-room-message";
import {
  applyRoomMentionReplacement,
  findActiveRoomMention,
  rankRoomMentionCandidates,
  type RoomMentionCandidate,
} from "@/teams/room-mention-autocomplete";
import {
  splitRoomMessage,
  type RoomMessageDirectory,
  type RoomMessageSegment,
} from "@/teams/room-message-segments";
import { useRoomSubscription } from "@/teams/use-room-subscription";
import { useTeamRoomScrollRetention } from "@/teams/use-team-room-scroll-retention";
import { describeTeamRoomAuthor, type TeamPanelMember } from "@/teams/team-panel-view";
import type { Theme } from "@/styles/theme";
import { setTextInputSelection } from "@/utils/text-input-selection";
import { formatMessageTimestamp } from "@/utils/time";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Enough for four or five names; a bigger team scrolls rather than covers the room. */
const AUTOCOMPLETE_MAX_HEIGHT = 180;

export interface TeamRoomProps {
  serverId: string;
  missionId: string | null;
  roster: readonly TeamPanelMember[];
  /** A room nobody can post to any more — the team is archiving or over. */
  readOnly?: boolean;
  /** Opens a member's own conversation. Avatars and mentions are inert without it. */
  onOpenAgent?: (agentId: string) => void;
  /** Opens Team membership and lifecycle settings beside the composer. */
  onOpenSettings: () => void;
  /** Starts the first/current Mission when this Team has no room yet. */
  onStartMission?: () => void;
  /** Pending permissions surfaced on the settings trigger. */
  settingsAttentionCount?: number;
}

export function TeamRoom({
  serverId,
  missionId,
  roster,
  readOnly = false,
  onOpenAgent,
  onOpenSettings,
  onStartMission,
  settingsAttentionCount = 0,
}: TeamRoomProps): ReactElement {
  const { t } = useTranslation();
  const { timeline, error, loading, retry } = useRoomSubscription(serverId, missionId);
  const isPanelActive = useRetainedPanelActive();
  const listRef = useRef<FlatList<TeamRoomMessage>>(null);
  const scrollRetention = useTeamRoomScrollRetention({ active: isPanelActive, listRef });

  // Whoever posted, named and colored the way the rest of the panel names them.
  // An agent id in a transcript is unreadable, and the roster is the only place
  // that knows a member is "reviewer".
  const members = useMemo(() => {
    const byAgentId = new Map<string, TeamPanelMember>();
    for (const row of roster) byAgentId.set(row.agentId, row);
    return byAgentId;
  }, [roster]);

  const directory = useMemo<RoomMessageDirectory>(
    () => ({
      members: roster.map((row) => ({
        agentId: row.agentId,
        role: row.role,
        mentionHandle: row.mentionHandle,
        active: row.active,
      })),
      humans: Array.from(
        new Set(
          timeline.messages
            .filter((message) => message.author.kind === "human")
            .map((message) => message.authorAgentId),
        ),
        (id) => ({ id, label: t("teams.room.you") }),
      ),
      taskIds: [],
    }),
    [roster, timeline.messages, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: TeamRoomMessage }) => (
      <RoomMessage
        message={item}
        member={members.get(item.authorAgentId) ?? null}
        directory={directory}
        onOpenAgent={onOpenAgent}
      />
    ),
    [members, directory, onOpenAgent],
  );

  const composer = (
    <RoomComposer
      serverId={serverId}
      missionId={missionId}
      roster={roster}
      readOnly={readOnly || !missionId}
      onOpenSettings={onOpenSettings}
      onStartMission={onStartMission}
      settingsAttentionCount={settingsAttentionCount}
    />
  );

  if (!missionId) {
    return (
      <View style={styles.container}>
        <View style={styles.notice}>
          <Text style={styles.muted} testID="team-room-no-mission">
            {t("teams.mission.empty")}
          </Text>
        </View>
        {composer}
      </View>
    );
  }

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
        {composer}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.notice} testID="team-room-loading">
          <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
        </View>
        {composer}
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
          ref={listRef}
          data={timeline.messages}
          keyExtractor={keyOf}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollRetention.onContentSizeChange}
          onLayout={scrollRetention.onLayout}
          onScroll={scrollRetention.onScroll}
          onScrollBeginDrag={scrollRetention.onScrollBeginDrag}
          scrollEventThrottle={16}
          testID="team-room"
        />
      )}
      {composer}
    </View>
  );
}

function keyOf(message: TeamRoomMessage): string {
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
function RoomComposer({
  serverId,
  missionId,
  roster,
  readOnly,
  onOpenSettings,
  onStartMission,
  settingsAttentionCount,
}: {
  serverId: string;
  missionId: string | null;
  roster: readonly TeamPanelMember[];
  readOnly: boolean;
  onOpenSettings: () => void;
  onStartMission?: () => void;
  settingsAttentionCount: number;
}): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const inputRef = useRef<TextInput>(null);
  const [body, setBody] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [state, setState] = useState<PostRoomMessageState>({ status: "idle" });
  const settingsBadge = useMemo(
    () =>
      settingsAttentionCount > 0 ? (
        <View style={styles.settingsBadge}>
          <Text style={styles.settingsBadgeText}>{settingsAttentionCount}</Text>
        </View>
      ) : null,
    [settingsAttentionCount],
  );

  // Handles use the complete append-only roster so a member keeps the same
  // suffix after an earlier seat leaves. Only active members are offered.
  const rosterCandidates = useMemo<RoomMentionCandidate[]>(
    () =>
      roster.map((row) => ({
        agentId: row.agentId,
        role: row.role,
        mentionHandle: row.mentionHandle,
        title: row.agent?.title ?? null,
      })),
    [roster],
  );
  const activeAgentIds = useMemo(
    () => new Set(roster.filter((row) => row.active).map((row) => row.agentId)),
    [roster],
  );
  const candidates = useMemo(
    () => rosterCandidates.filter((candidate) => activeAgentIds.has(candidate.agentId)),
    [activeAgentIds, rosterCandidates],
  );
  const mentionTokenByAgentId = useMemo(
    () =>
      new Map(rosterCandidates.map((candidate) => [candidate.agentId, candidate.mentionHandle])),
    [rosterCandidates],
  );

  const mention = useMemo(
    () => findActiveRoomMention({ text: body, cursorIndex }),
    [body, cursorIndex],
  );
  const options = useMemo<AutocompleteOption[]>(() => {
    if (!mention) return [];
    return rankRoomMentionCandidates({ candidates, query: mention.query }).map((candidate) => {
      const token = mentionTokenByAgentId.get(candidate.agentId);
      return {
        id: candidate.agentId,
        label: `@${token}`,
        description: [candidate.role, candidate.title].filter(Boolean).join(" - "),
      };
    });
  }, [mention, candidates, mentionTokenByAgentId]);
  const isVisible = !readOnly && mention !== null && options.length > 0;

  const selectOption = useCallback(
    (option: AutocompleteOption) => {
      const mentionToken = mentionTokenByAgentId.get(option.id);
      if (!mention || !mentionToken) return;
      const next = applyRoomMentionReplacement({ text: body, mention, mentionToken });
      setBody(next.text);
      setCursorIndex(next.cursorIndex);
      // React puts the caret back where it was before the value changed, which
      // is in the middle of the name that was just completed.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        setTextInputSelection(inputRef.current, {
          start: next.cursorIndex,
          end: next.cursorIndex,
        });
      });
    },
    [body, mention, mentionTokenByAgentId],
  );

  const { selectedIndex, onKeyPress } = useAutocomplete({
    isVisible,
    options,
    query: mention?.query ?? "",
    onSelectOption: selectOption,
  });

  // Enter belongs to the list while it is open. `preventDefault` is what stops
  // the same keystroke from also posting: react-native-web skips
  // `onSubmitEditing` on a key press that was defaulted away.
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      onKeyPress({
        key: event.nativeEvent.key,
        preventDefault: () => event.preventDefault(),
      });
    },
    [onKeyPress],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setCursorIndex(event.nativeEvent.selection.start);
    },
    [],
  );

  const handleChangeText = useCallback((next: string) => {
    setBody(next);
    // The caret is reported separately, and deleting can land it past the end
    // of what is left before that report arrives.
    setCursorIndex((current) => Math.min(current, next.length));
  }, []);

  const send = useCallback(() => {
    if (!missionId) return;
    const sent = body;
    void postRoomMessage(
      { missionId, body, client },
      { refused: t("teams.room.notPosted"), offline: t("common.errors.daemonClientUnavailable") },
      (next) => {
        setState(next);
        // Only clear once the daemon has it. Clearing on send loses the message
        // when the post is refused.
        if (next.status === "idle") {
          setBody((current) => (current === sent ? "" : current));
          setCursorIndex(0);
        }
      },
    );
  }, [body, client, missionId, t]);

  let composerAction: ReactElement | null = null;
  if (!readOnly && missionId) {
    composerAction = (
      <>
        <ThemedTextInput
          ref={inputRef}
          value={body}
          onChangeText={handleChangeText}
          onSelectionChange={handleSelectionChange}
          onKeyPress={handleKeyPress}
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
      </>
    );
  } else if (!missionId && onStartMission) {
    composerAction = (
      <Button size="sm" onPress={onStartMission} testID="team-room-start-mission">
        {t("teams.mission.start")}
      </Button>
    );
  }

  return (
    <View style={styles.composer}>
      {state.status === "failure" ? (
        <Text style={styles.error} testID="team-room-post-error">
          {state.message}
        </Text>
      ) : null}
      {isVisible ? (
        <View testID="team-room-mentions">
          <Autocomplete
            options={options}
            selectedIndex={selectedIndex}
            onSelect={selectOption}
            maxHeight={AUTOCOMPLETE_MAX_HEIGHT}
          />
        </View>
      ) : null}
      <View style={styles.composerRow}>
        <Button
          size="sm"
          variant="outline"
          leftIcon={Settings2}
          trailing={settingsBadge}
          accessibilityLabel={t("teams.settings.open")}
          onPress={onOpenSettings}
          style={styles.settingsButton}
          testID="team-room-settings"
        />
        {composerAction}
      </View>
    </View>
  );
}

function RoomMessage({
  message,
  member,
  directory,
  onOpenAgent,
}: {
  message: TeamRoomMessage;
  member: TeamPanelMember | null;
  directory: RoomMessageDirectory;
  onOpenAgent?: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const folded = useMemo(() => foldRoomMessage(message.body), [message.body]);
  const expand = useCallback(() => setExpanded(true), []);

  const isHuman = message.author.kind === "human";
  const author = describeTeamRoomAuthor({
    role: member?.role ?? null,
    mentionHandle: member?.mentionHandle ?? null,
    isHuman,
    youLabel: t("teams.room.you"),
    agentLabel: t("workspace.tabs.fallback.agent"),
  });
  const agent = member?.agent ?? null;
  const openAuthor = useMemo(() => {
    if (isHuman || !onOpenAgent || !member) return undefined;
    return () => onOpenAgent(member.agentId);
  }, [isHuman, onOpenAgent, member]);

  // Segments have no identity of their own. Their order is stable for one body;
  // changing the body recomputes the whole list.
  const segments = useMemo(() => {
    const keyed: { key: string; segment: RoomMessageSegment }[] = [];
    let index = 0;
    for (const segment of splitRoomMessage(expanded ? message.body : folded.text, directory)) {
      keyed.push({ key: `${index}-${segment.kind}`, segment });
      index += 1;
    }
    return keyed;
  }, [expanded, message.body, folded.text, directory]);

  return (
    <View style={styles.message} testID={`team-room-message-${message.id}`}>
      <MemberAvatar
        agentId={isHuman ? null : message.authorAgentId}
        label={author}
        status={agent?.status}
        requiresAttention={agent?.requiresAttention}
        attentionReason={agent?.attentionReason}
        pendingPermissionCount={agent?.pendingPermissions?.length ?? 0}
        onPress={openAuthor}
        testID={`team-room-message-${message.id}-avatar`}
      />
      <View style={styles.messageBody}>
        <View style={styles.messageHead}>
          <Text
            style={styles.author}
            numberOfLines={1}
            testID={`team-room-message-${message.id}-author`}
          >
            {author}
          </Text>
          <Text style={styles.time}>{formatMessageTimestamp(new Date(message.createdAt))}</Text>
        </View>
        <Text style={styles.body}>
          {segments.map((entry) => (
            <Segment key={entry.key} segment={entry.segment} onOpenAgent={onOpenAgent} />
          ))}
        </Text>
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
    </View>
  );
}

/**
 * One run of a body.
 *
 * Nested `Text` rather than a row of views: a mention has to wrap mid-sentence
 * with the words around it, and a flex row would put every segment on its own
 * line the moment one of them ran long.
 */
function Segment({
  segment,
  onOpenAgent,
}: {
  segment: RoomMessageSegment;
  onOpenAgent?: (agentId: string) => void;
}): ReactElement {
  const open = useMemo(() => {
    if (segment.kind === "mention" && !segment.inactive) {
      return onOpenAgent ? () => onOpenAgent(segment.agentId) : undefined;
    }
    return undefined;
  }, [segment, onOpenAgent]);

  if (segment.kind === "text") return <Text>{segment.text}</Text>;
  if (segment.kind === "mention") {
    return (
      <Text style={segment.inactive ? styles.inactiveMention : styles.mention} onPress={open}>
        {segment.text}
      </Text>
    );
  }
  if (segment.kind === "human") return <Text style={styles.mention}>{segment.text}</Text>;
  return <Text>{segment.text}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    overflow: "hidden",
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  messageBody: {
    flex: 1,
    gap: theme.spacing[1],
    // Without this the column refuses to shrink below its longest unbroken
    // token, and one stack trace widens the whole room.
    minWidth: 0,
  },
  messageHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  author: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    flexShrink: 1,
  },
  time: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  // The app's link color, not the reference design's blue: a mention is a link,
  // and it sits in the same body text as markdown links do.
  mention: {
    color: theme.colors.accentBright,
    fontWeight: "600",
  },
  inactiveMention: {
    color: theme.colors.foregroundMuted,
    fontWeight: "600",
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
  settingsButton: {
    minWidth: 36,
  },
  settingsBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.statusWarning,
  },
  settingsBadgeText: {
    color: theme.colors.surface0,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
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
