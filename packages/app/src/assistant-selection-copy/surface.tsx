import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onQuoteSelection?: (markdown: string) => void;
}

// Native Text selection exposes the platform copy menu but not a portable
// selected range. Custom quote actions are intentionally Web/Electron-only.
export function AssistantSelectionCopySurface({
  children,
  style,
}: AssistantSelectionCopySurfaceProps) {
  return <View style={style}>{children}</View>;
}
