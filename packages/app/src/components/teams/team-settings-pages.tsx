import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Archive, ChevronRight, ExternalLink, Pencil, Play, X } from "lucide-react-native";

import type { MissionAttentionItem, TeamMission, TeamV2 } from "@getpaseo/protocol/team/v2-types";
import type { TeamMissionAttentionResolutionInput } from "@getpaseo/protocol/team/v2-rpc-schemas";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import {
  selectTeamAttentionRecovery,
  selectTeamAttentionRows,
  selectTeamMemberSettingsRows,
  selectTeamMissionHistory,
  selectTeamPlanRows,
  type TeamPlanRow,
} from "@/teams/team-settings-view";

type ReplaceLeadResolution = Omit<
  Extract<TeamMissionAttentionResolutionInput, { kind: "replace_lead" }>,
  "replacementMemberId"
> & {
  readonly replacementMemberId: string;
};

export type TeamSettingsAttentionResolution =
  | Exclude<TeamMissionAttentionResolutionInput, { kind: "replace_lead" }>
  | ReplaceLeadResolution;

type StandardTeamAttentionResolution = Extract<
  TeamSettingsAttentionResolution,
  {
    kind: "external_change" | "resume_provider" | "restore_notification" | "cancel_mission";
  }
>;

export type TeamAttentionResolutionKind = StandardTeamAttentionResolution["kind"];

export interface TeamSettingsPageActions {
  readonly onEditProfile?: () => void;
  readonly onStartMission?: () => void;
  readonly onOpenAgent?: (agentId: string) => void;
  readonly onCancelMission?: () => void;
  readonly onArchiveTeam?: () => void;
  readonly onSelectMission?: (missionId: string) => void;
  readonly onResolveAttention?: (
    attentionId: string,
    resolution: TeamSettingsAttentionResolution,
  ) => void;
  readonly pendingActionKey?: string | null;
  readonly actionError?: string | null;
}

export function teamAttentionActionKey(
  attentionId: string,
  resolution: TeamSettingsAttentionResolution,
): string {
  const prefix = `attention:${encodeURIComponent(attentionId)}:`;
  if (resolution.kind === "replace_lead") {
    return `${prefix}${resolution.kind}:${encodeURIComponent(resolution.replacementMemberId)}`;
  }
  return `${prefix}${resolution.kind}`;
}

function isAttentionActionPending(pendingActionKey?: string | null): boolean {
  return pendingActionKey?.startsWith("attention:") ?? false;
}

interface SharedPageProps {
  readonly team: TeamV2;
  readonly mission: TeamMission | null;
  readonly actions: TeamSettingsPageActions;
}

export function TeamOverviewSettingsPage({
  team,
  mission,
  actions,
}: SharedPageProps): ReactElement {
  const { t } = useTranslation();
  const lead = team.members.find((member) => member.memberId === team.leadMemberId);
  const editButton = useMemo(
    () =>
      actions.onEditProfile ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Pencil}
          accessibilityLabel={t("teams.v2Settings.team.edit")}
          onPress={actions.onEditProfile}
          testID="team-settings-edit-profile"
        />
      ) : null,
    [actions.onEditProfile, t],
  );
  return (
    <View testID="team-settings-page-team">
      <SettingsSection title={t("teams.v2Settings.team.profile")} trailing={editButton}>
        <View style={settingsStyles.card}>
          <DataRow label={t("teams.v2Settings.team.name")} value={team.name} />
          <DataRow
            bordered
            label={t("teams.v2Settings.team.lead")}
            value={
              lead
                ? `${lead.role} · @${lead.mentionHandle}`
                : t("teams.v2Settings.team.leadUnavailable")
            }
          />
          <DataRow
            bordered
            label={t("teams.v2Settings.team.lifecycle")}
            value={t(`teams.v2Settings.lifecycle.${team.lifecycle}`)}
          />
          <DataRow
            bordered
            label={t("teams.v2Settings.team.currentMission")}
            value={mission?.objective ?? t("teams.v2Settings.mission.none")}
          />
        </View>
      </SettingsSection>

      <SettingsSection title={t("teams.v2Settings.team.skills")} flush>
        <View style={settingsStyles.card}>
          {team.skills.map((skill, index) => (
            <DataRow
              key={skill.skillId}
              bordered={index > 0}
              label={skill.name}
              value={skill.description ?? t("teams.v2Settings.team.noSkillDescription")}
            />
          ))}
        </View>
      </SettingsSection>
    </View>
  );
}

