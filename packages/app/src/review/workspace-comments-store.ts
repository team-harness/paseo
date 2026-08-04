import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { generateMessageId } from "@/types/stream";
import type { ReviewDraftComment } from "./state";
import { buildReviewDraftWorkspacePrefix, useReviewDraftStore } from "./store";
import {
  addWorkspaceReviewCommentToState,
  buildWorkspaceReviewKey,
  collectWorkspaceReviewSummaryEntries,
  deleteWorkspaceReviewCommentFromState,
  normalizeWorkspaceReviewCommentsState,
  serializeWorkspaceReviewCommentsState,
  type BuildWorkspaceReviewKeyInput,
  type WorkspaceReviewComment,
  type WorkspaceReviewCommentsState,
  type WorkspaceReviewSummaryEntry,
} from "./workspace-comments";

const STORE_VERSION = 1;
const EMPTY_WORKSPACE_REVIEW_COMMENTS: WorkspaceReviewComment[] = [];

export type WorkspaceReviewCommentInput = Omit<
  WorkspaceReviewComment,
  "id" | "createdAt" | "updatedAt"
> &
  Partial<Pick<WorkspaceReviewComment, "id" | "createdAt" | "updatedAt">>;

interface WorkspaceReviewCommentsActions {
  addComment(input: { key: string; comment: WorkspaceReviewCommentInput }): WorkspaceReviewComment;
  deleteComment(input: { key: string; id: string }): void;
}

type WorkspaceReviewCommentsStore = WorkspaceReviewCommentsState & WorkspaceReviewCommentsActions;

function createWorkspaceReviewComment(input: WorkspaceReviewCommentInput): WorkspaceReviewComment {
  const now = new Date().toISOString();
  return {
    id: input.id ?? generateMessageId(),
    filePath: input.filePath,
    source: input.source,
    quote: input.quote.trim(),
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    body: input.body.trim(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };
}

export const useWorkspaceReviewCommentsStore = create<WorkspaceReviewCommentsStore>()(
  persist(
    (set) => ({
      commentsByWorkspace: {},
      addComment: ({ key, comment }) => {
        const nextComment = createWorkspaceReviewComment(comment);
        set((state) => addWorkspaceReviewCommentToState(state, { key, comment: nextComment }));
        return nextComment;
      },
      deleteComment: (input) => {
        set((state) => deleteWorkspaceReviewCommentFromState(state, input));
      },
    }),
    {
      name: "@paseo:workspace-review-comments",
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => serializeWorkspaceReviewCommentsState(state),
      migrate: async (state) => normalizeWorkspaceReviewCommentsState(state),
    },
  ),
);

export function addWorkspaceReviewComment(input: {
  key: string;
  comment: WorkspaceReviewCommentInput;
}): WorkspaceReviewComment {
  return useWorkspaceReviewCommentsStore.getState().addComment(input);
}

export function deleteWorkspaceReviewComments(
  inputs: readonly { key: string; id: string }[],
): void {
  if (inputs.length === 0) {
    return;
  }
  useWorkspaceReviewCommentsStore.setState((state) => {
    const nextState = inputs.reduce<WorkspaceReviewCommentsState>(
      (currentState, input) => deleteWorkspaceReviewCommentFromState(currentState, input),
      state,
    );
    return { commentsByWorkspace: nextState.commentsByWorkspace };
  });
}

export function useWorkspaceReviewComments(key: string): WorkspaceReviewComment[] {
  return useWorkspaceReviewCommentsStore(
    (state) => state.commentsByWorkspace[key] ?? EMPTY_WORKSPACE_REVIEW_COMMENTS,
  );
}

export type { WorkspaceReviewSummaryEntry } from "./workspace-comments";

export function useWorkspaceReviewSummary(input: BuildWorkspaceReviewKeyInput): {
  workspaceReviewKey: string;
  selectionComments: readonly WorkspaceReviewComment[];
  diffComments: readonly ReviewDraftComment[];
  entries: readonly WorkspaceReviewSummaryEntry[];
} {
  const workspaceReviewKey = useMemo(() => buildWorkspaceReviewKey(input), [input]);
  const diffDraftPrefix = useMemo(() => buildReviewDraftWorkspacePrefix(input), [input]);
  const selectionComments = useWorkspaceReviewComments(workspaceReviewKey);
  const diffDrafts = useReviewDraftStore((state) => state.drafts);

  return useMemo(() => {
    const entries = collectWorkspaceReviewSummaryEntries({
      workspaceReviewKey,
      diffDraftPrefix,
      selectionComments,
      diffDrafts,
    });
    return {
      workspaceReviewKey,
      selectionComments,
      diffComments: entries
        .filter(
          (entry): entry is Extract<WorkspaceReviewSummaryEntry, { kind: "diff" }> =>
            entry.kind === "diff",
        )
        .map((entry) => entry.comment),
      entries,
    };
  }, [diffDraftPrefix, diffDrafts, selectionComments, workspaceReviewKey]);
}
