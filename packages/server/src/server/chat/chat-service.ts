import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";
import {
  ChatMessageSchema,
  ChatRoomDetailSchema,
  ChatRoomSchema,
  type ChatAuthor,
  type ChatMessage,
  type ChatRoom,
  type ChatRoomDetail,
} from "@getpaseo/protocol/chat/types";

/** The pre-0.3.0 layout: every room and every message in one file. */
const LegacyChatStorePayloadSchema = z.object({
  rooms: z.array(ChatRoomSchema),
  messages: z.array(z.unknown()),
});

const ChatRoomFileSchema = z.object({
  room: ChatRoomSchema,
  messages: z.array(ChatMessageSchema),
});

type ChatRoomFile = z.infer<typeof ChatRoomFileSchema>;

function normalizeRoomName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const CHAT_MENTION_PATTERN = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export function parseMentionAgentIds(body: string): string[] {
  const mentionAgentIds = new Set<string>();
  for (const match of body.matchAll(CHAT_MENTION_PATTERN)) {
    const agentId = match[1]?.trim();
    if (agentId) {
      mentionAgentIds.add(agentId);
    }
  }
  return Array.from(mentionAgentIds).sort();
}

export class ChatServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChatServiceError";
    this.code = code;
  }
}

interface Waiter {
  roomId: string;
  afterMessageId: string | null;
  resolve: (messages: ChatMessage[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface CreateChatRoomInput {
  name: string;
  purpose?: string | null;
}

export interface InspectChatRoomInput {
  room: string;
}

export interface DeleteChatRoomInput {
  room: string;
}

export interface PostChatMessageInput {
  room: string;
  authorAgentId: string;
  body: string;
  replyToMessageId?: string | null;
}

/** Who is speaking. A human's id is a client id, not an agent id. */
export type ChatActor = ChatAuthor;

export interface PostMessageInput {
  actor: ChatActor;
  room: string;
  body: string;
  replyToMessageId?: string | null;
}

export interface ChatMentionNotification {
  roomId: string;
  actor: ChatActor;
  body: string;
  mentionAgentIds: string[];
}

/**
 * Wakes mentioned agents. Injected rather than imported so the service stays
 * independent of the agent runtime, and so a test can watch the fanout without
 * one.
 */
export type ChatMentionNotifier = (input: ChatMentionNotification) => Promise<void>;

export interface ReadChatMessagesInput {
  room: string;
  limit?: number;
  since?: string;
  authorAgentId?: string;
}

export interface ListChatRoomPosterAgentIdsInput {
  room: string;
}

export interface WaitForChatMessagesInput {
  room: string;
  afterMessageId?: string | null;
  timeoutMs?: number;
}

export interface DeleteChatRoomResult {
  room: ChatRoomDetail;
}

export interface InspectChatRoomResult {
  room: ChatRoomDetail;
}

export class FileBackedChatService {
  private readonly chatDir: string;
  private readonly roomsDir: string;
  private readonly legacyFilePath: string;
  private readonly migratedMarkerPath: string;
  private readonly logger: pino.Logger;
  private loaded = false;
  private readonly rooms = new Map<string, ChatRoom>();
  private readonly messagesByRoomId = new Map<string, ChatMessage[]>();
  /** Serialized per room: one busy room no longer rewrites every other room. */
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly waitersByRoomId = new Map<string, Set<Waiter>>();

  private readonly notifyMentions: ChatMentionNotifier | null;

  constructor(options: {
    paseoHome: string;
    logger: pino.Logger;
    notifyMentions?: ChatMentionNotifier;
  }) {
    this.notifyMentions = options.notifyMentions ?? null;
    this.chatDir = path.join(options.paseoHome, "chat");
    this.roomsDir = path.join(this.chatDir, "rooms");
    this.legacyFilePath = path.join(this.chatDir, "rooms.json");
    this.migratedMarkerPath = path.join(this.chatDir, ".migrated");
    this.logger = options.logger.child({ component: "chat-service" });
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async createRoom(input: CreateChatRoomInput): Promise<ChatRoomDetail> {
    await this.load();
    const name = input.name.trim();
    if (name.length === 0) {
      throw new ChatServiceError("invalid_chat_room_name", "Chat room name is required");
    }
    if (this.findRoomByName(name)) {
      throw new ChatServiceError(
        "chat_room_name_taken",
        `Chat room already exists with name: ${name}`,
      );
    }

    const now = new Date().toISOString();
    const room = ChatRoomSchema.parse({
      id: randomUUID(),
      name,
      purpose: trimToNull(input.purpose),
      createdAt: now,
      updatedAt: now,
    });
    this.rooms.set(room.id, room);
    await this.enqueuePersist(room.id);
    return this.toRoomDetail(room);
  }

  async listRooms(): Promise<ChatRoomDetail[]> {
    await this.load();
    return Array.from(this.rooms.values())
      .map((room) => this.toRoomDetail(room))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async inspectRoom(input: InspectChatRoomInput): Promise<InspectChatRoomResult> {
    await this.load();
    const room = this.resolveRoom(input.room);
    return {
      room: this.toRoomDetail(room),
    };
  }

  async deleteRoom(input: DeleteChatRoomInput): Promise<DeleteChatRoomResult> {
    await this.load();
    const room = this.resolveRoom(input.room);
    const detail = this.toRoomDetail(room);
    this.rooms.delete(room.id);
    this.messagesByRoomId.delete(room.id);
    await this.enqueuePersist(room.id);
    this.rejectWaiters(
      room.id,
      new ChatServiceError("chat_room_deleted", `Chat room deleted: ${room.name}`),
    );
    return { room: detail };
  }

  /**
   * The single way a message enters a room: validate, persist, then wake whoever
   * was mentioned. Fanout lives here rather than in each caller so a message
   * posted by an agent tool reaches the same people as one posted over the
   * WebSocket — previously only the latter woke anyone.
   */
  async post(input: PostMessageInput): Promise<ChatMessage> {
    const message = await this.dispatchMessage({
      room: input.room,
      authorAgentId: input.actor.id,
      body: input.body,
      replyToMessageId: input.replyToMessageId,
      actor: input.actor,
    });

    if (this.notifyMentions && message.mentionAgentIds.length > 0) {
      try {
        await this.notifyMentions({
          roomId: message.roomId,
          actor: input.actor,
          body: message.body,
          mentionAgentIds: message.mentionAgentIds,
        });
      } catch (error) {
        // The message is already in the room. Failing the post would tell the
        // author it never landed, which is worse than a missed notification.
        this.logger.error(
          { err: error, roomId: message.roomId },
          "Failed to notify mentioned agents",
        );
      }
    }

    return message;
  }

  /** @deprecated Prefer {@link post}, which also runs mention fanout. */
  async dispatchMessage(input: PostChatMessageInput & { actor?: ChatActor }): Promise<ChatMessage> {
    await this.load();
    const room = this.resolveRoom(input.room);
    const body = input.body.trim();
    if (body.length === 0) {
      throw new ChatServiceError("invalid_chat_message", "Chat message body is required");
    }
    const authorAgentId = input.authorAgentId.trim();
    if (authorAgentId.length === 0) {
      throw new ChatServiceError("invalid_chat_author", "Chat message author is required");
    }
    // A caller that predates the author model is an agent by definition: humans
    // could not post before there was a way to say so.
    const author: ChatAuthor = input.actor ?? { kind: "agent", id: authorAgentId };

    const messages = this.getRoomMessages(room.id);
    const replyToMessageId = trimToNull(input.replyToMessageId);
    if (replyToMessageId) {
      const replyTarget = messages.find((message) => message.id === replyToMessageId);
      if (!replyTarget) {
        throw new ChatServiceError(
          "chat_message_not_found",
          `Reply target not found: ${replyToMessageId}`,
        );
      }
    }

    const createdAt = new Date().toISOString();
    const message = ChatMessageSchema.parse({
      id: randomUUID(),
      roomId: room.id,
      authorAgentId,
      body,
      replyToMessageId,
      mentionAgentIds: parseMentionAgentIds(body),
      createdAt,
      author,
    });

    messages.push(message);
    this.messagesByRoomId.set(room.id, messages);
    this.rooms.set(
      room.id,
      ChatRoomSchema.parse({
        ...room,
        updatedAt: createdAt,
      }),
    );
    await this.enqueuePersist(room.id);
    this.notifyWaiters(room.id);
    return message;
  }

  async readMessages(input: ReadChatMessagesInput): Promise<ChatMessage[]> {
    await this.load();
    const room = this.resolveRoom(input.room);
    const messages = [...this.getRoomMessages(room.id)];
    const since = trimToNull(input.since);
    const authorAgentId = trimToNull(input.authorAgentId);
    const limit = this.normalizeLimit(input.limit);

    const filtered = messages.filter((message) => {
      if (since && message.createdAt < since) {
        return false;
      }
      if (authorAgentId && message.authorAgentId !== authorAgentId) {
        return false;
      }
      return true;
    });

    if (limit === 0 || filtered.length <= limit) {
      return filtered;
    }
    return filtered.slice(filtered.length - limit);
  }

  async listRoomPosterAgentIds(input: ListChatRoomPosterAgentIdsInput): Promise<string[]> {
    await this.load();
    const room = this.resolveRoom(input.room);
    const posters = new Set<string>();
    for (const message of this.getRoomMessages(room.id)) {
      // Humans post here too, and their id is a client id. Handing it to mention
      // fanout would have it look for an agent that does not exist.
      if (message.author?.kind === "human") {
        continue;
      }
      posters.add(message.authorAgentId);
    }
    return Array.from(posters);
  }

  async waitForMessages(input: WaitForChatMessagesInput): Promise<ChatMessage[]> {
    await this.load();
    const room = this.resolveRoom(input.room);
    const timeoutMs = Math.max(0, Math.floor(input.timeoutMs ?? 0));
    const afterMessageId = trimToNull(input.afterMessageId);

    if (afterMessageId) {
      const existing = this.selectMessagesAfter(room.id, afterMessageId);
      if (existing.length > 0) {
        return existing;
      }
      const knownMessage = this.getRoomMessages(room.id).some(
        (message) => message.id === afterMessageId,
      );
      if (!knownMessage) {
        throw new ChatServiceError(
          "chat_message_not_found",
          `Wait cursor not found: ${afterMessageId}`,
        );
      }
    }

    return new Promise<ChatMessage[]>((resolve, reject) => {
      const waiter: Waiter = {
        roomId: room.id,
        afterMessageId,
        resolve: (messages) => {
          if (waiter.timeout) {
            clearTimeout(waiter.timeout);
            waiter.timeout = null;
          }
          this.removeWaiter(waiter);
          resolve(messages);
        },
        reject: (error) => {
          if (waiter.timeout) {
            clearTimeout(waiter.timeout);
            waiter.timeout = null;
          }
          this.removeWaiter(waiter);
          reject(error);
        },
        timeout: null,
      };

      if (timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          waiter.resolve([]);
        }, timeoutMs);
      }

      const roomWaiters = this.waitersByRoomId.get(room.id) ?? new Set<Waiter>();
      roomWaiters.add(waiter);
      this.waitersByRoomId.set(room.id, roomWaiters);
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.rooms.clear();
    this.messagesByRoomId.clear();

    await this.migrateIfNeeded();
    await this.loadRoomFiles();

    this.loaded = true;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Moves a legacy single-file store to one file per room, once.
   *
   * Ordering is load-bearing: every room file is written first, then the legacy
   * file is renamed aside, then the marker lands. Because nothing writes the new
   * layout until the marker exists, any per-room file found before then can only
   * be this migration's own earlier attempt over the same data — so "already
   * there, skip it" is exact rather than a guess about which copy is newer.
   *
   * A missing legacy file with a `.bak` present means the rename already
   * happened, which by the same ordering means the room files are complete.
   */
  private async migrateIfNeeded(): Promise<void> {
    if (await this.fileExists(this.migratedMarkerPath)) {
      return;
    }

    await fs.mkdir(this.roomsDir, { recursive: true });
    const legacy = await this.readLegacyStore();
    if (legacy) {
      for (const room of legacy.rooms) {
        const roomPath = this.roomFilePath(room.id);
        if (await this.fileExists(roomPath)) {
          continue;
        }
        await writeJsonFileAtomic(roomPath, {
          room,
          messages: legacy.messagesByRoomId.get(room.id) ?? [],
        } satisfies ChatRoomFile);
      }
      await fs.rename(this.legacyFilePath, `${this.legacyFilePath}.bak`).catch((error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw error;
        }
      });
    }

    await writeJsonFileAtomic(this.migratedMarkerPath, {
      migratedAt: new Date().toISOString(),
    });
  }

  /** Returns null when there is nothing to migrate. */
  private async readLegacyStore(): Promise<{
    rooms: ChatRoom[];
    messagesByRoomId: Map<string, ChatMessage[]>;
  } | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.legacyFilePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.legacyFilePath },
          "Failed to read legacy chat store",
        );
      }
      return null;
    }

    const parsed = LegacyChatStorePayloadSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger.error(
        { issues: parsed.error.issues, filePath: this.legacyFilePath },
        "Legacy chat store is unreadable; leaving it in place",
      );
      return null;
    }

