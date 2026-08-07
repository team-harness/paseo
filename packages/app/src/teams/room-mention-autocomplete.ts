/** The `@…` being typed, and where it sits in the composer. */
export interface RoomMentionRange {
  /** Index of the `@`. */
  start: number;
  /** The cursor, which is where the typed name ends. */
  end: number;
  /** What has been typed after the `@`, possibly empty. */
  query: string;
}

/** Someone in the room who can be named. */
export interface RoomMentionCandidate {
  agentId: string;
  role: string;
  /** What the agent calls itself, shown beside the role. */
  title?: string | null;
}

/**
 * What the daemon will read back as a mention.
 *
 * `parseMentionAgentIds` (`packages/server/src/server/chat/chat-service.ts`)
 * matches `@` at the start of a word followed by these characters, so a name
 * outside the set cannot be mentioned at all — completing one would insert
 * text that looks routed and is not.
 */
const MENTIONABLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The tail of a token, which is the same set minus the first-character rule. */
const PARTIAL = /^[A-Za-z0-9._-]*$/;

/** The `@` has to start a word, matching the daemon's own pattern. */
const OPENS_AFTER = /[\s(]/;

/**
 * The mention the cursor is inside, if it is inside one.
 *
 * Only the last `@` is considered. An earlier one is either separated from the
 * cursor by a space — which ends the token — or by another `@`, and neither can
 * still be open.
 */
export function findActiveRoomMention(input: {
  text: string;
  cursorIndex: number;
}): RoomMentionRange | null {
  const cursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const before = input.text.slice(0, cursor);

  const start = before.lastIndexOf("@");
  if (start < 0) return null;

  const preceding = start === 0 ? null : (before[start - 1] ?? null);
  if (preceding !== null && !OPENS_AFTER.test(preceding)) return null;

  const query = before.slice(start + 1);
  if (!PARTIAL.test(query)) return null;

  return { start, end: cursor, query };
}

/**
 * Who the query could mean, best first.
 *
 * A role the daemon cannot parse is dropped rather than ranked last: offering
 * "tech lead" would write `@tech lead`, which is read as `@tech` and wakes
 * nobody.
 */
export function rankRoomMentionCandidates(input: {
  candidates: readonly RoomMentionCandidate[];
  query: string;
}): RoomMentionCandidate[] {
  const folded = input.query.toLowerCase();
  const scored: { candidate: RoomMentionCandidate; rank: number; at: number }[] = [];

  input.candidates.forEach((candidate, at) => {
    if (!MENTIONABLE.test(candidate.role)) return;
    const rank = scoreCandidate(candidate, folded);
    if (rank === null) return;
    scored.push({ candidate, rank, at });
  });

  // Roster order breaks ties, so the lead stays above the members it briefs.
  scored.sort((left, right) => left.rank - right.rank || left.at - right.at);
  return scored.map((entry) => entry.candidate);
}

function scoreCandidate(candidate: RoomMentionCandidate, query: string): number | null {
  if (query.length === 0) return 1;

  const role = candidate.role.toLowerCase();
  if (role === query) return 0;
  if (role.startsWith(query)) return 1;
  if (role.includes(query)) return 2;

  // The title is what a person recognises the agent by; it is matched so the
  // name can be found, and never inserted, because only the role resolves.
  const title = candidate.title?.toLowerCase() ?? "";
  if (title.length > 0 && title.includes(query)) return 3;

  return null;
}

/**
 * Writes the chosen role into the composer.
 *
 * The role goes in, not the agent id: the daemon resolves roles inside a team
 * room, and a uuid in the middle of a sentence is unreadable.
 */
export function applyRoomMentionReplacement(input: {
  text: string;
  mention: RoomMentionRange;
  role: string;
}): { text: string; cursorIndex: number } {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  // A mention ends at a space, so the space belongs to the insertion rather
  // than to whatever is typed next.
  const spaced = after.startsWith(" ");
  const inserted = `@${input.role}${spaced ? "" : " "}`;
  return {
    text: `${before}${inserted}${after}`,
    // Past the space either way, so the next keystroke starts a word instead of
    // growing the name that was just chosen.
    cursorIndex: before.length + inserted.length + (spaced ? 1 : 0),
  };
}
