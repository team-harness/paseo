import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Quote } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getOverlayRoot, useGlobalWebOverlayLayer } from "@/lib/overlay-root";
import { createAssistantSelectionClipboardContent } from "./content.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onQuoteSelection?: (markdown: string) => void;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const VIEWPORT_MARGIN = 8;
const ACTION_GAP = 8;
const ACTION_HEIGHT = 36;

interface SelectionAction {
  markdown: string;
  left: number;
  top: number;
  placement: "above" | "below";
}

function preventSelectionActionMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

export function AssistantSelectionCopySurface({
  children,
  style,
  onQuoteSelection,
}: AssistantSelectionCopySurfaceProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const overlayLayer = useGlobalWebOverlayLayer("floating", selectionAction !== null);
  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  const updateSelectionAction = useCallback(() => {
    if (!onQuoteSelection) {
      setSelectionAction(null);
      return;
    }
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

    const content = createAssistantSelectionClipboardContent(selection);
    if (!content) {
      setSelectionAction(null);
      return;
    }

    const rect = getTerminalSelectionRect(range);
    if (rect.width === 0 && rect.height === 0) {
      setSelectionAction(null);
      return;
    }
    const visualViewportBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : window.innerHeight;
    const placement =
      rect.bottom + ACTION_GAP + ACTION_HEIGHT <= visualViewportBottom - VIEWPORT_MARGIN
        ? "below"
        : "above";
    setSelectionAction({
      markdown: content.plainText,
      left: Math.min(window.innerWidth - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, rect.right)),
      top: placement === "above" ? rect.top - ACTION_GAP : rect.bottom + ACTION_GAP,
      placement,
    });
  }, [onQuoteSelection]);

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
    if (!onQuoteSelection) {
      return;
    }
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
  }, [onQuoteSelection, scheduleSelectionActionUpdate]);

  const handleQuote = useCallback(() => {
    if (!selectionAction) {
      return;
    }
    onQuoteSelection?.(selectionAction.markdown);
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  }, [onQuoteSelection, selectionAction]);
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

  const selectionActionNode = selectionAction
    ? createPortal(
        <div
          onMouseDown={preventSelectionActionMouseDown}
          style={selectionActionStyle}
          data-testid="assistant-selection-actions"
        >
          <Button
            size="xs"
            variant="secondary"
            leftIcon={Quote}
            onPress={handleQuote}
            accessibilityLabel={t("review.quoteSelection")}
            testID="assistant-selection-quote"
          >
            {t("review.quote")}
          </Button>
        </div>,
        getOverlayRoot(),
      )
    : null;

  return (
    <div ref={rootRef} onCopy={handleCopy} style={DISPLAY_CONTENTS}>
      <View style={style}>{children}</View>
      {selectionActionNode}
    </div>
  );
}

function getTerminalSelectionRect(range: Range): DOMRect {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  return rects.at(-1) ?? range.getBoundingClientRect();
}
