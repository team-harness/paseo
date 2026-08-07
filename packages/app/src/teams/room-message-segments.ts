/** A run of a room message body, and what tapping it should do. */
export type RoomMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; agentId: string }
  | { kind: "task"; text: string; taskId: string };

export interface RoomMessageDirectory {
  /** The roster of the team this room belongs to. */
  members: readonly { agentId: string; role: string }[];
  /** Task ids from the ledger the client currently holds. */
  taskIds: readonly string[];
}

/** Below this a shortened id is too weak to be sure of, so it stays text. */
const MIN_SHORT_ID = 8;

const TOKEN = /[@#][A-Za-z0-9_-]+/g;

/**
 * Splits a room message into the parts that can be tapped.
 *
 * The roster decides, not `mentionAgentIds`: that field holds the token the
 * author actually typed, which is what the highlight should read, but only a
 * roster hit gives the tap somewhere to go. A token that resolves to nobody
 * stays plain text — a link that opens someone else's conversation is worse
 * than an id spelled out.
 */
export function splitRoomMessage(
  body: string,
  directory: RoomMessageDirectory,
): RoomMessageSegment[] {
  const segments: RoomMessageSegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(TOKEN)) {
    const start = match.index;
    // An email address, a markdown heading, a colour. Only a token that starts
    // a word is one of ours.
    if (start > 0 && /[\w@#]/.test(body[start - 1] ?? "")) continue;

    const resolved = resolve(match[0], directory);
    if (!resolved) continue;

    if (start > cursor) segments.push({ kind: "text", text: body.slice(cursor, start) });
    segments.push(resolved);
    cursor = start + match[0].length;
  }

  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });
  return segments;
}

function resolve(token: string, directory: RoomMessageDirectory): RoomMessageSegment | null {
  const value = token.slice(1);
  if (token.startsWith("@")) {
    const agentId = resolveMember(value, directory.members);
    return agentId ? { kind: "mention", text: token, agentId } : null;
  }
  const taskId = resolveId(value, directory.taskIds);
  return taskId ? { kind: "task", text: token, taskId } : null;
}

function resolveMember(
  value: string,
  members: readonly { agentId: string; role: string }[],
): string | null {
  const folded = value.toLowerCase();
  // Roles win over ids: they are what the lead is briefed with, and the only
  // form a person types on purpose.
  const byRole = members.find((member) => member.role.toLowerCase() === folded);
  if (byRole) return byRole.agentId;
  return resolveId(
    value,
    members.map((member) => member.agentId),
  );
}

/** An id written in full, or a prefix long enough to mean exactly one thing. */
function resolveId(value: string, ids: readonly string[]): string | null {
  const folded = value.toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === folded);
  if (exact) return exact;
  if (folded.length < MIN_SHORT_ID) return null;
  const matches = ids.filter((id) => id.toLowerCase().startsWith(folded));
  // Two hits is no hit. Picking one would send the tap somewhere arbitrary.
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
