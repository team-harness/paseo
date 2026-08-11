import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import {
  Bot,
  ChevronRight,
  Copy,
  MessageSquareText,
  Plus,
  Send,
  Trash2,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { dispatchComposerAgentMessage, queueComposerMessage } from "@/composer/actions";
import {
  createMessageSubmissionWriter,
  handoffCreatedAgentMessageSubmission,
} from "@/composer/submission/writer";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { selectAgentTurnPresentation, useSessionStore, type Agent } from "@/stores/session-store";
import { createUserMessage, generateMessageId } from "@/types/stream";
import { encodeImages } from "@/utils/encode-images";
import { toErrorMessage } from "@/utils/error-messages";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import { confirmDialog } from "@/utils/confirm-dialog";
import { deleteReviewDraftComments, useReviewDraftStore } from "./store";
import { collectPendingReviewEntries, submitReviewMessageViaComposer } from "./delivery";
import {
  useReviewDeliveryInFlight,
  useReviewDeliverySession,
  useReviewDeliveryStore,
} from "./delivery-store";
import {
  formatWorkspaceReviewSummaryEntries,
  formatWorkspaceReviewSummary,
  type BuildWorkspaceReviewKeyInput,
  type WorkspaceReviewComment,
} from "./workspace-comments";
import {
  deleteWorkspaceReviewComments,
  useWorkspaceReviewCommentsStore,
  useWorkspaceReviewSummary,
  type WorkspaceReviewSummaryEntry,
} from "./workspace-comments-store";
import type { Theme } from "@/styles/theme";

const ThemedTrash2 = withUnistyles(Trash2);
const ThemedMessageSquareText = withUnistyles(MessageSquareText);
const ThemedBot = withUnistyles(Bot);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedPlus = withUnistyles(Plus);
const destructiveIconMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const REVIEW_SUMMARY_SNAP_POINTS = ["60%", "88%"];

export function ReviewSummaryTrigger(props: BuildWorkspaceReviewKeyInput) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings: appSettings } = useAppSettings();
  const scope = useMemo(
    () => ({ serverId: props.serverId, workspaceId: props.workspaceId, cwd: props.cwd }),
    [props.cwd, props.serverId, props.workspaceId],
  );
  const review = useWorkspaceReviewSummary(scope);
  const client = useHostRuntimeClient(props.serverId);
  const agentsMap = useSessionStore((state) => state.sessions[props.serverId]?.agents ?? null);
  const setAgents = useSessionStore((state) => state.setAgents);
  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const [visible, setVisible] = useState(false);
  const [selectingAgent, setSelectingAgent] = useState(false);
  const [isDelivering, setIsDelivering] = useState(false);
  const deleteAllFlowRef = useRef(false);
  const count = review.entries.length;
  const deliverySession = useReviewDeliverySession(review.workspaceReviewKey);
  const deliveryInFlight = useReviewDeliveryInFlight(review.workspaceReviewKey);
  const workspaceAgents = useMemo(
    () =>
      collectWorkspaceReviewAgents(agentsMap, {
        serverId: props.serverId,
        workspaceId: props.workspaceId,
        cwd: props.cwd,
      }),
    [agentsMap, props.cwd, props.serverId, props.workspaceId],
  );
  const associatedAgent = deliverySession
    ? (agentsMap?.get(deliverySession.agentId) ?? null)
    : null;
  const availableAssociatedAgent = associatedAgent?.archivedAt ? null : associatedAgent;
  const pendingEntries = useMemo(
    () =>
      collectPendingReviewEntries(
        review.entries,
        deliverySession?.deliveredRevisions ?? EMPTY_DELIVERED_REVISIONS,
      ),
    [deliverySession?.deliveredRevisions, review.entries],
  );
  const deliveredCount = count - pendingEntries.length;
  const summaryText = useMemo(
    () =>
      formatWorkspaceReviewSummary({
        selectionComments: review.selectionComments,
        diffComments: review.diffComments,
      }),
    [review.diffComments, review.selectionComments],
  );
  const header = useMemo<SheetHeader>(
    () =>
      selectingAgent
        ? {
            title: t("review.summary.selectAgentTitle"),
            subtitle: t("review.summary.selectAgentSubtitle"),
            back: {
              onPress: () => setSelectingAgent(false),
              accessibilityLabel: t("common.actions.back"),
            },
          }
        : {
            title: t("review.summary.title"),
            subtitle: t("review.summary.count", { count }),
          },
    [count, selectingAgent, t],
  );
  const handleOpen = useCallback(() => setVisible(true), []);
  const handleClose = useCallback(() => {
    setVisible(false);
    setSelectingAgent(false);
  }, []);

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
  const handleDeleteAll = useCallback(async () => {
    if (deleteAllFlowRef.current || review.entries.length === 0) {
      return;
    }
    deleteAllFlowRef.current = true;
    try {
      const confirmed = await confirmDialog({
        title: t("review.summary.deleteAllConfirmTitle"),
        message: t("review.summary.deleteAllConfirmMessage", { count: review.entries.length }),
        confirmLabel: t("review.summary.deleteAll"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      deleteWorkspaceReviewComments(
        review.entries
          .filter((entry) => entry.kind === "selection")
          .map((entry) => ({ key: entry.ownerKey, id: entry.comment.id })),
      );
      deleteReviewDraftComments(
        review.entries
          .filter((entry) => entry.kind === "diff")
          .map((entry) => ({ key: entry.ownerKey, id: entry.comment.id })),
      );
    } finally {
      deleteAllFlowRef.current = false;
    }
  }, [review.entries, t]);
  const handleDeleteAllPress = useCallback(() => {
    void handleDeleteAll();
  }, [handleDeleteAll]);

  const buildAgentPrompt = useCallback(
    (entries: readonly WorkspaceReviewSummaryEntry[], followUp: boolean) => {
      const summary = formatWorkspaceReviewSummaryEntries(entries);
      const instruction = followUp
        ? t("review.summary.followUpPrompt")
        : t("review.summary.initialPrompt");
      return `${instruction}\n\n${summary}`;
    },
    [t],
  );

  const beginDelivery = useCallback(
    (agentId: string | null) => {
      const operationId = generateMessageId();
      const started = useReviewDeliveryStore.getState().beginDelivery({
        workspaceKey: review.workspaceReviewKey,
        operationId,
        agentId,
      });
      return started ? operationId : null;
    },
    [review.workspaceReviewKey],
  );

  const finishDelivery = useCallback(
    (operationId: string, agentId: string, entries: readonly WorkspaceReviewSummaryEntry[]) => {
      useReviewDeliveryStore.getState().finishDelivery({
        workspaceKey: review.workspaceReviewKey,
        operationId,
        agentId,
        entries,
      });
    },
    [review.workspaceReviewKey],
  );

  const releaseDelivery = useCallback(
    (operationId: string) => {
      useReviewDeliveryStore.getState().releaseDelivery({
        workspaceKey: review.workspaceReviewKey,
        operationId,
      });
    },
    [review.workspaceReviewKey],
  );

  const openAgent = useCallback(
    (agentId: string) => {
      if (!props.workspaceId) return;
      handleClose();
      navigateToWorkspace({
        serverId: props.serverId,
        workspaceId: props.workspaceId,
        target: { kind: "agent", agentId },
      });
    },
    [handleClose, props.serverId, props.workspaceId],
  );

  const sendToExistingAgent = useCallback(
    async (agent: Agent, entries: readonly WorkspaceReviewSummaryEntry[], operationId: string) => {
      if (!client || entries.length === 0) {
        throw new Error(t("review.summary.agentUnavailable"));
      }
      const text = buildAgentPrompt(entries, Boolean(deliverySession));
      const session = useSessionStore.getState().sessions[props.serverId];
      const isRunning = selectAgentTurnPresentation(session, agent.id).isActive;
      const result = await submitReviewMessageViaComposer({
        message: text,
        sendBehavior: appSettings.sendBehavior,
        isAgentRunning: isRunning,
        queueMessage: (queuedText) => {
          const queued = queueComposerMessage({
            agentId: agent.id,
            text: queuedText,
            attachments: [],
            queue: {
              read: (agentId) =>
                useSessionStore.getState().sessions[props.serverId]?.queuedMessages.get(agentId) ??
                [],
              write: (updater) => setQueuedMessages(props.serverId, updater),
            },
          });
          if (!queued.queued) {
            throw new Error(t("review.summary.agentUnavailable"));
          }
        },
        submitMessage: async (submitText) => {
          await dispatchComposerAgentMessage({
            client,
            agentId: agent.id,
            text: submitText,
            attachments: [],
            encodeImages,
            submission: createMessageSubmissionWriter(props.serverId),
          });
        },
        failedToSendMessage: t("composer.errors.failedToSend"),
      });
      finishDelivery(operationId, agent.id, entries);
      toast.show(
        result === "queued"
          ? t("review.summary.queued", { count: entries.length })
          : t("review.summary.sent", { count: entries.length }),
        { variant: "success" },
      );
      openAgent(agent.id);
    },
    [
      appSettings.sendBehavior,
      buildAgentPrompt,
      client,
      deliverySession,
      finishDelivery,
      openAgent,
      props.serverId,
      setQueuedMessages,
      t,
      toast,
    ],
  );

  const handleAgentPress = useCallback(
    (agent: Agent) => {
      if (isDelivering || deliveryInFlight || !client) return;
      const operationId = beginDelivery(agent.id);
      if (!operationId) return;
      setIsDelivering(true);
      void sendToExistingAgent(
        agent,
        deliverySession ? pendingEntries : review.entries,
        operationId,
      )
        .catch((error) => {
          releaseDelivery(operationId);
          toast.error(toErrorMessage(error));
        })
        .finally(() => setIsDelivering(false));
    },
    [
      beginDelivery,
      client,
      deliveryInFlight,
      deliverySession,
      isDelivering,
      pendingEntries,
      releaseDelivery,
      review.entries,
      sendToExistingAgent,
      toast,
    ],
  );

  const handleCreateAgent = useCallback(() => {
    const template = workspaceAgents[0];
    if (!client || !props.workspaceId || !template || isDelivering || deliveryInFlight) return;
    const operationId = beginDelivery(null);
    if (!operationId) return;
    const workspaceId = props.workspaceId;
    const entries = review.entries;
    const text = buildAgentPrompt(entries, false);
    setIsDelivering(true);
    void (async () => {
      const clientMessageId = generateMessageId();
      const timestamp = new Date();
      const snapshot = await client.createAgent({
        config: buildReviewAgentConfig(template, props.cwd, t("review.summary.newAgentTitle")),
        workspaceId,
        initialPrompt: text,
        clientMessageId,
      });
      const normalized = applyLegacyDaemonWorkspaceOwnership({
        serverId: props.serverId,
        agent: normalizeAgentSnapshot(snapshot, props.serverId),
      });
      setAgents(props.serverId, (previous) => new Map(previous).set(normalized.id, normalized));
      handoffCreatedAgentMessageSubmission(
        props.serverId,
        normalized.id,
        createUserMessage({ clientMessageId, text, timestamp }),
      );
      finishDelivery(operationId, normalized.id, entries);
      toast.show(t("review.summary.sent", { count: entries.length }), { variant: "success" });
      openAgent(normalized.id);
    })()
      .catch((error) => {
        releaseDelivery(operationId);
        toast.error(toErrorMessage(error));
      })
      .finally(() => setIsDelivering(false));
  }, [
    buildAgentPrompt,
    beginDelivery,
    client,
    deliveryInFlight,
    finishDelivery,
    isDelivering,
    openAgent,
    props.cwd,
    props.serverId,
    props.workspaceId,
    releaseDelivery,
    review.entries,
    setAgents,
    t,
    toast,
    workspaceAgents,
  ]);

  const handlePrimaryAction = useCallback(() => {
    if (!deliverySession) {
      setSelectingAgent(true);
      return;
    }
    if (availableAssociatedAgent && pendingEntries.length > 0) {
      handleAgentPress(availableAssociatedAgent);
    }
  }, [availableAssociatedAgent, deliverySession, handleAgentPress, pendingEntries.length]);
  const handleAssociatedAgentPress = useCallback(() => {
    if (availableAssociatedAgent) {
      openAgent(availableAssociatedAgent.id);
    }
  }, [availableAssociatedAgent, openAgent]);
  const primaryActionLabel = useMemo(() => {
    if (!deliverySession) {
      return t("review.summary.sendToAgent");
    }
    if (pendingEntries.length === 0) {
      return t("review.summary.allSent");
    }
    return t("review.summary.sendPending", { count: pendingEntries.length });
  }, [deliverySession, pendingEntries.length, t]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <View style={styles.footerStatus}>
          <Text style={styles.footerCount}>{t("review.summary.count", { count })}</Text>
          {deliverySession ? (
            <Text style={styles.deliveryCounts}>
              {t("review.summary.deliveryCounts", {
                delivered: deliveredCount,
                pending: pendingEntries.length,
              })}
            </Text>
          ) : null}
        </View>
        <View style={styles.footerActions}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Copy}
            onPress={handleCopy}
            testID="review-summary-copy"
          >
            {t("review.summary.copy")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={Trash2}
            onPress={handleDeleteAllPress}
            testID="review-summary-clear-all"
          >
            {t("review.summary.deleteAll")}
          </Button>
          <Button
            variant="default"
            size="sm"
            leftIcon={Send}
            onPress={handlePrimaryAction}
            loading={isDelivering}
            disabled={
              !client ||
              deliveryInFlight ||
              (Boolean(deliverySession) &&
                (!availableAssociatedAgent || pendingEntries.length === 0))
            }
            testID="review-summary-send"
          >
            {primaryActionLabel}
          </Button>
        </View>
      </View>
    ),
    [
      availableAssociatedAgent,
      client,
      count,
      deliveredCount,
      deliverySession,
      deliveryInFlight,
      handleCopy,
      handleDeleteAllPress,
      handlePrimaryAction,
      isDelivering,
      pendingEntries.length,
      primaryActionLabel,
      t,
    ],
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
        footer={selectingAgent ? undefined : footer}
        snapPoints={REVIEW_SUMMARY_SNAP_POINTS}
        desktopMaxWidth={620}
        testID="review-summary-sheet"
      >
        {selectingAgent ? (
          <ReviewAgentPicker
            agents={workspaceAgents}
            isDelivering={isDelivering || deliveryInFlight || !client}
            canCreateAgent={Boolean(client && props.workspaceId && workspaceAgents[0])}
            onAgentPress={handleAgentPress}
            onCreateAgent={handleCreateAgent}
          />
        ) : (
          <>
            {deliverySession ? (
              <AssociatedAgentRow
                agent={availableAssociatedAgent}
                agentId={deliverySession.agentId}
                onPress={availableAssociatedAgent ? handleAssociatedAgentPress : undefined}
              />
            ) : null}
            <ReviewSummaryList entries={review.entries} onDelete={handleDelete} />
          </>
        )}
      </AdaptiveModalSheet>
    </>
  );
}

const EMPTY_DELIVERED_REVISIONS: Readonly<Record<string, string>> = {};

function collectWorkspaceReviewAgents(
  agents: Map<string, Agent> | null,
  scope: BuildWorkspaceReviewKeyInput,
): Agent[] {
  if (!agents) return [];
  const workspaceId = normalizeWorkspaceOpaqueId(scope.workspaceId);
  const cwd = normalizeWorkspacePath(scope.cwd);
  return Array.from(agents.values())
    .filter((agent) => {
      if (agent.archivedAt || agent.parentAgentId) return false;
      if (workspaceId) return normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId;
      return normalizeWorkspacePath(agent.cwd) === cwd;
    })
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
}

function buildReviewAgentConfig(template: Agent, cwd: string, title: string) {
  const featureValues = Object.fromEntries(
    (template.features ?? []).map((feature) => [feature.id, feature.value]),
  );
  const modeId = template.currentModeId ?? template.runtimeInfo?.modeId ?? undefined;
  const model = template.model ?? template.runtimeInfo?.model ?? undefined;
  const thinkingOptionId =
    template.thinkingOptionId ?? template.runtimeInfo?.thinkingOptionId ?? undefined;
  return {
    provider: template.provider,
    cwd,
    title,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(Object.keys(featureValues).length > 0 ? { featureValues } : {}),
  };
}

function agentDisplayName(agent: Agent): string {
  return agent.title?.trim() || agent.provider;
}

function ReviewAgentPicker({
  agents,
  isDelivering,
  canCreateAgent,
  onAgentPress,
  onCreateAgent,
}: {
  agents: readonly Agent[];
  isDelivering: boolean;
  canCreateAgent: boolean;
  onAgentPress: (agent: Agent) => void;
  onCreateAgent: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.agentPicker}>
      <Pressable
        onPress={onCreateAgent}
        disabled={!canCreateAgent || isDelivering}
        accessibilityRole="button"
        accessibilityLabel={t("review.summary.createAgent")}
        style={agentRowStyle}
        testID="review-summary-create-agent"
      >
        <View style={styles.agentIcon}>
          <ThemedPlus size={16} uniProps={mutedIconMapping} />
        </View>
        <View style={styles.agentText}>
          <Text style={styles.agentTitle}>{t("review.summary.createAgent")}</Text>
          <Text style={styles.agentMeta}>{t("review.summary.createAgentHint")}</Text>
        </View>
        <ThemedChevronRight size={16} uniProps={mutedIconMapping} />
      </Pressable>
      <Text style={styles.agentSectionLabel}>{t("review.summary.existingAgents")}</Text>
      {agents.map((agent) => (
        <ReviewAgentPickerRow
          key={agent.id}
          agent={agent}
          disabled={isDelivering}
          onPress={onAgentPress}
        />
      ))}
    </View>
  );
}

