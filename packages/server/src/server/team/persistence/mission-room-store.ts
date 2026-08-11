import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  TeamRoomMessageSchema,
  type TeamRoomMessage,
  type TeamRoomMessageAuthor,
} from "@getpaseo/protocol/team/v2-types";

import { writeJsonFileAtomic } from "../../atomic-file.js";

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const StoredMissionRoomSchema = z.object({
  missionId: z.string().min(1),
  roomId: z.string().min(1),
  teamId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  messages: z.array(TeamRoomMessageSchema),
});

type StoredMissionRoom = z.infer<typeof StoredMissionRoomSchema>;

export interface MissionRoomMessageEvent {
  missionId: string;
  message: TeamRoomMessage;
  cursor: number;
}

export class MissionRoomNotFoundError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission room ${missionId} does not exist`);
    this.name = "MissionRoomNotFoundError";
  }
}

export class MissionRoomConflictError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission room ${missionId} conflicts with the persisted room`);
    this.name = "MissionRoomConflictError";
  }
}

export class MissionRoomMessageConflictError extends Error {
  constructor(
    readonly missionId: string,
    readonly messageId: string,
  ) {
    super(`Mission room message ${messageId} conflicts with the persisted message`);
    this.name = "MissionRoomMessageConflictError";
  }
}

export class MissionRoomStore {
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly subscribers = new Set<(event: MissionRoomMessageEvent) => void>();

  constructor(
    private readonly directory: string,
    private readonly now: () => string,
  ) {}

  async create(input: { missionId: string; roomId: string; teamId: string }): Promise<void> {
    await this.serialize(input.missionId, async () => {
      const existing = await this.readOptional(input.missionId);
      if (existing) {
        if (existing.roomId === input.roomId && existing.teamId === input.teamId) return;
        throw new MissionRoomConflictError(input.missionId);
      }
      const timestamp = this.now();
      await this.write({
        missionId: input.missionId,
        roomId: input.roomId,
        teamId: input.teamId,
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [],
      });
    });
  }

  async post(input: {
    messageId: string;
    missionId: string;
    roomId: string;
    author: TeamRoomMessageAuthor;
    body: string;
    replyToMessageId?: string | null;
    mentionAgentIds?: readonly string[];
  }): Promise<MissionRoomMessageEvent> {
    return this.serialize(input.missionId, async () => {
      const room = await this.require(input.missionId);
      if (room.roomId !== input.roomId) throw new MissionRoomConflictError(input.missionId);
      const body = input.body.trim();
      if (!body) throw new Error("Mission room message body must not be empty");
      const message: TeamRoomMessage = {
        id: input.messageId,
        missionId: input.missionId,
        roomId: room.roomId,
        authorAgentId: input.author.id,
        author: input.author,
        body,
        replyToMessageId: input.replyToMessageId?.trim() || null,
        mentionAgentIds: [...(input.mentionAgentIds ?? [])],
        createdAt: this.now(),
      };
      const replayIndex = room.messages.findIndex((candidate) => candidate.id === input.messageId);
      if (replayIndex >= 0) {
        const replay = room.messages[replayIndex];
        if (!replay || !sameMessageIntent(replay, message)) {
          throw new MissionRoomMessageConflictError(input.missionId, input.messageId);
        }
        return { missionId: input.missionId, message: replay, cursor: replayIndex + 1 };
      }
      const next = {
        ...room,
        updatedAt: message.createdAt,
        messages: [...room.messages, message],
      };
      await this.write(next);
      const event = { missionId: input.missionId, message, cursor: next.messages.length };
      for (const subscriber of this.subscribers) subscriber(event);
      return event;
    });
  }

  async read(input: { missionId: string; afterCursor?: number; limit?: number }): Promise<{
    roomId: string;
    messages: TeamRoomMessage[];
    cursor: number;
    hasMore: boolean;
  }> {
    const room = await this.require(input.missionId);
    const limit = normalizeLimit(input.limit);
    if (input.afterCursor === undefined) {
      const messages =
        limit >= room.messages.length
          ? [...room.messages]
          : room.messages.slice(room.messages.length - limit);
      return { roomId: room.roomId, messages, cursor: room.messages.length, hasMore: false };
    }
    const start = Math.min(Math.max(0, input.afterCursor), room.messages.length);
    const messages = room.messages.slice(start, start + limit);
    return {
      roomId: room.roomId,
      messages,
      cursor: start + messages.length,
      hasMore: start + messages.length < room.messages.length,
    };
  }

  onMessage(subscriber: (event: MissionRoomMessageEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private async require(missionId: string): Promise<StoredMissionRoom> {
    const room = await this.readOptional(missionId);
    if (!room) throw new MissionRoomNotFoundError(missionId);
    return room;
  }

  private async readOptional(missionId: string): Promise<StoredMissionRoom | null> {
    const filePath = this.filePath(missionId);
    try {
      return StoredMissionRoomSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  private async write(room: StoredMissionRoom): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeJsonFileAtomic(this.filePath(room.missionId), room);
  }

  private filePath(missionId: string): string {
    if (!RECORD_ID_PATTERN.test(missionId)) throw new Error(`Invalid Mission id: ${missionId}`);
    return join(this.directory, `${missionId}.json`);
  }

  private async serialize<T>(missionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(missionId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => tail);
    this.mutationTails.set(missionId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(missionId) === queued) this.mutationTails.delete(missionId);
    }
  }
}

function sameMessageIntent(left: TeamRoomMessage, right: TeamRoomMessage): boolean {
  return isDeepStrictEqual(
    {
      missionId: left.missionId,
      roomId: left.roomId,
      authorAgentId: left.authorAgentId,
      author: left.author,
      body: left.body,
      replyToMessageId: left.replyToMessageId,
      mentionAgentIds: left.mentionAgentIds,
    },
    {
      missionId: right.missionId,
      roomId: right.roomId,
      authorAgentId: right.authorAgentId,
      author: right.author,
      body: right.body,
      replyToMessageId: right.replyToMessageId,
      mentionAgentIds: right.mentionAgentIds,
    },
  );
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit <= 0)
    throw new Error("Mission room limit must be positive");
  return Math.min(limit, MAX_PAGE_SIZE);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
