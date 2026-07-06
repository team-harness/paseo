import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HostBottomChromeProvider } from "./bottom-chrome-inset";
import {
  GlobalStatusBar,
  GLOBAL_STATUS_BAR_CONTENT_HEIGHT,
  useGlobalStatusBarChromeState,
} from "./global-status-bar";

interface HostStatusBarLayoutProps {
  serverId: string;
  children: ReactNode;
}

export function HostStatusBarLayout({ serverId, children }: HostStatusBarLayoutProps) {
  const insets = useSafeAreaInsets();
  const chromeState = useGlobalStatusBarChromeState(serverId);
  const chromeHeight = chromeState.isVisible ? GLOBAL_STATUS_BAR_CONTENT_HEIGHT + insets.bottom : 0;
  const providerValue = useMemo(
    () => ({
      bottomSafeAreaOwned: chromeState.isVisible,
      chromeHeight,
    }),
    [chromeHeight, chromeState.isVisible],
  );

  return (
    <HostBottomChromeProvider {...providerValue}>
      <View style={styles.root} testID="host-status-bar-layout">
        <View style={styles.content} testID="host-status-bar-content">
          {children}
        </View>
        <GlobalStatusBar
          serverId={serverId}
          bottomInset={insets.bottom}
          chromeState={chromeState}
        />
      </View>
    </HostBottomChromeProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
}));
