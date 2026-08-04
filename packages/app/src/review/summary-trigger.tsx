import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Copy, MessageSquareText, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useReviewDraftStore } from "./store";
import {
  formatWorkspaceReviewSummary,
  type BuildWorkspaceReviewKeyInput,
  type WorkspaceReviewComment,
} from "./workspace-comments";
import {
  useWorkspaceReviewCommentsStore,
  useWorkspaceReviewSummary,
  type WorkspaceReviewSummaryEntry,
} from "./workspace-comments-store";
import type { Theme } from "@/styles/theme";

const ThemedTrash2 = withUnistyles(Trash2);
const ThemedMessageSquareText = withUnistyles(MessageSquareText);
const destructiveIconMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const REVIEW_SUMMARY_SNAP_POINTS = ["60%", "88%"];

export function ReviewSummaryTrigger(props: BuildWorkspaceReviewKeyInput) {
  const { t } = useTranslation();
  const toast = useToast();
  const scope = useMemo(
    () => ({ serverId: props.serverId, workspaceId: props.workspaceId, cwd: props.cwd }),
    [props.cwd, props.serverId, props.workspaceId],
  );
  const review = useWorkspaceReviewSummary(scope);
  const [visible, setVisible] = useState(false);
  const count = review.entries.length;
  const summaryText = useMemo(
    () =>
      formatWorkspaceReviewSummary({
        selectionComments: review.selectionComments,
        diffComments: review.diffComments,
      }),
    [review.diffComments, review.selectionComments],
  );
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("review.summary.title"),
      subtitle: t("review.summary.count", { count }),
    }),
    [count, t],
  );
  const handleOpen = useCallback(() => setVisible(true), []);
  const handleClose = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (count === 0) {
      setVisible(false);
    }
  }, [count]);

  const handleCopy = useCallback(() => {
    if (!summaryText) {
      return;
    }
    void Clipboard.setStringAsync(summaryText)
      .then(() => toast.copied(t("review.summary.title")))
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : t("review.summary.copyFailed"));
      });
  }, [summaryText, t, toast]);
  const handleDelete = useCallback((entry: WorkspaceReviewSummaryEntry) => {
    if (entry.kind === "selection") {
      useWorkspaceReviewCommentsStore
        .getState()
        .deleteComment({ key: entry.ownerKey, id: entry.comment.id });
      return;
    }
    useReviewDraftStore.getState().deleteComment({ key: entry.ownerKey, id: entry.comment.id });
  }, []);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Text style={styles.footerCount}>{t("review.summary.count", { count })}</Text>
        <Button
          variant="default"
          size="sm"
          leftIcon={Copy}
          onPress={handleCopy}
          testID="review-summary-copy"
        >
          {t("review.summary.copyAll")}
        </Button>
      </View>
    ),
    [count, handleCopy, t],
  );

  if (count === 0) {
    return null;
  }

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel={t("review.summary.open", { count })}
          style={triggerStyle}
          testID="review-summary-trigger"
        >
          <ThemedMessageSquareText size={15} uniProps={mutedIconMapping} />
          <Text style={styles.triggerCount}>{count}</Text>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          {t("review.summary.open", { count })}
        </TooltipContent>
      </Tooltip>
      <AdaptiveModalSheet
        visible={visible}
        header={header}
        onClose={handleClose}
        footer={footer}
        snapPoints={REVIEW_SUMMARY_SNAP_POINTS}
        desktopMaxWidth={620}
        testID="review-summary-sheet"
      >
        <ReviewSummaryList entries={review.entries} onDelete={handleDelete} />
      </AdaptiveModalSheet>
    </>
  );
}

function ReviewSummaryList({
  entries,
  onDelete,
}: {
  entries: readonly WorkspaceReviewSummaryEntry[];
  onDelete: (entry: WorkspaceReviewSummaryEntry) => void;
}) {
  const grouped = useMemo(() => {
    const byFile = new Map<string, WorkspaceReviewSummaryEntry[]>();
    for (const entry of entries) {
      byFile.set(entry.comment.filePath, [...(byFile.get(entry.comment.filePath) ?? []), entry]);
    }
    return Array.from(byFile);
  }, [entries]);

  return (
    <View style={styles.list}>
      {grouped.map(([filePath, fileEntries]) => (
        <View key={filePath} style={styles.fileGroup}>
          <Text style={styles.filePath}>{filePath}</Text>
          <View style={styles.comments}>
            {fileEntries.map((entry) => (
              <ReviewSummaryRow
                key={`${entry.kind}:${entry.ownerKey}:${entry.comment.id}`}
                entry={entry}
                onDelete={onDelete}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ReviewSummaryRow({
  entry,
  onDelete,
}: {
  entry: WorkspaceReviewSummaryEntry;
  onDelete: (entry: WorkspaceReviewSummaryEntry) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(entry), [entry, onDelete]);
  const location =
    entry.kind === "diff"
      ? t("review.selection.diffLine", {
          line: entry.comment.lineNumber,
          side: entry.comment.side,
        })
      : formatSelectionLocation(entry.comment, t);

  return (
    <View style={styles.commentRow}>
      <View style={styles.commentContent}>
        <Text style={styles.location}>{location}</Text>
        {entry.kind === "selection" ? (
          <View style={styles.quote}>
            <Text style={styles.quoteText} numberOfLines={4}>
              {entry.comment.quote}
            </Text>
          </View>
        ) : null}
        <Text style={styles.commentBody}>{entry.comment.body}</Text>
      </View>
      <Pressable
        onPress={handleDelete}
        accessibilityRole="button"
        accessibilityLabel={t("review.comment.delete")}
        style={deleteButtonStyle}
        testID={`review-summary-delete-${entry.comment.id}`}
      >
        <ThemedTrash2 size={14} uniProps={destructiveIconMapping} />
      </Pressable>
    </View>
  );
}

function formatSelectionLocation(
  comment: WorkspaceReviewComment,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (comment.lineStart === null) {
    return t("review.selection.selectedText");
  }
  if (comment.lineEnd === null || comment.lineEnd === comment.lineStart) {
    return t("review.selection.line", { line: comment.lineStart });
  }
  return t("review.selection.lines", { start: comment.lineStart, end: comment.lineEnd });
}

function triggerStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, (hovered || pressed) && styles.triggerHovered];
}

function deleteButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.deleteButton, (hovered || pressed) && styles.deleteButtonHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.base,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    color: theme.colors.foregroundMuted,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  list: {
    gap: theme.spacing[6],
  },
  fileGroup: {
    gap: theme.spacing[2],
  },
  filePath: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  comments: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  commentContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  location: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.borderAccent,
    paddingLeft: theme.spacing[2],
  },
  quoteText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  commentBody: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.45,
  },
  deleteButton: {
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  deleteButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  footerCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