export function TeamMembersSettingsPage({ team, mission, actions }: SharedPageProps): ReactElement {
  const { t } = useTranslation();
  const rows = selectTeamMemberSettingsRows(team, mission);
  const editButton = useMemo(
    () =>
      actions.onEditProfile ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Pencil}
          accessibilityLabel={t("teams.v2Settings.members.edit")}
          onPress={actions.onEditProfile}
          testID="team-settings-edit-members"
        />
      ) : null,
    [actions.onEditProfile, t],
  );
  return (
    <View testID="team-settings-page-members">
      <SettingsSection
        title={t("teams.v2Settings.members.title", { count: rows.length })}
        trailing={editButton}
        flush
      >
        {rows.map((row) => (
          <MemberSettingsCard key={row.memberId} row={row} onOpenAgent={actions.onOpenAgent} />
        ))}
      </SettingsSection>
    </View>
  );
}

export interface TeamMissionSettingsPageProps extends SharedPageProps {
  readonly history: readonly TeamMission[];
  readonly historyStatus: "idle" | "loading" | "ready" | "failed";
}

export function TeamMissionSettingsPage({
  team,
  mission,
  history,
  historyStatus,
  actions,
}: TeamMissionSettingsPageProps): ReactElement {
  const { t } = useTranslation();
  const visibleHistory = selectTeamMissionHistory(history, mission);
  let historyNode: ReactNode;
  if (historyStatus === "loading") {
    historyNode = <DataRow label={t("common.states.loading")} value="" />;
  } else if (visibleHistory.length === 0) {
    historyNode = <DataRow label={t("teams.v2Settings.mission.noHistory")} value="" />;
  } else {
    historyNode = visibleHistory.map((item, index) => (
      <HistoryMissionRow
        key={item.id}
        bordered={index > 0}
        mission={item}
        onSelect={actions.onSelectMission}
      />
    ));
  }

  return (
    <View testID={mission ? "team-settings-page-mission" : "team-settings-page-mission-empty"}>
      {mission ? (
        <SettingsSection title={t("teams.v2Settings.mission.current")}>
          <View style={settingsStyles.card}>
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>{mission.objective}</Text>
                <Text style={settingsStyles.rowHint}>
                  {t("teams.v2Settings.mission.revision", { revision: mission.planRevision })}
                </Text>
              </View>
              <StatusBadge
                label={t(`teams.v2Settings.status.${mission.status}`)}
                variant={mission.status === "completed" ? "success" : undefined}
              />
            </View>
            <StringListRow
              label={t("teams.v2Settings.mission.acceptance")}
              values={mission.acceptanceCriteria}
            />
            <StringListRow
              label={t("teams.v2Settings.mission.constraints")}
              values={mission.constraints}
            />
          </View>
        </SettingsSection>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("teams.v2Settings.mission.none")}</Text>
          {team.lifecycle === "active" && actions.onStartMission ? (
            <Button
              variant="default"
              size="md"
              leftIcon={Play}
              onPress={actions.onStartMission}
              testID="team-settings-start-mission"
            >
              {t("teams.v2Settings.mission.start")}
            </Button>
          ) : null}
        </View>
      )}

      <SettingsSection title={t("teams.v2Settings.mission.history")}>
        <View style={settingsStyles.card} testID="team-mission-history">
          {historyNode}
        </View>
      </SettingsSection>

      {!mission || isMissionTerminal(mission) || !actions.onCancelMission ? null : (
        <SettingsSection title={t("teams.v2Settings.lifecycle.actions")} flush>
          <Button
            variant="outline"
            size="sm"
            leftIcon={X}
            loading={actions.pendingActionKey === "cancel-mission"}
            onPress={actions.onCancelMission}
            testID="team-settings-cancel-mission"
          >
            {t("teams.v2Settings.mission.cancel")}
          </Button>
        </SettingsSection>
      )}
      <ActionError message={actions.actionError} />
    </View>
  );
}

