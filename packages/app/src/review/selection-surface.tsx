import { useCallback, useState, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { NativeTextSelectionActionSurface } from "@/native-text-selection/action-surface";
import { canUseNativeTextSelection } from "@/native-text-selection/native-module";
import { ReviewCommentComposerSheet } from "./comment-composer-sheet";
import type { ReviewTextSelection } from "./workspace-comments";

export interface ReviewSelectionSurfaceProps {
  children: ReactNode;
  filePath: string;
  onComment: (selection: ReviewTextSelection, body: string) => void;
}

export function ReviewSelectionSurface({
  children,
  filePath,
  onComment,
}: ReviewSelectionSurfaceProps) {
  const { t } = useTranslation();
  const [editingSelection, setEditingSelection] = useState<ReviewTextSelection | null>(null);
  const handleOpenComment = useCallback((quote: string) => {
    setEditingSelection({ quote, lineStart: null, lineEnd: null });
  }, []);
  const handleCloseComment = useCallback(() => setEditingSelection(null), []);
  const handleSaveComment = useCallback(
    (body: string) => {
      if (!editingSelection) return;
      onComment(editingSelection, body);
      setEditingSelection(null);
    },
    [editingSelection, onComment],
  );

  if (!canUseNativeTextSelection()) {
    return children;
  }

  return (
    <>
      <NativeTextSelectionActionSurface
        actionIcon={MessageSquarePlus}
        actionLabel={t("review.comment.add")}
        actionText={t("review.comment.save")}
        actionTestID="review-selection-comment"
        onAction={handleOpenComment}
      >
        {children}
      </NativeTextSelectionActionSurface>
      <ReviewCommentComposerSheet
        visible={editingSelection !== null}
        filePath={filePath}
        selection={editingSelection}
        onClose={handleCloseComment}
        onSave={handleSaveComment}
      />
    </>
  );
}
