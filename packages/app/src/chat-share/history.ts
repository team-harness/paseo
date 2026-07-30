import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type {
  DaemonClient,
  FetchAgentTimelinePayload,
  ProviderSubagentTimelinePayload,
} from "@getpaseo/client/internal/daemon-client";
import { fetchAgentTimelineOnce } from "@/timeline/fetch-agent-timeline-once";
import { processTimelineResponse, type TimelineCursor } from "@/timeline/session-stream-reducers";
import { planTimelineOlderFetch, planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import { applyStreamEvent, type StreamItem, type TodoEntry } from "@/types/stream";

// Canonical schema is owned by https://github.com/team-harness/threadshare.
export const THREADSHARE_HISTORY_FORMAT = "threadshare-history@v1" as const;
export const THREADSHARE_HISTORY_SCHEMA_VERSION = 1 as const;

export type SharedChatEntry =
  | {
      id: string;
      createdAt: string;
      kind: "message";
      role: "user" | "assistant";
      markdown: string;
    }
  | {
      id: string;
      createdAt: string;
      kind: "tool";
      name: string;
      status: "running" | "completed" | "failed" | "canceled";
      input?: unknown;
      output?: unknown;
      error?: unknown;
    }
  | { id: string; createdAt: string; kind: "thought"; text: string; status: "loading" | "ready" }
  | { id: string; createdAt: string; kind: "todo"; items: TodoEntry[] }
  | {
      id: string;
      createdAt: string;
      kind: "activity";
      message: string;
      level: "system" | "info" | "success" | "error";
    }
  | {
      id: string;
      createdAt: string;
      kind: "compaction";
      status: "loading" | "completed";
      trigger?: "auto" | "manual";
      preTokens?: number;
    };

export interface PaseoChatHistory {
  format: typeof THREADSHARE_HISTORY_FORMAT;
  schemaVersion: typeof THREADSHARE_HISTORY_SCHEMA_VERSION;
  exportedAt: string;
  conversation: {
    id: string;
    title: string;
    source: "paseo";
    provider?: string;
    model?: string;
  };
  entries: SharedChatEntry[];
}

export interface ExportChatHistoryInput {
  agentId: string;
  title: string;
  provider?: AgentProvider;
  model?: string | null;
  items: readonly StreamItem[];
  exportedAt?: Date;
}

export interface LoadCompleteChatHistoryInput {
  client: Pick<DaemonClient, "fetchAgentTimeline">;
  agentId: string;
  localTail: readonly StreamItem[];
  liveHead: readonly StreamItem[];
}

export interface LoadCompleteProviderSubagentChatHistoryInput {
  client: Pick<DaemonClient, "fetchProviderSubagentTimeline">;
  parentAgentId: string;
  subagentId: string;
}

interface TimelineSnapshot {
  tail: StreamItem[];
  head: StreamItem[];
  cursor: TimelineCursor | undefined;
}

function toJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        toJsonValue(child),
      ]),
    );
  }
  return value === undefined ? undefined : String(value);
}

function iso(value: Date): string {
  return value.toISOString();
}

function cursorForTimelinePage(page: FetchAgentTimelinePayload): TimelineCursor | undefined {
  if (!page.startCursor || !page.endCursor) {
    return undefined;
  }

  return {
    epoch: page.epoch,
    startSeq: page.startCursor.seq,
    endSeq: page.endCursor.seq,
  };
}

function applyTimelinePage(input: {
  page: FetchAgentTimelinePayload;
  snapshot: TimelineSnapshot;
  isInitial: boolean;
}): TimelineSnapshot {
  const result = processTimelineResponse({
    payload: input.page,
    currentTail: input.snapshot.tail,
    currentHead: input.snapshot.head,
    currentCursor: input.snapshot.cursor,
    isInitializing: input.isInitial,
    hasActiveInitDeferred: input.isInitial,
    initRequestDirection: "tail",
  });

  return {
    tail: result.tail,
    head: result.head,
    cursor: result.cursor ?? undefined,
  };
}

export async function loadCompleteChatHistory({
  client,
  agentId,
  localTail,
  liveHead,
}: LoadCompleteChatHistoryInput): Promise<StreamItem[]> {
  let page = await fetchAgentTimelineOnce(client, agentId, planTimelineTailFetch());
  let snapshot = applyTimelinePage({
    page,
    snapshot: {
      tail: [...localTail],
      head: [...liveHead],
      // The captured live head must survive its canonical counterpart from the tail page.
      cursor: cursorForTimelinePage(page),
    },
    isInitial: true,
  });

  while (page.hasOlder) {
    if (!snapshot.cursor) {
      throw new Error("Unable to load the complete conversation history");
    }

    const nextPage = await fetchAgentTimelineOnce(
      client,
      agentId,
      planTimelineOlderFetch({ epoch: snapshot.cursor.epoch, seq: snapshot.cursor.startSeq }),
    );
    if (nextPage.epoch !== page.epoch || nextPage.reset) {
      throw new Error("Conversation history changed while it was being shared");
    }

    snapshot = applyTimelinePage({
      page: nextPage,
      snapshot,
      isInitial: false,
    });
    page = nextPage;
  }

  return [...snapshot.tail, ...snapshot.head];
}

