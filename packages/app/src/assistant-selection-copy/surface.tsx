import { useCallback, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Quote } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { NativeTextSelectionActionSurface } from "@/native-text-selection/action-surface";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onQuoteSelection?: (markdown: string) => void;
}

export function AssistantSelectionCopySurface({
  children,
  style,
  onQuoteSelection,
}: AssistantSelectionCopySurfaceProps) {
  const { t } = useTranslation();
  const handleQuote = useCallback((text: string) => onQuoteSelection?.(text), [onQuoteSelection]);

  if (!onQuoteSelection) {
    return <View style={style}>{children}</View>;
  }

  return (
    <NativeTextSelectionActionSurface
      style={style}
      actionIcon={Quote}
      actionLabel={t("review.quoteSelection")}
      actionText={t("review.quote")}
      actionTestID="assistant-selection-quote"
      onAction={handleQuote}
    >
      {children}
    </NativeTextSelectionActionSurface>
  );
}
