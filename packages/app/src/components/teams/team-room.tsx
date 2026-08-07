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
import { RotateCw, SendHorizontal } from "lucide-react-native";

import type { ChatMessage } from "@getpaseo/protocol/chat/types";

import { MemberAvatar } from "@/components/teams/member-avatar";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { TeamMemberRow } from "@/runtime/team-sync/selectors";
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
import type { Theme } from "@/styles/theme";
import { setTextInputSelection } from "@/utils/text-input-selection";
import { formatMessageTimestamp } from "@/utils/time";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const NO_TASKS: readonly string[] = [];

/** Enough for four or five names; a bigger team scrolls rather than covers the room. */
const AUTOCOMPLETE_MAX_HEIGHT = 180;

export interface TeamRoomProps {
  serverId: string;
  roomId: string | null;
  roster: readonly TeamMemberRow[];
  /** Task ids the client holds, so a `#id` in a message can become a chip. */
  taskIds?: readonly string[];
  /** A room nobody can post to any more — the team is archiving or over. */
  readOnly?: boolean;
  /** Opens a member's own conversation. Avatars and mentions are inert without it. */
  onOpenAgent?: (agentId: string) => void;
  /** Shows one task. Task chips are inert without it. */
  onOpenTask?: (taskId: string) => void;
}

export function TeamRoom({
  serverId,
  roomId,
  roster,
  taskIds = NO_TASKS,
  readOnly = false,
  onOpenAgent,
  onOpenTask,
}: TeamRoomProps): ReactElement {
  const { t } = useTranslation();
  const { timeline, error, loading, retry } = useRoomSubscription(serverId, roomId);

  // Whoever posted, named and colored the way the rest of the panel names them.
  // An agent id in a transcript is unreadable, and the roster is the only place
  // that knows a member is "reviewer".
  const members = useMemo(() => {
    const byAgentId = new Map<string, TeamMemberRow>();
    for (const row of roster) byAgentId.set(row.entry.agentId, row);
    return byAgentId;
  }, [roster]);

  const directory = useMemo<RoomMessageDirectory>(
    () => ({
      members: roster.map((row) => ({ agentId: row.entry.agentId, role: row.entry.role })),
      taskIds,
    }),
    [roster, taskIds],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <RoomMessage
        message={item}
        member={members.get(item.authorAgentId) ?? null}
        directory={directory}
        onOpenAgent={onOpenAgent}
        onOpenTask={onOpenTask}
      />
    ),
    [members, directory, onOpenAgent, onOpenTask],
  );

  const composer =
    readOnly || !roomId ? null : (
      <RoomComposer serverId={serverId} roomId={roomId} roster={roster} />
    );

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
function RoomComposer({
  serverId,
  roomId,
  roster,
}: {
  serverId: string;
  roomId: string;
  roster: readonly TeamMemberRow[];
}): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const inputRef = useRef<TextInput>(null);
  const [body, setBody] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [state, setState] = useState<PostRoomMessageState>({ status: "idle" });

  // Only people still on the team. Naming someone who left writes a mention the
  // daemon resolves to nobody.
  const candidates = useMemo<RoomMentionCandidate[]>(
    () =>
      roster
        .filter((row) => row.entry.state === "active")
        .map((row) => ({
          agentId: row.entry.agentId,
          role: row.entry.role,
          title: row.agent?.title ?? null,
        })),
    [roster],
  );
  const roleByAgentId = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.agentId, candidate.role] as const)),
    [candidates],
  );

  const mention = useMemo(
    () => findActiveRoomMention({ text: body, cursorIndex }),
    [body, cursorIndex],
  );
  const options = useMemo<AutocompleteOption[]>(() => {
    if (!mention) return [];
    return rankRoomMentionCandidates({ candidates, query: mention.query }).map((candidate) => ({
      id: candidate.agentId,
      label: `@${candidate.role}`,
      description: candidate.title ?? undefined,
    }));
  }, [mention, candidates]);
  const isVisible = mention !== null && options.length > 0;

  const selectOption = useCallback(
    (option: AutocompleteOption) => {
      const role = roleByAgentId.get(option.id);
      if (!mention || !role) return;
      const next = applyRoomMentionReplacement({ text: body, mention, role });
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
    [body, mention, roleByAgentId],
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
    const sent = body;
    void postRoomMessage(
      { roomId, body, client },
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
  }, [body, client, roomId, t]);

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
      </View>
    </View>
  );
}

function RoomMessage({
  message,
  member,
  directory,
  onOpenAgent,
  onOpenTask,
}: {
  message: ChatMessage;
  member: TeamMemberRow | null;
  directory: RoomMessageDirectory;
  onOpenAgent?: (agentId: string) => void;
  onOpenTask?: (taskId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const folded = useMemo(() => foldRoomMessage(message.body), [message.body]);
  const expand = useCallback(() => setExpanded(true), []);

  const isHuman = message.author?.kind === "human";
  const author = describeAuthor(message, member?.entry.role ?? null, t("teams.room.person"));
  const agent = member?.agent ?? null;
  const openAuthor = useMemo(() => {
    if (isHuman || !onOpenAgent || !member) return undefined;
    return () => onOpenAgent(member.entry.agentId);
  }, [isHuman, onOpenAgent, member]);

  // Segments have no identity of their own, but they tile the body exactly, so
  // where one starts names it: insert a word and everything after it moves,
  // which is the same thing React needs to know.
  const segments = useMemo(() => {
    const keyed: { key: string; segment: RoomMessageSegment }[] = [];
    let at = 0;
    for (const segment of splitRoomMessage(expanded ? message.body : folded.text, directory)) {
      keyed.push({ key: `${at}-${segment.kind}`, segment });
      at += segment.text.length;
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
          <Text style={styles.author} numberOfLines={1}>
            {author}
          </Text>
          <Text style={styles.time}>{formatMessageTimestamp(new Date(message.createdAt))}</Text>
        </View>
        <Text style={styles.body}>
          {segments.map((entry) => (
            <Segment
              key={entry.key}
              segment={entry.segment}
              onOpenAgent={onOpenAgent}
              onOpenTask={onOpenTask}
            />
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
  onOpenTask,
}: {
  segment: RoomMessageSegment;
  onOpenAgent?: (agentId: string) => void;
  onOpenTask?: (taskId: string) => void;
}): ReactElement {
  const open = useMemo(() => {
    if (segment.kind === "mention") {
      return onOpenAgent ? () => onOpenAgent(segment.agentId) : undefined;
    }
    if (segment.kind === "task") {
      return onOpenTask ? () => onOpenTask(segment.taskId) : undefined;
    }
    return undefined;
  }, [segment, onOpenAgent, onOpenTask]);

  if (segment.kind === "text") return <Text>{segment.text}</Text>;
  if (segment.kind === "mention") {
    return (
      <Text style={styles.mention} onPress={open}>
        {segment.text}
      </Text>
    );
  }
  return (
    <Text style={styles.task} onPress={open}>
      {segment.text}
    </Text>
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
  task: {
    color: theme.colors.statusWarning,
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
