import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
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
import type { MethodologyCatalogStatus } from "@/runtime/methodology-catalog-sync";
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
  methodologies?: readonly MethodologyDescriptor[];
  agentProfiles?: readonly AgentProfile[];
  catalogStatus?: MethodologyCatalogStatus;
  catalogError?: string | null;
  onRetryCatalog?: () => void;
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

function catalogStateTestID(status: Exclude<MethodologyCatalogStatus, "ready">): string {
  if (status === "failed") return "team-profile-catalog-failed";
  if (status === "update_host") return "team-profile-catalog-update-host";
  return "team-profile-catalog-loading";
}

/** A fresh Team profile form for each open; live provider data enters through the model adapter. */
export function TeamProfileFormSheet(props: TeamProfileFormSheetProps): ReactElement | null {
  if (!props.visible) return null;
  return <VisibleTeamProfileFormSheet key={openKey(props)} {...props} />;
}

function VisibleTeamProfileFormSheet(props: TeamProfileFormSheetProps): ReactElement {
  const catalogReady =
    Boolean(props.profile) || !props.catalogStatus || props.catalogStatus === "ready";
  const [catalogAccepted, setCatalogAccepted] = useState(catalogReady);
  useEffect(() => {
    if (catalogReady) setCatalogAccepted(true);
  }, [catalogReady]);
  if (!catalogAccepted && props.catalogStatus && props.catalogStatus !== "ready") {
    return <TeamProfileCatalogStateSheet {...props} catalogStatus={props.catalogStatus} />;
  }
  return <OpenTeamProfileFormSheet {...props} />;
}

function TeamProfileCatalogStateSheet({
  catalogStatus,
  catalogError,
  onRetryCatalog,
  visible,
  onClose,
}: TeamProfileFormSheetProps & { catalogStatus: Exclude<MethodologyCatalogStatus, "ready"> }) {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const failed = catalogStatus === "failed";
  const updateHost = catalogStatus === "update_host";
  const testID = catalogStateTestID(catalogStatus);
  const message = failed
    ? (catalogError ?? t("teams.v2.profile.catalogFailed"))
    : t(updateHost ? "teams.v2.profile.catalogUpdateHost" : "teams.v2.profile.catalogLoading");
  const header = useMemo<SheetHeader>(() => ({ title: t("teams.v2.profile.createTitle") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footerActions}>
        <Button variant="ghost" size={size} onPress={onClose}>
          {t("common.actions.cancel")}
        </Button>
        {failed && onRetryCatalog ? (
          <Button
            variant="default"
            size={size}
            onPress={onRetryCatalog}
            testID="team-profile-catalog-retry"
          >
            {t("common.actions.retry")}
          </Button>
        ) : null}
      </View>
    ),
    [failed, onClose, onRetryCatalog, size, t],
  );
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      footer={footer}
      desktopMaxWidth={640}
      snapPoints={["52%", "72%"]}
      contentStyle={styles.catalogState}
      testID="team-profile-form-sheet"
    >
      <View style={styles.catalogState} testID={testID}>
        <Text style={styles.catalogStateText}>{message}</Text>
      </View>
    </AdaptiveModalSheet>
  );
}

