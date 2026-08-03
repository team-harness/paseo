import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { BookOpen } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Theme } from "@/styles/theme";
import { PromptLibrarySheet } from "./prompt-library-sheet";

interface PromptLibraryTriggerProps {
  disabled?: boolean;
  isPaneFocused: boolean;
  onInsert: (content: string) => void;
}

interface OpenSheetState {
  key: number;
  visible: boolean;
}

export function PromptLibraryTrigger({
  disabled = false,
  isPaneFocused,
  onInsert,
}: PromptLibraryTriggerProps) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<OpenSheetState | null>(null);
  const nextSheetKeyRef = useRef(0);

  useEffect(() => {
    if (!isPaneFocused) {
      setSheet((current) => (current ? { ...current, visible: false } : null));
    }
  }, [isPaneFocused]);

  const handleOpen = useCallback(() => {
    nextSheetKeyRef.current += 1;
    setSheet({ key: nextSheetKeyRef.current, visible: true });
  }, []);
  const handleClose = useCallback(() => {
    setSheet((current) => (current ? { ...current, visible: false } : null));
  }, []);
  const sheetKey = sheet?.key;
  const handleDismiss = useCallback(() => {
    setSheet((current) => {
      if (!current || current.key !== sheetKey) return current;
      return null;
    });
  }, [sheetKey]);
  const label = t("composer.promptLibrary.trigger");

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            leftIcon={BookOpen}
            style={styles.trigger}
            disabled={disabled || !isPaneFocused}
            accessibilityLabel={label}
            onPress={handleOpen}
            testID="prompt-library-trigger"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      {sheet ? (
        <PromptLibrarySheet
          key={sheet.key}
          visible={sheet.visible && isPaneFocused}
          onClose={handleClose}
          onDismiss={handleDismiss}
          onInsert={onInsert}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  trigger: {
    width: 28,
    height: 28,
    minHeight: 28,
    paddingHorizontal: 0,
    borderRadius: theme.borderRadius.full,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
})) as unknown as Record<string, object>;
