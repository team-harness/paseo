import React, { useCallback, useMemo, useSyncExternalStore, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { resolveTeamMissionsAccess } from "@/teams/team-missions-access";
import type {
  MissionStartFormModel,
  MissionStartFormRow,
  MissionStartFormSnapshot,
  MissionStartFormState,
} from "@/teams/mission-start-form-model";
import { submitMissionStartForm } from "@/teams/submit-mission-start-form";
import { useMissionStartFormModel } from "@/teams/use-mission-start-form-model";

export interface MissionStartSheetProps {
  serverId: string;
  workspaceId: string;
  selectedTeamId?: string | null;
  visible: boolean;
  onClose: () => void;
  onStarted?: (teamId: string) => void;
}

function createLocalKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function openKey(props: MissionStartSheetProps): string {
  return `${props.serverId}:${props.workspaceId}:${props.selectedTeamId ?? "select"}`;
}

export function MissionStartSheet(props: MissionStartSheetProps): ReactElement | null {
  if (!props.visible) return null;
  return <OpenMissionStartSheet key={openKey(props)} {...props} />;
}

function OpenMissionStartSheet({
  serverId,
  workspaceId,
  selectedTeamId,
  visible,
  onClose,
  onStarted,
}: MissionStartSheetProps): ReactElement {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const client = useHostRuntimeClient(serverId);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo);
  const profileMap = useSessionStore(
    (state) => state.sessions[serverId]?.teamMissionsReplica.profiles,
  );
  const teams = useMemo(
    () =>
      [...(profileMap?.values() ?? [])].filter(
        (profile) => profile.workspaceId === workspaceId && profile.lifecycle !== "archived",
      ),
    [profileMap, workspaceId],
  );
  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  );
  const access = resolveTeamMissionsAccess(serverInfo);
  const snapshot = useMemo<MissionStartFormSnapshot>(
    () => ({
      serverId,
      workspaceId,
      access,
      selectedTeam,
      teams,
      newRowKey: () => createLocalKey("row"),
      newIdempotencyKey: () => createLocalKey("app"),
    }),
    [access, selectedTeam, serverId, teams, workspaceId],
  );
  const model = useMissionStartFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);

  const submit = useCallback(() => {
    if (!client) {
      model.submitFailed({
        message: t("common.errors.daemonClientUnavailable"),
        retryable: true,
      });
      return;
    }
    void submitMissionStartForm(
      model,
      { startTeamMission: (input) => client.startTeamMission(input) },
      t("teams.v2.missionStart.startFailed"),
    ).then((target) => {
      if (target) onStarted?.(target.teamId);
      return target;
    });
  }, [client, model, onStarted, t]);

  const header = useMemo<SheetHeader>(() => ({ title: t("teams.v2.missionStart.title") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footerActions}>
        <Button variant="ghost" size={size} onPress={onClose}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size={size}
          disabled={!state.canSubmit}
          loading={state.submission.status === "pending"}
          onPress={submit}
          testID="mission-start-submit"
        >
          {t("teams.v2.missionStart.startAction")}
        </Button>
      </View>
    ),
    [onClose, size, state.canSubmit, state.submission.status, submit, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      footer={footer}
      snapPoints={["72%", "92%"]}
      desktopMaxWidth={600}
      contentStyle={styles.body}
      testID="mission-start-sheet"
    >
      <MissionFields model={model} state={state} size={size} />
    </AdaptiveModalSheet>
  );
}

