import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  findNodeHandle,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Portal } from "@gorhom/portal";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import {
  addNativeTextSelectionListener,
  canUseNativeTextSelection,
  clearNativeTextSelection,
  registerNativeTextSelectionSurface,
  unregisterNativeTextSelectionSurface,
} from "./native-module";
import { resolveSelectionActionPlacement } from "./placement";

const DEFAULT_ACTION_SIZE = { width: 112, height: 32 };
const CLEAR_DELAY_MS = 180;

interface ActiveSelection {
  text: string;
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function NativeTextSelectionActionSurface({
  children,
  style,
  actionIcon,
  actionLabel,
  actionText,
  actionTestID,
  onAction,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  actionIcon: ComponentType<{ color: string; size: number }>;
  actionLabel: string;
  actionText: string;
  actionTestID: string;
  onAction: (text: string) => void;
}) {
  const rootRef = useRef<View | null>(null);
  const surfaceId = useId();
  const portalHostName = useFloatingPanelPortalHostName();
  const selectionRef = useRef<ActiveSelection | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [actionSize, setActionSize] = useState(DEFAULT_ACTION_SIZE);

  const cancelClearTimer = useCallback(() => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  const registerSurface = useCallback(() => {
    if (!canUseNativeTextSelection()) return;
    const viewTag = findNodeHandle(rootRef.current);
    if (viewTag !== null) {
      void registerNativeTextSelectionSurface(viewTag, surfaceId);
    }
  }, [surfaceId]);

  useEffect(() => {
    if (!canUseNativeTextSelection()) return;
    const subscription = addNativeTextSelectionListener((event) => {
      if (event.surfaceId !== surfaceId) return;
      if (!event.active) {
        cancelClearTimer();
        clearTimerRef.current = setTimeout(() => {
          selectionRef.current = null;
          setSelection(null);
          clearTimerRef.current = null;
        }, CLEAR_DELAY_MS);
        return;
      }
      if (!event.text || event.anchorX === undefined || event.anchorY === undefined) return;
      cancelClearTimer();
      void measureFloatingPanelPortalHost(portalHostName).then((hostRect) => {
        if (!hostRect) return null;
        const nextSelection = {
          text: event.text ?? "",
          anchorX: event.anchorX! - hostRect.x,
          anchorY: event.anchorY! - hostRect.y,
          viewportWidth: hostRect.width,
          viewportHeight: hostRect.height,
        };
        selectionRef.current = nextSelection;
        setSelection(nextSelection);
        return nextSelection;
      });
    });
    const frame = requestAnimationFrame(registerSurface);
    return () => {
      cancelAnimationFrame(frame);
      cancelClearTimer();
      subscription?.remove();
      void unregisterNativeTextSelectionSurface(surfaceId);
    };
  }, [cancelClearTimer, portalHostName, registerSurface, surfaceId]);

  const handleAction = useCallback(() => {
    const activeSelection = selectionRef.current;
    if (!activeSelection) return;
    cancelClearTimer();
    void clearNativeTextSelection(surfaceId);
    selectionRef.current = null;
    setSelection(null);
    onAction(activeSelection.text);
  }, [cancelClearTimer, onAction, surfaceId]);

  const handleActionLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setActionSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  const handleOverlayLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSelection((current) => {
      if (!current || (current.viewportWidth === width && current.viewportHeight === height)) {
        return current;
      }
      const next = { ...current, viewportWidth: width, viewportHeight: height };
      selectionRef.current = next;
      return next;
    });
  }, []);

  const actionStyle = useMemo(() => {
    if (!selection) return null;
    const placement = resolveSelectionActionPlacement({
      anchorX: selection.anchorX,
      anchorY: selection.anchorY,
      actionWidth: actionSize.width,
      actionHeight: actionSize.height,
      viewportWidth: selection.viewportWidth,
      viewportHeight: selection.viewportHeight,
    });
    return [styles.action, inlineUnistylesStyle({ left: placement.left, top: placement.top })];
  }, [actionSize.height, actionSize.width, selection]);

  return (
    <View ref={rootRef} collapsable={false} onLayout={registerSurface} style={style}>
      {children}
      {selection && actionStyle ? (
        <Portal hostName={portalHostName}>
          <View pointerEvents="box-none" style={styles.overlay} onLayout={handleOverlayLayout}>
            <View style={actionStyle} onLayout={handleActionLayout}>
              <Button
                size="xs"
                variant="secondary"
                leftIcon={actionIcon}
                onPress={handleAction}
                accessibilityLabel={actionLabel}
                testID={actionTestID}
              >
                {actionText}
              </Button>
            </View>
          </View>
        </Portal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  action: {
    position: "absolute",
  },
}));
