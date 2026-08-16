import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ListTree } from "lucide-react-native";

import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { MemberAvatar } from "@/components/teams/member-avatar";
import { TeamRoom } from "@/components/teams/team-room";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { MissionWorkroomView } from "@/teams/mission-workroom-view";
import type { TeamPanelMember } from "@/teams/team-panel-view";

export interface MissionWorkroomProps {
  serverId: string;
  view: MissionWorkroomView;
  roster: readonly TeamPanelMember[];
  readOnly: boolean;
  onOpenAgent?: (agentId: string) => void;
  onOpenSettings: () => void;
  onStartMission?: () => void;
  onExitReplay?: () => void;
  settingsAttentionCount?: number;
}

export function MissionWorkroom({
  serverId,
  view,
  roster,
  readOnly,
  onOpenAgent,
  onOpenSettings,
  onStartMission,
  onExitReplay,
  settingsAttentionCount = 0,
}: MissionWorkroomProps): ReactElement {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const statusVariant = missionStatusVariant(view.status);
  const inspectorHeader = useMemo(() => ({ title: t("teams.workroom.inspector") }), [t]);
  const openInspector = useCallback(() => setInspectorOpen(true), []);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);

  const inspector = (
    <MissionWorkroomInspector view={view} onOpenAgent={onOpenAgent} compact={compact} />
  );

  return (
    <View style={styles.container} testID="mission-workroom">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.objective} numberOfLines={2} testID="mission-workroom-objective">
            {view.objective}
          </Text>
          <View style={styles.metadata}>
            <StatusBadge
              label={t(`teams.v2Settings.status.${view.status}`)}
              variant={statusVariant}
            />
            <Text style={styles.workspace} numberOfLines={1} testID="mission-workroom-workspace">
              {view.workspaceLabel}
            </Text>
            {view.attentionCount > 0 ? (
              <Text style={styles.attentionCount}>
                {t("teams.workroom.attentionCount", { count: view.attentionCount })}
              </Text>
            ) : null}
          </View>
        </View>
        {compact ? (
          <Button
            size="sm"
            variant="outline"
            leftIcon={ListTree}
            onPress={openInspector}
            testID="mission-workroom-inspector-trigger"
          >
            {t("teams.workroom.details")}
          </Button>
        ) : null}
      </View>

      <View style={styles.content}>
        <View style={styles.chat}>
          <TeamRoom
            serverId={serverId}
            missionId={view.missionId}
            roster={roster}
            readOnly={readOnly}
            onOpenAgent={onOpenAgent}
            onOpenSettings={onOpenSettings}
            onStartMission={onStartMission}
            onExitReplay={onExitReplay}
            settingsAttentionCount={settingsAttentionCount}
          />
        </View>
        {compact ? null : inspector}
      </View>

      {compact ? (
        <AdaptiveModalSheet
          header={inspectorHeader}
          visible={inspectorOpen}
          onClose={closeInspector}
          scrollable={false}
          sizeContentToCurrentSnapPoint
          testID="mission-workroom-inspector-sheet"
        >
          {inspector}
        </AdaptiveModalSheet>
      ) : null}
    </View>
  );
}

function MissionWorkroomInspector({
  view,
  onOpenAgent,
  compact,
}: {
  view: MissionWorkroomView;
  onOpenAgent?: (agentId: string) => void;
  compact: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollView
      style={compact ? styles.sheetInspector : styles.inspector}
      contentContainerStyle={styles.inspectorContent}
      testID={compact ? "mission-workroom-inspector-sheet-content" : "mission-workroom-inspector"}
    >
      <InspectorSection title={t("teams.workroom.members")}>
        {view.members.map((member) => (
          <MissionMemberRow key={member.memberId} member={member} onOpenAgent={onOpenAgent} />
        ))}
      </InspectorSection>

      <InspectorSection title={t("teams.workroom.plan")}>
        {view.workstreams.length === 0 ? (
          <EmptyRow>{t("teams.workroom.noPlan")}</EmptyRow>
        ) : (
          view.workstreams.map((workstream) => (
            <View key={workstream.workstreamId} style={styles.itemRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {workstream.title}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={2}>
                  {workstream.owner.role} · {workstream.objective}
                </Text>
              </View>
              <StatusBadge label={t(`teams.v2Settings.status.${workstream.status}`)} />
            </View>
          ))
        )}
      </InspectorSection>

      <InspectorSection title={t("teams.workroom.attention")}>
        {view.attention.length === 0 ? (
          <EmptyRow>{t("teams.workroom.noAttention")}</EmptyRow>
        ) : (
          view.attention.map((item) => (
            <View key={item.attentionId} style={styles.textRow}>
              <Text style={styles.rowTitle}>{item.summary}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.workstreamTitle ?? t("teams.workroom.missionScope")}
              </Text>
            </View>
          ))
        )}
      </InspectorSection>

      <InspectorSection title={t("teams.workroom.results")}>
        {view.results.length === 0 ? (
          <EmptyRow>{t("teams.workroom.noResults")}</EmptyRow>
        ) : (
          view.results.map((result) => (
            <View key={result.id} style={styles.itemRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{result.workstreamTitle}</Text>
                <Text style={styles.rowMeta}>{result.summary}</Text>
              </View>
              <StatusBadge
                label={t(`teams.v2Settings.status.${result.status}`)}
                variant={reportStatusVariant(result.status)}
              />
            </View>
          ))
        )}
      </InspectorSection>
    </ScrollView>
  );
}

function MissionMemberRow({
  member,
  onOpenAgent,
}: {
  member: MissionWorkroomView["members"][number];
  onOpenAgent?: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const agentId = member.participantAgentId;
  const openAgent = useCallback(() => {
    if (agentId) onOpenAgent?.(agentId);
  }, [agentId, onOpenAgent]);
  const canOpenAgent = agentId !== null && onOpenAgent !== undefined;
  return (
    <View style={styles.memberRow}>
      <MemberAvatar
        agentId={agentId}
        label={member.role}
        onPress={canOpenAgent ? openAgent : undefined}
        accessibilityLabel={
          canOpenAgent ? t("teams.workroom.openAgent", { role: member.role }) : member.role
        }
        testID={agentId ? `mission-workroom-member-${agentId}` : undefined}
      />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {member.role}
          {member.isLead ? ` · ${t("teams.workroom.lead")}` : ""}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          @{member.mentionHandle}
          {member.skillNames.length > 0 ? ` · ${member.skillNames.join(", ")}` : ""}
        </Text>
      </View>
    </View>
  );
}

function missionStatusVariant(
  status: MissionWorkroomView["status"],
): "success" | "error" | "muted" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "canceled") return "error";
  return "muted";
}

function reportStatusVariant(
  status: MissionWorkroomView["results"][number]["status"],
): "success" | "error" | "muted" {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  return "muted";
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactElement | readonly ReactElement[];
}): ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionRows}>{children}</View>
    </View>
  );
}

function EmptyRow({ children }: { children: string }): ReactElement {
  return <Text style={styles.empty}>{children}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  objective: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  metadata: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  workspace: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  attentionCount: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.xs,
  },
  content: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
  },
  chat: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  inspector: {
    width: 340,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  sheetInspector: {
    flex: 1,
    minHeight: 0,
  },
  inspectorContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[6],
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
  },
  sectionRows: {
    gap: theme.spacing[2],
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  textRow: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
}));
