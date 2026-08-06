import type pino from "pino";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { ManagedAgent } from "../agent/agent-manager.js";

export const CHAT_MENTION_FANOUT_LIMIT = 25;

export interface ChatMentionNotificationInput {
  room: string;
  authorAgentId: string;
  body: string;
  mentionAgentIds: string[];
}

export interface PreparedChatMentionFanout {
  targetMentionAgentIds: string[];
  roomPosterAgentIds: string[];
}

export type PrepareChatMentionFanoutResult =
  | { ok: true; prepared: PreparedChatMentionFanout }
  | { ok: false; error: string };

export interface PrepareChatMentionFanoutInput {
  authorAgentId: string;
  mentionAgentIds: string[];
  storedAgents: StoredAgentRecord[];
  liveAgents: ManagedAgent[];
  listRoomPosterAgentIds: () => Promise<string[]>;
  limit?: number;
}

export interface NotifyChatMentionsInput extends ChatMentionNotificationInput {
  logger: pino.Logger;
  storedAgents: StoredAgentRecord[];
  liveAgents: ManagedAgent[];
  prepared: PreparedChatMentionFanout;
  resolveAgentIdentifier: (
    identifier: string,
  ) => Promise<{ ok: true; agentId: string } | { ok: false; error: string }>;
  sendAgentMessage: (agentId: string, text: string) => Promise<void>;
}

export async function prepareChatMentionFanout(
  input: PrepareChatMentionFanoutInput,
): Promise<PrepareChatMentionFanoutResult> {
  const mentionsEveryone = input.mentionAgentIds.includes("everyone");
  const roomPosterAgentIds = mentionsEveryone ? await input.listRoomPosterAgentIds() : [];
  const targetMentionAgentIds = expandChatMentionTargets({
    authorAgentId: input.authorAgentId,
    mentionAgentIds: input.mentionAgentIds,
    storedAgents: input.storedAgents,
    liveAgents: input.liveAgents,
    roomPosterAgentIds,
  });

  if (mentionsEveryone) {
    const limit = input.limit ?? CHAT_MENTION_FANOUT_LIMIT;
    if (targetMentionAgentIds.length > limit) {
      return {
        ok: false,
        error: `@everyone would notify ${targetMentionAgentIds.length} agents, which exceeds the limit of ${limit}. Narrow the room or mention specific agents.`,
      };
    }
  }

  return { ok: true, prepared: { targetMentionAgentIds, roomPosterAgentIds } };
}

export async function notifyChatMentions(input: NotifyChatMentionsInput): Promise<void> {
  const { targetMentionAgentIds } = input.prepared;
  if (targetMentionAgentIds.length === 0) {
    return;
  }

  const notification = buildChatMentionNotification({
    room: input.room,
    authorAgentId: input.authorAgentId,
    body: input.body,
    mentionAgentIds: targetMentionAgentIds,
  });

  await Promise.all(
    targetMentionAgentIds.map(async (mentionedAgentId) => {
      const resolved = await input.resolveAgentIdentifier(mentionedAgentId);
      if (!resolved.ok) {
        input.logger.warn(
          { mentionedAgentId, room: input.room, error: resolved.error },
          "Failed to resolve chat mention target",
        );
        return;
      }

      // Re-check eligibility on the resolved canonical id: explicit mentions may
      // be custom titles that resolve to an archived or error-state agent.
      if (
        !isChatMentionTargetEligible({
          agentId: resolved.agentId,
          authorAgentId: input.authorAgentId,
          storedAgents: input.storedAgents,
          liveAgents: input.liveAgents,
        })
      ) {
        return;
      }

      // DEC-10: a mention nudges, it never interrupts. An agent mid-turn
      // already has the message in the room and will read it when it looks;
      // waking it would cancel work someone else is waiting on.
      if (
        !isChatMentionTargetWakeable({
          agentId: resolved.agentId,
          storedAgents: input.storedAgents,
          liveAgents: input.liveAgents,
        })
      ) {
        return;
      }

      try {
        await input.sendAgentMessage(resolved.agentId, notification);
      } catch (error) {
        input.logger.warn(
          { err: error, mentionedAgentId: resolved.agentId, room: input.room },
          "Failed to notify mentioned agent about chat message",
        );
      }
    }),
  );
}

