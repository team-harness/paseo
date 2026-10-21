import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DocumentShareButton } from "@/document-share/button";
import { ReviewSummaryTrigger } from "./summary-trigger";
import { ReviewSelectionCommentTrigger } from "./selection-comment-trigger";
import { ReviewSelectionSurface } from "./selection-surface";
import { addWorkspaceReviewComment } from "./workspace-comments-store";
import {
  buildWorkspaceReviewKey,
  type ReviewTextSelection,
  type WorkspaceReviewCommentSource,
} from "./workspace-comments";

interface FilePanelReview {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  shareCwd: string;
  path: string;
  content: string | null;
  selection: ReviewTextSelection | null;
  setContent: (content: string | null) => void;
  setSelection: (selection: ReviewTextSelection | null) => void;
  onComment: (
    selection: ReviewTextSelection,
    body: string,
    source?: WorkspaceReviewCommentSource,
  ) => void;
}

const Context = createContext<FilePanelReview | null>(null);

/** Keeps workspace review identity outside the replaceable file panel. */
export function FilePanelReviewProvider({
  children,
  serverId,
  workspaceId,
  cwd,
  shareCwd = cwd,
  path,
}: {
  children: ReactNode;
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  shareCwd?: string;
  path: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReviewTextSelection | null>(null);
  const key = buildWorkspaceReviewKey({ serverId, workspaceId, cwd });
  const onComment = useCallback(
    (
      selected: ReviewTextSelection,
      body: string,
      source: WorkspaceReviewCommentSource = "preview",
    ) => {
      addWorkspaceReviewComment({ key, comment: { filePath: path, source, ...selected, body } });
    },
    [key, path],
  );
  const value = useMemo(
    () => ({
      serverId,
      workspaceId,
      cwd,
      shareCwd,
      path,
      content,
      selection,
      setContent,
      setSelection,
      onComment,
    }),
    [serverId, workspaceId, cwd, shareCwd, path, content, selection, onComment],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Panels publish the actual displayed draft, including unsaved source edits. */
export function useFilePanelReviewContent(content: string | null) {
  const context = useContext(Context);
  const setContent = context?.setContent;
  const setSelection = context?.setSelection;
  useEffect(() => {
    setContent?.(content);
  }, [content, setContent]);
  useEffect(
    () => () => {
      setContent?.(null);
      setSelection?.(null);
    },
    [setContent, setSelection],
  );
  return setSelection;
}

export function FilePanelReviewActions() {
  const review = useContext(Context);
  const onSourceComment = useCallback(
    (selection: ReviewTextSelection, body: string) => review?.onComment(selection, body, "source"),
    [review],
  );
  if (!review) return null;
  return (
    <>
      <ReviewSelectionCommentTrigger
        filePath={review.path}
        selection={review.selection}
        onComment={onSourceComment}
      />
      <ReviewSummaryTrigger
        serverId={review.serverId}
        workspaceId={review.workspaceId}
        cwd={review.cwd}
      />
      {review.content !== null ? (
        <DocumentShareButton
          key={`${review.serverId}:${review.cwd}:${review.path}`}
          serverId={review.serverId}
          cwd={review.shareCwd}
          path={review.path}
          content={review.content}
        />
      ) : null}
    </>
  );
}

export function FilePanelReviewSurface({
  children,
  source = "preview",
}: {
  children: ReactNode;
  source?: WorkspaceReviewCommentSource;
}) {
  const review = useContext(Context);
  const onComment = useCallback(
    (selection: ReviewTextSelection, body: string) => review?.onComment(selection, body, source),
    [review, source],
  );
  if (!review) return children;
  return (
    <ReviewSelectionSurface filePath={review.path} onComment={onComment}>
      {children}
    </ReviewSelectionSurface>
  );
}