export async function loadCompleteProviderSubagentChatHistory({
  client,
  parentAgentId,
  subagentId,
}: LoadCompleteProviderSubagentChatHistoryInput): Promise<StreamItem[]> {
  let page = await client.fetchProviderSubagentTimeline(parentAgentId, subagentId, {
    direction: "tail",
    limit: 40,
  });
  const epoch = page.epoch;
  const rows = new Map<number, ProviderSubagentTimelinePayload["rows"][number]>();

  while (true) {
    if (page.epoch !== epoch || page.reset || page.staleCursor || page.gap) {
      throw new Error("Conversation history changed while it was being shared");
    }
    for (const row of page.rows) {
      rows.set(row.seq, row);
    }
    if (!page.hasOlder) {
      break;
    }

    const firstSeq = Math.min(...rows.keys());
    if (!Number.isFinite(firstSeq)) {
      throw new Error("Unable to load the complete conversation history");
    }
    page = await client.fetchProviderSubagentTimeline(parentAgentId, subagentId, {
      direction: "before",
      cursor: { epoch, seq: firstSeq },
      limit: 40,
    });
  }

  let timeline = { tail: [] as StreamItem[], head: [] as StreamItem[] };
  for (const row of [...rows.values()].sort((left, right) => left.seq - right.seq)) {
    if (!page.provider) {
      throw new Error("Unable to load the complete conversation history");
    }
    timeline = applyStreamEvent({
      tail: timeline.tail,
      head: timeline.head,
      event: { type: "timeline", provider: page.provider, item: row.item },
      timestamp: new Date(row.timestamp),
    });
  }
  return [...timeline.tail, ...timeline.head];
}

export function selectChatHistoryFromUserMessage(
  items: readonly StreamItem[],
  userMessageId: string,
): StreamItem[] | null {
  const startIndex = items.findIndex(
    (item) => item.kind === "user_message" && item.id === userMessageId,
  );
  return startIndex === -1 ? null : items.slice(startIndex);
}

function normalizeToolStatus(
  status: "executing" | "running" | "completed" | "failed" | "canceled",
): "running" | "completed" | "failed" | "canceled" {
  return status === "executing" ? "running" : status;
}

function exportItem(item: StreamItem): SharedChatEntry {
  const base = { id: item.id, createdAt: iso(item.timestamp) };

  switch (item.kind) {
    case "user_message":
      return { ...base, kind: "message", role: "user", markdown: item.text };
    case "assistant_message":
      return { ...base, kind: "message", role: "assistant", markdown: item.text };
    case "thought":
      return { ...base, kind: "thought", text: item.text, status: item.status };
    case "todo_list":
      return { ...base, kind: "todo", items: item.items.map((todo) => ({ ...todo })) };
    case "activity_log":
      return { ...base, kind: "activity", message: item.message, level: item.activityType };
    case "compaction":
      return {
        ...base,
        kind: "compaction",
        status: item.status,
        ...(item.trigger ? { trigger: item.trigger } : {}),
        ...(item.preTokens === undefined ? {} : { preTokens: item.preTokens }),
      };
    case "tool_call": {
      if (item.payload.source === "agent") {
        const { data } = item.payload;
        return {
          ...base,
          kind: "tool",
          name: data.name,
          status: normalizeToolStatus(data.status),
          input: toJsonValue(data.detail),
          ...(data.error === undefined ? {} : { error: toJsonValue(data.error) }),
        };
      }
      const { data } = item.payload;
      return {
        ...base,
        kind: "tool",
        name: data.toolName,
        status: normalizeToolStatus(data.status),
        input: toJsonValue(data.arguments),
        ...(data.result === undefined ? {} : { output: toJsonValue(data.result) }),
        ...(data.error === undefined ? {} : { error: toJsonValue(data.error) }),
      };
    }
  }
}

export function exportChatHistory(input: ExportChatHistoryInput): PaseoChatHistory {
  return {
    format: THREADSHARE_HISTORY_FORMAT,
    schemaVersion: THREADSHARE_HISTORY_SCHEMA_VERSION,
    exportedAt: iso(input.exportedAt ?? new Date()),
    conversation: {
      id: input.agentId,
      title: input.title.trim() || "Paseo conversation",
      source: "paseo",
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
    entries: input.items.map(exportItem),
  };
}
