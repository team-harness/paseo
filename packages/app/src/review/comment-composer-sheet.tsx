import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { ReviewTextSelection } from "./workspace-comments";

export function ReviewCommentComposerSheet({
  visible,
  filePath,
  selection,
  onClose,
  onSave,
}: {
  visible: boolean;
  filePath: string;
  selection: ReviewTextSelection | null;
  onClose: () => void;
  onSave: (body: string) => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const trimmedBody = body.trim();
  const location = useMemo(
    () => (selection ? formatSelectionLocation(selection, t) : filePath),
    [filePath, selection, t],
  );
  const header = useMemo<SheetHeader>(
    () => ({ title: t("review.comment.add"), subtitle: `${filePath} · ${location}` }),
    [filePath, location, t],
  );

  useEffect(() => {
    if (visible) {
      setBody("");
    }
  }, [visible, selection]);

  const handleSave = useCallback(() => {
    if (!trimmedBody) {
      return;
    }
    onSave(trimmedBody);
  }, [onSave, trimmedBody]);
  const footer = (
    <>
      <Button variant="ghost" size="sm" onPress={onClose}>
        {t("review.comment.cancel")}
      </Button>
      <Button
        variant="default"
        size="sm"
        disabled={!trimmedBody}
        onPress={handleSave}
        testID="selection-review-save"
      >
        {t("review.comment.save")}
      </Button>
    </>
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={header}
      onClose={onClose}
      footer={footer}
      scrollable={false}
      snapPoints={["45%", "70%"]}
      testID="selection-review-sheet"
    >
      <View style={styles.content}>
        <View style={styles.quote}>
          <Text style={styles.quoteText} numberOfLines={6}>
            {selection?.quote}
          </Text>
        </View>
        <AdaptiveTextInput
          multiline
          autoFocus
          initialValue=""
          resetKey={visible ? selection?.quote : "closed"}
          onChangeText={setBody}
          placeholder={t("review.comment.placeholder")}
          accessibilityLabel={t("review.comment.label")}
          style={styles.input}
          textAlignVertical="top"
          testID="selection-review-input"
        />
      </View>
    </AdaptiveModalSheet>
  );
}

function formatSelectionLocation(
  selection: ReviewTextSelection,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (selection.lineStart === null) {
    return t("review.selection.selectedText");
  }
  if (selection.lineEnd === null || selection.lineEnd === selection.lineStart) {
    return t("review.selection.line", { line: selection.lineStart });
  }
  return t("review.selection.lines", {
    start: selection.lineStart,
    end: selection.lineEnd,
  });
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.borderAccent,
    paddingLeft: theme.spacing[3],
  },
  quoteText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.45,
  },
  input: {
    minHeight: 128,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
}));