export function TeamPlanSettingsPage({ team, mission }: SharedPageProps): ReactElement {
  const { t } = useTranslation();
  const rows = selectTeamPlanRows(team, mission);
  if (!mission || rows.length === 0) {
    return (
      <View style={styles.empty} testID="team-settings-page-plan-empty">
        <Text style={styles.emptyTitle}>
          {mission?.status === "planning"
            ? t("teams.v2Settings.plan.planning")
            : t("teams.v2Settings.plan.none")}
        </Text>
      </View>
    );
  }
  return (
    <View testID="team-settings-page-plan">
      <SettingsSection title={t("teams.v2Settings.plan.title")} flush>
        {rows.map((row) => (
          <WorkstreamCard key={row.workstreamId} row={row} />
        ))}
      </SettingsSection>
    </View>
  );
}

export interface TeamAttentionSettingsPageProps extends SharedPageProps {
  readonly permissionRows: ReactNode;
  readonly pendingPermissionCount: number;
}

export function TeamAttentionSettingsPage({
  team,
  mission,
  actions,
  permissionRows,
  pendingPermissionCount,
}: TeamAttentionSettingsPageProps): ReactElement {
  const { t } = useTranslation();
  const attentionRows = selectTeamAttentionRows(mission);
  const recovery = selectTeamAttentionRecovery(mission);
  return (
    <View testID="team-settings-page-attention">
      {pendingPermissionCount > 0 ? (
        <SettingsSection title={t("teams.v2Settings.attention.permissions")}>
          {permissionRows}
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("teams.v2Settings.attention.title")}>
        {attentionRows.length === 0 ? (
          <View style={settingsStyles.card}>
            <DataRow label={t("teams.v2Settings.attention.none")} value="" />
          </View>
        ) : (
          attentionRows.map((row) => {
            let replacementActions: ReactNode = null;
            if (row.kind === "lead_unavailable" && actions.onResolveAttention) {
              replacementActions =
                recovery.replacementMembers.length > 0 ? (
                  recovery.replacementMembers.map((member) => (
                    <LeadReplacementButton
                      key={member.memberId}
                      attentionId={row.attentionId}
                      member={member}
                      actions={actions}
                    />
                  ))
                ) : (
                  <Text
                    style={settingsStyles.rowHint}
                    testID={`team-attention-${row.attentionId}-no-replacements`}
                  >
                    {t("teams.v2Settings.attention.noReplacementLead")}
                  </Text>
                );
            }
            return (
              <View key={row.attentionId} style={settingsStyles.card}>
                <View style={settingsStyles.row}>
                  <View style={settingsStyles.rowContent}>
                    <Text style={settingsStyles.rowTitle}>{row.summary}</Text>
                    <Text style={settingsStyles.rowHint}>
                      {t(`teams.v2Settings.attention.kind.${row.kind}`)}
                    </Text>
                  </View>
                </View>
                <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.actionWrap]}>
                  {replacementActions}
                  {requiresLeadRecovery(row.kind) ? (
                    <LeadRecoveryAction
                      attentionId={row.attentionId}
                      leadAgentId={recovery.leadAgentId}
                      actions={actions}
                    />
                  ) : null}
                  {actions.onResolveAttention
                    ? resolutionKindsFor(row.kind).map((kind) => (
                        <AttentionResolutionButton
                          key={kind}
                          attentionId={row.attentionId}
                          kind={kind}
                          actions={actions}
                        />
                      ))
                    : null}
                </View>
              </View>
            );
          })
        )}
      </SettingsSection>

      {team.lifecycleRecoveryFailure ? (
        <SettingsSection title={t("teams.v2Settings.lifecycle.recovery")}>
          <View style={settingsStyles.card}>
            <DataRow
              label={team.lifecycleRecoveryFailure.message}
              value={team.lifecycleRecoveryFailure.code}
            />
          </View>
        </SettingsSection>
      ) : null}

      {team.lifecycle === "active" && actions.onArchiveTeam ? (
        <SettingsSection title={t("teams.v2Settings.lifecycle.archive")} flush>
          <Button
            variant="outline"
            size="sm"
            leftIcon={Archive}
            loading={actions.pendingActionKey === "archive-team"}
            onPress={actions.onArchiveTeam}
            testID="team-settings-archive-team"
          >
            {t("teams.v2Settings.lifecycle.archiveAction")}
          </Button>
        </SettingsSection>
      ) : null}
      <ActionError message={actions.actionError} />
    </View>
  );
}