function OpenTeamProfileFormSheet({
  serverId,
  workspaceId,
  cwd,
  profile,
  methodologies = [],
  agentProfiles = [],
  catalogStatus,
  catalogError,
  onRetryCatalog,
  visible,
  onClose,
  onSaved,
}: TeamProfileFormSheetProps): ReactElement {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const client = useHostRuntimeClient(serverId);
  const snapshot = useMemo<TeamProfileFormSnapshot>(
    () => ({
      ...(profile
        ? { mode: "edit" as const, profile }
        : { mode: "create" as const, workspaceId, methodologies }),
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
      {!profile && catalogStatus && catalogStatus !== "ready" ? (
        <TeamProfileCatalogNotice
          catalogStatus={catalogStatus}
          catalogError={catalogError}
          onRetryCatalog={onRetryCatalog}
          size={size}
        />
      ) : null}
      <Field label={t("teams.v2.profile.name")}>
        <FormTextInput
          value={state.name}
          onChangeText={model.setName}
          placeholder={t("teams.v2.profile.namePlaceholder")}
          size={size}
          testID="team-profile-name"
        />
      </Field>

      {state.mode === "create" ? (
        <MethodologyFields model={model} state={state} size={size} />
      ) : null}

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
            agentProfiles={agentProfiles}
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

function TeamProfileCatalogNotice({
  catalogStatus,
  catalogError,
  onRetryCatalog,
  size,
}: {
  catalogStatus: Exclude<MethodologyCatalogStatus, "ready">;
  catalogError?: string | null;
  onRetryCatalog?: () => void;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const failed = catalogStatus === "failed";
  const updateHost = catalogStatus === "update_host";
  const message = failed
    ? (catalogError ?? t("teams.v2.profile.catalogFailed"))
    : t(updateHost ? "teams.v2.profile.catalogUpdateHost" : "teams.v2.profile.catalogLoading");
  return (
    <View style={styles.catalogNotice} testID={catalogStateTestID(catalogStatus)}>
      <Text style={styles.catalogStateText}>{message}</Text>
      {failed && onRetryCatalog ? (
        <Button
          variant="outline"
          size={size}
          onPress={onRetryCatalog}
          testID="team-profile-catalog-retry"
        >
          {t("common.actions.retry")}
        </Button>
      ) : null}
    </View>
  );
}

function MethodologyFields({
  model,
  state,
  size,
}: {
  model: TeamProfileFormModel;
  state: TeamProfileFormState;
  size: FieldControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const methodologyOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.methodologies.map((methodology) => ({
        id: methodology.ref.digest,
        value: methodology.ref.digest,
        label: methodology.name,
      })),
    [state.methodologies],
  );
  const presetOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      (state.selectedMethodology?.presets ?? []).map((preset) => ({
        id: preset.presetId,
        value: preset.presetId,
        label: preset.name,
      })),
    [state.selectedMethodology],
  );
  const preset = state.selectedMethodology?.presets.find(
    (candidate) => candidate.presetId === state.selectedPresetId,
  );
  const methodologyDisplay = useMemo(
    () => (state.selectedMethodology ? { label: state.selectedMethodology.name } : null),
    [state.selectedMethodology],
  );
  const presetDisplay = useMemo(() => (preset ? { label: preset.name } : null), [preset]);
  const changeMethodology = useCallback(
    (digest: string) => {
      const methodology = state.methodologies.find((candidate) => candidate.ref.digest === digest);
      if (methodology) model.setMethodology(methodology.ref);
    },
    [model, state.methodologies],
  );

  return (
    <FormSection title={t("teams.v2.profile.methodology")}>
      <SelectField
        label={t("teams.v2.profile.methodology")}
        value={state.selectedMethodology?.ref.digest ?? null}
        selectedDisplay={methodologyDisplay}
        options={methodologyOptions}
        onChange={changeMethodology}
        placeholder={t("teams.v2.profile.selectMethodology")}
        emptyText={t("teams.v2.profile.noMethodologies")}
        size={size}
        testID="team-profile-methodology"
      />
      <SelectField
        label={t("teams.v2.profile.preset")}
        value={state.selectedPresetId}
        selectedDisplay={presetDisplay}
        options={presetOptions}
        onChange={model.applyPreset}
        placeholder={t("teams.v2.profile.selectPreset")}
        emptyText={t("teams.v2.profile.noPresets")}
        size={size}
        testID="team-profile-preset"
      />
      {state.selectedMethodology ? (
        <View style={styles.methodologyFacts}>
          <Text style={styles.methodologyFact}>
            {t("teams.v2.profile.reviewPolicy", {
              policy: state.selectedMethodology.policySummary.review.writableWorkstreams,
            })}
          </Text>
          <Text style={styles.methodologyFact}>
            {t("teams.v2.profile.finalVerificationRequired")}
          </Text>
          {state.selectedMethodology.playbooks.map((playbook) => (
            <Text key={playbook.playbookId} style={styles.methodologyFact}>
              {playbook.name}
            </Text>
          ))}
        </View>
      ) : null}
    </FormSection>
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
  agentProfiles,
}: {
  serverId: string;
  model: TeamProfileFormModel;
  state: TeamProfileFormState;
  member: TeamProfileMemberRow;
  index: number;
  size: FieldControlSize;
  providerLoading: boolean;
  agentProfiles: readonly AgentProfile[];
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
  const executionSourceOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "inline", value: "inline", label: t("teams.v2.profile.inlineExecution") },
      ...agentProfiles.map((profile) => ({
        id: `profile:${profile.id}`,
        value: `profile:${profile.id}`,
        label: profile.name,
      })),
    ],
    [agentProfiles, t],
  );
  const executionSourceValue =
    member.executionSelection.kind === "agent_profile"
      ? `profile:${member.executionSelection.profileId}`
      : "inline";
  const executionSourceDisplay = executionSourceOptions.find(
    (option) => option.value === executionSourceValue,
  );
  const selectedExecutionSourceDisplay = useMemo(
    () => (executionSourceDisplay ? { label: executionSourceDisplay.label } : null),
    [executionSourceDisplay],
  );
  const changeExecutionSource = useCallback(
    (value: string) => {
      if (value === "inline") model.setMemberInlineExecution(member.key);
      else model.setMemberAgentProfile(member.key, value.slice("profile:".length));
    },
    [member.key, model],
  );
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

      <SelectField
        label={t("teams.v2.profile.executionSource")}
        value={executionSourceValue}
        selectedDisplay={selectedExecutionSourceDisplay}
        options={executionSourceOptions}
        onChange={changeExecutionSource}
        placeholder={t("teams.v2.profile.selectExecutionSource")}
        emptyText={t("teams.v2.profile.noExecutionSources")}
        disabled={state.mode === "edit"}
        size={size}
        testID={`team-profile-member-${index}-execution-source`}
      />

      {member.executionSelection.kind === "inline" ? (
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
      ) : null}

      {member.executionSelection.kind === "inline" && thinkingOptions.length > 0 ? (
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

      {member.executionSelection.kind === "inline" && modeOptions.length > 0 ? (
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
  methodologyFacts: {
    gap: theme.spacing[1],
  },
  methodologyFact: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  catalogState: {
    flex: 1,
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  catalogStateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  catalogNotice: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
}));