function ReviewAgentPickerRow({
  agent,
  disabled,
  onPress,
}: {
  agent: Agent;
  disabled: boolean;
  onPress: (agent: Agent) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(agent), [agent, onPress]);
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t("review.summary.sendToNamedAgent", { name: agentDisplayName(agent) })}
      style={agentRowStyle}
      testID={`review-summary-agent-${agent.id}`}
    >
      <View style={styles.agentIcon}>
        <ThemedBot size={16} uniProps={mutedIconMapping} />
      </View>
      <View style={styles.agentText}>
        <Text style={styles.agentTitle} numberOfLines={1}>
          {agentDisplayName(agent)}
        </Text>
        <Text style={styles.agentMeta} numberOfLines={1}>
          {agent.provider}
        </Text>
      </View>
      <ThemedChevronRight size={16} uniProps={mutedIconMapping} />
    </Pressable>
  );
}

function AssociatedAgentRow({
  agent,
  agentId,
  onPress,
}: {
  agent: Agent | null;
  agentId: string;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={styles.associatedAgent}
      testID="review-summary-associated-agent"
    >
      <ThemedBot size={15} uniProps={mutedIconMapping} />
      <Text style={styles.associatedLabel}>{t("review.summary.associatedAgent")}</Text>
      <Text style={styles.associatedName} numberOfLines={1}>
        {agent ? agentDisplayName(agent) : t("review.summary.agentUnavailable", { agentId })}
      </Text>
      {onPress ? <ThemedChevronRight size={14} uniProps={mutedIconMapping} /> : null}
    </Pressable>
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

function agentRowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.agentRow, (hovered || pressed) && styles.agentRowHovered];
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
  associatedAgent: {
    minHeight: 36,
    marginBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  associatedLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  associatedName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  agentPicker: {
    gap: theme.spacing[1],
  },
  agentSectionLabel: {
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[1],
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
  },
  agentRow: {
    minHeight: 52,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  agentRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  agentIcon: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  agentText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  agentTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  agentMeta: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
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
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  footerCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  footerStatus: {
    gap: theme.spacing[0.5],
  },
  deliveryCounts: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
}));
