import type { PaseoChatHistory, SharedChatEntry } from "./history";

export const CHAT_SHARE_MAX_BYTES = 5 * 1024 * 1024;

export class ChatShareTooLargeError extends Error {
  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Shared conversation is ${sizeBytes} bytes after tool result compression`);
    this.name = "ChatShareTooLargeError";
  }
}

export class ChatShareUploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChatShareUploadError";
  }
}

interface CreateChatShareResponse {
  id: string;
}

interface PreparedChatShareUpload {
  body: string;
  sizeBytes: number;
}

type SharedToolEntry = Extract<SharedChatEntry, { kind: "tool" }>;

const PLAIN_TEXT_REQUEST_TOOL_NAMES = new Set(["request_user_input", "switch_mode", "terminal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function compactWorktreeCommands(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((command) => {
    if (!isRecord(command)) return command;
    return {
      index: command.index,
      command: command.command,
      cwd: command.cwd,
    };
  });
}

function compactKnownToolInput(input: Record<string, unknown> & { type: string }): unknown {
  switch (input.type) {
    case "unknown":
      return input.input;
    case "worktree_setup":
      return {
        type: input.type,
        worktreePath: input.worktreePath,
        branchName: input.branchName,
        commands: compactWorktreeCommands(input.commands),
      };
    case "shell":
      return { type: input.type, command: input.command, cwd: input.cwd };
    case "read":
      return {
        type: input.type,
        filePath: input.filePath,
        offset: input.offset,
        limit: input.limit,
      };
    case "edit":
      return {
        type: input.type,
        filePath: input.filePath,
        oldString: input.oldString,
        newString: input.newString,
        unifiedDiff: input.unifiedDiff,
      };
    case "write":
      return { type: input.type, filePath: input.filePath, content: input.content };
    case "search":
      return {
        type: input.type,
        query: input.query,
        toolName: input.toolName,
        mode: input.mode,
      };
    case "fetch":
      return { type: input.type, url: input.url, prompt: input.prompt };
    case "sub_agent":
      return {
        type: input.type,
        subAgentType: input.subAgentType,
        description: input.description,
        childSessionId: input.childSessionId,
      };
    default:
      return null;
  }
}

function compactToolInput(toolName: string, firstInput: unknown, latestInput: unknown): unknown {
  const firstDetail =
    isRecord(firstInput) && typeof firstInput.type === "string" ? firstInput : null;
  const latestDetail =
    isRecord(latestInput) && typeof latestInput.type === "string" ? latestInput : null;
  const input = latestDetail ?? firstDetail ?? firstInput ?? latestInput;
  if (!isRecord(input) || typeof input.type !== "string") return input;

  if (input.type === "plain_text") {
    const requestDetail = firstDetail?.type === "plain_text" ? firstDetail : input;
    return {
      type: requestDetail.type,
      label: requestDetail.label,
      ...(PLAIN_TEXT_REQUEST_TOOL_NAMES.has(toolName.toLowerCase())
        ? { text: requestDetail.text }
        : {}),
      icon: requestDetail.icon,
    };
  }
  if (input.type === "plan") return undefined;

  const knownInput = compactKnownToolInput(input as Record<string, unknown> & { type: string });
  if (knownInput !== null) return knownInput;
  return latestInput ?? firstInput;
}

function compactToolEntry(first: SharedToolEntry, latest: SharedToolEntry): SharedToolEntry {
  const input = compactToolInput(first.name, first.input, latest.input);
  return {
    id: first.id,
    createdAt: first.createdAt,
    kind: "tool",
    name: first.name,
    status: latest.status,
    ...(input === undefined ? {} : { input }),
  };
}

function compactToolEntries(entries: SharedChatEntry[]): SharedChatEntry[] {
  const latestById = new Map<string, SharedToolEntry>();
  for (const entry of entries) {
    if (entry.kind === "tool") latestById.set(entry.id, entry);
  }

  const emittedToolIds = new Set<string>();
  const compacted: SharedChatEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "tool") {
      compacted.push(entry);
      continue;
    }
    if (emittedToolIds.has(entry.id)) continue;
    emittedToolIds.add(entry.id);
    compacted.push(compactToolEntry(entry, latestById.get(entry.id) ?? entry));
  }
  return compacted;
}

function prepareChatShareUpload(history: PaseoChatHistory): PreparedChatShareUpload {
  const fullBody = JSON.stringify(history);
  const fullSizeBytes = utf8ByteLength(fullBody);
  if (fullSizeBytes <= CHAT_SHARE_MAX_BYTES) {
    return { body: fullBody, sizeBytes: fullSizeBytes };
  }

  const compactedHistory: PaseoChatHistory = {
    ...history,
    entries: compactToolEntries(history.entries),
  };
  const body = JSON.stringify(compactedHistory);
  const sizeBytes = utf8ByteLength(body);
  if (sizeBytes > CHAT_SHARE_MAX_BYTES) {
    throw new ChatShareTooLargeError(sizeBytes, CHAT_SHARE_MAX_BYTES);
  }
  return { body, sizeBytes };
}

async function readUploadError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // The service may return a non-JSON infrastructure error page.
  }
  return `Unable to upload the shared conversation (HTTP ${response.status})`;
}

function createChatShareUrl(baseUrl: string): URL {
  const shareUrl = new URL("/api/v1/shares", baseUrl);
  if (shareUrl.protocol !== "https:" && shareUrl.protocol !== "http:") {
    throw new Error("Chat sharing requires an HTTP or HTTPS service URL");
  }
  return shareUrl;
}

export async function shareChatHistory(input: {
  baseUrl: string;
  history: PaseoChatHistory;
}): Promise<string> {
  const shareUrl = createChatShareUrl(input.baseUrl);
  const upload = prepareChatShareUpload(input.history);
  const response = await fetch(shareUrl.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: upload.body,
  });
  if (!response.ok) {
    throw new ChatShareUploadError(response.status, await readUploadError(response));
  }

  const payload = (await response.json()) as CreateChatShareResponse;
  if (!payload.id || typeof payload.id !== "string") {
    throw new Error("The chat share service returned an invalid response");
  }

  const viewerUrl = new URL("/", shareUrl);
  viewerUrl.searchParams.set("id", payload.id);
  return viewerUrl.toString();
}