function MissionFields({
  model,
  state,
  size,
}: {
  model: MissionStartFormModel;
  state: MissionStartFormState;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const teamOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.teamOptions
        .filter((option) => option.available)
        .map((option) => ({
          id: option.teamId,
          value: option.teamId,
          label: option.display,
        })),
    [state.teamOptions],
  );
  const selectedTeam = teamOptions.find((option) => option.value === state.selectedTeamId) ?? null;
  const selectedTeamDisplay = useMemo(
    () => (selectedTeam ? { label: selectedTeam.label } : null),
    [selectedTeam],
  );

  return (
    <>
      <SelectField
        label={t("teams.v2.missionStart.team")}
        value={state.selectedTeamId}
        selectedDisplay={selectedTeamDisplay}
        options={teamOptions}
        onChange={model.selectTeam}
        placeholder={t("teams.v2.missionStart.selectTeam")}
        emptyText={t("teams.v2.missionStart.noAvailableTeams")}
        loading={state.access === "checking_host"}
        disabled={state.access !== "supported" || state.submission.status === "pending"}
        error={state.staleTeam ? t("teams.v2.missionStart.teamChanged") : null}
        size={size}
        testID="mission-start-team"
      />

      <Field label={t("teams.v2.missionStart.objective")}>
        <FormTextInput
          value={state.objective}
          onChangeText={model.setObjective}
          placeholder={t("teams.v2.missionStart.objectivePlaceholder")}
          multiline
          size={size}
          testID="mission-start-objective"
        />
      </Field>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("teams.v2.missionStart.constraints")}</Text>
        {state.constraints.map((constraint, index) => (
          <MissionConstraintRow
            key={constraint.key}
            model={model}
            row={constraint}
            index={index}
            size={size}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onPress={model.addConstraint}
          testID="mission-start-add-constraint"
        >
          {t("teams.v2.missionStart.addConstraint")}
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("teams.v2.missionStart.acceptanceCriteria")}</Text>
        {state.acceptanceCriteria.map((criterion, index) => (
          <MissionAcceptanceRow
            key={criterion.key}
            model={model}
            row={criterion}
            index={index}
            size={size}
            removable={state.acceptanceCriteria.length > 1}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onPress={model.addAcceptanceCriterion}
          testID="mission-start-add-acceptance"
        >
          {t("teams.v2.missionStart.addAcceptance")}
        </Button>
      </View>

      {state.access === "upgrade_required" ? (
        <Text style={styles.error}>{t("teams.v2.missionStart.updateHost")}</Text>
      ) : null}
      {state.submission.status === "failure" ? (
        <Text style={styles.error} testID="mission-start-error">
          {state.submission.message}
        </Text>
      ) : null}
    </>
  );
}

function MissionConstraintRow({
  model,
  row,
  index,
  size,
}: {
  model: MissionStartFormModel;
  row: MissionStartFormRow;
  index: number;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const changeValue = useCallback(
    (value: string) => model.setConstraint(row.key, value),
    [model, row.key],
  );
  const remove = useCallback(() => model.removeConstraint(row.key), [model, row.key]);
  return (
    <View style={styles.dynamicRow}>
      <View style={styles.dynamicInput}>
        <FormTextInput
          value={row.value}
          onChangeText={changeValue}
          placeholder={t("teams.v2.missionStart.constraintPlaceholder")}
          size={size}
          testID={`mission-start-constraint-${index}`}
        />
      </View>
      <Button
        variant="ghost"
        size="sm"
        onPress={remove}
        testID={`mission-start-constraint-${index}-remove`}
      >
        {t("common.actions.remove")}
      </Button>
    </View>
  );
}

function MissionAcceptanceRow({
  model,
  row,
  index,
  size,
  removable,
}: {
  model: MissionStartFormModel;
  row: MissionStartFormRow;
  index: number;
  size: FieldControlSize;
  removable: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const changeValue = useCallback(
    (value: string) => model.setAcceptanceCriterion(row.key, value),
    [model, row.key],
  );
  const remove = useCallback(() => model.removeAcceptanceCriterion(row.key), [model, row.key]);
  return (
    <View style={styles.dynamicRow}>
      <View style={styles.dynamicInput}>
        <FormTextInput
          value={row.value}
          onChangeText={changeValue}
          placeholder={t("teams.v2.missionStart.acceptancePlaceholder")}
          size={size}
          testID={`mission-start-acceptance-${index}`}
        />
      </View>
      {removable ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={remove}
          testID={`mission-start-acceptance-${index}-remove`}
        >
          {t("common.actions.remove")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[6],
  },
  footerActions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  section: {
    gap: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  dynamicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  dynamicInput: {
    flex: 1,
    minWidth: 0,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
}));
