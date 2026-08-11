import {
  buildTeamMentionHandles,
  TEAM_MENTION_TOKEN_SOURCE,
} from "@getpaseo/protocol/team/mention-handles";

/** A run of a room message body, and what tapping it should do. */
export type RoomMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; agentId: string; inactive?: true }
  | { kind: "human"; text: string }
  | { kind: "task"; text: string; taskId: string };

export interface RoomMessageDirectory {
  /** The roster of the team this room belongs to. */
  members: readonly {
    agentId: string;
    role: string;
    mentionHandle?: string | null;
    active?: boolean;
  }[];
  /** Human client ids observed in this room and the local label they use. */
  humans?: readonly { id: string; label: string }[];
  /** Task ids from the ledger the client currently holds. */
  taskIds: readonly string[];
}

/** Below this a shortened id is too weak to be sure of, so it stays text. */
const MIN_SHORT_ID = 8;
const UUID_AGENT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PREFIXED_OPAQUE_AGENT_ID = /^(?:agent|agt|cid)_[a-z0-9_-]{12,}$/i;

const TOKEN = new RegExp(`(?:@${TEAM_MENTION_TOKEN_SOURCE}|#[A-Za-z0-9_-]+)`, "g");

/**
 * Splits a room message into the parts that can be tapped.
 *
 * The roster decides, not `mentionAgentIds`: only a roster hit gives the tap
 * somewhere to go. Readable tokens keep what the author typed; opaque id
 * tokens render as the member's current handle. A token that resolves to
 * nobody stays plain text — a link that opens someone else's conversation is
 * worse than an id spelled out.
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
    const member = resolveMember(value, directory.members);
    if (member) {
      const mention: RoomMessageSegment = {
        kind: "mention",
        text: member.displayAsHandle ? `@${member.handle}` : token,
        agentId: member.agentId,
      };
      return member.inactive ? { ...mention, inactive: true } : mention;
    }
    const human = directory.humans?.find((entry) => entry.id.toLowerCase() === value.toLowerCase());
    return human ? { kind: "human", text: `@${human.label}` } : null;
  }
  const taskId = resolveId(value, directory.taskIds);
  return taskId ? { kind: "task", text: token, taskId } : null;
}

function resolveMember(
  value: string,
  members: RoomMessageDirectory["members"],
): { agentId: string; handle: string; displayAsHandle: boolean; inactive: boolean } | null {
  const folded = value.toLowerCase();
  const addressed = buildTeamMentionHandles(members);
  const exactId = addressed.find((member) => member.agentId.toLowerCase() === folded);
  if (exactId) {
    return {
      agentId: exactId.agentId,
      handle: exactId.handle,
      displayAsHandle: isOpaqueAgentId(exactId.agentId),
      inactive: isInactive(exactId.agentId, members),
    };
  }

  const byHandle = addressed.find((member) => member.handle.toLowerCase() === folded);
  if (byHandle) {
    return {
      agentId: byHandle.agentId,
      handle: byHandle.handle,
      displayAsHandle: false,
      inactive: isInactive(byHandle.agentId, members),
    };
  }

  const agentId = resolveId(
    value,
    members.map((member) => member.agentId),
  );
  if (!agentId) return null;
  const byId = addressed.find((member) => member.agentId === agentId);
  return byId
    ? {
        agentId: byId.agentId,
        handle: byId.handle,
        displayAsHandle: isOpaqueAgentId(byId.agentId),
        inactive: isInactive(byId.agentId, members),
      }
    : null;
}

function isInactive(agentId: string, members: RoomMessageDirectory["members"]): boolean {
  return members.find((member) => member.agentId === agentId)?.active === false;
}

function isOpaqueAgentId(value: string): boolean {
  return UUID_AGENT_ID.test(value) || PREFIXED_OPAQUE_AGENT_ID.test(value);
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
