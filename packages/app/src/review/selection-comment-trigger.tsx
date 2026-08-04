import { useCallback, useState } from "react";
import { MessageSquarePlus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ReviewCommentComposerSheet } from "./comment-composer-sheet";
import type { ReviewTextSelection } from "./workspace-comments";

export function ReviewSelectionCommentTrigger({
  filePath,
  selection,
  onComment,
}: {
  filePath: string;
  selection: ReviewTextSelection | null;
  onComment: (selection: ReviewTextSelection, body: string) => void;
}) {
  const { t } = useTranslation();
  const [editingSelection, setEditingSelection] = useState<ReviewTextSelection | null>(null);
  const handleOpen = useCallback(() => {
    if (selection) {
      setEditingSelection(selection);
    }
  }, [selection]);
  const handleClose = useCallback(() => setEditingSelection(null), []);
  const handleSave = useCallback(
    (body: string) => {
      if (!editingSelection) {
        return;
      }
      onComment(editingSelection, body);
      setEditingSelection(null);
    },
    [editingSelection, onComment],
  );

  if (!selection) {
    return null;
  }

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={MessageSquarePlus}
        onPress={handleOpen}
        accessibilityLabel={t("review.comment.add")}
        testID="source-selection-review-trigger"
      >
        {t("review.comment.save")}
      </Button>
      <ReviewCommentComposerSheet
        visible={editingSelection !== null}
        filePath={filePath}
        selection={editingSelection}
        onClose={handleClose}
        onSave={handleSave}
      />
    </>
  );
}