function WorkstreamCard({ row }: { row: TeamPlanRow }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.card} testID={`team-workstream-${row.workstreamId}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{row.title}</Text>
          <Text style={settingsStyles.rowHint}>{row.objective}</Text>
        </View>
        <StatusBadge label={t(`teams.v2Settings.status.${row.status}`)} />
      </View>
      <DataRow
        bordered
        label={t("teams.v2Settings.plan.owner")}
        value={`${row.owner.role} · @${row.owner.mentionHandle}`}
      />
      {row.reviewer ? (
        <DataRow
          bordered
          label={t("teams.v2Settings.plan.reviewer")}
          value={`${row.reviewer.role} · @${row.reviewer.mentionHandle}`}
        />
      ) : null}
      <DataRow
        bordered
        label={t("teams.v2Settings.plan.scope")}
        value={describeScope(row.scope, t)}
      />
      <DataRow
        bordered
        label={t("teams.v2Settings.plan.assignments")}
        value={
          row.assignmentStates.length > 0
            ? row.assignmentStates.map((state) => t(`teams.v2Settings.status.${state}`)).join(", ")
            : "—"
        }
      />
      {row.artifactPaths.length > 0 ? (
        <StringListRow label={t("teams.v2Settings.plan.artifacts")} values={row.artifactPaths} />
      ) : null}
    </View>
  );
}

function HistoryMissionRow({
  mission,
  bordered,
  onSelect,
}: {
  mission: TeamMission;
  bordered: boolean;
  onSelect?: (missionId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect?.(mission.id), [mission.id, onSelect]);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onSelect}
      onPress={select}
      style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}
      testID={`team-mission-history-${mission.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{mission.objective}</Text>
        <Text style={settingsStyles.rowHint}>{t(`teams.v2Settings.status.${mission.status}`)}</Text>
      </View>
      {onSelect ? <ThemedChevronRight size={16} /> : null}
    </Pressable>
  );
}