export function buildChatMentionNotification(input: ChatMentionNotificationInput): string {
  const mentioned = input.mentionAgentIds.map((agentId) => `@${agentId}`).join(", ");
  const bodyWithoutMentions = input.body.replace(/(^|\s)@[A-Za-z0-9][A-Za-z0-9._-]*/g, "$1").trim();
  const body = bodyWithoutMentions.length > 0 ? bodyWithoutMentions : input.body;

  return [
    `Chat mention from ${input.authorAgentId} in room "${input.room}".`,
    `Mentioned agents: ${mentioned}.`,
    "Message:",
    body,
    `Read the room with: paseo chat read ${input.room} --limit 20`,
  ].join("\n");
}

function expandChatMentionTargets(input: {
  authorAgentId: string;
  mentionAgentIds: string[];
  storedAgents: StoredAgentRecord[];
  liveAgents: ManagedAgent[];
  roomPosterAgentIds: string[];
}): string[] {
  const candidates = new Set<string>();
  const mentionsEveryone = input.mentionAgentIds.includes("everyone");

  for (const mentionAgentId of input.mentionAgentIds) {
    if (mentionAgentId === "everyone" || mentionAgentId === input.authorAgentId) {
      continue;
    }
    candidates.add(mentionAgentId);
  }

  if (mentionsEveryone) {
    for (const posterAgentId of input.roomPosterAgentIds) {
      if (posterAgentId !== input.authorAgentId) {
        candidates.add(posterAgentId);
      }
    }
  }

  const targets: string[] = [];
  for (const candidate of candidates) {
    if (
      isChatMentionTargetEligible({
        agentId: candidate,
        authorAgentId: input.authorAgentId,
        storedAgents: input.storedAgents,
        liveAgents: input.liveAgents,
      })
    ) {
      targets.push(candidate);
    }
  }
  return targets;
}

/**
 * Whether a mention should start a turn for this agent, as opposed to only
 * landing the message in the room.
 *
 * Live state wins where it exists: the stored record is a snapshot written at
 * turn boundaries, so it can say "running" for an agent that has since gone
 * idle, or "idle" for one that just started. An agent with no live entry has no
 * session in memory at all, which is precisely the one that needs waking.
 */
function isChatMentionTargetWakeable(input: {
  agentId: string;
  storedAgents: StoredAgentRecord[];
  liveAgents: ManagedAgent[];
}): boolean {
  const live = input.liveAgents.find((agent) => agent.id === input.agentId);
  if (live) {
    return live.lifecycle !== "running";
  }

  const stored = input.storedAgents.find((record) => record.id === input.agentId);
  return stored?.lastStatus !== "running";
}

function isChatMentionTargetEligible(input: {
  agentId: string;
  authorAgentId: string;
  storedAgents: StoredAgentRecord[];
  liveAgents: ManagedAgent[];
}): boolean {
  if (input.agentId === input.authorAgentId) {
    return false;
  }

  // `internal` and `archivedAt` are durable facts the stored record owns.
  const stored = input.storedAgents.find((record) => record.id === input.agentId);
  if (stored?.internal || stored?.archivedAt) {
    return false;
  }

  // `lastStatus` is not: it is written at turn boundaries, so an agent that has
  // recovered still reads as `error` there until it next writes. Letting that
  // decide would make the agent permanently unmentionable. Where a live entry
  // exists it is the current answer; the stored status only fills the gap.
  const live = input.liveAgents.find((agent) => agent.id === input.agentId);
  if (live) {
    return !live.internal && live.lifecycle !== "error";
  }

  return stored?.lastStatus !== "error";
}
