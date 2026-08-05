import React, { createContext, memo, type ReactNode, useContext, useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

interface RetainedPanelActivityState {
  active: boolean;
  // The nearest panel's own selection state, before ancestor visibility is folded in.
  localActive: boolean;
}

const RetainedPanelActivityContext = createContext<RetainedPanelActivityState>({
  active: true,
  localActive: true,
});

export function useRetainedPanelActive(): boolean {
  return useContext(RetainedPanelActivityContext).active;
}

export function useRetainedPanelLocalActive(): boolean {
  return useContext(RetainedPanelActivityContext).localActive;
}

interface RetainedPanelProps {
  active: boolean;
  children: ReactNode;
  localActive?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface RetainedPanelActivityProps {
  active: boolean;
  children: ReactNode;
  localActive?: boolean;
}

export function RetainedPanelActivity({
  active,
  children,
  localActive = active,
}: RetainedPanelActivityProps) {
  const parentActive = useRetainedPanelActive();
  const value = useMemo(
    () => ({ active: parentActive && active, localActive }),
    [active, localActive, parentActive],
  );
  return <RetainedPanelActivityContext value={value}>{children}</RetainedPanelActivityContext>;
}

/**
 * Keeps expensive panel state mounted without letting an inactive panel render
 * on screen. The stable, non-collapsible native root is intentional: retained
 * panels must not detach or reparent their native descendants when visibility
 * changes.
 */
export const RetainedPanel = memo(function RetainedPanel({
  active,
  children,
  localActive,
  style,
  testID,
}: RetainedPanelProps) {
  const visibleStyle = StyleSheet.compose<ViewStyle, ViewStyle, ViewStyle>(styles.root, style);
  const panelStyle = active
    ? visibleStyle
    : StyleSheet.compose<ViewStyle, ViewStyle, ViewStyle>(visibleStyle, styles.hidden);

  return (
    <RetainedPanelActivity active={active} localActive={localActive}>
      <View
        collapsable={false}
        pointerEvents={active ? "auto" : "none"}
        style={panelStyle}
        testID={testID}
      >
        {children}
      </View>
    </RetainedPanelActivity>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
});