function MemberSettingsCard({
  row,
  onOpenAgent,
}: {
  row: ReturnType<typeof selectTeamMemberSettingsRows>[number];
  onOpenAgent?: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => {
    if (row.participantAgentId) onOpenAgent?.(row.participantAgentId);
  }, [onOpenAgent, row.participantAgentId]);
  return (
    <View style={settingsStyles.card} testID={`team-member-${row.memberId}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <View style={styles.titleLine}>
            <Text style={settingsStyles.rowTitle}>{row.role}</Text>
            {row.isLead ? <StatusBadge label={t("teams.v2Settings.members.lead")} /> : null}
          </View>
          <Text style={settingsStyles.rowHint}>
            {t("teams.v2Settings.members.identity", {
              handle: row.mentionHandle,
              level: row.level,
            })}
          </Text>
        </View>
        {row.participantAgentId && onOpenAgent ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={ExternalLink}
            accessibilityLabel={t("teams.v2Settings.members.openAgent")}
            onPress={open}
            testID={`team-member-${row.memberId}-open`}
          />
        ) : null}
      </View>
      <DataRow
        bordered
        label={t("teams.v2Settings.members.skills")}
        value={row.skillNames.join(", ")}
      />
      <DataRow
        bordered
        label={t("teams.v2Settings.members.execution")}
        value={[row.provider, row.model].filter(Boolean).join(" · ")}
      />
      <DataRow
        bordered
        label={t("teams.v2Settings.members.participant")}
        value={t(`teams.v2Settings.participant.${row.participantState}`)}
      />
    </View>
  );
}

function AttentionResolutionButton({
  attentionId,
  kind,
  actions,
}: {
  attentionId: string;
  kind: TeamAttentionResolutionKind;
  actions: TeamSettingsPageActions;
}): ReactElement {
  const { t } = useTranslation();
  const reason = t("teams.v2Settings.attention.resolutionReason", {
    resolution: t(`teams.v2Settings.attention.resolution.${kind}`),
  });
  const resolution = standardAttentionResolution(kind, reason);
  const resolve = useCallback(
    () => actions.onResolveAttention?.(attentionId, resolution),
    [actions, attentionId, resolution],
  );
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isAttentionActionPending(actions.pendingActionKey)}
      loading={actions.pendingActionKey === teamAttentionActionKey(attentionId, resolution)}
      onPress={resolve}
      testID={`team-attention-${attentionId}-${kind}`}
    >
      {t(`teams.v2Settings.attention.resolution.${kind}`)}
    </Button>
  );
}

function LeadReplacementButton({
  attentionId,
  member,
  actions,
}: {
  attentionId: string;
  member: ReturnType<typeof selectTeamAttentionRecovery>["replacementMembers"][number];
  actions: TeamSettingsPageActions;
}): ReactElement {
  const { t } = useTranslation();
  const reason = t("teams.v2Settings.attention.replaceLeadReason", {
    member: `@${member.mentionHandle}`,
  });
  const resolution = useMemo(
    () => ({ kind: "replace_lead" as const, replacementMemberId: member.memberId, reason }),
    [member.memberId, reason],
  );
  const resolve = useCallback(
    () => actions.onResolveAttention?.(attentionId, resolution),
    [actions, attentionId, resolution],
  );
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isAttentionActionPending(actions.pendingActionKey)}
      loading={actions.pendingActionKey === teamAttentionActionKey(attentionId, resolution)}
      onPress={resolve}
      testID={`team-attention-${attentionId}-replace-${member.memberId}`}
    >
      {`${member.role} · @${member.mentionHandle}`}
    </Button>
  );
}

function LeadRecoveryAction({
  attentionId,
  leadAgentId,
  actions,
}: {
  attentionId: string;
  leadAgentId: string | null;
  actions: TeamSettingsPageActions;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => {
    if (leadAgentId) actions.onOpenAgent?.(leadAgentId);
  }, [actions, leadAgentId]);
  if (!leadAgentId || !actions.onOpenAgent) {
    return (
      <Text
        style={settingsStyles.rowHint}
        testID={`team-attention-${attentionId}-lead-unavailable`}
      >
        {t("teams.v2Settings.attention.activeLeadUnavailable")}
      </Text>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={ExternalLink}
      disabled={isAttentionActionPending(actions.pendingActionKey)}
      onPress={open}
      testID={`team-attention-${attentionId}-open-lead`}
    >
      {t("teams.v2Settings.attention.openLead")}
    </Button>
  );
}

function DataRow({
  label,
  value,
  bordered = false,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}): ReactElement {
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {value ? <Text style={settingsStyles.rowHint}>{value}</Text> : null}
      </View>
    </View>
  );
}

function StringListRow({
  label,
  values,
}: {
  label: string;
  values: readonly string[];
}): ReactElement {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {values.map((value) => (
          <Text key={value} style={settingsStyles.rowHint}>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}

function ActionError({ message }: { message?: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <Text style={styles.error} testID="team-settings-action-error">
      {message}
    </Text>
  );
}

function isMissionTerminal(mission: TeamMission): boolean {
  return ["completed", "failed", "canceled"].includes(mission.status);
}

function resolutionKindsFor(kind: MissionAttentionItem["kind"]): TeamAttentionResolutionKind[] {
  switch (kind) {
    case "ownership_violation":
      return ["external_change", "cancel_mission"];
    case "provider_unavailable":
      return ["resume_provider", "cancel_mission"];
    case "notification_unacknowledged":
      return ["restore_notification", "cancel_mission"];
    case "lead_unavailable":
    case "missing_report":
    case "assignment_requires_replan":
    case "dispatch_acceptance_unknown":
    case "participant_unavailable":
    case "reviewer_unavailable":
      return ["cancel_mission"];
  }
}

function standardAttentionResolution(
  kind: TeamAttentionResolutionKind,
  reason: string,
): StandardTeamAttentionResolution {
  switch (kind) {
    case "external_change":
      return { kind: "external_change", reason };
    case "resume_provider":
      return { kind: "resume_provider", reason };
    case "restore_notification":
      return { kind: "restore_notification", reason };
    case "cancel_mission":
      return { kind: "cancel_mission", reason };
  }
}

function requiresLeadRecovery(kind: MissionAttentionItem["kind"]): boolean {
  return (
    kind === "missing_report" ||
    kind === "assignment_requires_replan" ||
    kind === "participant_unavailable" ||
    kind === "reviewer_unavailable"
  );
}

function describeScope(
  scope: TeamPlanRow["scope"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (scope.kind === "read_only") return t("teams.v2Settings.plan.readOnly");
  if (scope.kind === "workspace") return t("teams.v2Settings.plan.workspaceScope");
  return scope.pathPrefixes.join(", ");
}

const styles = StyleSheet.create((theme) => ({
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  actionWrap: {
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
    gap: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
}));

const ThemedChevronRight = withUnistyles(ChevronRight, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
