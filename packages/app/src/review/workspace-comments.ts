import type { ReviewDraftComment } from "./state";

export type WorkspaceReviewCommentSource = "preview" | "source";

export interface ReviewTextSelection {
  quote: string;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface WorkspaceReviewComment {
  id: string;
  filePath: string;
  source: WorkspaceReviewCommentSource;
  quote: string;
  lineStart: number | null;
  lineEnd: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceReviewCommentsState {
  commentsByWorkspace: Record<string, WorkspaceReviewComment[]>;
}

export interface BuildWorkspaceReviewKeyInput {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

export function buildWorkspaceReviewKey(input: BuildWorkspaceReviewKeyInput): string {
  const workspaceId = input.workspaceId?.trim();
  const workspacePart = workspaceId
    ? `workspace=${encodeKeyPart(workspaceId)}`
    : `cwd=${encodeKeyPart(normalizeCwd(input.cwd))}`;
  return ["workspace-review", `server=${encodeKeyPart(input.serverId)}`, workspacePart].join(":");
}

export function trimReviewTextSelection(input: {
  selectedText: string;
  from: number;
}): { quote: string; from: number; to: number } | null {
  const quote = input.selectedText.trim();
  if (!quote) {
    return null;
  }
  const leadingWhitespace = input.selectedText.length - input.selectedText.trimStart().length;
  const trailingWhitespace = input.selectedText.length - input.selectedText.trimEnd().length;
  return {
    quote,
    from: input.from + leadingWhitespace,
    to: input.from + input.selectedText.length - trailingWhitespace,
  };
}

export function addWorkspaceReviewCommentToState(
  state: WorkspaceReviewCommentsState,
  input: { key: string; comment: WorkspaceReviewComment },
): WorkspaceReviewCommentsState {
  return {
    commentsByWorkspace: {
      ...state.commentsByWorkspace,
      [input.key]: [...(state.commentsByWorkspace[input.key] ?? []), input.comment],
    },
  };
}

export function deleteWorkspaceReviewCommentFromState(
  state: WorkspaceReviewCommentsState,
  input: { key: string; id: string },
): WorkspaceReviewCommentsState {
  const comments = state.commentsByWorkspace[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    commentsByWorkspace: {
      ...state.commentsByWorkspace,
      [input.key]: comments.filter((comment) => comment.id !== input.id),
    },
  };
}

export function serializeWorkspaceReviewCommentsState(
  state: WorkspaceReviewCommentsState,
): WorkspaceReviewCommentsState {
  return { commentsByWorkspace: state.commentsByWorkspace };
}

export function normalizeWorkspaceReviewCommentsState(
  state: unknown,
): WorkspaceReviewCommentsState {
  if (!state || typeof state !== "object") {
    return { commentsByWorkspace: {} };
  }
  const commentsByWorkspace = (state as { commentsByWorkspace?: unknown }).commentsByWorkspace;
  if (
    !commentsByWorkspace ||
    typeof commentsByWorkspace !== "object" ||
    Array.isArray(commentsByWorkspace)
  ) {
    return { commentsByWorkspace: {} };
  }

  const normalized: Record<string, WorkspaceReviewComment[]> = {};
  for (const [key, value] of Object.entries(commentsByWorkspace)) {
    if (!Array.isArray(value)) {
      continue;
    }
    normalized[key] = value.filter(isWorkspaceReviewComment);
  }
  return { commentsByWorkspace: normalized };
}

export function isWorkspaceReviewComment(value: unknown): value is WorkspaceReviewComment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.filePath === "string" &&
    (record.source === "preview" || record.source === "source") &&
    typeof record.quote === "string" &&
    isOptionalLineNumber(record.lineStart) &&
    isOptionalLineNumber(record.lineEnd) &&
    typeof record.body === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

function isOptionalLineNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

export type WorkspaceReviewSummaryEntry =
  | { ownerKey: string; kind: "selection"; comment: WorkspaceReviewComment }
  | { ownerKey: string; kind: "diff"; comment: ReviewDraftComment };

export function collectWorkspaceReviewSummaryEntries(input: {
  workspaceReviewKey: string;
  diffDraftPrefix: string;
  selectionComments: readonly WorkspaceReviewComment[];
  diffDrafts: Readonly<Record<string, readonly ReviewDraftComment[]>>;
}): WorkspaceReviewSummaryEntry[] {
  const diffEntries = Object.entries(input.diffDrafts)
    .filter(([key]) => key.startsWith(input.diffDraftPrefix))
    .flatMap(([ownerKey, comments]) =>
      comments.map((comment) => ({ ownerKey, kind: "diff" as const, comment })),
    );
  const selectionEntries = input.selectionComments.map((comment) => ({
    ownerKey: input.workspaceReviewKey,
    kind: "selection" as const,
    comment,
  }));
  return [...selectionEntries, ...diffEntries].toSorted((left, right) =>
    left.comment.createdAt.localeCompare(right.comment.createdAt),
  );
}

type SummaryEntry =
  | { kind: "selection"; comment: WorkspaceReviewComment }
  | { kind: "diff"; comment: ReviewDraftComment };

export function formatWorkspaceReviewSummary(input: {
  selectionComments: readonly WorkspaceReviewComment[];
  diffComments: readonly ReviewDraftComment[];
}): string {
  const entries: SummaryEntry[] = [
    ...input.selectionComments.map((comment) => ({ kind: "selection" as const, comment })),
    ...input.diffComments.map((comment) => ({ kind: "diff" as const, comment })),
  ].toSorted((left, right) => left.comment.createdAt.localeCompare(right.comment.createdAt));
  if (entries.length === 0) {
    return "";
  }

  const byFile = new Map<string, SummaryEntry[]>();
  for (const entry of entries) {
    byFile.set(entry.comment.filePath, [...(byFile.get(entry.comment.filePath) ?? []), entry]);
  }

  const sections = Array.from(byFile, ([filePath, fileEntries]) => {
    const comments = fileEntries.map(formatSummaryEntry).join("\n\n");
    return `## ${filePath}\n${comments}`;
  });
  return ["Review comments", "", sections.join("\n\n")].join("\n");
}

function formatSummaryEntry(entry: SummaryEntry): string {
  if (entry.kind === "diff") {
    return `Line ${entry.comment.lineNumber} (${entry.comment.side})\n${entry.comment.body.trim()}`;
  }

  const location = formatSelectionLocation(entry.comment);
  const quote = entry.comment.quote
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `${location}\n${quote}\n\n${entry.comment.body.trim()}`;
}

function formatSelectionLocation(comment: WorkspaceReviewComment): string {
  if (comment.lineStart === null) {
    return "Selected text";
  }
  if (comment.lineEnd === null || comment.lineEnd === comment.lineStart) {
    return `Line ${comment.lineStart}`;
  }
  return `Lines ${comment.lineStart}-${comment.lineEnd}`;
}
