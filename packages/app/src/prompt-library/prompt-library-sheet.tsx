import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type TextInput,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BookOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  filterSavedPrompts,
  SAVED_PROMPT_CONTENT_MAX_LENGTH,
  SAVED_PROMPT_TITLE_MAX_LENGTH,
  type SavedPrompt,
  type SavedPromptDraft,
} from "./model";
import { PromptLibraryValidationError, type PromptLibraryValidationCode } from "./service";
import { PromptLibraryCorruptStorageError } from "./storage";
import { usePromptLibrary } from "./use-prompt-library";

const PROMPT_LIBRARY_SNAP_POINTS = ["72%", "92%"];
const BUSY_ACCESSIBILITY_STATE = { busy: true } as const;

interface PromptLibrarySheetProps {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onInsert: (content: string) => void;
}

interface FieldErrors {
  title?: string;
  content?: string;
}

type SheetMode = { kind: "library" } | { kind: "editor"; prompt: SavedPrompt | null };

function getPromptPreview(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function PromptLibraryRow({
  prompt,
  first,
  disabled,
  isDeleting,
  onUse,
  onEdit,
  onDelete,
}: {
  prompt: SavedPrompt;
  first: boolean;
  disabled: boolean;
  isDeleting: boolean;
  onUse: (prompt: SavedPrompt) => void;
  onEdit: (prompt: SavedPrompt) => void;
  onDelete: (prompt: SavedPrompt) => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(() => [styles.row, !first && styles.rowBorder], [first]);
  const disabledAccessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const handleUse = useCallback(() => onUse(prompt), [onUse, prompt]);
  const handleEdit = useCallback(() => onEdit(prompt), [onEdit, prompt]);
  const handleDelete = useCallback(() => onDelete(prompt), [onDelete, prompt]);
  const rowPressableStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.rowMain,
      !disabled && (hovered || pressed) && styles.rowMainActive,
      disabled && styles.rowMainDisabled,
    ],
    [disabled],
  );
  const menuTriggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.menuTrigger,
      !disabled && (hovered || pressed || open) && styles.menuTriggerActive,
    ],
    [disabled],
  );

  return (
    <View style={rowStyle} testID={`prompt-library-row-${prompt.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("composer.promptLibrary.insertNamed", { title: prompt.title })}
        accessibilityState={disabledAccessibilityState}
        disabled={disabled}
        onPress={handleUse}
        style={rowPressableStyle}
        testID={`prompt-library-use-${prompt.id}`}
      >
        <Text style={styles.rowTitle} numberOfLines={1}>
          {prompt.title}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {getPromptPreview(prompt.content)}
        </Text>
      </Pressable>
      {isDeleting ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t("composer.promptLibrary.deletingNamed", { title: prompt.title })}
          accessibilityState={BUSY_ACCESSIBILITY_STATE}
          style={styles.menuTrigger}
          testID={`prompt-library-deleting-${prompt.id}`}
        >
          <ThemedLoadingSpinner size="small" uniProps={spinnerMutedMapping} />
        </View>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={t("composer.promptLibrary.actionsFor", { title: prompt.title })}
            accessibilityState={disabledAccessibilityState}
            disabled={disabled}
            style={menuTriggerStyle}
            testID={`prompt-library-menu-${prompt.id}`}
          >
            <ThemedMoreHorizontal size={ICON_SIZE.md} uniProps={iconMutedMapping} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="left" align="center" offset={6} minWidth={160}>
            <DropdownMenuItem
              leading={editLeadingIcon}
              onSelect={handleEdit}
              testID={`prompt-library-edit-${prompt.id}`}
            >
              {t("composer.promptLibrary.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              leading={deleteLeadingIcon}
              destructive
              onSelect={handleDelete}
              testID={`prompt-library-delete-${prompt.id}`}
            >
              {t("composer.promptLibrary.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </View>
  );
}

function PromptLibraryState({
  icon,
  message,
  action,
}: {
  icon?: ReactElement;
  message: string;
  action?: ReactElement;
}) {
  return (
    <View style={styles.state}>
      {icon}
      <Text style={styles.stateText}>{message}</Text>
      {action}
    </View>
  );
}

function validationMessage(code: PromptLibraryValidationCode, t: (key: string) => string): string {
  return t(`composer.promptLibrary.errors.${code}`);
}

export function PromptLibrarySheet({
  visible,
  onClose,
  onDismiss,
  onInsert,
}: PromptLibrarySheetProps) {
  const { t } = useTranslation();
  const library = usePromptLibrary();
  const [mode, setMode] = useState<SheetMode>({ kind: "library" });
  const [query, setQuery] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const draftRef = useRef<SavedPromptDraft>({ title: "", content: "" });
  const titleInputRef = useRef<TextInput>(null);
  const deleteFlowRef = useRef(false);
  const resetFlowRef = useRef(false);

  const resetEditor = useCallback(() => {
    setMode({ kind: "library" });
    draftRef.current = { title: "", content: "" };
    setFieldErrors({});
    setSubmitError(null);
    setIsSaving(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setActionError(null);
      setDeletingId(null);
      setIsResetting(false);
      setResetError(null);
      resetEditor();
    }
  }, [resetEditor, visible]);

  const openEditor = useCallback((prompt: SavedPrompt | null) => {
    setMode({ kind: "editor", prompt });
    draftRef.current = prompt
      ? { title: prompt.title, content: prompt.content }
      : { title: "", content: "" };
    setFieldErrors({});
    setSubmitError(null);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }, []);

  const handleNew = useCallback(() => openEditor(null), [openEditor]);
  const handleBack = useCallback(() => {
    if (isSaving) return;
    resetEditor();
  }, [isSaving, resetEditor]);
  const handleClose = useCallback(() => {
    if (isSaving || deletingId || isResetting) return;
    onClose();
  }, [deletingId, isResetting, isSaving, onClose]);

  const handleTitleChange = useCallback((title: string) => {
    draftRef.current = { ...draftRef.current, title };
  }, []);
  const handleContentChange = useCallback((content: string) => {
    draftRef.current = { ...draftRef.current, content };
  }, []);
  const handleTitleFocus = useCallback(() => {
    setFieldErrors((current) => (current.title ? { ...current, title: undefined } : current));
    setSubmitError(null);
  }, []);
  const handleContentFocus = useCallback(() => {
    setFieldErrors((current) => (current.content ? { ...current, content: undefined } : current));
    setSubmitError(null);
  }, []);

  const validateDraft = useCallback((): boolean => {
    const draft = draftRef.current;
    const errors: FieldErrors = {};
    if (!draft.title.trim()) {
      errors.title = t("composer.promptLibrary.errors.title_required");
    } else if (draft.title.trim().length > SAVED_PROMPT_TITLE_MAX_LENGTH) {
      errors.title = t("composer.promptLibrary.errors.title_too_long");
    }
    if (!draft.content.trim()) {
      errors.content = t("composer.promptLibrary.errors.content_required");
    } else if (draft.content.length > SAVED_PROMPT_CONTENT_MAX_LENGTH) {
      errors.content = t("composer.promptLibrary.errors.content_too_long");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [t]);

  const handleSave = useCallback(async () => {
    if (isSaving || mode.kind !== "editor" || !validateDraft()) return;
    const draft = draftRef.current;
    setIsSaving(true);
    setSubmitError(null);
    try {
      if (mode.prompt) {
        await library.updatePrompt(mode.prompt.id, draft);
      } else {
        await library.createPrompt(draft);
      }
      resetEditor();
    } catch (error) {
      if (error instanceof PromptLibraryValidationError) {
        const message = validationMessage(error.code, t);
        if (error.code.startsWith("title_")) {
          setFieldErrors({ title: message });
        } else {
          setFieldErrors({ content: message });
        }
      } else {
        setSubmitError(
          error instanceof Error ? error.message : t("composer.promptLibrary.errors.unableToSave"),
        );
      }
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, library, mode, resetEditor, t, validateDraft]);

  const handleUse = useCallback(
    (prompt: SavedPrompt) => {
      onInsert(prompt.content);
      onClose();
    },
    [onClose, onInsert],
  );

  const handleDelete = useCallback(
    async (prompt: SavedPrompt) => {
      if (deleteFlowRef.current) return;
      deleteFlowRef.current = true;
      try {
        const confirmed = await confirmDialog({
          title: t("composer.promptLibrary.deleteConfirmTitle"),
          message: t("composer.promptLibrary.deleteConfirmMessage", { title: prompt.title }),
          confirmLabel: t("composer.promptLibrary.delete"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        setDeletingId(prompt.id);
        setActionError(null);
        try {
          await library.removePrompt(prompt.id);
        } catch (error) {
          setActionError(
            error instanceof Error
              ? error.message
              : t("composer.promptLibrary.errors.unableToDelete"),
          );
        } finally {
          setDeletingId(null);
        }
      } finally {
        deleteFlowRef.current = false;
      }
    },
    [library, t],
  );

  const handleReset = useCallback(async () => {
    if (resetFlowRef.current) return;
    resetFlowRef.current = true;
    try {
      const confirmed = await confirmDialog({
        title: t("composer.promptLibrary.resetConfirmTitle"),
        message: t("composer.promptLibrary.resetConfirmMessage"),
        confirmLabel: t("composer.promptLibrary.reset"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setIsResetting(true);
      setResetError(null);
      try {
        await library.resetPrompts();
      } catch {
        setResetError(t("composer.promptLibrary.errors.unableToReset"));
      } finally {
        setIsResetting(false);
      }
    } finally {
      resetFlowRef.current = false;
    }
  }, [library, t]);

  const filteredPrompts = useMemo(
    () => filterSavedPrompts(library.prompts, query),
    [library.prompts, query],
  );

  const newButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="xs"
        leftIcon={Plus}
        onPress={handleNew}
        disabled={library.isLoading || Boolean(library.error) || Boolean(deletingId) || isResetting}
        testID="prompt-library-new-button"
      >
        {t("composer.promptLibrary.new")}
      </Button>
    ),
    [deletingId, handleNew, isResetting, library.error, library.isLoading, t],
  );

  const header = useMemo<SheetHeader>(() => {
    if (mode.kind === "editor") {
      return {
        title: mode.prompt
          ? t("composer.promptLibrary.editTitle")
          : t("composer.promptLibrary.addTitle"),
        back: {
          onPress: handleBack,
          accessibilityLabel: t("common.actions.back"),
        },
      };
    }
    return {
      title: t("composer.promptLibrary.title"),
      leading: headerLeadingIcon,
      actions: newButton,
      search: {
        onChange: setQuery,
        resetKey: Number(visible),
        placeholder: t("composer.promptLibrary.searchPlaceholder"),
        autoFocus: false,
        testID: "prompt-library-search-input",
      },
    };
  }, [handleBack, mode, newButton, t, visible]);

  const editorFooter = useMemo(
    () =>
      mode.kind === "editor" ? (
        <View style={styles.footerActions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.footerButton}
            onPress={handleBack}
            disabled={isSaving}
            testID="prompt-library-cancel-button"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={styles.footerButton}
            onPress={handleSave}
            loading={isSaving}
            testID="prompt-library-save-button"
          >
            {t("composer.promptLibrary.save")}
          </Button>
        </View>
      ) : null,
    [handleBack, handleSave, isSaving, mode.kind, t],
  );

  const retryAction = useMemo(
    () => (
      <Button
        variant="secondary"
        size="sm"
        onPress={library.reload}
        disabled={isResetting}
        testID="prompt-library-retry-button"
      >
        {t("common.actions.retry")}
      </Button>
    ),
    [isResetting, library.reload, t],
  );
  const corruptStorageAction = useMemo(
    () => (
      <View style={styles.stateActionGroup}>
        <View style={styles.stateActions}>
          {retryAction}
          <Button
            variant="destructive"
            size="sm"
            onPress={handleReset}
            loading={isResetting}
            testID="prompt-library-reset-button"
          >
            {t("composer.promptLibrary.reset")}
          </Button>
        </View>
        {resetError ? (
          <Text style={styles.errorText} testID="prompt-library-reset-error">
            {resetError}
          </Text>
        ) : null}
      </View>
    ),
    [handleReset, isResetting, resetError, retryAction, t],
  );
  const emptyAction = useMemo(
    () =>
      query.trim() ? undefined : (
        <Button variant="default" size="sm" leftIcon={Plus} onPress={handleNew}>
          {t("composer.promptLibrary.new")}
        </Button>
      ),
    [handleNew, query, t],
  );

  let content: ReactElement;
  if (mode.kind === "editor") {
    content = (
      <View style={styles.editor}>
        <Field
          label={t("composer.promptLibrary.nameLabel")}
          error={fieldErrors.title}
          testID="prompt-library-title-field"
        >
          <FormTextInput
            ref={titleInputRef}
            initialValue={mode.prompt?.title ?? ""}
            resetKey={mode.prompt?.id ?? "new"}
            onChangeText={handleTitleChange}
            onFocus={handleTitleFocus}
            placeholder={t("composer.promptLibrary.namePlaceholder")}
            maxLength={SAVED_PROMPT_TITLE_MAX_LENGTH}
            editable={!isSaving}
            returnKeyType="next"
            testID="prompt-library-title-input"
          />
        </Field>
        <Field
          label={t("composer.promptLibrary.contentLabel")}
          error={fieldErrors.content}
          testID="prompt-library-content-field"
        >
          <FormTextInput
            initialValue={mode.prompt?.content ?? ""}
            resetKey={mode.prompt?.id ?? "new"}
            onChangeText={handleContentChange}
            onFocus={handleContentFocus}
            placeholder={t("composer.promptLibrary.contentPlaceholder")}
            maxLength={SAVED_PROMPT_CONTENT_MAX_LENGTH}
            editable={!isSaving}
            multiline
            numberOfLines={8}
            textAlignVertical="top"
            style={styles.contentInput}
            testID="prompt-library-content-input"
          />
        </Field>
        {submitError ? (
          <Text style={styles.errorText} testID="prompt-library-submit-error">
            {submitError}
          </Text>
        ) : null}
      </View>
    );
  } else if (library.isLoading) {
    content = (
      <PromptLibraryState icon={loadingStateIcon} message={t("composer.promptLibrary.loading")} />
    );
  } else if (library.error) {
    const isCorruptStorage = library.error instanceof PromptLibraryCorruptStorageError;
    content = (
      <PromptLibraryState
        message={t(
          isCorruptStorage
            ? "composer.promptLibrary.corruptData"
            : "composer.promptLibrary.loadError",
        )}
        action={isCorruptStorage ? corruptStorageAction : retryAction}
      />
    );
  } else if (filteredPrompts.length === 0) {
    content = (
      <PromptLibraryState
        message={
          query.trim() ? t("composer.promptLibrary.noResults") : t("composer.promptLibrary.empty")
        }
        action={emptyAction}
      />
    );
  } else {
    content = (
      <View style={styles.libraryContent}>
        {actionError ? (
          <Text style={styles.errorText} testID="prompt-library-action-error">
            {actionError}
          </Text>
        ) : null}
        <View style={styles.list} testID="prompt-library-list">
          {filteredPrompts.map((prompt, index) => (
            <PromptLibraryRow
              key={prompt.id}
              prompt={prompt}
              first={index === 0}
              disabled={deletingId !== null}
              isDeleting={deletingId === prompt.id}
              onUse={handleUse}
              onEdit={openEditor}
              onDelete={handleDelete}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      onDismiss={onDismiss}
      footer={editorFooter}
      snapPoints={PROMPT_LIBRARY_SNAP_POINTS}
      sizeContentToCurrentSnapPoint
      desktopMaxWidth={560}
      testID="prompt-library-sheet"
    >
      {content}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  libraryContent: {
    gap: theme.spacing[3],
  },
  list: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surface2,
  },
  rowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowMainActive: {
    backgroundColor: theme.colors.surface3,
  },
  rowMainDisabled: {
    opacity: theme.opacity[50],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.4),
  },
  menuTrigger: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTriggerActive: {
    backgroundColor: theme.colors.surface3,
  },
  state: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  stateActionGroup: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stateActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  editor: {
    gap: theme.spacing[4],
  },
  contentInput: {
    minHeight: 180,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  footerButton: {
    flex: 1,
  },
})) as unknown as Record<string, object>;

const ThemedBookOpen = withUnistyles(BookOpen);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const iconMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const spinnerMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const headerLeadingIcon = createElement(ThemedBookOpen, {
  size: ICON_SIZE.md,
  uniProps: iconMutedMapping,
});
const editLeadingIcon = createElement(ThemedPencil, {
  size: ICON_SIZE.sm,
  uniProps: iconMutedMapping,
});
const deleteLeadingIcon = createElement(ThemedTrash2, {
  size: ICON_SIZE.sm,
  uniProps: iconMutedMapping,
});
const loadingStateIcon = createElement(ThemedLoadingSpinner, {
  size: "small",
  uniProps: spinnerMutedMapping,
});
