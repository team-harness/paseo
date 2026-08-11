import React, {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  SelectField,
  SelectFieldTrigger,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { formatAgentModeLabel, formatThinkingOptionLabel } from "@/agent-controls/labels";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { submitTeamProfileForm } from "@/teams/submit-team-profile-form";
import type {
  TeamProfileFormModel,
  TeamProfileFormSnapshot,
  TeamProfileFormState,
  TeamProfileMemberRow,
  TeamProfileSkillRow,
} from "@/teams/team-profile-form-model";
import { useTeamProfileFormModel } from "@/teams/use-team-profile-form-model";
import { useTeamProfileFormProviderSnapshot } from "@/teams/use-team-profile-form-provider-snapshot";

export interface TeamProfileFormSheetProps {
  serverId: string;
  workspaceId: string;
  cwd: string;
  profile?: TeamV2;
  visible: boolean;
  onClose: () => void;
  onSaved?: (teamId: string) => void;
}

function createLocalKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function openKey(props: TeamProfileFormSheetProps): string {
  return props.profile ? `edit:${props.serverId}:${props.profile.id}` : `create:${props.serverId}`;
}

/** A fresh Team profile form for each open; live provider data enters through the model adapter. */
export function TeamProfileFormSheet(props: TeamProfileFormSheetProps): ReactElement | null {
  if (!props.visible) return null;
  return <OpenTeamProfileFormSheet key={openKey(props)} {...props} />;
}

function OpenTeamProfileFormSheet({
  serverId,
  workspaceId,
  cwd,
  profile,
  visible,
  onClose,
  onSaved,
}: TeamProfileFormSheetProps): ReactElement {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const client = useHostRuntimeClient(serverId);
  const snapshot = useMemo<TeamProfileFormSnapshot>(
    () => ({
      ...(profile ? { mode: "edit" as const, profile } : { mode: "create" as const, workspaceId }),
      hostSnapshot: { workspaceId, serverId, cwd },
      newRowKey: () => createLocalKey("row"),
      newIdempotencyKey: () => createLocalKey("app"),
    }),
    // A mounted form owns one immutable open snapshot; late providers use applyProviderSnapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const model = useTeamProfileFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const providers = useTeamProfileFormProviderSnapshot(model, state);

  const submit = useCallback(() => {
    if (!client) {
      model.submitFailed({
        message: t("common.errors.daemonClientUnavailable"),
        outcome: "definite",
      });
      return;
    }
    void submitTeamProfileForm(
      model,
      {
        createTeamProfile: (input) => client.createTeamProfile(input),
        updateTeamProfile: (input) => client.updateTeamProfile(input),
      },
      { refused: t("teams.v2.profile.saveFailed") },
    ).then((target) => {
      if (target) onSaved?.(target.teamId);
      return target;
    });
  }, [client, model, onSaved, t]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: profile ? t("teams.v2.profile.editTitle") : t("teams.v2.profile.createTitle"),
    }),
    [profile, t],
  );
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
          testID="team-profile-submit"
        >
          {profile ? t("common.actions.save") : t("teams.v2.profile.createAction")}
        </Button>
      </View>
    ),
    [onClose, profile, size, state.canSubmit, state.submission.status, submit, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      footer={footer}
      desktopMaxWidth={640}
      snapPoints={["80%", "94%"]}
      contentStyle={styles.body}
      testID="team-profile-form-sheet"
    >
      <Field label={t("teams.v2.profile.name")}>
        <FormTextInput
          value={state.name}
          onChangeText={model.setName}
          placeholder={t("teams.v2.profile.namePlaceholder")}
          size={size}
          testID="team-profile-name"
        />
      </Field>

      <FormSection title={t("teams.v2.profile.skills")}>
        {state.skills.map((skill, index) => (
          <SkillFields
            key={skill.key}
            model={model}
            state={state}
            skill={skill}
            index={index}
            size={size}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onPress={model.addSkill}
          testID="team-profile-add-skill"
        >
          {t("teams.v2.profile.addSkill")}
        </Button>
      </FormSection>

      <FormSection title={t("teams.v2.profile.members")}>
        {state.members.map((member, index) => (
          <MemberFields
            key={member.key}
            serverId={serverId}
            model={model}
            state={state}
            member={member}
            index={index}
            size={size}
            providerLoading={providers.isLoading || providers.isFetching}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onPress={model.addMember}
          testID="team-profile-add-member"
        >
          {t("teams.v2.profile.addMember")}
        </Button>
      </FormSection>

      <LeadField model={model} state={state} size={size} />

      {state.submission.status === "failure" ? (
        <Text style={styles.error} testID="team-profile-error">
          {state.submission.message}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function toSkillId(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function FormSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SkillFields({
  model,
  state,
  skill,
  index,
  size,
}: {
  model: TeamProfileFormModel;
  state: TeamProfileFormState;
  skill: TeamProfileSkillRow;
  index: number;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const changeName = useCallback(
    (value: string) => {
      const previousSkillId = skill.skillId;
      const nextSkillId = toSkillId(value);
      model.setSkillName(skill.key, value);
      model.setSkillId(skill.key, nextSkillId);
      if (!previousSkillId || previousSkillId === nextSkillId) return;
      for (const member of state.members) {
        if (!member.skillIds.includes(previousSkillId)) continue;
        model.setMemberSkillIds(
          member.key,
          member.skillIds.map((skillId) => (skillId === previousSkillId ? nextSkillId : skillId)),
        );
      }
    },
    [model, skill.key, skill.skillId, state.members],
  );
  const changeDescription = useCallback(
    (value: string) => model.setSkillDescription(skill.key, value),
    [model, skill.key],
  );
  const remove = useCallback(() => model.removeSkill(skill.key), [model, skill.key]);

  return (
    <View style={styles.repeatRow} testID={`team-profile-skill-${index}`}>
      <Field label={t("teams.v2.profile.skillName")}>
        <FormTextInput
          value={skill.name}
          onChangeText={changeName}
          placeholder={t("teams.v2.profile.skillNamePlaceholder")}
          size={size}
          testID={`team-profile-skill-${index}-name`}
        />
      </Field>
      <Field label={t("teams.v2.profile.skillDescription")}>
        <FormTextInput
          value={skill.description}
          onChangeText={changeDescription}
          placeholder={t("teams.v2.profile.skillDescriptionPlaceholder")}
          size={size}
          multiline
          testID={`team-profile-skill-${index}-description`}
        />
      </Field>
      {state.skills.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={remove}
          testID={`team-profile-skill-${index}-remove`}
        >
          {t("common.actions.remove")}
        </Button>
      ) : null}
    </View>
  );
}

function MemberFields({
  serverId,
  model,
  state,
  member,
  index,
  size,
  providerLoading,
}: {
  serverId: string;
  model: TeamProfileFormModel;
  state: TeamProfileFormState;
  member: TeamProfileMemberRow;
  index: number;
  size: FieldControlSize;
  providerLoading: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const levelOptions = useMemo<SelectFieldOption<number>[]>(
    () =>
      [1, 2, 3, 4, 5].map((level) => ({
        id: String(level),
        value: level,
        label: t("teams.v2.profile.levelValue", { level }),
      })),
    [t],
  );
  const modeOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      member.modeOptions.map((mode) => ({
        id: mode.id,
        value: mode.id,
        label: formatAgentModeLabel(mode),
      })),
    [member.modeOptions],
  );
  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      member.availableThinkingOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: formatThinkingOptionLabel(option),
      })),
    [member.availableThinkingOptions],
  );
  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
      disabled,
      isOpen,
      hovered,
      pressed,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
      hovered: boolean;
      pressed: boolean;
    }) => (
      <SelectFieldTrigger
        label={member.executionProfileDisplay.model ?? selectedModelLabel}
        isPlaceholder={!member.executionProfile.model}
        placeholder={t("teams.v2.profile.selectModel")}
        disabled={disabled}
        active={isOpen || hovered || pressed}
        size={size}
        testID={`team-profile-member-${index}-model-trigger`}
      />
    ),
    [index, member.executionProfile.model, member.executionProfileDisplay.model, size, t],
  );
  const selectModel = useCallback(
    (provider: AgentProvider, modelId: string) =>
      model.setMemberModel(member.key, provider, modelId),
    [member.key, model],
  );
  const changeRole = useCallback(
    (value: string) => model.setMemberRole(member.key, value),
    [member.key, model],
  );
  const changeLevel = useCallback(
    (value: number) => model.setMemberLevel(member.key, value),
    [member.key, model],
  );
  const changeThinking = useCallback(
    (value: string) => model.setMemberThinking(member.key, value),
    [member.key, model],
  );
  const changeMode = useCallback(
    (value: string) => model.setMemberMode(member.key, value),
    [member.key, model],
  );
  const remove = useCallback(() => model.removeMember(member.key), [member.key, model]);
  const levelDisplay = useMemo(
    () => ({ label: t("teams.v2.profile.levelValue", { level: member.level }) }),
    [member.level, t],
  );
  const thinkingDisplay = useMemo(
    () =>
      member.executionProfileDisplay.thinking
        ? { label: member.executionProfileDisplay.thinking }
        : null,
    [member.executionProfileDisplay.thinking],
  );
  const modeDisplay = useMemo(
    () =>
      member.executionProfileDisplay.mode ? { label: member.executionProfileDisplay.mode } : null,
    [member.executionProfileDisplay.mode],
  );

  return (
    <View style={styles.member} testID={`team-profile-member-${index}`}>
      <View style={styles.twoColumn}>
        <View style={styles.flexField}>
          <Field label={t("teams.v2.profile.role")}>
            <FormTextInput
              value={member.role}
              onChangeText={changeRole}
              placeholder={t("teams.v2.profile.rolePlaceholder")}
              size={size}
              testID={`team-profile-member-${index}-role`}
            />
          </Field>
        </View>
        <View style={styles.levelField}>
          <SelectField
            label={t("teams.v2.profile.level")}
            value={member.level}
            selectedDisplay={levelDisplay}
            options={levelOptions}
            onChange={changeLevel}
            placeholder={t("teams.v2.profile.level")}
            emptyText={t("teams.v2.profile.noLevels")}
            size={size}
            testID={`team-profile-member-${index}-level`}
          />
        </View>
      </View>

      <Field label={t("teams.v2.profile.memberSkills")}>
        <View style={styles.skillToggles}>
          {state.skills.map((skill) => (
            <MemberSkillToggle
              key={skill.key}
              model={model}
              member={member}
              skill={skill}
              memberIndex={index}
            />
          ))}
        </View>
      </Field>

      <Field label={t("teams.v2.profile.model")}>
        <CombinedModelSelector
          providers={state.modelSelectorProviders}
          selectedProvider={member.executionProfile.provider ?? ""}
          selectedModel={member.executionProfile.model ?? ""}
          onSelect={selectModel}
          isLoading={providerLoading || state.providerResolution !== "complete"}
          renderTrigger={renderModelTrigger}
          triggerFill
          serverId={serverId}
        />
      </Field>

      {thinkingOptions.length > 0 ? (
        <SelectField
          label={t("teams.v2.profile.thinking")}
          value={member.executionProfile.thinkingOptionId}
          selectedDisplay={thinkingDisplay}
          options={thinkingOptions}
          onChange={changeThinking}
          placeholder={t("teams.v2.profile.defaultThinking")}
          emptyText={t("teams.v2.profile.noThinking")}
          size={size}
          testID={`team-profile-member-${index}-thinking`}
        />
      ) : null}

      {modeOptions.length > 0 ? (
        <SelectField
          label={t("teams.v2.profile.mode")}
          value={member.executionProfile.modeId}
          selectedDisplay={modeDisplay}
          options={modeOptions}
          onChange={changeMode}
          placeholder={t("teams.v2.profile.defaultMode")}
          emptyText={t("teams.v2.profile.noModes")}
          size={size}
          testID={`team-profile-member-${index}-mode`}
        />
      ) : null}

      {state.members.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={remove}
          testID={`team-profile-member-${index}-remove`}
        >
          {t("teams.v2.profile.removeMember")}
        </Button>
      ) : null}
    </View>
  );
}

function MemberSkillToggle({
  model,
  member,
  skill,
  memberIndex,
}: {
  model: TeamProfileFormModel;
  member: TeamProfileMemberRow;
  skill: TeamProfileSkillRow;
  memberIndex: number;
}): ReactElement {
  const selected = member.skillIds.includes(skill.skillId);
  const label = skill.name || skill.skillId;
  const changeSelected = useCallback(
    (enabled: boolean) =>
      model.setMemberSkillIds(
        member.key,
        enabled
          ? [...member.skillIds, skill.skillId]
          : member.skillIds.filter((skillId) => skillId !== skill.skillId),
      ),
    [member.key, member.skillIds, model, skill.skillId],
  );
  return (
    <View style={styles.skillToggleRow}>
      <Text style={styles.skillToggleLabel}>{label}</Text>
      <Switch
        value={selected}
        onValueChange={changeSelected}
        accessibilityLabel={label}
        testID={`team-profile-member-${memberIndex}-skill-${skill.key}`}
      />
    </View>
  );
}

function LeadField({
  model,
  state,
  size,
}: {
  model: TeamProfileFormModel;
  state: TeamProfileFormState;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.members.map((member, index) => ({
        id: member.key,
        value: member.key,
        label: member.role.trim() || t("teams.v2.profile.memberNumber", { number: index + 1 }),
      })),
    [state.members, t],
  );
  const selected = options.find((option) => option.value === state.leadRowKey) ?? null;
  const selectedDisplay = useMemo(() => (selected ? { label: selected.label } : null), [selected]);
  return (
    <SelectField
      label={t("teams.v2.profile.lead")}
      value={state.leadRowKey}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={model.setLead}
      placeholder={t("teams.v2.profile.selectLead")}
      emptyText={t("teams.v2.profile.noMembers")}
      size={size}
      testID="team-profile-lead"
    />
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
    gap: theme.spacing[4],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  repeatRow: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface2,
  },
  member: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface2,
  },
  twoColumn: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[3],
  },
  flexField: {
    flex: 1,
    minWidth: 0,
  },
  levelField: {
    width: 132,
  },
  skillToggles: {
    gap: theme.spacing[2],
  },
  skillToggleRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  skillToggleLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
}));
