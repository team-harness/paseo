import type { ChatRoomOwnerKind } from "@getpaseo/protocol/chat/types";
import type { TeamMemberState } from "@getpaseo/protocol/team/types";

/** One seat on a team, as the resolver needs to see it. */
export interface RoomRosterEntry {
  agentId: string;
  role: string;
  state: TeamMemberState;
}

/**
 * What the resolver has to ask the rest of the daemon.
 *
 * Injected rather than imported: this runs inside chat fanout, and reaching for
 * the team store or the chat store from here would tie the two together for one
 * lookup each.
 */
export interface RoomMentionLookups {
  /** Who owns the room, or null when nobody does and when there is no such room. */
  getRoomOwner(roomId: string): Promise<{ kind: ChatRoomOwnerKind; id: string } | null>;
  /** The team's seats, or null when there is no team by that id. */
  getTeamRoster(teamId: string): Promise<RoomRosterEntry[] | null>;
  /** Client ids of the humans who have posted in this room. */
  listHumanAuthorIds(roomId: string): Promise<string[]>;
}

/** Passes straight through: fanout expands it against the room, not the roster. */
const EVERYONE = "everyone";

/**
 * Turns what somebody typed after an `@` into something fanout can deliver to.
 *
 * Two rewrites happen here, both of which the fanout below cannot do for itself
 * because it only ever sees a flat list of tokens.
 *
 * A role becomes the agent holding it. `@docs` is how a lead is told to address
 * its team and how anyone reading the transcript follows it, but fanout looks
 * every token up as an agent id, so a role used to resolve to nobody — silently,
 * with one WARN in the daemon log. Roles only resolve inside the room the team
 * owns; elsewhere "reviewer" is a word.
 *
 * A human drops out. An agent replying to a person mentions the id it saw, which
 * is a client id, and no agent will ever have it. Left in, it counts against the
 * `@everyone` cap and produces the same misleading WARN.
 *
 * Anything else is passed through untouched — bare ids, custom titles, and
 * tokens that are simply not addressed to anyone still mean what they meant.
 */
export async function resolveRoomMentionTokens(input: {
  roomId: string;
  tokens: string[];
  lookups: RoomMentionLookups;
}): Promise<string[]> {
  if (input.tokens.length === 0) return [];

  const humans = new Set(await input.lookups.listHumanAuthorIds(input.roomId));
  const roles = await readRoleIndex(input.roomId, input.lookups);

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const token of input.tokens) {
    if (token !== EVERYONE && humans.has(token)) continue;
    const target = token === EVERYONE ? token : (roles.get(token.toLowerCase()) ?? token);
    if (seen.has(target)) continue;
    seen.add(target);
    resolved.push(target);
  }
  return resolved;
}

/**
 * Role to agent id for the team that owns this room, lowercased on both sides.
 *
 * Empty for a room no team owns. Only `active` seats count: a removed member is
 * history, and an archived one cannot be woken anyway, so resolving to either
 * would name a target that fanout drops a moment later.
 *
 * A role two members share resolves to the first of them. The roster does not
 * stop that from happening, and picking one beats resolving to neither.
 */
async function readRoleIndex(
  roomId: string,
  lookups: RoomMentionLookups,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const owner = await lookups.getRoomOwner(roomId);
  if (owner?.kind !== "team") return index;
  const roster = await lookups.getTeamRoster(owner.id);
  for (const member of roster ?? []) {
    if (member.state !== "active") continue;
    const role = member.role.trim().toLowerCase();
    if (role.length === 0 || index.has(role)) continue;
    index.set(role, member.agentId);
  }
  return index;
}