    // Messages are validated one by one: a single damaged entry should cost that
    // entry, not every conversation in the file. The original is never edited.
    const messagesByRoomId = new Map<string, ChatMessage[]>();
    for (const candidate of parsed.data.messages) {
      const message = ChatMessageSchema.safeParse(candidate);
      if (!message.success) {
        this.logger.warn(
          { issues: message.error.issues },
          "Skipping unreadable message while migrating chat store",
        );
        continue;
      }
      const bucket = messagesByRoomId.get(message.data.roomId) ?? [];
      bucket.push(message.data);
      messagesByRoomId.set(message.data.roomId, bucket);
    }
    return { rooms: parsed.data.rooms, messagesByRoomId };
  }

  private async loadRoomFiles(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.roomsDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error({ err: error, dir: this.roomsDir }, "Failed to list chat rooms");
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(this.roomsDir, entry);
      try {
        const parsed = ChatRoomFileSchema.safeParse(
          JSON.parse(await fs.readFile(filePath, "utf8")),
        );
        if (!parsed.success) {
          // One damaged room must not strand the others.
          this.logger.error(
            { issues: parsed.error.issues, filePath },
            "Skipping unreadable chat room file",
          );
          continue;
        }
        this.rooms.set(parsed.data.room.id, parsed.data.room);
        this.messagesByRoomId.set(parsed.data.room.id, parsed.data.messages);
      } catch (error) {
        this.logger.error({ err: error, filePath }, "Skipping unreadable chat room file");
      }
    }
  }

  private roomFilePath(roomId: string): string {
    return path.join(this.roomsDir, `${roomId}.json`);
  }

  /** Serialized per room: a busy room no longer rewrites every other room. */
  private async enqueuePersist(roomId: string): Promise<void> {
    const previous = this.persistQueues.get(roomId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.persistRoom(roomId));
    this.persistQueues.set(
      roomId,
      next.catch(() => undefined),
    );
    await next;
  }

  private async persistRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      await fs.rm(this.roomFilePath(roomId), { force: true });
      return;
    }
    await fs.mkdir(this.roomsDir, { recursive: true });
    await writeJsonFileAtomic(this.roomFilePath(roomId), {
      room,
      messages: this.messagesByRoomId.get(roomId) ?? [],
    } satisfies ChatRoomFile);
  }

  private findRoomByName(name: string): ChatRoom | null {
    const normalizedName = normalizeRoomName(name);
    for (const room of this.rooms.values()) {
      if (normalizeRoomName(room.name) === normalizedName) {
        return room;
      }
    }
    return null;
  }

  private resolveRoom(roomSelector: string): ChatRoom {
    const selector = roomSelector.trim();
    if (selector.length === 0) {
      throw new ChatServiceError("invalid_chat_room", "Chat room name or ID is required");
    }
    const byId = this.rooms.get(selector);
    if (byId) {
      return byId;
    }
    const byName = this.findRoomByName(selector);
    if (byName) {
      return byName;
    }
    throw new ChatServiceError("chat_room_not_found", `Chat room not found: ${selector}`);
  }

  private getRoomMessages(roomId: string): ChatMessage[] {
    return this.messagesByRoomId.get(roomId) ?? [];
  }

  private toRoomDetail(room: ChatRoom): ChatRoomDetail {
    const messages = this.getRoomMessages(room.id);
    return ChatRoomDetailSchema.parse({
      ...room,
      messageCount: messages.length,
      lastMessageAt: messages[messages.length - 1]?.createdAt ?? null,
    });
  }

  private normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return 20;
    }
    const normalized = Math.max(0, Math.floor(limit));
    return normalized;
  }

  private selectMessagesAfter(roomId: string, afterMessageId: string): ChatMessage[] {
    const messages = this.getRoomMessages(roomId);
    const index = messages.findIndex((message) => message.id === afterMessageId);
    if (index === -1) {
      return [];
    }
    return messages.slice(index + 1);
  }

  private notifyWaiters(roomId: string): void {
    const waiters = this.waitersByRoomId.get(roomId);
    if (!waiters || waiters.size === 0) {
      return;
    }

    for (const waiter of Array.from(waiters)) {
      const messages =
        waiter.afterMessageId === null
          ? this.getRoomMessages(roomId).slice(-1)
          : this.selectMessagesAfter(roomId, waiter.afterMessageId);
      if (messages.length === 0) {
        continue;
      }
      waiter.resolve(messages);
    }
  }

  private removeWaiter(waiter: Waiter): void {
    const waiters = this.waitersByRoomId.get(waiter.roomId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.waitersByRoomId.delete(waiter.roomId);
    }
  }

  private rejectWaiters(roomId: string, error: Error): void {
    const waiters = this.waitersByRoomId.get(roomId);
    if (!waiters) {
      return;
    }
    for (const waiter of Array.from(waiters)) {
      waiter.reject(error);
    }
  }
}
