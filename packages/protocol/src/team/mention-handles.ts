export interface TeamMentionMember {
  agentId: string;
  role: string;
  mentionHandle?: string | null;
}

export interface TeamMentionHandle extends TeamMentionMember {
  handle: string;
}

export interface TeamMentionHandleOptions {
  reservedHandles?: readonly string[];
}

export const TEAM_MENTION_TOKEN_SOURCE = "[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?";
const MENTION_TOKEN_PATTERN = new RegExp(`^${TEAM_MENTION_TOKEN_SOURCE}$`);

/** The token grammar accepted after `@` in a team room. */
export function isTeamMentionToken(value: string): boolean {
  return MENTION_TOKEN_PATTERN.test(value);
}

/** Builds the readable, stable address used to mention each team member. */
export function buildTeamMentionHandles<Member extends TeamMentionMember>(
  members: readonly Member[],
  options: TeamMentionHandleOptions = {},
): Array<Member & TeamMentionHandle> {
  // Exact ids and persisted handles are reserved globally. Unpersisted roles
  // allocate strictly in roster order, so appending a member cannot rename an
  // address already present in a briefing or room history.
  const claimed = new Map<string, string | null>([["everyone", null]]);
  for (const reservedHandle of options.reservedHandles ?? []) {
    const handle = reservedHandle.trim().toLowerCase();
    if (isTeamMentionToken(handle)) claimed.set(handle, null);
  }
  for (const member of members) {
    const agentId = member.agentId.trim().toLowerCase();
    if (isTeamMentionToken(agentId)) claimed.set(agentId, member.agentId);
  }

  const persisted = new Map<string, string>();
  for (const member of members) {
    const handle = member.mentionHandle?.trim().toLowerCase() ?? "";
    if (
      isTeamMentionToken(handle) &&
      (!claimed.has(handle) || claimed.get(handle) === member.agentId)
    ) {
      claimed.set(handle, member.agentId);
      persisted.set(member.agentId, handle);
    }
  }

  // Roster entries are append-only. Allocation in roster order keeps every
  // derived handle prefix-stable while respecting the reserved addresses.
  return members.map((member) => {
    const persistedHandle = persisted.get(member.agentId);
    if (persistedHandle) return { ...member, handle: persistedHandle };

    const base = toHandleBase(member.role);
    let handle = base;
    let suffix = 2;
    while (claimed.has(handle) && claimed.get(handle) !== member.agentId) {
      handle = `${base}-${suffix}`;
      suffix += 1;
    }
    claimed.set(handle, member.agentId);
    return { ...member, handle };
  });
}

/** Freezes derived addresses onto roster entries before they are persisted. */
export function assignTeamMentionHandles<Member extends TeamMentionMember>(
  members: readonly Member[],
  options: TeamMentionHandleOptions = {},
): Array<Member & { mentionHandle: string }> {
  const handles = buildTeamMentionHandles(members, options);
  return members.map((member, index) => ({
    ...member,
    mentionHandle: handles[index]?.handle ?? toHandleBase(member.role),
  }));
}

function toHandleBase(role: string): string {
  return toTokenPart(role, "member");
}

function toTokenPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[._-]+$/g, "");
  return normalized || fallback;
}
