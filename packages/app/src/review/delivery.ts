import { submitAgentInput, type AgentInputSubmitResult } from "@/composer/submit";
import type { SendBehavior } from "@/hooks/use-settings";
import type { WorkspaceReviewSummaryEntry } from "./workspace-comments";

export interface SubmitReviewMessageViaComposerInput {
  message: string;
  sendBehavior: SendBehavior;
  isAgentRunning: boolean;
  queueMessage: (message: string) => void;
  submitMessage: (message: string) => Promise<void>;
  failedToSendMessage?: string;
}

export async function submitReviewMessageViaComposer(
  input: SubmitReviewMessageViaComposerInput,
): Promise<Extract<AgentInputSubmitResult, "queued" | "submitted">> {
  let submissionError: unknown;
  const result = await submitAgentInput({
    message: input.message,
    attachments: [],
    forceSend: input.sendBehavior === "interrupt",
    isAgentRunning: input.isAgentRunning,
    canSubmit: true,
    queueMessage: ({ message }) => input.queueMessage(message),
    submitMessage: ({ message }) => input.submitMessage(message),
    clearDraft: () => undefined,
    setUserInput: () => undefined,
    setAttachments: () => undefined,
    setSendError: () => undefined,
    setIsProcessing: () => undefined,
    onSubmitError: (error) => {
      submissionError = error;
    },
    failedToSendMessage: input.failedToSendMessage,
  });

  if (result === "queued" || result === "submitted") {
    return result;
  }
  if (submissionError instanceof Error) {
    throw submissionError;
  }
  throw new Error(input.failedToSendMessage ?? "Review message could not be submitted");
}

export interface ReviewDeliverySession {
  agentId: string;
  deliveredRevisions: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDeliveryState {
  sessionsByWorkspace: Record<string, ReviewDeliverySession>;
  operationsByWorkspace: Record<string, { operationId: string; agentId: string | null }>;
}

export function beginReviewDeliveryInState(
  state: ReviewDeliveryState,
  input: { workspaceKey: string; operationId: string; agentId: string | null },
): { state: ReviewDeliveryState; started: boolean } {
  const session = state.sessionsByWorkspace[input.workspaceKey];
  if (
    state.operationsByWorkspace[input.workspaceKey] ||
    (session && session.agentId !== input.agentId)
  ) {
    return { state, started: false };
  }
  return {
    state: {
      ...state,
      operationsByWorkspace: {
        ...state.operationsByWorkspace,
        [input.workspaceKey]: { operationId: input.operationId, agentId: input.agentId },
      },
    },
    started: true,
  };
}

export function releaseReviewDeliveryInState(
  state: ReviewDeliveryState,
  input: { workspaceKey: string; operationId: string },
): ReviewDeliveryState {
  if (state.operationsByWorkspace[input.workspaceKey]?.operationId !== input.operationId) {
    return state;
  }
  const { [input.workspaceKey]: _removed, ...operationsByWorkspace } = state.operationsByWorkspace;
  return { ...state, operationsByWorkspace };
}

export function buildReviewEntryIdentity(entry: WorkspaceReviewSummaryEntry): string {
  return [entry.kind, entry.ownerKey, entry.comment.id].join(":");
}

export function collectPendingReviewEntries(
  entries: readonly WorkspaceReviewSummaryEntry[],
  deliveredRevisions: Readonly<Record<string, string>>,
): WorkspaceReviewSummaryEntry[] {
  return entries.filter(
    (entry) => deliveredRevisions[buildReviewEntryIdentity(entry)] !== entry.comment.updatedAt,
  );
}

export function recordReviewDeliveryInState(
  state: ReviewDeliveryState,
  input: {
    workspaceKey: string;
    agentId: string;
    entries: readonly WorkspaceReviewSummaryEntry[];
    deliveredAt: string;
  },
): ReviewDeliveryState {
  const current = state.sessionsByWorkspace[input.workspaceKey];
  if (current && current.agentId !== input.agentId) {
    return state;
  }
  const deliveredRevisions = { ...current?.deliveredRevisions };
  for (const entry of input.entries) {
    deliveredRevisions[buildReviewEntryIdentity(entry)] = entry.comment.updatedAt;
  }
  return {
    ...state,
    sessionsByWorkspace: {
      ...state.sessionsByWorkspace,
      [input.workspaceKey]: {
        agentId: input.agentId,
        deliveredRevisions,
        createdAt: current?.createdAt ?? input.deliveredAt,
        updatedAt: input.deliveredAt,
      },
    },
  };
}

export function finishReviewDeliveryInState(
  state: ReviewDeliveryState,
  input: {
    workspaceKey: string;
    operationId: string;
    agentId: string;
    entries: readonly WorkspaceReviewSummaryEntry[];
    deliveredAt: string;
  },
): ReviewDeliveryState {
  if (state.operationsByWorkspace[input.workspaceKey]?.operationId !== input.operationId) {
    return state;
  }
  return releaseReviewDeliveryInState(recordReviewDeliveryInState(state, input), input);
}

export function normalizeReviewDeliveryState(state: unknown): ReviewDeliveryState {
  if (!state || typeof state !== "object") {
    return { sessionsByWorkspace: {}, operationsByWorkspace: {} };
  }
  const sessions = (state as { sessionsByWorkspace?: unknown }).sessionsByWorkspace;
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
    return { sessionsByWorkspace: {}, operationsByWorkspace: {} };
  }
  const sessionsByWorkspace: Record<string, ReviewDeliverySession> = {};
  for (const [workspaceKey, value] of Object.entries(sessions)) {
    if (!isReviewDeliverySession(value)) {
      continue;
    }
    sessionsByWorkspace[workspaceKey] = value;
  }
  return { sessionsByWorkspace, operationsByWorkspace: {} };
}

function isReviewDeliverySession(value: unknown): value is ReviewDeliverySession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Record<string, unknown>;
  return (
    typeof session.agentId === "string" &&
    session.agentId.length > 0 &&
    isStringRecord(session.deliveredRevisions) &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string")
  );
}
