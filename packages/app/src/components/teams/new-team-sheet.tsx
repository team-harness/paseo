import { useCallback, useMemo, useSyncExternalStore, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { submitTeamForm } from "@/teams/submit-team-form";
import type {
  TeamFormMemberRow,
  TeamFormModel,
  TeamFormProviderOption,
  TeamFormSnapshot,
  TeamFormState,
} from "@/teams/team-form-model";
import { useTeamFormModel } from "@/teams/use-team-form-model";
import { useTeamFormProviderSnapshot } from "@/teams/use-team-form-provider-snapshot";

export interface NewTeamSheetProps {
  serverId: string;
  workspaceId: string | null;
  workspaceDisplay: string | null;
  /** Where the daemon resolves providers from. */
  cwd: string;
  visible: boolean;
  onClose: () => void;
  onCreated?: (teamId: string) => void;
}

/**
 * Mounts a fresh form per open.
 *
 * Returning null while closed unmounts the subtree, and that is what makes each
 * open a new form. One instance living across opens is how a previous attempt's
 * input — and its idempotency key — leak into the next one.
 */
export function NewTeamSheet(props: NewTeamSheetProps): ReactElement | null {
  if (!props.visible) return null;
  // Keyed by host: the form freezes its snapshot at mount, so an instance
  // reused across a host change would submit one daemon's workspace id to
  // another's client, with its provider list quietly frozen.
  return <OpenNewTeamSheet key={props.serverId} {...props} />;
}

function OpenNewTeamSheet({
  serverId,
  workspaceId,
  workspaceDisplay,
  cwd,
  visible,
  onClose,
  onCreated,
}: NewTeamSheetProps): ReactElement {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const client = useHostRuntimeClient(serverId);

  const snapshot = useMemo<TeamFormSnapshot>(
    () => ({
      serverId,
      workspaceId,
      workspaceDisplay,
      template: null,
      newIdempotencyKey: () => `app-${crypto.randomUUID()}`,
      newRowKey: () => crypto.randomUUID(),
    }),
    // Deliberately built once for this mount: the model reads it at construction
    // and takes late data through inputs, not through a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const model = useTeamFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useTeamFormProviderSnapshot(model, state, cwd);

  const submit = useCallback(() => {
    if (!client) {
      // The menu entry is gated on the daemon's feature, not on the connection,
      // so this is reachable — and a confirmed create that does nothing at all
      // reads as one that worked.
      model.submitFailed({ message: t("common.errors.daemonClientUnavailable"), retryable: true });
      return;
    }
    void (async () => {
      await submitTeamForm(
        model,
        { createTeam: (input) => client.createTeam(input) },
        {
          keyReused: t("teams.form.keyReused"),
          refused: t("teams.form.refused"),
          neverStarted: t("teams.form.neverStarted"),
        },
      );
      const result = model.getState().submission;
      if (result.status === "success") onCreated?.(result.teamId);
    })();
  }, [client, model, onCreated, t]);

  const header = useMemo<SheetHeader>(() => ({ title: t("teams.form.title") }), [t]);

  return (
    <AdaptiveModalSheet visible={visible} onClose={onClose} header={header}>
      {state.step === "compose" ? (
        <ComposeStep model={model} state={state} size={controlSize} />
      ) : (
        <ConfirmStep state={state} onBack={model.backToCompose} onSubmit={submit} />
      )}
    </AdaptiveModalSheet>
  );
}

function ComposeStep({
  model,
  state,
  size,
}: {
  model: TeamFormModel;
  state: TeamFormState;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const providerOptions = useMemo<Array<SelectFieldOption<string>>>(
    () =>
      state.providerOptions.map((option: TeamFormProviderOption) => ({
        id: option.provider,
        value: option.provider,
        label: option.label,
      })),
    [state.providerOptions],
  );
  // Waiting for the list is a state, not an empty list: a picker that cannot
  // tell them apart says "no providers" to someone who has several.
  const loadingProviders = state.providerResolution !== "complete";
  const leadDisplay = useMemo(
    () => (state.leadProviderDisplay ? { label: state.leadProviderDisplay } : null),
    [state.leadProviderDisplay],
  );
  const setLead = useCallback(
    (value: string, option: { label: string } | null) =>
      model.setLeadProvider(value, option?.label ?? null),
    [model],
  );

  return (
    <View style={styles.body}>
      <Field label={t("teams.form.name")}>
        <FormTextInput
          value={state.name}
          onChangeText={model.setName}
          placeholder={t("teams.form.namePlaceholder")}
          testID="team-form-name"
        />
      </Field>

      <Field label={t("teams.form.task")}>
        <FormTextInput
          value={state.task}
          onChangeText={model.setTask}
          placeholder={t("teams.form.taskPlaceholder")}
          multiline
          testID="team-form-task"
        />
      </Field>

      <SelectField
        label={t("teams.form.lead")}
        value={state.leadProvider}
        selectedDisplay={leadDisplay}
        options={providerOptions}
        loading={loadingProviders}
        onChange={setLead}
        placeholder={t("teams.form.provider")}
        emptyText={t("teams.form.noProviders")}
        size={size}
        testID="team-form-lead"
      />

      {state.members.map((member, index) => (
        <MemberRow
          key={member.key}
          member={member}
          index={index}
          model={model}
          providerOptions={providerOptions}
          loadingProviders={loadingProviders}
          size={size}
        />
      ))}

      <Button
        variant="secondary"
        disabled={!state.canAddMember}
        onPress={model.addMember}
        testID="team-form-add-member"
      >
        {t("teams.form.addMember")}
      </Button>

      <Button disabled={!state.canSubmit} onPress={model.review} testID="team-form-review">
        {t("teams.form.review")}
      </Button>
    </View>
  );
}

function MemberRow({
  member,
  index,
  model,
  providerOptions,
  loadingProviders,
  size,
}: {
  member: TeamFormMemberRow;
  index: number;
  model: TeamFormModel;
  providerOptions: Array<SelectFieldOption<string>>;
  loadingProviders: boolean;
  size: FieldControlSize;
}): ReactElement {
  const display = useMemo(
    () => (member.providerDisplay ? { label: member.providerDisplay } : null),
    [member.providerDisplay],
  );
  const setRole = useCallback(
    (value: string) => model.setMemberRole(member.key, value),
    [model, member.key],
  );
  const setProvider = useCallback(
    (value: string, option: { label: string } | null) =>
      model.setMemberProvider(member.key, value, option?.label ?? null),
    [model, member.key],
  );
  const remove = useCallback(() => model.removeMember(member.key), [model, member.key]);
  const { t } = useTranslation();

  return (
    <View style={styles.member} testID={`team-form-member-${index}`}>
      <Field label={t("teams.form.role")}>
        <FormTextInput
          value={member.role}
          onChangeText={setRole}
          placeholder={t("teams.form.rolePlaceholder")}
          testID={`team-form-member-${index}-role`}
        />
      </Field>
      <SelectField
        label={t("teams.form.provider")}
        value={member.provider}
        selectedDisplay={display}
        options={providerOptions}
        loading={loadingProviders}
        onChange={setProvider}
        placeholder={t("teams.form.provider")}
        emptyText={t("teams.form.noProviders")}
        size={size}
        testID={`team-form-member-${index}-provider`}
      />
      <Button variant="ghost" onPress={remove} testID={`team-form-member-${index}-remove`}>
        {t("teams.form.removeMember")}
      </Button>
    </View>
  );
}

function ConfirmStep({
  state,
  onBack,
  onSubmit,
}: {
  state: TeamFormState;
  onBack: () => void;
  onSubmit: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const submission = state.submission;
  return (
    <View style={styles.body}>
      <Text style={styles.summary} testID="team-form-cost">
        {t("teams.form.cost", { agents: state.agentCount, members: state.memberCount })}
      </Text>

      {submission.status === "failure" ? (
        <Text style={styles.error} testID="team-form-error">
          {submission.message}
        </Text>
      ) : null}
      {submission.status === "success" ? (
        <Text style={styles.summary} testID="team-form-success">
          {t("teams.form.created")}
        </Text>
      ) : null}

      <Button variant="secondary" onPress={onBack} testID="team-form-back">
        {t("teams.form.back")}
      </Button>
      <Button
        disabled={!state.canSubmit}
        loading={submission.status === "pending"}
        onPress={onSubmit}
        testID="team-form-submit"
      >
        {t("teams.form.submit")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  member: {
    gap: theme.spacing[2],
  },
  summary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
