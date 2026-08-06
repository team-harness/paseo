import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getOverlayRoot, useGlobalWebOverlayLayer } from "@/lib/overlay-root";
import { ReviewCommentComposerSheet } from "./comment-composer-sheet";
import type { ReviewTextSelection } from "./workspace-comments";
import type { ReviewSelectionSurfaceProps } from "./selection-surface";

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const VIEWPORT_MARGIN = 8;
const ACTION_GAP = 8;
const ACTION_HEIGHT = 36;

interface SelectionAction extends ReviewTextSelection {
  left: number;
  top: number;
  placement: "above" | "below";
}

function preventSelectionActionMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

export function ReviewSelectionSurface({
  children,
  filePath,
  onComment,
}: ReviewSelectionSurfaceProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [editingSelection, setEditingSelection] = useState<ReviewTextSelection | null>(null);
  const overlayLayer = useGlobalWebOverlayLayer("floating", selectionAction !== null);

  const updateSelectionAction = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      setSelectionAction(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !rootRef.current?.contains(range.startContainer) ||
      !rootRef.current.contains(range.endContainer)
    ) {
      setSelectionAction(null);
      return;
    }
    const quote = selection.toString().trim();
    const rect = getTerminalSelectionRect(range);
    if (!quote || (rect.width === 0 && rect.height === 0)) {
      setSelectionAction(null);
      return;
    }

    const locatedRange = selectionLineRange(range);
    const visualViewportBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : window.innerHeight;
    const placement =
      rect.bottom + ACTION_GAP + ACTION_HEIGHT <= visualViewportBottom - VIEWPORT_MARGIN
        ? "below"
        : "above";
    setSelectionAction({
      quote,
      lineStart: locatedRange?.lineStart ?? null,
      lineEnd: locatedRange?.lineEnd ?? null,
      left: Math.min(window.innerWidth - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, rect.right)),
      top: placement === "above" ? rect.top - ACTION_GAP : rect.bottom + ACTION_GAP,
      placement,
    });
  }, []);

  const scheduleSelectionActionUpdate = useCallback(() => {
    if (selectionFrameRef.current !== null) {
      return;
    }
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      selectionFrameRef.current = null;
      updateSelectionAction();
    });
  }, [updateSelectionAction]);

  useEffect(() => {
    document.addEventListener("selectionchange", scheduleSelectionActionUpdate);
    document.addEventListener("scroll", scheduleSelectionActionUpdate, true);
    window.addEventListener("resize", scheduleSelectionActionUpdate);
    return () => {
      document.removeEventListener("selectionchange", scheduleSelectionActionUpdate);
      document.removeEventListener("scroll", scheduleSelectionActionUpdate, true);
      window.removeEventListener("resize", scheduleSelectionActionUpdate);
      if (selectionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
      }
    };
  }, [scheduleSelectionActionUpdate]);

  const handleOpenComment = useCallback(() => {
    if (!selectionAction) {
      return;
    }
    setEditingSelection({
      quote: selectionAction.quote,
      lineStart: selectionAction.lineStart,
      lineEnd: selectionAction.lineEnd,
    });
    setSelectionAction(null);
  }, [selectionAction]);
  const handleCloseComment = useCallback(() => setEditingSelection(null), []);
  const handleSaveComment = useCallback(
    (body: string) => {
      if (!editingSelection) {
        return;
      }
      onComment(editingSelection, body);
      window.getSelection()?.removeAllRanges();
      setEditingSelection(null);
    },
    [editingSelection, onComment],
  );
  const selectionActionStyle = useMemo<CSSProperties | undefined>(() => {
    if (!selectionAction) {
      return undefined;
    }
    return {
      position: "fixed",
      pointerEvents: "auto",
      zIndex: overlayLayer,
      left: selectionAction.left,
      top: selectionAction.top,
      transform:
        selectionAction.placement === "above" ? "translate(-50%, -100%)" : "translateX(-50%)",
    };
  }, [overlayLayer, selectionAction]);

  const action = selectionAction
    ? createPortal(
        <div
          onMouseDown={preventSelectionActionMouseDown}
          style={selectionActionStyle}
          data-testid="review-selection-actions"
        >
          <Button
            size="xs"
            variant="secondary"
            leftIcon={MessageSquarePlus}
            onPress={handleOpenComment}
            accessibilityLabel={t("review.comment.add")}
            testID="review-selection-comment"
          >
            {t("review.comment.save")}
          </Button>
        </div>,
        getOverlayRoot(),
      )
    : null;

  return (
    <div ref={rootRef} style={DISPLAY_CONTENTS}>
      {children}
      {action}
      <ReviewCommentComposerSheet
        visible={editingSelection !== null}
        filePath={filePath}
        selection={editingSelection}
        onClose={handleCloseComment}
        onSave={handleSaveComment}
      />
    </div>
  );
}

function getTerminalSelectionRect(range: Range): DOMRect {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  return rects.at(-1) ?? range.getBoundingClientRect();
}

function selectionLineRange(range: Range): { lineStart: number; lineEnd: number } | null {
  const start = closestReviewLine(range.startContainer);
  const end = closestReviewLine(range.endContainer);
  if (start === null || end === null) {
    return null;
  }
  return { lineStart: Math.min(start, end), lineEnd: Math.max(start, end) };
}

function closestReviewLine(node: Node): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const line = Number(element?.closest("[data-review-line]")?.getAttribute("data-review-line"));
  return Number.isInteger(line) && line > 0 ? line : null;
}
