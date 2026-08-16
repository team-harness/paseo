import { createHash } from "node:crypto";

import type {
  MethodologyDescriptor,
  TeamMissionAttentionResolutionInput,
  TeamProfileCreateMemberInput,
  TeamProfileMemberInput,
  TeamProfileMemberPatch,
} from "@getpaseo/protocol/team/v2-rpc-schemas";
import type {
  MissionAttentionItem,
  MissionAttentionResolution,
  MissionCapabilityFacts,
  MissionCapabilityReplanRequest,
  MissionReviewWaiver,
  MissionRosterSnapshot,
  TeamMemberProfile,
  TeamMission,
  TeamMissionInspect,
  TeamMethodologyBinding,
  TeamSkill,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";
import { assignTeamMentionHandles } from "@getpaseo/protocol/team/mention-handles";

import type { AcceptedTurnFact } from "../domain/assignment-contract-validation.js";
import { applyMissionAttentionTransition } from "../domain/mission-attention-transition.js";
import { matchWorkstreamReviewer } from "../domain/member-matching.js";
import {
  validateMissionAttentionResolution,
  validateTeamMission,
} from "../domain/mission-validation.js";
import {
  validateTeamProfile,
  validateTeamReadyForMission,
} from "../domain/team-profile-validation.js";
import {
  MissionStartConflictError,
  MissionLeadReplacementConflictError,
  MissionRevisionConflictError,
  MissionStorageRevisionConflictError,
  MissionStore,
} from "../persistence/mission-store.js";
import { TeamProfileStore } from "../persistence/profile-store.js";
import type { TeamPersistenceRecoveryAction } from "../persistence/reconciliation.js";
import type {
  StoredMission,
  StoredTeamProfile,
  TeamArchiveIntent,
  TeamLeadReplacementIntent,
  TeamMissionFinishIntent,
} from "../persistence/schemas.js";
import {
  TeamMissionPersistenceTransactions,
  type TeamPersistenceFaultInjector,
} from "../persistence/transactions.js";
import type {
  ProviderCapabilityResolver,
  TeamClockPort,
  TeamIdentityPort,
  TeamParticipantPort,
  TeamRecoveryPort,
  TeamRoomPort,
  TeamRuntimeEventPort,
  TeamWorkspaceAvailabilityPort,
} from "./ports.js";
import type {
  MaterializedTeamMemberExecution,
  TeamAgentProfileMaterializer,
} from "./team-agent-profile-materializer.js";
import { capabilityReplanDeliveryBody } from "./assignment-replan.js";
import { TeamApplicationError } from "./errors.js";
export { TeamApplicationError } from "./errors.js";
import { TeamOperationCoordinator } from "./team-operation-coordinator.js";
import { MethodologyCompileError, type MethodologyCatalog } from "../methodology/catalog.js";
import {
  type WorkspaceLifecyclePort,
  workspaceLifecycleCoordinator,
} from "../../workspace-lifecycle-coordinator.js";

const DEFAULT_WORKSPACE_AUDIT_POLICY = {
  revision: 1,
  includeTrackedPaths: true,
  includeNonIgnoredUntrackedPaths: true,
  includeDeclaredArtifactPaths: true,
  excludeGitignoredPathsByDefault: true,
  excludedPathPrefixes: [".git", ".codegraph"],
};

const IMPLEMENTED_ATTENTION_RESOLUTION_KINDS = new Set<TeamMissionAttentionResolutionInput["kind"]>(
  [
    "attribute_owner",
    "external_change",
    "resume_provider",
    "restore_notification",
    "waive_review",
    "cancel_mission",
  ],
);

const PUBLIC_ATTENTION_RESOLUTION_PREREQUISITES = {
  recovery_assignment: {
    code: "attention_resolution_requires_recovery_assignment",
    action: "a durable recovery Assignment",
  },
  report_received: {
    code: "attention_resolution_requires_assignment_report",
    action: "assignment_report",
  },
  replan: {
    code: "attention_resolution_requires_mission_plan",
    action: "mission_plan",
  },
} as const;

export interface CreateTeamInput {
  idempotencyKey: string;
  name: string;
  creationWorkspaceId: string;
  skills: TeamSkill[];
  leadClientMemberKey: string;
  members: TeamProfileCreateMemberInput[];
  methodologyBinding: {
    ref: MethodologyDescriptor["ref"];
    presetId: string | null;
    memberArchetypeBindings: Array<{
      clientMemberKey: string;
      archetypeId: string | null;
    }>;
    skillBindings: TeamMethodologyBinding["skillBindings"];
  };
}

export interface UpdateTeamInput {
  idempotencyKey?: string;
  teamId: string;
  expectedRevision: number;
  name?: string;
  skills?: TeamSkill[];
  leadMemberId?: string;
  memberAdds?: TeamProfileMemberInput[];
  memberUpdates?: TeamProfileMemberPatch[];
  memberRemovals?: string[];
  methodologyUpgrade?: {
    expectedRef: MethodologyDescriptor["ref"];
    ref: MethodologyDescriptor["ref"];
    presetId: string | null;
    memberArchetypeBindings: TeamMethodologyBinding["memberArchetypeBindings"];
    skillBindings: TeamMethodologyBinding["skillBindings"];
  };
}

export interface RefreshTeamMemberExecutionInput {
  idempotencyKey: string;
  teamId: string;
  memberId: string;
  expectedTeamRevision: number;
}

export type RefreshTeamMemberExecutionResult =
  | { disposition: "unchanged"; teamRevision: number; appliedDigest: string }
  | { disposition: "updated"; team: TeamV2 };

export interface ArchiveTeamInput {
  idempotencyKey: string;
  teamId: string;
  expectedRevision: number;
}

export interface StartMissionInput {
  idempotencyKey: string;
  teamId: string;
  expectedTeamRevision: number;
  expectedMethodologyRef: MethodologyDescriptor["ref"];
  workspaceId: string;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
}

export interface CancelMissionInput {
  idempotencyKey: string;
  missionId: string;
  expectedRevision: number;
  reason: string;
}

export interface CompleteMissionInput {
  idempotencyKey: string;
  missionId: string;
  expectedRevision: number;
  acceptedTurns: AcceptedTurnFact[];
}

export type MissionFatalFailureKind = "unrecoverable_system_failure" | "lead_provision_failed";

export interface FailMissionInput {
  idempotencyKey: string;
  missionId: string;
  expectedRevision: number;
  failureKind: MissionFatalFailureKind;
  reason: string;
}

export interface ResolveMissionAttentionInput {
  idempotencyKey: string;
  missionId: string;
  attentionId: string;
  expectedRevision: number;
  actorId: string;
  waiverSource?: {
    connectionId: string;
    selfReportedClientLabel: string;
  };
  resolution: TeamMissionAttentionResolutionInput;
}

export interface RefreshMissionCapabilitiesInput {
  missionId: string;
  attentionId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export type RefreshMissionCapabilitiesResult =
  | {
      disposition: "unchanged";
      reason: "capability_declarations_unchanged";
      missionRevision: number;
      rosterSnapshotRevision: number;
    }
  | {
      disposition: "replan_requested";
      missionRevision: number;
      rosterSnapshotRevision: number;
      requestId: string;
      sourceAttentionIds: string[];
    };

export interface RecordMissionRecoveryAttentionInput {
  missionId: string;
  attentionId: string;
  summary: string;
  kind: "lead_unavailable" | "notification_unacknowledged" | "ownership_violation";
}

export interface TeamMissionFinishQuiescencePort {
  prepareEvidence(input: { missionId: string; intentId: string }): Promise<void>;
}

export interface TeamMissionServiceOptions {
  profiles: TeamProfileStore;
  missions: MissionStore;
  recovery: TeamRecoveryPort;
  rooms: TeamRoomPort;
  participants: TeamParticipantPort;
  workspaces: TeamWorkspaceAvailabilityPort;
  capabilities: ProviderCapabilityResolver;
  events: TeamRuntimeEventPort;
  clock: TeamClockPort;
  ids: TeamIdentityPort;
  agentProfiles: TeamAgentProfileMaterializer;
  methodologies: Pick<MethodologyCatalog, "get" | "compileMission">;
  operations?: TeamOperationCoordinator;
  workspaceLifecycle?: WorkspaceLifecyclePort;
  persistenceFaultInjector?: TeamPersistenceFaultInjector;
  finishQuiescence: TeamMissionFinishQuiescencePort;
}

export class TeamMissionService {
  private readonly profiles: TeamProfileStore;
  private readonly missions: MissionStore;
  private readonly recovery: TeamRecoveryPort;
  private readonly rooms: TeamRoomPort;
  private readonly participants: TeamParticipantPort;
  private readonly workspaces: TeamWorkspaceAvailabilityPort;
  private readonly capabilities: ProviderCapabilityResolver;
  private readonly events: TeamRuntimeEventPort;
  private readonly clock: TeamClockPort;
  private readonly ids: TeamIdentityPort;
  private readonly agentProfiles: TeamAgentProfileMaterializer;
  private readonly methodologies: TeamMissionServiceOptions["methodologies"];
  private readonly transactions: TeamMissionPersistenceTransactions;
  private readonly operations: TeamOperationCoordinator;
  private readonly workspaceLifecycle: WorkspaceLifecyclePort;
  private readonly finishQuiescence: TeamMissionFinishQuiescencePort;

  constructor(options: TeamMissionServiceOptions) {
    this.profiles = options.profiles;
    this.missions = options.missions;
    this.recovery = options.recovery;
    this.rooms = options.rooms;
    this.participants = options.participants;
    this.workspaces = options.workspaces;
    this.capabilities = options.capabilities;
    this.events = options.events;
    this.clock = options.clock;
    this.ids = options.ids;
    this.agentProfiles = options.agentProfiles;
    this.methodologies = options.methodologies;
    this.operations = options.operations ?? new TeamOperationCoordinator();
    this.workspaceLifecycle = options.workspaceLifecycle ?? workspaceLifecycleCoordinator;
    this.finishQuiescence = options.finishQuiescence;
    this.transactions = new TeamMissionPersistenceTransactions({
      profiles: options.profiles,
      missions: options.missions,
      faultInjector: options.persistenceFaultInjector,
    });
  }

  async createTeam(input: CreateTeamInput): Promise<TeamV2> {
    const requestFingerprint = fingerprint("team.profile.create", {
      name: input.name,
      creationWorkspaceId: input.creationWorkspaceId,
      skills: input.skills,
      leadClientMemberKey: input.leadClientMemberKey,
      members: input.members,
      methodologyBinding: input.methodologyBinding,
    });
    const stored = await this.profiles.createFromFactory({
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      create: async () => {
        const methodology = this.methodologies.get(input.methodologyBinding.ref);
        if (!methodology) {
          throw new TeamApplicationError(
            "methodology_not_found",
            `Methodology ${input.methodologyBinding.ref.bundleId}@${input.methodologyBinding.ref.version} was not found`,
          );
        }
        validateCreateMethodologyBinding(input, methodology);
        const executions = await this.agentProfiles.materialize(input.members);
        const executionByKey = new Map(
          executions.map((execution) => [execution.clientMemberKey, execution]),
        );
        const teamId = this.ids.next("team");
        const memberIdByKey = new Map(
          input.members.map((member) => [member.clientMemberKey, this.ids.next("member")]),
        );
        const members = assignMentionHandles(
          input.members.map((member) => {
            const execution = requireValue(
              executionByKey.get(member.clientMemberKey),
              `Member ${member.clientMemberKey} was not materialized`,
            );
            return {
              memberId: requireValue(
                memberIdByKey.get(member.clientMemberKey),
                `Member ${member.clientMemberKey} was not allocated`,
              ),
              role: member.role,
              level: member.level,
              skillIds: structuredClone(member.skillIds),
              executionProfile: structuredClone(execution.executionProfile),
              ...(execution.executionProfileSource
                ? { executionProfileSource: structuredClone(execution.executionProfileSource) }
                : {}),
              mentionHandle: "",
            };
          }),
        );
        const candidate: Omit<TeamV2, "revision" | "createdAt" | "updatedAt"> = {
          id: teamId,
          name: input.name.trim(),
          creationWorkspaceId: input.creationWorkspaceId,
          leadMemberId: requireValue(
            memberIdByKey.get(input.leadClientMemberKey),
            "Lead member was not allocated",
          ),
          skills: structuredClone(input.skills),
          members,
          methodologyBinding: {
            ref: structuredClone(input.methodologyBinding.ref),
            presetId: input.methodologyBinding.presetId,
            memberArchetypeBindings: input.methodologyBinding.memberArchetypeBindings.map(
              (binding) => ({
                memberId: requireValue(
                  memberIdByKey.get(binding.clientMemberKey),
                  `Member ${binding.clientMemberKey} was not allocated`,
                ),
                archetypeId: binding.archetypeId,
              }),
            ),
            skillBindings: structuredClone(input.methodologyBinding.skillBindings),
          },
          lifecycle: "active",
          activeMissionId: null,
          lifecycleRecoveryFailure: null,
          archivedAt: null,
        };
        assertValidTeamProfile({
          ...candidate,
          revision: 0,
          createdAt: this.clock.now(),
          updatedAt: this.clock.now(),
        });
        return candidate;
      },
    });
    await this.events.publishTeam(stored.profile);
    return stored.profile;
  }

  async listTeams(includeArchived = false): Promise<TeamV2[]> {
    const records = await this.profiles.list();
    return records
      .map((record) => record.profile)
      .filter((team) => includeArchived || team.lifecycle !== "archived");
  }

  async inspectTeam(teamId: string): Promise<TeamV2 | null> {
    return (await this.profiles.get(teamId))?.profile ?? null;
  }

  async updateTeam(input: UpdateTeamInput): Promise<TeamV2> {
    const requestFingerprint = input.idempotencyKey
      ? fingerprint("team.profile.update", {
          teamId: input.teamId,
          expectedRevision: input.expectedRevision,
          name: input.name,
          skills: input.skills,
          leadMemberId: input.leadMemberId,
          memberAdds: input.memberAdds,
          memberUpdates: input.memberUpdates,
          memberRemovals: input.memberRemovals,
          methodologyUpgrade: input.methodologyUpgrade,
        })
      : undefined;
    const stored = await this.profiles.update({
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      teamId: input.teamId,
      expectedRevision: input.expectedRevision,
      update: async (current, context) => {
        if (current.lifecycle !== "active") {
          throw new TeamApplicationError("team_archived", `Team ${current.id} is archived`);
        }
        if (context.archiveIntent) {
          throw new TeamApplicationError(
            "team_archive_in_progress",
            `Team ${current.id} has an archive in progress`,
          );
        }
        assertMemberMutationTargets(current, input);
        assertRosterMutationAllowed(current, context.startIntent, input);
        validateMethodologyUpgrade(current, context.startIntent, input, this.methodologies);
        const selections = [
          ...(input.memberAdds ?? []).map((member, index) => ({
            clientMemberKey: `add:${index}`,
            executionProfileSelection: member.executionProfileSelection,
          })),
          ...(input.memberUpdates ?? []).flatMap((member) =>
            member.executionProfileSelection
              ? [
                  {
                    clientMemberKey: `update:${member.memberId}`,
                    executionProfileSelection: member.executionProfileSelection,
                  },
                ]
              : [],
          ),
        ];
        const materialized = await this.agentProfiles.materialize(selections);
        const executionByKey = new Map(
          materialized.map((execution) => [execution.clientMemberKey, execution]),
        );
        const removed = new Set(input.memberRemovals ?? []);
        const retiredMentionHandles = current.members
          .filter((member) => removed.has(member.memberId))
          .map((member) => member.mentionHandle);
        const patches = new Map(
          (input.memberUpdates ?? []).map((patch) => [patch.memberId, patch]),
        );
        const retained = current.members
          .filter((member) => !removed.has(member.memberId))
          .map((member) => applyMemberPatch(member, patches.get(member.memberId), executionByKey));
        const additions = (input.memberAdds ?? []).map((member, index) => {
          const execution = requireValue(
            executionByKey.get(`add:${index}`),
            `Added Member ${index} was not materialized`,
          );
          const addition: TeamMemberProfile = {
            memberId: this.ids.next("member"),
            role: member.role,
            level: member.level,
            skillIds: structuredClone(member.skillIds),
            executionProfile: structuredClone(execution.executionProfile),
            mentionHandle: "",
          };
          if (execution.executionProfileSource) {
            addition.executionProfileSource = structuredClone(execution.executionProfileSource);
          }
          return addition;
        });
        const members = assignMentionHandles(
          [...retained, ...additions],
          [...context.retiredMentionHandles, ...retiredMentionHandles],
        );
        const next: TeamV2 = {
          ...current,
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.skills ? { skills: structuredClone(input.skills) } : {}),
          ...(input.leadMemberId ? { leadMemberId: input.leadMemberId } : {}),
          members,
          ...(input.methodologyUpgrade
            ? {
                methodologyBinding: {
                  ref: structuredClone(input.methodologyUpgrade.ref),
                  presetId: input.methodologyUpgrade.presetId,
                  memberArchetypeBindings: structuredClone(
                    input.methodologyUpgrade.memberArchetypeBindings,
                  ),
                  skillBindings: structuredClone(input.methodologyUpgrade.skillBindings),
                },
              }
            : {}),
        };
        assertValidTeamProfile(next);
        return { profile: next, retireMentionHandles: retiredMentionHandles };
      },
    });
    await this.events.publishTeam(stored.profile);
    return stored.profile;
  }

  async refreshMemberExecution(
    input: RefreshTeamMemberExecutionInput,
  ): Promise<RefreshTeamMemberExecutionResult> {
    const requestFingerprint = fingerprint("team.profile.member.execution.refresh", input);
    const stored = await this.profiles.update({
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      persistReceiptOnNoChange: false,
      teamId: input.teamId,
      expectedRevision: input.expectedTeamRevision,
      update: async (current, context) => {
        assertMutableTeam(current, context.archiveIntent);
        const member = current.members.find((candidate) => candidate.memberId === input.memberId);
        if (!member) {
          throw new TeamApplicationError(
            "member_not_found",
            `Member ${input.memberId} does not belong to Team ${current.id}`,
          );
        }
        const source = member.executionProfileSource;
        if (!source) {
          throw new TeamApplicationError(
            "team_agent_profile_source_required",
            `Member ${input.memberId} has no Agent Profile source`,
          );
        }
        const [execution] = await this.agentProfiles.materialize([
          {
            clientMemberKey: member.memberId,
            executionProfileSelection: { kind: "agent_profile", profileId: source.profileId },
          },
        ]);
        if (!execution?.executionProfileSource) {
          throw new Error(`Member ${input.memberId} source was not materialized`);
        }
        if (execution.executionProfileSource.appliedDigest === source.appliedDigest) return current;
        const members = current.members.map((candidate) =>
          candidate.memberId === member.memberId
            ? {
                ...candidate,
                executionProfile: structuredClone(execution.executionProfile),
                executionProfileSource: structuredClone(execution.executionProfileSource),
              }
            : candidate,
        );
        const next = { ...current, members };
        assertValidTeamProfile(next);
        return next;
      },
    });
    const member = requireValue(
      stored.profile.members.find((candidate) => candidate.memberId === input.memberId),
      `Member ${input.memberId} disappeared during refresh`,
    );
    const source = requireValue(
      member.executionProfileSource,
      `Member ${input.memberId} lost its source during refresh`,
    );
    if (stored.profile.revision === input.expectedTeamRevision) {
      return {
        disposition: "unchanged",
        teamRevision: stored.profile.revision,
        appliedDigest: source.appliedDigest,
      };
    }
    await this.events.publishTeam(stored.profile);
    return { disposition: "updated", team: stored.profile };
  }

  async archiveTeam(input: ArchiveTeamInput): Promise<TeamV2> {
    let workspaceIds = await this.teamLifecycleWorkspaceIds(await this.requireTeam(input.teamId));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.workspaceLifecycle.serialize(workspaceIds, async () => {
        const lockedWorkspaceIds = new Set(workspaceIds);
        const prepared = await this.serializeTeamLifecycle(input.teamId, async () => {
          const current = await this.requireTeam(input.teamId);
          const currentWorkspaceIds = await this.teamLifecycleWorkspaceIds(current);
          if (currentWorkspaceIds.some((workspaceId) => !lockedWorkspaceIds.has(workspaceId))) {
            return { kind: "retry" as const, workspaceIds: currentWorkspaceIds };
          }
          return {
            kind: "ready" as const,
            profile: await this.beginTeamArchiveWithinLifecycle(input),
          };
        });
        if (prepared.kind === "retry") return prepared;
        return { kind: "done" as const, team: await this.resumeTeamArchive(prepared.profile) };
      });
      if (result.kind === "done") return result.team;
      workspaceIds = result.workspaceIds;
    }
    throw new TeamApplicationError(
      "team_archive_workspace_changed",
      `Team ${input.teamId} Mission workspace changed while archive was acquiring its fence`,
    );
  }

  private async beginTeamArchiveWithinLifecycle(
    input: ArchiveTeamInput,
  ): Promise<StoredTeamProfile> {
    const requestFingerprint = fingerprint("team.profile.archive", { teamId: input.teamId });
    const current = await this.requireTeam(input.teamId);
    if (current.profile.lifecycle === "archived") return current;
    if (current.archiveIntent) {
      const isReplay =
        current.archiveIntent.idempotencyKey === input.idempotencyKey &&
        current.archiveIntent.requestFingerprint === requestFingerprint;
      if (!isReplay) {
        throw new TeamApplicationError(
          "team_archive_conflict",
          `Team ${input.teamId} has a different archive in progress`,
        );
      }
      return current;
    }

    const now = this.clock.now();
    const currentMissionId =
      current.profile.activeMissionId ?? current.startIntent?.missionId ?? null;
    const abandonActiveMissionId = current.persistenceAttentions.find(
      (attention) =>
        attention.missionId === currentMissionId &&
        (attention.code === "active_mission_missing" ||
          attention.code === "active_mission_team_mismatch"),
    )?.missionId;
    const missionId = abandonActiveMissionId ? null : currentMissionId;
    const missionFinishIntent: TeamMissionFinishIntent | null = missionId
      ? {
          intentId: this.ids.next("finish"),
          idempotencyKey: `${input.idempotencyKey}:mission-cancel`,
          requestFingerprint: fingerprint("team.profile.archive.mission.cancel", {
            teamId: input.teamId,
            missionId,
            archiveRequestFingerprint: requestFingerprint,
          }),
          completionEventId: this.ids.next("event"),
          kind: "canceled",
          reason: "Team archived by user",
          stage: "requested",
          requestedAt: now,
          updatedAt: now,
        }
      : null;
    const intent: TeamArchiveIntent = {
      intentId: this.ids.next("archive"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      expectedTeamRevision: input.expectedRevision,
      missionId,
      missionFinishIntent,
      stage: "requested",
      requestedAt: now,
      updatedAt: now,
    };
    return this.profiles.beginArchive({
      teamId: input.teamId,
      intent,
      abandonActiveMissionId,
    });
  }

  async startMission(input: StartMissionInput): Promise<TeamMission> {
    const workspaceId = normalizeMissionWorkspaceId(input.workspaceId);
    return this.workspaceLifecycle.serialize([workspaceId], () =>
      this.serializeTeamLifecycle(input.teamId, () =>
        this.startMissionWithinLifecycle(input, workspaceId),
      ),
    );
  }

  private async startMissionWithinLifecycle(
    input: StartMissionInput,
    lockedWorkspaceId: string,
  ): Promise<TeamMission> {
    const storedTeam = await this.requireTeam(input.teamId);
    const effectiveWorkspaceId = normalizeMissionWorkspaceId(input.workspaceId);
    if (effectiveWorkspaceId !== lockedWorkspaceId) {
      throw new TeamApplicationError(
        "mission_start_workspace_conflict",
        `Mission start workspace changed from ${lockedWorkspaceId} to ${effectiveWorkspaceId}`,
      );
    }
    const normalizedInput = { ...input, workspaceId: effectiveWorkspaceId };
    const requestFingerprint = fingerprint("team.mission.start", normalizedInput);
    let started: StoredMission | null;
    try {
      started = await this.missions.findStartedMission({
        teamId: input.teamId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
      });
    } catch (error) {
      if (!(error instanceof MissionStartConflictError)) throw error;
      throw new TeamApplicationError(
        "mission_start_conflict",
        `Mission start key ${input.idempotencyKey} has a different request`,
      );
    }
    if (started) {
      assertMissionBelongsToTeam(storedTeam, started);
      const pending = storedTeam.startIntent;
      if (
        pending?.idempotencyKey === input.idempotencyKey &&
        pending.requestFingerprint === requestFingerprint &&
        pending.missionId === started.mission.id
      ) {
        return this.resumeMissionStart(storedTeam);
      }
      return started.mission;
    }
    if (storedTeam.startIntent?.idempotencyKey === input.idempotencyKey) {
      if (storedTeam.startIntent.requestFingerprint !== requestFingerprint) {
        throw new TeamApplicationError(
          "mission_start_conflict",
          `Mission start key ${input.idempotencyKey} has a different request`,
        );
      }
      return this.resumeMissionStart(storedTeam);
    }
    await this.requireActiveWorkspace(effectiveWorkspaceId);
    if (storedTeam.profile.revision !== input.expectedTeamRevision) {
      throw new TeamApplicationError(
        "team_revision_conflict",
        `Team ${input.teamId} revision is ${storedTeam.profile.revision}, expected ${input.expectedTeamRevision}`,
      );
    }
    if (
      !exactMethodologyRefsEqual(
        storedTeam.profile.methodologyBinding.ref,
        input.expectedMethodologyRef,
      )
    ) {
      throw new TeamApplicationError(
        "methodology_ref_conflict",
        `Team ${input.teamId} Methodology binding changed before Mission start`,
      );
    }
    const readiness = validateTeamReadyForMission(storedTeam.profile);
    if (!readiness.ok) {
      throw new TeamApplicationError("team_not_ready", `Team ${input.teamId} is not active`);
    }

    const now = this.clock.now();
    const rosterSnapshot = await this.createRosterSnapshot(storedTeam.profile, now);
    let methodologySnapshot: ReturnType<MethodologyCatalog["compileMission"]>;
    try {
      methodologySnapshot = this.methodologies.compileMission({
        binding: structuredClone(storedTeam.profile.methodologyBinding),
        teamRevision: storedTeam.profile.revision,
        roster: methodologyRosterProjection(rosterSnapshot),
        mission: {
          objective: input.objective,
          constraints: structuredClone(input.constraints),
          acceptanceCriteria: structuredClone(input.acceptanceCriteria),
        },
      });
    } catch (error) {
      if (error instanceof MethodologyCompileError) {
        throw new TeamApplicationError(error.code, error.message);
      }
      throw error;
    }

    const missionId = this.ids.next("mission");
    const intent = {
      intentId: this.ids.next("start"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      expectedTeamRevision: input.expectedTeamRevision,
      workspaceId: effectiveWorkspaceId,
      missionId,
      chatRoomId: this.ids.next("room"),
      teamName: storedTeam.profile.name,
      leadAgentId: this.ids.next("agent"),
      bindingEpoch: 1,
      objective: input.objective,
      constraints: structuredClone(input.constraints),
      acceptanceCriteria: structuredClone(input.acceptanceCriteria),
      rosterSnapshot,
      methodologySnapshot,
      methodologyCompiledAt: now,
      workspaceAuditPolicy: structuredClone(DEFAULT_WORKSPACE_AUDIT_POLICY),
      stage: "reserved" as const,
      requestedAt: now,
      updatedAt: now,
    };

    const persisted = await this.transactions.beginMissionStart({ teamId: input.teamId, intent });
    return this.resumeMissionStart(persisted.profile);
  }

  async listMissions(teamId: string, includeTerminal = false): Promise<TeamMission[]> {
    const records = await this.missions.list();
    return records
      .map((record) => record.mission)
      .filter((mission) => mission.teamId === teamId)
      .filter((mission) => includeTerminal || !isTerminalMission(mission));
  }

  async inspectMission(missionId: string): Promise<TeamMissionInspect | null> {
    const stored = await this.missions.get(missionId);
    if (!stored) return null;
    const roster = requireActiveRoster(stored.mission);
    const leadBinding = latestActiveParticipant(stored.mission, roster.leadMemberId);
    return {
      ...stored.mission,
      capabilityReplanRequests: stored.mission.capabilityReplanRequests.map((request) => {
        const currentDelivery = leadBinding
          ? (stored.recipientAttentionOutbox.find(
              (delivery) =>
                delivery.recipientMemberId === roster.leadMemberId &&
                delivery.bindingEpoch === leadBinding.bindingEpoch &&
                (delivery.deliveryId === request.deliveryId ||
                  delivery.deliveryId.startsWith(`${request.deliveryId}:binding:`)) &&
                delivery.state !== "canceled",
            ) ??
            stored.recipientAttentionOutbox.find(
              (delivery) =>
                delivery.recipientMemberId === roster.leadMemberId &&
                delivery.bindingEpoch === leadBinding.bindingEpoch &&
                (delivery.deliveryId === request.deliveryId ||
                  delivery.deliveryId.startsWith(`${request.deliveryId}:binding:`)),
            ))
          : null;
        return Object.assign({}, request, {
          currentBindingDelivery: currentDelivery
            ? {
                deliveryId: currentDelivery.deliveryId,
                bindingEpoch: currentDelivery.bindingEpoch,
                state: currentDelivery.state,
              }
            : null,
        });
      }),
    };
  }

  async cancelMission(input: CancelMissionInput): Promise<TeamMission> {
    const stored = await this.requireMission(input.missionId);
    const finishing = await this.serializeTeamLifecycle(stored.mission.teamId, () =>
      this.beginCancelMissionWithinLifecycle(input),
    );
    return this.resumeMissionFinish(finishing);
  }

  async prepareWorkspaceArchive(workspaceId: string): Promise<TeamMission[]> {
    const terminalMissions: TeamMission[] = [];
    const candidatesById = new Map(
      (await this.missions.list())
        .filter(
          (stored) =>
            stored.mission.workspaceId === workspaceId && !isTerminalMission(stored.mission),
        )
        .map((stored) => [stored.mission.id, stored]),
    );
    for (const profile of await this.profiles.list()) {
      const intent = profile.startIntent;
      if (!intent || intent.workspaceId !== workspaceId || candidatesById.has(intent.missionId)) {
        continue;
      }
      const materialized = await this.serializeTeamLifecycle(profile.profile.id, async () => {
        const current = await this.requireTeam(profile.profile.id);
        const currentIntent = current.startIntent;
        if (
          !currentIntent ||
          currentIntent.intentId !== intent.intentId ||
          currentIntent.workspaceId !== workspaceId
        ) {
          return null;
        }
        const existing = await this.missions.get(currentIntent.missionId);
        if (existing) return existing;
        return (
          await this.transactions.commitMissionStart({
            teamId: current.profile.id,
            intentId: currentIntent.intentId,
            missionId: currentIntent.missionId,
          })
        ).mission;
      });
      if (materialized && !isTerminalMission(materialized.mission)) {
        candidatesById.set(materialized.mission.id, materialized);
      }
    }
    const candidates = [...candidatesById.values()];
    for (const candidate of candidates) {
      let stored = await this.requireMission(candidate.mission.id);
      if (isTerminalMission(stored.mission)) {
        terminalMissions.push(stored.mission);
        continue;
      }
      if (!stored.finishIntent) {
        stored = await this.serializeTeamLifecycle(stored.mission.teamId, async () => {
          const current = await this.requireMission(candidate.mission.id);
          if (isTerminalMission(current.mission) || current.finishIntent) return current;
          const now = this.clock.now();
          const intent: TeamMissionFinishIntent = {
            intentId: this.ids.next("finish"),
            idempotencyKey: `workspace-archive:${workspaceId}:${current.mission.id}`,
            requestFingerprint: fingerprint("team.mission.workspace.archive", {
              workspaceId,
              missionId: current.mission.id,
            }),
            completionEventId: this.ids.next("event"),
            kind: "canceled",
            reason: `Workspace ${workspaceId} archived`,
            stage: "requested",
            requestedAt: now,
            updatedAt: now,
          };
          return this.missions.beginFinish({
            missionId: current.mission.id,
            expectedRevision: current.mission.revision,
            intent,
          });
        });
      }
      terminalMissions.push(await this.resumeMissionFinish(stored));
    }
    return terminalMissions;
  }

  private async beginCancelMissionWithinLifecycle(
    input: CancelMissionInput,
  ): Promise<StoredMission> {
    const current = await this.requireMission(input.missionId);
    if (
      current.finishIntent?.kind === "canceled" &&
      current.finishIntent.idempotencyKey === input.idempotencyKey &&
      current.mission.lifecycleRecoveryFailure?.intentId === current.finishIntent.intentId
    ) {
      return current;
    }
    const now = this.clock.now();
    const intent: TeamMissionFinishIntent = {
      intentId: this.ids.next("finish"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint("team.mission.cancel", input),
      completionEventId: this.ids.next("event"),
      kind: "canceled",
      reason: input.reason,
      stage: "requested",
      requestedAt: now,
      updatedAt: now,
    };
    return this.missions.beginFinish({
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      intent,
    });
  }

  async completeMission(input: CompleteMissionInput): Promise<TeamMission> {
    const stored = await this.requireMission(input.missionId);
    const finishing = await this.serializeTeamLifecycle(stored.mission.teamId, () =>
      this.completeMissionWithinLifecycle(input),
    );
    return this.resumeMissionFinish(finishing);
  }

  private async completeMissionWithinLifecycle(
    input: CompleteMissionInput,
  ): Promise<StoredMission> {
    const stored = await this.requireMission(input.missionId);
    const requestFingerprint = fingerprint("team.mission.complete", input);
    if (
      stored.finishIntent?.idempotencyKey === input.idempotencyKey &&
      stored.finishIntent.requestFingerprint === requestFingerprint
    ) {
      return stored;
    }
    const acceptedTurnsById = new Map<string, AcceptedTurnFact>();
    for (const acceptedTurn of input.acceptedTurns) {
      if (acceptedTurnsById.has(acceptedTurn.turnId)) {
        throw new TeamApplicationError(
          "mission_completion_gate_failed",
          `Mission ${input.missionId} has duplicate accepted turn ${acceptedTurn.turnId}`,
        );
      }
      acceptedTurnsById.set(acceptedTurn.turnId, acceptedTurn);
    }
    const now = this.clock.now();
    const validation = validateTeamMission(
      {
        ...stored.mission,
        status: "completed",
        suspendedStatus: null,
        completedAt: now,
      },
      { acceptedTurnsById },
    );
    if (stored.mission.status !== "verifying" || !validation.ok) {
      const issueKinds = validation.ok
        ? ["mission_not_verifying"]
        : validation.issues.map((issue) => issue.kind);
      throw new TeamApplicationError(
        "mission_completion_gate_failed",
        `Mission ${input.missionId} cannot complete: ${issueKinds.join(", ")}`,
      );
    }
    const intent: TeamMissionFinishIntent = {
      intentId: this.ids.next("finish"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      completionEventId: this.ids.next("event"),
      kind: "completed",
      reason: "Final verification quality gate passed",
      stage: "requested",
      requestedAt: now,
      updatedAt: now,
    };
    return this.missions.beginFinish({
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      intent,
    });
  }

  async failMission(input: FailMissionInput): Promise<TeamMission> {
    const stored = await this.requireMission(input.missionId);
    const finishing = await this.serializeTeamLifecycle(stored.mission.teamId, () =>
      this.failMissionWithinLifecycle(input),
    );
    return this.resumeMissionFinish(finishing);
  }

  private async failMissionWithinLifecycle(input: FailMissionInput): Promise<StoredMission> {
    const stored = await this.requireMission(input.missionId);
    const requestFingerprint = fingerprint("team.mission.fail", input);
    if (
      stored.finishIntent?.idempotencyKey === input.idempotencyKey &&
      stored.finishIntent.requestFingerprint === requestFingerprint
    ) {
      return stored;
    }
    const reason = input.reason.trim();
    if (!reason) {
      throw new TeamApplicationError(
        "invalid_fatal_failure",
        `Mission ${input.missionId} failure reason is required`,
      );
    }
    if (
      input.failureKind === "lead_provision_failed" &&
      (stored.mission.status !== "planning" ||
        stored.mission.planRevision !== 0 ||
        stored.mission.assignments.some((assignment) => assignment.acceptedTurnId !== null))
    ) {
      throw new TeamApplicationError(
        "invalid_fatal_failure",
        `Mission ${input.missionId} already has planned or accepted work`,
      );
    }
    const now = this.clock.now();
    const intent: TeamMissionFinishIntent = {
      intentId: this.ids.next("finish"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      completionEventId: this.ids.next("event"),
      kind: "failed",
      reason: `${input.failureKind}: ${reason}`,
      stage: "requested",
      requestedAt: now,
      updatedAt: now,
    };
    return this.missions.beginFinish({
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      intent,
    });
  }

  async resolveAttention(input: ResolveMissionAttentionInput): Promise<TeamMission> {
    const stored = await this.requireMission(input.missionId);
    if (input.resolution.kind === "cancel_mission") {
      const finishing = await this.serializeTeamLifecycle(stored.mission.teamId, () =>
        this.beginAttentionCancelWithinLifecycle(input),
      );
      return this.resumeMissionFinish(finishing);
    }
    if (input.resolution.kind === "replace_lead") {
      return this.workspaceLifecycle.serialize([stored.mission.workspaceId], async () => {
        await this.requireActiveWorkspace(stored.mission.workspaceId);
        return this.serializeTeamLifecycle(stored.mission.teamId, () =>
          this.resolveAttentionWithinLifecycle(input),
        );
      });
    }
    return this.serializeTeamLifecycle(stored.mission.teamId, () =>
      this.resolveAttentionWithinLifecycle(input),
    );
  }

  async refreshMissionCapabilities(
    input: RefreshMissionCapabilitiesInput,
  ): Promise<RefreshMissionCapabilitiesResult> {
    const initial = await this.requireMission(input.missionId);
    return this.serializeTeamLifecycle(initial.mission.teamId, async () => {
      const current = await this.requireMission(input.missionId);
      const requestFingerprint = fingerprint("team.mission.capability.refresh", {
        missionId: input.missionId,
        attentionId: input.attentionId,
        expectedRevision: input.expectedRevision,
      });
      const replay = current.mission.capabilityReplanRequests.find(
        (request) => request.idempotencyKey === input.idempotencyKey,
      );
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) {
          throw new TeamApplicationError(
            "team_mission_capability_refresh_idempotency_conflict",
            `Capability refresh key ${input.idempotencyKey} has different input`,
          );
        }
        return capabilityRefreshResult(current.mission.revision, replay);
      }
      const pending = current.mission.capabilityReplanRequests.find(
        (request) => request.consumedAt === null,
      );
      if (pending) {
        return capabilityRefreshResult(current.mission.revision, pending);
      }
      if (current.mission.revision !== input.expectedRevision) {
        throw new TeamApplicationError(
          "mission_revision_conflict",
          `Mission ${input.missionId} revision is ${current.mission.revision}, expected ${input.expectedRevision}`,
        );
      }
      const selected = requireAttention(current.mission, input.attentionId);
      if (!isOpenStructuralCapabilityAttention(selected)) {
        throw new TeamApplicationError(
          "team_mission_capability_refresh_not_allowed",
          `Attention ${input.attentionId} is not an open structural capability gate`,
        );
      }
      const activeRoster = requireValue(
        current.mission.rosterSnapshots.find(
          (snapshot) => snapshot.revision === current.mission.activeRosterSnapshotRevision,
        ),
        `Mission ${input.missionId} active roster snapshot is missing`,
      );
      const refreshedMembers = await Promise.all(
        activeRoster.members.map(async (member) => ({
          ...structuredClone(member),
          capabilityFacts: await this.capabilities.resolve(member.executionProfile),
        })),
      );
      if (stableJson(refreshedMembers) === stableJson(activeRoster.members)) {
        return {
          disposition: "unchanged",
          reason: "capability_declarations_unchanged",
          missionRevision: current.mission.revision,
          rosterSnapshotRevision: activeRoster.revision,
        };
      }

      const sourceAttentionIds = current.mission.attentionItems
        .filter(isOpenStructuralCapabilityAttention)
        .map((attention) => attention.attentionId)
        .filter((attentionId, index, values) => values.indexOf(attentionId) === index)
        .toSorted();
      const rosterSnapshotRevision =
        Math.max(...current.mission.rosterSnapshots.map((snapshot) => snapshot.revision)) + 1;
      const createdAt = this.clock.now();
      const requestId = deterministicCapabilityRefreshId(
        "request",
        input.missionId,
        input.idempotencyKey,
      );
      const deliveryId = deterministicCapabilityRefreshId("delivery", requestId, "lead");
      const roomMessageId = deterministicCapabilityRefreshId("message", requestId, "room");
      const leadMember = requireValue(
        refreshedMembers.find((member) => member.memberId === activeRoster.leadMemberId),
        `Mission ${input.missionId} active Lead is missing from its roster`,
      );
      const leadParticipant = requireValue(
        current.mission.participants.find(
          (participant) =>
            participant.memberId === activeRoster.leadMemberId && participant.archivedAt === null,
        ),
        `Mission ${input.missionId} active Lead has no Participant binding`,
      );
      const request: MissionCapabilityReplanRequest = {
        requestId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        sourceAttentionIds,
        rosterSnapshotRevision,
        deliveryId,
        createdAt,
        consumedAt: null,
      };
      const body = capabilityReplanDeliveryBody({
        mentionHandle: leadMember.mentionHandle,
        requestId,
        rosterSnapshotRevision,
      });
      const updated = await this.missions.updateAggregate({
        missionId: input.missionId,
        expectedRevision: input.expectedRevision,
        update: ({ mission, recovery }) => ({
          mission: {
            ...mission,
            activeRosterSnapshotRevision: rosterSnapshotRevision,
            rosterSnapshots: [
              ...mission.rosterSnapshots,
              {
                ...structuredClone(activeRoster),
                revision: rosterSnapshotRevision,
                reason: "replan",
                members: refreshedMembers,
                createdAt,
              },
            ],
            capabilityReplanRequests: [...mission.capabilityReplanRequests, request],
          },
          recovery: {
            ...recovery,
            recipientAttentionOutbox: [
              ...recovery.recipientAttentionOutbox,
              {
                deliveryId,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint,
                roomMessageId,
                senderMemberId: leadMember.memberId,
                senderAgentId: leadParticipant.agentId,
                recipientMemberId: leadMember.memberId,
                bindingEpoch: leadParticipant.bindingEpoch,
                mentionHandle: leadMember.mentionHandle,
                body,
                roomPostedAt: null,
                roomCursor: null,
                attempts: 0,
                createdAt,
                successorDeliveryId: null,
                state: "pending",
                lastAttemptAt: null,
                nextEligibleAt: createdAt,
                acknowledgedAt: null,
                canceledAt: null,
                cancelReason: null,
              },
            ],
          },
        }),
      });
      await this.events.publishMission(updated.mission);
      return capabilityRefreshResult(updated.mission.revision, request);
    });
  }

  private async beginAttentionCancelWithinLifecycle(
    input: ResolveMissionAttentionInput,
  ): Promise<StoredMission> {
    const current = await this.requireMission(input.missionId);
    const attention = requireAttention(current.mission, input.attentionId);
    const requestedResolution = toAttentionResolution(input, this.clock.now());
    const kindIssues = validateMissionAttentionResolution(
      current.mission,
      attention,
      requestedResolution,
    ).filter((issue) => issue.kind === "invalid_attention_resolution_kind");
    if (kindIssues.length > 0) {
      throw new TeamApplicationError(
        "invalid_attention_resolution",
        `Attention ${input.attentionId} does not support ${input.resolution.kind}`,
      );
    }
    const replay = await this.findAttentionResolutionReplay(input);
    if (replay) return replay;
    return this.cancelMissionFromAttention(input);
  }

  private async resolveAttentionWithinLifecycle(
    input: ResolveMissionAttentionInput,
  ): Promise<TeamMission> {
    const current = await this.requireMission(input.missionId);
    const attention = requireAttention(current.mission, input.attentionId);
    const requestedResolution = toAttentionResolution(input, this.clock.now());
    const kindIssues = validateMissionAttentionResolution(
      current.mission,
      attention,
      requestedResolution,
    ).filter((issue) => issue.kind === "invalid_attention_resolution_kind");
    if (kindIssues.length > 0) {
      throw new TeamApplicationError(
        "invalid_attention_resolution",
        `Attention ${input.attentionId} does not support ${input.resolution.kind}`,
      );
    }
    if (input.resolution.kind === "replace_lead") {
      return this.replaceLeadFromAttention(current, input);
    }
    if (input.resolution.kind === "waive_review") {
      return this.waiveReviewFromAttention(input);
    }
    const prerequisite =
      PUBLIC_ATTENTION_RESOLUTION_PREREQUISITES[
        input.resolution.kind as keyof typeof PUBLIC_ATTENTION_RESOLUTION_PREREQUISITES
      ];
    if (prerequisite) {
      throw new TeamApplicationError(
        prerequisite.code,
        `Attention resolution ${input.resolution.kind} requires ${prerequisite.action}`,
      );
    }
    if (!IMPLEMENTED_ATTENTION_RESOLUTION_KINDS.has(input.resolution.kind)) {
      throw new TeamApplicationError(
        "attention_resolution_not_implemented",
        `Attention resolution ${input.resolution.kind} has no application side effect`,
      );
    }
    const replay = await this.findAttentionResolutionReplay(input);
    if (replay) {
      return replay.mission;
    }
    if (input.resolution.kind === "restore_notification") {
      return this.restoreNotificationFromAttention(input);
    }
    if (input.resolution.kind === "attribute_owner") {
      return this.attributeOwnershipFromAttention(input);
    }
    let stored: StoredMission;
    try {
      stored = await this.missions.update({
        missionId: input.missionId,
        expectedRevision: input.expectedRevision,
        update: (mission) =>
          input.resolution.kind === "resume_provider"
            ? resumeProviderAssignment(mission, input, this.clock.now())
            : resolveMissionAttention(mission, input, this.clock.now()),
      });
    } catch (error) {
      if (error instanceof MissionRevisionConflictError) {
        const concurrentReplay = await this.findAttentionResolutionReplay(input);
        if (concurrentReplay) return concurrentReplay.mission;
      }
      throw error;
    }
    await this.events.publishMission(stored.mission);
    return stored.mission;
  }

  private async waiveReviewFromAttention(
    input: ResolveMissionAttentionInput,
  ): Promise<TeamMission> {
    if (input.resolution.kind !== "waive_review" || !input.waiverSource) {
      throw new TeamApplicationError(
        "team_controller_capability_required",
        "Review waiver requires physical controller source attribution",
      );
    }
    const replay = await this.findAttentionResolutionReplay(input);
    if (replay) return replay.mission;
    const decidedAt = this.clock.now();
    let stored: StoredMission;
    try {
      stored = await this.missions.update({
        missionId: input.missionId,
        expectedRevision: input.expectedRevision,
        update: (mission) => applyReviewWaiver(mission, input, decidedAt, this.ids.next("waiver")),
      });
    } catch (error) {
      if (error instanceof MissionRevisionConflictError) {
        const concurrentReplay = await this.findAttentionResolutionReplay(input);
        if (concurrentReplay) return concurrentReplay.mission;
      }
      throw error;
    }
    await this.events.publishMission(stored.mission);
    return stored.mission;
  }

  private async replaceLeadFromAttention(
    current: StoredMission,
    input: ResolveMissionAttentionInput,
  ): Promise<TeamMission> {
    if (input.resolution.kind !== "replace_lead") {
      throw new TeamApplicationError(
        "invalid_attention_resolution",
        `Attention resolution ${input.resolution.kind} cannot replace the Lead`,
      );
    }
    const replacementMemberId = input.resolution.replacementMemberId;
    if (!replacementMemberId) {
      throw new TeamApplicationError(
        "replacement_lead_required",
        "replace_lead requires replacementMemberId",
      );
    }
    const requestFingerprint = fingerprint("team.mission.attention.replace_lead", input);
    if (current.leadReplacementIntent) {
      assertLeadReplacementReplay(current.leadReplacementIntent, input, requestFingerprint);
      return this.resumeLeadReplacement(current);
    }
    const replay = await this.findAttentionResolutionReplay(input);
    if (replay) return replay.mission;

    const activeRoster = requireValue(
      current.mission.rosterSnapshots.find(
        (snapshot) => snapshot.revision === current.mission.activeRosterSnapshotRevision,
      ),
      `Mission ${current.mission.id} active roster snapshot is missing`,
    );
    if (replacementMemberId === activeRoster.leadMemberId) {
      throw new TeamApplicationError(
        "replacement_lead_unchanged",
        `Member ${replacementMemberId} is already the active Lead`,
      );
    }
    const replacement = activeRoster.members.find(
      (member) => member.memberId === replacementMemberId,
    );
    if (!replacement) {
      throw new TeamApplicationError(
        "replacement_lead_not_in_active_roster",
        `Member ${replacementMemberId} is not in the active Mission roster`,
      );
    }
    if (hasOpenAcceptedWork(current.mission, replacementMemberId)) {
      throw new TeamApplicationError(
        "replacement_lead_has_open_accepted_work",
        `Member ${replacementMemberId} has open accepted work`,
      );
    }
    const capabilityFacts = await this.capabilities.resolve(replacement.executionProfile);
    if (capabilityFacts.kind === "unknown") {
      throw new TeamApplicationError(
        "methodology_capability_unknown",
        `Replacement Lead ${replacementMemberId} capability facts are unavailable from provider ${capabilityFacts.providerId}`,
      );
    }
    if (!capabilityFacts.capabilityIds.includes("structured-tools")) {
      throw new TeamApplicationError(
        "methodology_capability_unsatisfied",
        `Replacement Lead ${replacementMemberId} does not declare structured-tools`,
      );
    }

    const profile = await this.requireTeam(current.mission.teamId);
    const missionStartIntentId =
      profile.startIntent?.missionId === current.mission.id ? profile.startIntent.intentId : null;
    const now = this.clock.now();
    const rosterSnapshotRevision =
      Math.max(...current.mission.rosterSnapshots.map((snapshot) => snapshot.revision)) + 1;
    const bindingEpoch =
      Math.max(
        0,
        ...current.mission.participants
          .filter((participant) => participant.memberId === replacementMemberId)
          .map((participant) => participant.bindingEpoch),
      ) + 1;
    const intent: TeamLeadReplacementIntent = {
      intentId: this.ids.next("replacement"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      attentionId: input.attentionId,
      missionStartIntentId,
      previousLeadMemberId: activeRoster.leadMemberId,
      replacementMemberId,
      replacementAgentId: this.ids.next("agent"),
      supersededParticipantAgentIds: [
        ...new Set(
          current.mission.participants
            .filter(
              (participant) =>
                participant.archivedAt === null &&
                (participant.memberId === activeRoster.leadMemberId ||
                  participant.memberId === replacementMemberId),
            )
            .map((participant) => participant.agentId),
        ),
      ],
      bindingEpoch,
      rosterSnapshotRevision,
      stage: "reserved",
      requestedAt: now,
      updatedAt: now,
    };
    let persisted: StoredMission;
    try {
      persisted = await this.missions.beginLeadReplacement({
        missionId: input.missionId,
        expectedRevision: input.expectedRevision,
        intent,
        update: (mission) =>
          applyLeadReplacement({ mission, input, intent, capabilityFacts, replacedAt: now }),
      });
    } catch (error) {
      if (error instanceof MissionRevisionConflictError) {
        const concurrent = await this.requireMission(input.missionId);
        if (concurrent.leadReplacementIntent) {
          assertLeadReplacementReplay(concurrent.leadReplacementIntent, input, requestFingerprint);
          return this.resumeLeadReplacement(concurrent);
        }
      }
      throw error;
    }
    return this.resumeLeadReplacement(persisted);
  }

  private async resumeLeadReplacement(stored: StoredMission): Promise<TeamMission> {
    let current = stored;
    let intent = requireValue(
      stored.leadReplacementIntent,
      `Mission ${stored.mission.id} has no pending Lead replacement`,
    );
    const roster = requireValue(
      current.mission.rosterSnapshots.find(
        (snapshot) => snapshot.revision === intent.rosterSnapshotRevision,
      ),
      `Mission ${current.mission.id} replacement roster snapshot is missing`,
    );
    const replacement = requireValue(
      roster.members.find((member) => member.memberId === intent.replacementMemberId),
      `Mission ${current.mission.id} replacement Member is missing`,
    );
    const profile = await this.profiles.alignMissionStartLead({
      teamId: current.mission.teamId,
      missionId: current.mission.id,
      missionStartIntentId: intent.missionStartIntentId,
      previousLeadMemberId: intent.previousLeadMemberId,
      replacementAgentId: intent.replacementAgentId,
      bindingEpoch: intent.bindingEpoch,
      rosterSnapshot: roster,
    });
    const ownsPendingMissionStart =
      intent.missionStartIntentId !== null || profile.startIntent?.missionId === current.mission.id;
    if (intent.stage === "reserved") {
      for (const agentId of intent.supersededParticipantAgentIds) {
        await this.participants.archiveParticipant({
          agentId,
          teamId: current.mission.teamId,
          missionId: current.mission.id,
        });
      }
      try {
        current = await this.missions.advanceLeadReplacement({
          missionId: current.mission.id,
          intentId: intent.intentId,
          from: "reserved",
          to: "superseded_archived",
        });
      } catch (error) {
        if (error instanceof MissionLeadReplacementConflictError) {
          const concurrent = await this.requireMission(current.mission.id);
          if (!concurrent.leadReplacementIntent) {
            await this.events.publishMission(concurrent.mission);
            return concurrent.mission;
          }
        }
        throw error;
      }
      intent = requireValue(
        current.leadReplacementIntent,
        `Mission ${current.mission.id} Lead replacement disappeared after participant cleanup`,
      );
    }
    if (ownsPendingMissionStart) {
      if (profile.startIntent) {
        if (profile.startIntent.stage === "lead_created") {
          await this.createMissionLead(profile, profile.startIntent);
        }
        await this.resumeMissionStart(profile, intent.intentId);
      } else if (profile.profile.activeMissionId !== current.mission.id) {
        throw new TeamApplicationError(
          "mission_start_conflict",
          `Mission start for ${current.mission.id} no longer belongs to Team ${current.mission.teamId}`,
        );
      }
      const completed = await this.missions.completeLeadReplacement({
        missionId: current.mission.id,
        intentId: intent.intentId,
      });
      await this.events.publishMission(completed.mission);
      return completed.mission;
    }
    await this.participants.createLead({
      agentId: intent.replacementAgentId,
      teamId: current.mission.teamId,
      missionId: current.mission.id,
      workspaceId: current.mission.workspaceId,
      memberId: replacement.memberId,
      role: replacement.role,
      mentionHandle: replacement.mentionHandle,
      executionProfile: replacement.executionProfile,
      methodologyPromptSections: current.mission.methodologySnapshot.promptSections.filter(
        (section) => section.audience === "lead",
      ),
      bindingEpoch: intent.bindingEpoch,
    });
    const completed = await this.missions.completeLeadReplacement({
      missionId: current.mission.id,
      intentId: intent.intentId,
    });
    await this.events.publishMission(completed.mission);
    return completed.mission;
  }

  private async attributeOwnershipFromAttention(
    input: ResolveMissionAttentionInput,
  ): Promise<TeamMission> {
    if (input.resolution.kind !== "attribute_owner") {
      throw new TeamApplicationError(
        "invalid_attention_resolution",
        `Attention resolution ${input.resolution.kind} cannot attribute ownership`,
      );
    }
    const ownerAssignmentId = input.resolution.ownerAssignmentId;
    const attributedAt = this.clock.now();
    let stored: StoredMission;
    try {
      stored = await this.missions.updateAggregate({
        missionId: input.missionId,
        expectedRevision: input.expectedRevision,
        update: ({ mission, recovery }) => {
          const attention = requireAttention(mission, input.attentionId);
          if (!attention.assignmentId) {
            throw new TeamApplicationError(
              "attention_assignment_required",
              `Attention ${attention.attentionId} has no source Assignment`,
            );
          }
          if (attention.pathEvidence.length === 0) {
            throw new TeamApplicationError(
              "attention_path_evidence_required",
              `Attention ${attention.attentionId} has no path evidence`,
            );
          }
          const owner = mission.assignments.find(
            (assignment) => assignment.assignmentId === ownerAssignmentId,
          );
          if (!owner) {
            throw new TeamApplicationError(
              "owner_assignment_not_found",
              `Assignment ${ownerAssignmentId} does not exist`,
            );
          }
          if (
            !mutableScopeOwnsPaths(
              owner.mutableScope,
              attention.pathEvidence.map(({ path }) => path),
            )
          ) {
            throw new TeamApplicationError(
              "owner_assignment_scope_mismatch",
              `Assignment ${owner.assignmentId} does not own every path in Attention ${attention.attentionId}`,
            );
          }
          return {
            mission: resolveMissionAttention(mission, input, attributedAt),
            recovery: {
              ...recovery,
              assignmentDeltaHandoffs: [
                ...recovery.assignmentDeltaHandoffs,
                {
                  sourceAssignmentId: attention.assignmentId,
                  replacementAssignmentId: owner.assignmentId,
                  reportHoldLeaseId: null,
                  capturedDelta: structuredClone(attention.pathEvidence),
                  createdAt: attributedAt,
                },
              ],
            },
          };
        },
      });
    } catch (error) {
      if (error instanceof MissionRevisionConflictError) {
        const concurrentReplay = await this.findAttentionResolutionReplay(input);
        if (concurrentReplay) return concurrentReplay.mission;
      }
      throw error;
    }
    await this.events.publishMission(stored.mission);
    return stored.mission;
  }

  private async restoreNotificationFromAttention(
    input: ResolveMissionAttentionInput,
  ): Promise<TeamMission> {
    const current = await this.requireMission(input.missionId);
    const attention = requireAttention(current.mission, input.attentionId);
    const deliveryId = notificationDeliveryId(attention.attentionId);
    const successorDeliveryId = notificationRecoveryDeliveryId(deliveryId);
    const restoredAt = this.clock.now();
    let stored: StoredMission;
    try {
      stored = await this.missions.updateAggregate({
        missionId: input.missionId,
        expectedRevision: input.expectedRevision,
        update: ({ mission, recovery }) => {
          const delivery = recovery.recipientAttentionOutbox.find(
            (candidate) => candidate.deliveryId === deliveryId,
          );
          if (!delivery) {
            throw new TeamApplicationError(
              "notification_delivery_not_found",
              `Notification delivery ${deliveryId} does not exist`,
            );
          }
          if (delivery.state === "canceled") {
            throw new TeamApplicationError(
              "notification_delivery_canceled",
              `Notification delivery ${deliveryId} is canceled`,
            );
          }
          if (delivery.state === "acknowledged") {
            throw new TeamApplicationError(
              "notification_delivery_acknowledged",
              `Notification delivery ${deliveryId} is already acknowledged`,
            );
          }
          const hasSuccessor = recovery.recipientAttentionOutbox.some(
            (candidate) => candidate.deliveryId === successorDeliveryId,
          );
          const recipientAttentionOutbox = [
            ...recovery.recipientAttentionOutbox.map((candidate) =>
              candidate.deliveryId === deliveryId
                ? {
                    ...candidate,
                    state: "canceled" as const,
                    successorDeliveryId,
                    nextEligibleAt: null,
                    acknowledgedAt: null,
                    canceledAt: restoredAt,
                    cancelReason: "attention_resolved" as const,
                  }
                : candidate,
            ),
            ...(hasSuccessor
              ? []
              : [
                  {
                    ...delivery,
                    deliveryId: successorDeliveryId,
                    idempotencyKey: `${delivery.idempotencyKey}:recovery`,
                    attempts: 0,
                    createdAt: restoredAt,
                    successorDeliveryId: null,
                    state: "pending" as const,
                    lastAttemptAt: null,
                    nextEligibleAt: restoredAt,
                    acknowledgedAt: null,
                    canceledAt: null,
                    cancelReason: null,
                  },
                ]),
          ];
          return {
            mission: resolveMissionAttention(mission, input, restoredAt),
            recovery: { ...recovery, recipientAttentionOutbox },
          };
        },
      });
    } catch (error) {
      if (error instanceof MissionRevisionConflictError) {
        const concurrentReplay = await this.findAttentionResolutionReplay(input);
        if (concurrentReplay) return concurrentReplay.mission;
      }
      throw error;
    }
    await this.events.publishMission(stored.mission);
    return stored.mission;
  }

  private async cancelMissionFromAttention(
    input: ResolveMissionAttentionInput,
  ): Promise<StoredMission> {
    const now = this.clock.now();
    const intent: TeamMissionFinishIntent = {
      intentId: this.ids.next("finish"),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint("team.mission.attention.cancel", input),
      completionEventId: this.ids.next("event"),
      kind: "canceled",
      reason: input.resolution.reason,
      stage: "requested",
      requestedAt: now,
      updatedAt: now,
    };
    return this.missions.beginFinish({
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      intent,
      update: (mission) => resolveMissionAttention(mission, input, now),
    });
  }

  async reconcile(): Promise<void> {
    await this.resumePendingLeadReplacements();
    await this.resumeArchivedMissionFinishes();
    const blockedActions = new Set<string>();
    for (let pass = 0; pass < 100; pass += 1) {
      const result = await this.recovery.reconcile();
      await this.reconcileCompletionActions(result.actions);
      await this.recordMissingProfileRecoveryAttentions(result.actions);
      const lifecycleActions = result.actions.filter(
        (action) =>
          action.kind === "resume_mission_start" ||
          action.kind === "resume_mission_finish" ||
          action.kind === "resume_team_archive",
      );
      if (lifecycleActions.length === 0) return;
      let attemptedAction = false;
      for (const action of lifecycleActions) {
        const actionKey = `${action.kind}:${action.intentId}`;
        if (blockedActions.has(actionKey)) continue;
        if (action.kind === "resume_mission_start") {
          let outcome: "missing" | "blocked" | "resumed";
          try {
            outcome = await this.resumeMissionStartRecoveryAction(action);
          } catch (error) {
            attemptedAction = true;
            blockedActions.add(actionKey);
            await this.recordMissionStartRecoveryFailureBestEffort(action, error);
            continue;
          }
          if (outcome === "missing") continue;
          if (outcome === "blocked") {
            blockedActions.add(actionKey);
            continue;
          }
          attemptedAction = true;
          continue;
        }
        if (action.kind === "resume_team_archive") {
          const profile = await this.profiles.get(action.teamId);
          if (!profile?.archiveIntent) continue;
          attemptedAction = true;
          try {
            await this.workspaceLifecycle.serialize(
              await this.teamLifecycleWorkspaceIds(profile),
              () => this.resumeTeamArchive(profile),
            );
          } catch {
            blockedActions.add(actionKey);
          }
          continue;
        }
        const mission = await this.missions.get(action.missionId);
        if (!mission?.finishIntent) continue;
        attemptedAction = true;
        try {
          await this.resumeMissionFinish(mission);
        } catch {
          blockedActions.add(actionKey);
        }
      }
      if (!attemptedAction) return;
    }
    throw new TeamApplicationError(
      "reconciliation_did_not_converge",
      "Team lifecycle reconciliation exceeded 100 passes",
    );
  }

  private async resumeMissionStartRecoveryAction(
    action: Extract<
      Awaited<ReturnType<TeamRecoveryPort["reconcile"]>>["actions"][number],
      { kind: "resume_mission_start" }
    >,
  ): Promise<"missing" | "blocked" | "resumed"> {
    const profile = await this.profiles.get(action.teamId);
    if (!profile?.startIntent) return "missing";
    const workspaceId = profile.startIntent.workspaceId;
    return this.workspaceLifecycle.serialize([workspaceId], async () => {
      if (!(await this.workspaces.isActive(workspaceId))) {
        await this.prepareWorkspaceArchive(workspaceId);
        return "resumed";
      }
      if (await this.isMissionStartRecoveryBlocked(action.missionId, action.intentId)) {
        return "blocked";
      }
      await this.serializeTeamLifecycle(action.teamId, async () => {
        const current = await this.requireTeam(action.teamId);
        if (current.startIntent?.intentId !== action.intentId) return;
        await this.resumeMissionStart(current);
      });
      return "resumed";
    });
  }

  private async isMissionStartRecoveryBlocked(
    missionId: string,
    startIntentId: string,
  ): Promise<boolean> {
    const mission = await this.missions.get(missionId);
    return Boolean(
      mission?.leadReplacementIntent || hasOpenLifecycleAttention(mission, startIntentId),
    );
  }

  private async resumePendingLeadReplacements(): Promise<void> {
    for (const mission of await this.missions.list()) {
      if (!mission.leadReplacementIntent) continue;
      if (mission.finishIntent || isTerminalMission(mission.mission)) {
        if (
          mission.finishIntent?.stage === "requested" ||
          mission.finishIntent?.stage === "dispatch_stopped"
        ) {
          continue;
        }
        try {
          await this.serializeTeamLifecycle(mission.mission.teamId, () =>
            this.archivePendingLeadReplacement(mission),
          );
        } catch {
          // Finish recovery retains both intents until participant cleanup can replay.
        }
        continue;
      }
      try {
        await this.workspaceLifecycle.serialize([mission.mission.workspaceId], async () => {
          if (!(await this.workspaces.isActive(mission.mission.workspaceId))) {
            await this.prepareWorkspaceArchive(mission.mission.workspaceId);
            return;
          }
          await this.serializeTeamLifecycle(mission.mission.teamId, () =>
            this.resumeLeadReplacement(mission),
          );
        });
      } catch {
        // The persisted binding and replacement intent remain replayable.
      }
    }
  }

  async recordRecoveryAttention(input: RecordMissionRecoveryAttentionInput): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = await this.requireMission(input.missionId);
      if (stored.finishIntent || isTerminalMission(stored.mission)) {
        return;
      }
      let updated: StoredMission;
      try {
        updated = await this.missions.update({
          missionId: input.missionId,
          expectedRevision: stored.mission.revision,
          expectedStorageRevision: stored.storageRevision,
          update: (mission) => addRecoveryAttention(mission, input, this.clock.now()),
        });
      } catch (error) {
        if (
          (error instanceof MissionRevisionConflictError ||
            error instanceof MissionStorageRevisionConflictError) &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
      if (updated.mission.revision !== stored.mission.revision) {
        await this.events.publishMission(updated.mission);
      }
      return;
    }
  }

  private async reconcileCompletionActions(
    actions: TeamPersistenceRecoveryAction[],
  ): Promise<void> {
    for (const action of actions) {
      if (action.kind !== "deliver_mission_completion") continue;
      try {
        await this.serializeTeamLifecycle(action.teamId, () =>
          this.deliverMissionCompletion(action.missionId, action.eventId),
        );
      } catch {
        // The durable outbox remains pending or notified for the next reconciliation pass.
      }
    }
  }

  private async recordMissingProfileRecoveryAttentions(
    actions: TeamPersistenceRecoveryAction[],
  ): Promise<void> {
    const persistenceAttentionMissionIds = new Set(
      actions.flatMap((action) =>
        action.kind === "persistence_attention" ? [action.missionId] : [],
      ),
    );
    for (const action of actions) {
      if (
        action.kind !== "persistence_attention" ||
        (action.code !== "team_profile_missing" &&
          action.code !== "start_intent_mission_workspace_mismatch")
      ) {
        continue;
      }
      try {
        const profileMissing = action.code === "team_profile_missing";
        await this.recordRecoveryAttention({
          missionId: action.missionId,
          attentionId: `persistence:${action.code}:${action.missionId}`,
          kind: "ownership_violation",
          summary: profileMissing
            ? "Team profile is missing for this Mission"
            : "Mission workspace does not match its durable start intent",
        });
      } catch {
        // A Mission-level persistence failure remains scoped to this action.
      }
    }
    for (const stored of await this.missions.list()) {
      if (persistenceAttentionMissionIds.has(stored.mission.id)) continue;
      const attentionPrefix = `persistence:team_profile_missing:${stored.mission.id}`;
      const hasOpenAttention = stored.mission.attentionItems.some(
        (item) =>
          (item.attentionId === attentionPrefix ||
            item.attentionId.startsWith(`${attentionPrefix}:generation:`)) &&
          item.status === "open",
      );
      if (!hasOpenAttention) continue;
      try {
        const profile = await this.profiles.get(stored.mission.teamId);
        if (
          !profile ||
          (profile.profile.activeMissionId !== stored.mission.id &&
            profile.startIntent?.missionId !== stored.mission.id)
        ) {
          continue;
        }
        await this.resolveMissingProfileRecoveryAttention(stored.mission.id, attentionPrefix);
      } catch {
        // Profile recovery and Mission persistence remain isolated to this Mission.
      }
    }
  }

  private async resolveMissingProfileRecoveryAttention(
    missionId: string,
    attentionPrefix: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = await this.requireMission(missionId);
      const openAttention = stored.mission.attentionItems.find(
        (item) =>
          (item.attentionId === attentionPrefix ||
            item.attentionId.startsWith(`${attentionPrefix}:generation:`)) &&
          item.status === "open",
      );
      if (!openAttention) return;
      let updated: StoredMission;
      try {
        updated = await this.missions.update({
          missionId,
          expectedRevision: stored.mission.revision,
          update: (mission) =>
            resolveMissionAttention(
              mission,
              {
                idempotencyKey: `recover:${openAttention.attentionId}`,
                missionId,
                attentionId: openAttention.attentionId,
                expectedRevision: mission.revision,
                actorId: "team-runtime",
                resolution: {
                  kind: "external_change",
                  reason: "The Team profile is readable again",
                },
              },
              this.clock.now(),
            ),
        });
      } catch (error) {
        if (error instanceof MissionRevisionConflictError && attempt < 2) continue;
        throw error;
      }
      await this.events.publishMission(updated.mission);
      return;
    }
  }

  private async resumeArchivedMissionFinishes(): Promise<void> {
    for (const mission of await this.missions.list()) {
      if (mission.finishIntent?.stage !== "participants_archived") continue;
      try {
        await this.resumeMissionFinish(mission);
      } catch {
        // The durable stage and recovery failure remain for the normal reconciliation report.
      }
    }
  }

  private async recordMissionStartRecoveryFailure(
    action: Extract<
      Awaited<ReturnType<TeamRecoveryPort["reconcile"]>>["actions"][number],
      { kind: "resume_mission_start" }
    >,
    error: unknown,
  ): Promise<void> {
    const stored = await this.missions.get(action.missionId);
    if (!stored || isTerminalMission(stored.mission)) return;
    const attentionId = lifecycleAttentionId(action.intentId);
    const updated = await this.missions.update({
      missionId: action.missionId,
      expectedRevision: stored.mission.revision,
      update: (mission) => {
        if (
          isTerminalMission(mission) ||
          mission.attentionItems.some(
            (item) => item.attentionId === attentionId && item.status === "open",
          )
        ) {
          return mission;
        }
        return applyMissionAttentionTransition(mission, {
          kind: "raise",
          item: {
            attentionId,
            kind: "lead_unavailable",
            scope: { kind: "mission" },
            status: "open",
            priorMissionStatus: recoverableMissionStatus(mission),
            assignmentId: null,
            summary: `Mission start recovery failed: ${errorMessage(error)}`,
            pathEvidence: [],
            createdAt: this.clock.now(),
            resolution: null,
          },
        });
      },
    });
    await this.events.publishMission(updated.mission);
  }

  private async recordMissionStartRecoveryFailureBestEffort(
    action: Extract<
      Awaited<ReturnType<TeamRecoveryPort["reconcile"]>>["actions"][number],
      { kind: "resume_mission_start" }
    >,
    error: unknown,
  ): Promise<void> {
    try {
      await this.recordMissionStartRecoveryFailure(action, error);
    } catch {
      // The durable start intent remains available for a later recovery pass.
    }
  }

  private async resumeTeamArchive(profileBeforeResume: StoredTeamProfile): Promise<TeamV2> {
    try {
      return await this.resumeTeamArchiveSteps(profileBeforeResume);
    } catch (error) {
      await this.recordTeamArchiveRecoveryFailure(profileBeforeResume.profile.id, error);
      throw error;
    }
  }

  private async resumeTeamArchiveSteps(profileBeforeResume: StoredTeamProfile): Promise<TeamV2> {
    let profile = profileBeforeResume;
    for (let step = 0; step < 4; step += 1) {
      const intent = profile.archiveIntent;
      if (!intent) {
        if (profile.profile.lifecycle === "archived") return profile.profile;
        throw new TeamApplicationError(
          "team_archive_state_invalid",
          `Team ${profile.profile.id} archive intent disappeared before completion`,
        );
      }
      if (intent.stage === "requested") {
        if (intent.missionId) {
          const persisted = await this.serializeTeamLifecycle(profile.profile.id, async () => {
            const current = await this.requireTeam(profile.profile.id);
            const currentIntent = requireValue(
              current.archiveIntent,
              `Team ${current.profile.id} archive intent disappeared before Mission finish`,
            );
            return this.requireArchiveMission(current, currentIntent);
          });
          profile = persisted.profile;
          const mission = persisted.mission;
          if (!isTerminalMission(mission.mission)) {
            const finishing = await this.serializeTeamLifecycle(profile.profile.id, async () => {
              const current = await this.requireMission(mission.mission.id);
              return current.finishIntent
                ? current
                : this.missions.beginFinish({
                    missionId: current.mission.id,
                    expectedRevision: current.mission.revision,
                    intent: requireValue(
                      intent.missionFinishIntent,
                      `Team ${profile.profile.id} archive has no Mission finish intent`,
                    ),
                  });
            });
            await this.resumeMissionFinish(finishing);
          }
          profile = await this.requireTeam(profile.profile.id);
        }
        profile = await this.serializeTeamLifecycle(profile.profile.id, async () => {
          const current = await this.requireTeam(profile.profile.id);
          if (current.archiveIntent?.stage !== "requested") return current;
          if (intent.missionId) {
            const mission = await this.requireMission(intent.missionId);
            if (!isTerminalMission(mission.mission)) {
              throw new TeamApplicationError(
                "team_archive_mission_not_finished",
                `Team ${current.profile.id} Mission ${mission.mission.id} is not terminal`,
              );
            }
            if (current.profile.activeMissionId === mission.mission.id) {
              await this.profiles.clearActiveMission({
                teamId: current.profile.id,
                missionId: mission.mission.id,
              });
            }
          }
          return this.profiles.advanceArchive({
            teamId: current.profile.id,
            intentId: intent.intentId,
            from: "requested",
            to: "mission_finished",
          });
        });
        continue;
      }
      const archived = await this.serializeTeamLifecycle(profile.profile.id, () =>
        this.profiles.finalizeArchive({
          teamId: profile.profile.id,
          intentId: intent.intentId,
        }),
      );
      await this.events.publishTeam(archived.profile);
      return archived.profile;
    }
    throw new TeamApplicationError(
      "team_archive_did_not_converge",
      `Team archive ${profile.profile.id} did not converge`,
    );
  }

  private async requireArchiveMission(
    profile: StoredTeamProfile,
    intent: TeamArchiveIntent,
  ): Promise<{ profile: StoredTeamProfile; mission: StoredMission }> {
    const missionId = requireValue(
      intent.missionId,
      `Team ${profile.profile.id} archive has no Mission id`,
    );
    const existing = await this.missions.get(missionId);
    if (existing) {
      assertMissionBelongsToTeam(profile, existing);
      return { profile, mission: existing };
    }
    const startIntent = profile.startIntent;
    if (!startIntent || startIntent.missionId !== missionId) {
      throw new TeamApplicationError(
        "team_archive_mission_missing",
        `Team ${profile.profile.id} archive Mission ${missionId} does not exist`,
      );
    }
    return this.transactions.commitMissionStart({
      teamId: profile.profile.id,
      intentId: startIntent.intentId,
      missionId: startIntent.missionId,
    });
  }

  private async resumeMissionStart(
    profileBeforeResume: StoredTeamProfile,
    allowedLeadReplacementIntentId: string | null = null,
  ): Promise<TeamMission> {
    let profile = profileBeforeResume;
    let leadCreatedThisResume = false;
    for (let step = 0; step < 5; step += 1) {
      const intent = profile.startIntent;
      if (!intent) {
        const missionId = requireValue(
          profile.profile.activeMissionId,
          "Mission start completed without an active Mission",
        );
        return (await this.requireMission(missionId)).mission;
      }
      const persistedMission = await this.missions.get(intent.missionId);
      assertMissionMatchesStartWorkspace(persistedMission, intent);
      if (persistedMission && isTerminalMission(persistedMission.mission)) {
        await this.profiles.clearActiveMission({
          teamId: profile.profile.id,
          missionId: intent.missionId,
        });
        return persistedMission.mission;
      }
      if (
        persistedMission?.leadReplacementIntent &&
        persistedMission.leadReplacementIntent.intentId !== allowedLeadReplacementIntentId
      ) {
        throw new TeamApplicationError(
          "lead_replacement_in_progress",
          `Mission ${intent.missionId} start is fenced by Lead replacement ${persistedMission.leadReplacementIntent.intentId}`,
        );
      }
      if (intent.stage === "reserved") {
        const persisted = await this.transactions.commitMissionStart({
          teamId: profile.profile.id,
          intentId: intent.intentId,
          missionId: intent.missionId,
        });
        profile = persisted.profile;
        continue;
      }
      if (intent.stage === "mission_written") {
        await this.rooms.createMissionRoom({
          roomId: intent.chatRoomId,
          teamId: profile.profile.id,
          missionId: intent.missionId,
          teamName: intent.teamName,
          objective: intent.objective,
        });
        profile = await this.profiles.advanceMissionStart({
          teamId: profile.profile.id,
          intentId: intent.intentId,
          from: "mission_written",
          to: "room_created",
        });
        continue;
      }
      if (intent.stage === "room_created") {
        await this.createMissionLead(profile, intent);
        leadCreatedThisResume = true;
        profile = await this.profiles.advanceMissionStart({
          teamId: profile.profile.id,
          intentId: intent.intentId,
          from: "room_created",
          to: "lead_created",
        });
        continue;
      }
      const needsLeadRecovery =
        persistedMission?.mission.status === "planning" &&
        persistedMission.mission.planRevision === 0 &&
        persistedMission.mission.workstreams.length === 0 &&
        persistedMission.mission.assignments.length === 0 &&
        persistedMission.finishIntent === null &&
        !hasOpenLifecycleAttention(persistedMission, intent.intentId);
      if (!leadCreatedThisResume && needsLeadRecovery) {
        await this.createMissionLead(profile, intent);
      }
      const completed = await this.transactions.commitMissionStart({
        teamId: profile.profile.id,
        intentId: intent.intentId,
        missionId: intent.missionId,
      });
      await this.events.publishTeam(completed.profile.profile);
      await this.events.publishMission(completed.mission.mission);
      return completed.mission.mission;
    }
    throw new TeamApplicationError(
      "mission_start_did_not_converge",
      `Mission start for Team ${profile.profile.id} did not converge`,
    );
  }

  private async createMissionLead(
    profile: StoredTeamProfile,
    intent: NonNullable<StoredTeamProfile["startIntent"]>,
  ): Promise<void> {
    const lead = requireValue(
      intent.rosterSnapshot.members.find(
        (member) => member.memberId === intent.rosterSnapshot.leadMemberId,
      ),
      "Lead member is missing from the start intent",
    );
    await this.participants.createLead({
      agentId: intent.leadAgentId,
      teamId: profile.profile.id,
      missionId: intent.missionId,
      workspaceId: intent.workspaceId,
      memberId: lead.memberId,
      role: lead.role,
      mentionHandle: lead.mentionHandle,
      executionProfile: lead.executionProfile,
      methodologyPromptSections: intent.methodologySnapshot.promptSections.filter(
        (section) => section.audience === "lead",
      ),
      bindingEpoch: intent.bindingEpoch,
    });
  }

  private async resumeMissionFinish(missionBeforeResume: StoredMission): Promise<TeamMission> {
    try {
      return await this.resumeMissionFinishSteps(missionBeforeResume);
    } catch (error) {
      await this.recordMissionFinishRecoveryFailure(missionBeforeResume.mission.id, error);
      throw error;
    }
  }

  private async resumeMissionFinishSteps(missionBeforeResume: StoredMission): Promise<TeamMission> {
    let stored = missionBeforeResume;
    for (let step = 0; step < 6; step += 1) {
      const intent = stored.finishIntent;
      if (!intent) return stored.mission;
      if (intent.stage === "requested") {
        stored = await this.serializeTeamLifecycle(stored.mission.teamId, async () => {
          const current = await this.requireMission(stored.mission.id);
          if (current.finishIntent?.stage !== "requested") return current;
          return this.missions.advanceFinish({
            missionId: current.mission.id,
            intentId: intent.intentId,
            from: "requested",
            to: "dispatch_stopped",
          });
        });
        continue;
      }
      if (intent.stage === "dispatch_stopped") {
        const archivedAt = this.clock.now();
        await this.archiveMissionFinishParticipants(stored);
        stored = await this.serializeTeamLifecycle(stored.mission.teamId, async () => {
          let current = await this.requireMission(stored.mission.id);
          if (current.finishIntent?.stage !== "dispatch_stopped") return current;
          current = await this.missions.update({
            missionId: current.mission.id,
            expectedRevision: current.mission.revision,
            update: (mission) => ({
              ...mission,
              participants: mission.participants.map((participant) =>
                Object.assign({}, participant, {
                  archivedAt: participant.archivedAt ?? archivedAt,
                }),
              ),
            }),
          });
          return this.missions.advanceFinish({
            missionId: current.mission.id,
            intentId: intent.intentId,
            from: "dispatch_stopped",
            to: "participants_archived",
          });
        });
        continue;
      }
      if (stored.leadReplacementIntent) {
        stored = await this.archivePendingLeadReplacement(stored);
      }
      if (intent.stage === "participants_archived") {
        await this.finishQuiescence.prepareEvidence({
          missionId: stored.mission.id,
          intentId: intent.intentId,
        });
        stored = await this.serializeTeamLifecycle(stored.mission.teamId, async () => {
          const current = await this.requireMission(stored.mission.id);
          if (current.finishIntent?.stage !== "participants_archived") return current;
          return this.missions.prepareFinishEvidence({
            missionId: current.mission.id,
            intentId: intent.intentId,
          });
        });
        continue;
      }
      const completed = await this.serializeTeamLifecycle(stored.mission.teamId, () =>
        this.transactions.commitMissionFinish({
          teamId: stored.mission.teamId,
          missionId: stored.mission.id,
          intentId: intent.intentId,
        }),
      );
      await this.events.publishTeam(completed.profile.profile);
      try {
        await this.deliverMissionCompletion(completed.mission.mission.id, intent.completionEventId);
      } catch {
        // The durable outbox is replayed by lifecycle reconciliation.
      }
      return completed.mission.mission;
    }
    throw new TeamApplicationError(
      "mission_finish_did_not_converge",
      `Mission finish ${stored.mission.id} did not converge`,
    );
  }

  private async archiveMissionFinishParticipants(stored: StoredMission): Promise<void> {
    const agentIds = new Set(
      stored.mission.participants
        .filter((participant) => participant.archivedAt === null)
        .map((participant) => participant.agentId),
    );
    if (stored.leadReplacementIntent) {
      agentIds.add(stored.leadReplacementIntent.replacementAgentId);
      for (const agentId of stored.leadReplacementIntent.supersededParticipantAgentIds) {
        agentIds.add(agentId);
      }
    }
    for (const agentId of agentIds) {
      await this.participants.archiveParticipant({
        agentId,
        teamId: stored.mission.teamId,
        missionId: stored.mission.id,
      });
    }
  }

  private async archivePendingLeadReplacement(stored: StoredMission): Promise<StoredMission> {
    const intent = stored.leadReplacementIntent;
    if (!intent) return stored;
    const agentIds = new Set([intent.replacementAgentId, ...intent.supersededParticipantAgentIds]);
    for (const agentId of agentIds) {
      await this.participants.archiveParticipant({
        agentId,
        teamId: stored.mission.teamId,
        missionId: stored.mission.id,
      });
    }
    return this.missions.completeLeadReplacement({
      missionId: stored.mission.id,
      intentId: intent.intentId,
    });
  }

  private async recordMissionFinishRecoveryFailure(
    missionId: string,
    error: unknown,
  ): Promise<void> {
    const current = await this.missions.get(missionId);
    if (!current?.finishIntent || isTerminalMission(current.mission)) return;
    const intent = current.finishIntent;
    const previous = current.mission.lifecycleRecoveryFailure;
    const updated = await this.missions.update({
      missionId,
      expectedRevision: current.mission.revision,
      update: (mission) => ({
        ...mission,
        lifecycleRecoveryFailure: {
          operation: "mission_finish",
          intentId: intent.intentId,
          idempotencyKey: intent.idempotencyKey,
          code: recoveryErrorCode(error),
          message: errorMessage(error),
          retryAction: intent.kind === "canceled" ? "cancel_mission" : "resume_mission_finish",
          attempts:
            previous?.operation === "mission_finish" && previous.intentId === intent.intentId
              ? previous.attempts + 1
              : 1,
          failedAt: this.clock.now(),
        },
      }),
    });
    await this.events.publishMission(updated.mission);
  }

  private async deliverMissionCompletion(missionId: string, eventId: string): Promise<void> {
    let stored = await this.requireMission(missionId);
    const delivery = stored.completionOutbox.find((candidate) => candidate.eventId === eventId);
    if (!delivery) return;
    if (delivery.state === "acknowledged") return;
    const attemptedAt = this.clock.now();
    stored = await this.missions.updateRecoveryState({
      missionId,
      expectedStorageRevision: stored.storageRevision,
      update: (recovery) => ({
        ...recovery,
        completionOutbox: recovery.completionOutbox.map((candidate) =>
          candidate.eventId === eventId && candidate.state !== "acknowledged"
            ? {
                ...candidate,
                state: "notified" as const,
                attempts: candidate.attempts + 1,
                lastAttemptAt: attemptedAt,
                acknowledgedAt: null,
              }
            : candidate,
        ),
      }),
    });
    await this.events.publishMission(stored.mission);
    const acknowledgedAt = this.clock.now();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = attempt === 0 ? stored : await this.requireMission(missionId);
      const currentDelivery = current.completionOutbox.find(
        (candidate) => candidate.eventId === eventId,
      );
      if (!currentDelivery) return;
      if (currentDelivery.state === "acknowledged") return;
      try {
        await this.missions.updateRecoveryState({
          missionId,
          expectedStorageRevision: current.storageRevision,
          update: (recovery) => ({
            ...recovery,
            completionOutbox: recovery.completionOutbox.map((candidate) =>
              candidate.eventId === eventId && candidate.state === "notified"
                ? {
                    ...candidate,
                    state: "acknowledged" as const,
                    acknowledgedAt,
                  }
                : candidate,
            ),
          }),
        });
        return;
      } catch (error) {
        if (error instanceof MissionStorageRevisionConflictError && attempt < 2) continue;
        throw error;
      }
    }
  }

  private async recordTeamArchiveRecoveryFailure(teamId: string, error: unknown): Promise<void> {
    const current = await this.profiles.get(teamId);
    if (!current?.archiveIntent || current.profile.lifecycle === "archived") return;
    const intent = current.archiveIntent;
    const previous = current.profile.lifecycleRecoveryFailure;
    const updated = await this.profiles.update({
      teamId,
      expectedRevision: current.profile.revision,
      update: (profile) => ({
        ...profile,
        lifecycleRecoveryFailure: {
          operation: "team_archive",
          intentId: intent.intentId,
          idempotencyKey: intent.idempotencyKey,
          code: recoveryErrorCode(error),
          message: errorMessage(error),
          retryAction: "archive_team",
          attempts:
            previous?.operation === "team_archive" && previous.intentId === intent.intentId
              ? previous.attempts + 1
              : 1,
          failedAt: this.clock.now(),
        },
      }),
    });
    await this.events.publishTeam(updated.profile);
  }

  private async createRosterSnapshot(
    team: TeamV2,
    createdAt: string,
  ): Promise<MissionRosterSnapshot> {
    const members = await Promise.all(
      team.members.map(async (member) =>
        Object.assign(structuredClone(member), {
          capabilityFacts: await this.capabilities.resolve(member.executionProfile),
        }),
      ),
    );
    return {
      revision: 1,
      teamRevision: team.revision,
      leadMemberId: team.leadMemberId,
      reason: "initial",
      skills: structuredClone(team.skills),
      members,
      createdAt,
    };
  }

  private async requireTeam(teamId: string): Promise<StoredTeamProfile> {
    const team = await this.profiles.get(teamId);
    if (!team) throw new TeamApplicationError("team_not_found", `Team ${teamId} does not exist`);
    return team;
  }

  private async requireMission(missionId: string): Promise<StoredMission> {
    const mission = await this.missions.get(missionId);
    if (!mission) {
      throw new TeamApplicationError("mission_not_found", `Mission ${missionId} does not exist`);
    }
    return mission;
  }

  private async requireActiveWorkspace(workspaceId: string): Promise<void> {
    if (await this.workspaces.isActive(workspaceId)) return;
    throw new TeamApplicationError(
      "workspace_not_found",
      `Workspace ${workspaceId} does not exist or is archived`,
    );
  }

  private async teamLifecycleWorkspaceIds(profile: StoredTeamProfile): Promise<string[]> {
    const workspaceIds = new Set<string>();
    if (profile.startIntent) workspaceIds.add(profile.startIntent.workspaceId);
    for (const missionId of [profile.profile.activeMissionId, profile.archiveIntent?.missionId]) {
      if (!missionId) continue;
      const mission = await this.missions.get(missionId);
      if (mission) workspaceIds.add(mission.mission.workspaceId);
    }
    return [...workspaceIds].toSorted();
  }

  private async serializeTeamLifecycle<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
    return this.operations.serialize(teamId, operation);
  }

  private async findAttentionResolutionReplay(
    input: ResolveMissionAttentionInput,
  ): Promise<StoredMission | null> {
    const stored = await this.requireMission(input.missionId);
    const attention = requireAttention(stored.mission, input.attentionId);
    if (attention.status === "open") return null;
    const persisted = requireValue(
      attention.resolution,
      `Resolved Attention ${input.attentionId} has no resolution`,
    );
    const requested = toAttentionResolution(input, persisted.resolvedAt);
    if (stableJson(persisted) === stableJson(requested)) return stored;
    if (
      input.resolution.kind === "waive_review" &&
      persisted.kind === "waive_review" &&
      persisted.idempotencyKey === input.idempotencyKey
    ) {
      throw new TeamApplicationError(
        "team_mission_review_waiver_idempotency_conflict",
        `Review waiver key ${input.idempotencyKey} has different input`,
      );
    }
    throw new TeamApplicationError(
      "attention_resolution_conflict",
      `Attention ${input.attentionId} was resolved by another request (${input.idempotencyKey})`,
    );
  }
}

function resolveMissionAttention(
  mission: TeamMission,
  input: ResolveMissionAttentionInput,
  resolvedAt: string,
): TeamMission {
  const attention = requireAttention(mission, input.attentionId);
  const resolution = toAttentionResolution(input, resolvedAt);
  const resolutionIssues = validateMissionAttentionResolution(mission, attention, resolution);
  if (resolutionIssues.length > 0) {
    throw new TeamApplicationError(
      "invalid_attention_resolution",
      `Attention ${input.attentionId} resolution is invalid: ${resolutionIssues
        .map((issue) => issue.kind)
        .join(", ")}`,
    );
  }
  return applyMissionAttentionTransition(mission, {
    kind: "resolve",
    attentionId: attention.attentionId,
    resolution,
  });
}

function applyReviewWaiver(
  mission: TeamMission,
  input: ResolveMissionAttentionInput,
  decidedAt: string,
  waiverId: string,
): TeamMission {
  if (input.resolution.kind !== "waive_review" || !input.waiverSource) {
    throw new TeamApplicationError(
      "invalid_attention_resolution",
      "waive_review context is missing",
    );
  }
  const reason = input.resolution.reason.trim();
  if (!reason) {
    throw new TeamApplicationError(
      "review_waiver_reason_required",
      "Review waiver reason is required",
    );
  }
  const waiverInput = { ...input, resolution: input.resolution };
  const { attention, workstream, gate, roster } = requireWaivableReviewContext(
    mission,
    waiverInput,
  );
  assertNoEligibleReviewers(workstream, gate, roster);
  const waiver: MissionReviewWaiver = {
    waiverId,
    attentionId: attention.attentionId,
    gateKey: structuredClone(gate.gateKey),
    gateKeyFingerprint: gate.gateKeyFingerprint,
    subjectFingerprint: gate.subjectFingerprint,
    connectionId: input.waiverSource.connectionId,
    selfReportedClientLabel: input.waiverSource.selfReportedClientLabel,
    reason,
    createdAt: decidedAt,
  };
  const resolution = toAttentionResolution(input, decidedAt);
  const settledGate = {
    ...gate,
    outcome: {
      kind: "waived" as const,
      gateKeyFingerprint: gate.gateKeyFingerprint,
      subjectFingerprint: gate.subjectFingerprint,
      waiverId,
      decidedAt,
    },
  };
  const withOutcome = {
    ...mission,
    reviewWaivers: [...mission.reviewWaivers, waiver],
    workstreams: mission.workstreams.map((candidate) =>
      candidate.workstreamId === workstream.workstreamId
        ? { ...candidate, reviewGate: settledGate }
        : candidate,
    ),
  };
  const resolved = applyMissionAttentionTransition(withOutcome, {
    kind: "resolve",
    attentionId: attention.attentionId,
    resolution,
  });
  const accepted = resolved.workstreams.find(
    (candidate) => candidate.workstreamId === workstream.workstreamId,
  );
  if (accepted) accepted.status = "accepted";
  return resolved;
}

function requireWaivableReviewContext(
  mission: TeamMission,
  input: ResolveMissionAttentionInput & {
    resolution: Extract<TeamMissionAttentionResolutionInput, { kind: "waive_review" }>;
  },
) {
  const attention = requireAttention(mission, input.attentionId);
  if (
    attention.status !== "open" ||
    attention.kind !== "review_gate_reviewer_unavailable" ||
    attention.scope.kind !== "workstream"
  ) {
    throw new TeamApplicationError(
      "review_waiver_attention_conflict",
      `Attention ${input.attentionId} is not an open known-empty review gate`,
    );
  }
  const workstream = mission.workstreams.find(
    (candidate) => candidate.workstreamId === attention.scope.workstreamId,
  );
  const gate = workstream?.reviewGate;
  if (
    !workstream ||
    workstream.kind === "verification" ||
    workstream.status !== "blocked" ||
    gate?.kind !== "required" ||
    gate.outcome.kind !== "pending" ||
    gate.selection.kind !== "awaiting_reviewer"
  ) {
    throw new TeamApplicationError(
      "review_waiver_gate_conflict",
      `Review gate for Attention ${input.attentionId} is no longer pending for a reviewer`,
    );
  }
  if (
    mission.attentionItems.some(
      (candidate) =>
        candidate.attentionId !== attention.attentionId &&
        candidate.status === "open" &&
        candidate.scope.kind === "workstream" &&
        candidate.scope.workstreamId === workstream.workstreamId,
    )
  ) {
    throw new TeamApplicationError(
      "review_waiver_attention_conflict",
      `Workstream ${workstream.workstreamId} has another open Attention`,
    );
  }
  assertCurrentWaivableGate(mission, input, attention, workstream, gate);
  const roster = mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === workstream.rosterSnapshotRevision,
  );
  if (!roster || roster.members.some((member) => member.capabilityFacts.kind !== "known")) {
    throw new TeamApplicationError(
      "review_waiver_capability_unknown",
      "Every frozen reviewer capability fact must be known",
    );
  }
  return { attention, workstream, gate, roster };
}

function assertCurrentWaivableGate(
  mission: TeamMission,
  input: ResolveMissionAttentionInput & {
    resolution: Extract<TeamMissionAttentionResolutionInput, { kind: "waive_review" }>;
  },
  attention: Extract<MissionAttentionItem, { kind: "review_gate_reviewer_unavailable" }>,
  workstream: TeamMission["workstreams"][number],
  gate: Extract<TeamMission["workstreams"][number]["reviewGate"], { kind: "required" }>,
): void {
  if (
    mission.methodologySnapshot.hardPolicy.review.operatorWaiver !== "allowed_with_reason" ||
    gate.gateKey.planRevision !== mission.planRevision ||
    gate.gateKey.planRevision !== workstream.planRevision ||
    gate.gateKeyFingerprint !== input.resolution.gateKeyFingerprint ||
    gate.subjectFingerprint !== input.resolution.subjectFingerprint ||
    attention.reviewGateDetails.gateKeyFingerprint !== gate.gateKeyFingerprint ||
    attention.reviewGateDetails.subjectFingerprint !== gate.subjectFingerprint
  ) {
    throw new TeamApplicationError(
      "review_waiver_gate_conflict",
      `Review gate for Attention ${input.attentionId} is no longer current or waivable`,
    );
  }
}

function assertNoEligibleReviewers(
  workstream: TeamMission["workstreams"][number],
  gate: Extract<TeamMission["workstreams"][number]["reviewGate"], { kind: "required" }>,
  roster: TeamMission["rosterSnapshots"][number],
): void {
  const match = matchWorkstreamReviewer({
    candidates: roster.members.map((profile) => ({ profile, openAssignments: 0 })),
    ...gate.requirements,
    previousReviewerMemberId: null,
    ownerMemberId: workstream.ownerMemberId,
    ownerMutableScope: workstream.mutableScope,
  });
  if (match.kind === "matched") {
    throw new TeamApplicationError(
      "review_waiver_reviewer_available",
      "A structurally eligible reviewer is available",
    );
  }
}

function applyLeadReplacement(input: {
  mission: TeamMission;
  input: ResolveMissionAttentionInput;
  intent: TeamLeadReplacementIntent;
  capabilityFacts: MissionCapabilityFacts;
  replacedAt: string;
}): TeamMission {
  const activeRoster = requireValue(
    input.mission.rosterSnapshots.find(
      (snapshot) => snapshot.revision === input.mission.activeRosterSnapshotRevision,
    ),
    `Mission ${input.mission.id} active roster snapshot is missing`,
  );
  const resolved = resolveMissionAttention(input.mission, input.input, input.replacedAt);
  const hasOpenReplanAttention = resolved.attentionItems.some(
    (attention) =>
      attention.kind === "assignment_requires_replan" &&
      attention.status === "open" &&
      attention.assignmentId === null,
  );
  const replanAttention = {
    attentionId: `lead-replacement:${input.intent.attentionId}:replan`,
    kind: "assignment_requires_replan" as const,
    scope: { kind: "mission" as const },
    status: "open" as const,
    priorMissionStatus: recoverableMissionStatus(input.mission),
    assignmentId: null,
    summary: "The replacement Lead must submit a new Mission plan.",
    pathEvidence: [],
    createdAt: input.replacedAt,
    resolution: null,
  };
  const nextRoster: MissionRosterSnapshot = {
    revision: input.intent.rosterSnapshotRevision,
    teamRevision: activeRoster.teamRevision,
    leadMemberId: input.intent.replacementMemberId,
    reason: "replan",
    skills: structuredClone(activeRoster.skills),
    members: activeRoster.members.map((member) =>
      member.memberId === input.intent.replacementMemberId
        ? Object.assign(structuredClone(member), {
            capabilityFacts: structuredClone(input.capabilityFacts),
          })
        : structuredClone(member),
    ),
    createdAt: input.replacedAt,
  };
  const replaced = {
    ...resolved,
    activeRosterSnapshotRevision: nextRoster.revision,
    rosterSnapshots: [...resolved.rosterSnapshots, nextRoster],
    participants: [
      ...resolved.participants.map((participant) =>
        participant.archivedAt === null &&
        (participant.memberId === input.intent.previousLeadMemberId ||
          participant.memberId === input.intent.replacementMemberId)
          ? Object.assign({}, participant, { archivedAt: input.replacedAt })
          : participant,
      ),
      {
        memberId: input.intent.replacementMemberId,
        agentId: input.intent.replacementAgentId,
        bindingEpoch: input.intent.bindingEpoch,
        joinedAt: input.replacedAt,
        archivedAt: null,
      },
    ],
  };
  return hasOpenReplanAttention
    ? replaced
    : applyMissionAttentionTransition(replaced, { kind: "raise", item: replanAttention });
}

function recoverableMissionStatus(mission: TeamMission): "planning" | "active" | "verifying" {
  const status = mission.status === "needs_attention" ? mission.suspendedStatus : mission.status;
  if (status === "planning" || status === "active" || status === "verifying") return status;
  throw new TeamApplicationError(
    "mission_not_recoverable",
    `Mission ${mission.id} cannot replace its Lead from status ${String(status)}`,
  );
}

function assertLeadReplacementReplay(
  intent: TeamLeadReplacementIntent,
  input: ResolveMissionAttentionInput,
  requestFingerprint: string,
): void {
  if (
    intent.idempotencyKey === input.idempotencyKey &&
    intent.requestFingerprint === requestFingerprint
  ) {
    return;
  }
  throw new TeamApplicationError(
    "attention_resolution_conflict",
    `Attention ${input.attentionId} has another Lead replacement in progress`,
  );
}

function hasOpenAcceptedWork(mission: TeamMission, memberId: string): boolean {
  return mission.assignments.some(
    (assignment) =>
      assignment.assigneeMemberId === memberId &&
      assignment.acceptedTurnId !== null &&
      assignment.semanticState !== "completed" &&
      assignment.semanticState !== "failed" &&
      assignment.semanticState !== "canceled",
  );
}

function resumeProviderAssignment(
  mission: TeamMission,
  input: ResolveMissionAttentionInput,
  resolvedAt: string,
): TeamMission {
  if (input.resolution.kind !== "resume_provider") {
    throw new TeamApplicationError(
      "invalid_attention_resolution",
      `Attention resolution ${input.resolution.kind} cannot resume a provider`,
    );
  }
  const attention = requireAttention(mission, input.attentionId);
  if (!attention.assignmentId) {
    throw new TeamApplicationError(
      "attention_assignment_required",
      `Attention ${attention.attentionId} has no blocked Assignment`,
    );
  }
  const assignment = mission.assignments.find(
    (candidate) => candidate.assignmentId === attention.assignmentId,
  );
  if (
    !assignment ||
    assignment.semanticState !== "blocked" ||
    assignment.terminationReason !== "provider_unavailable"
  ) {
    throw new TeamApplicationError(
      "assignment_not_provider_blocked",
      `Assignment ${attention.assignmentId} is not blocked by provider availability`,
    );
  }
  const resolved = resolveMissionAttention(mission, input, resolvedAt);
  return {
    ...resolved,
    assignments: resolved.assignments.map((candidate) =>
      candidate.assignmentId === assignment.assignmentId
        ? Object.assign({}, candidate, {
            revision: candidate.revision + 1,
            semanticState: "planned" as const,
            terminationReason: null,
          })
        : candidate,
    ),
  };
}

function mutableScopeOwnsPaths(
  scope: TeamMission["assignments"][number]["mutableScope"],
  paths: string[],
): boolean {
  if (scope.kind === "workspace") return true;
  if (scope.kind === "read_only") return false;
  return paths.every((path) =>
    scope.pathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );
}

function assertMemberMutationTargets(team: TeamV2, input: UpdateTeamInput): void {
  const memberIds = new Set(team.members.map((member) => member.memberId));
  for (const memberId of [
    ...(input.memberUpdates ?? []).map((member) => member.memberId),
    ...(input.memberRemovals ?? []),
  ]) {
    if (!memberIds.has(memberId)) {
      throw new TeamApplicationError(
        "member_not_found",
        `Member ${memberId} does not belong to Team ${team.id}`,
      );
    }
  }
}

function applyMemberPatch(
  member: TeamMemberProfile,
  patch: TeamProfileMemberPatch | undefined,
  executionByKey: ReadonlyMap<string, MaterializedTeamMemberExecution>,
): TeamMemberProfile {
  if (!patch) return member;
  const executionProfileSelection = patch.executionProfileSelection;
  const base: TeamMemberProfile = {
    ...member,
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.skillIds !== undefined ? { skillIds: structuredClone(patch.skillIds) } : {}),
  };
  if (!executionProfileSelection) return base;
  const execution = requireValue(
    executionByKey.get(`update:${member.memberId}`),
    `Member ${member.memberId} execution selection was not materialized`,
  );
  const { executionProfileSource: _previousSource, ...withoutSource } = base;
  return {
    ...withoutSource,
    executionProfile: structuredClone(execution.executionProfile),
    ...(execution.executionProfileSource
      ? { executionProfileSource: structuredClone(execution.executionProfileSource) }
      : {}),
  };
}

function assertMutableTeam(team: TeamV2, archiveIntent: StoredTeamProfile["archiveIntent"]): void {
  if (team.lifecycle !== "active") {
    throw new TeamApplicationError("team_archived", `Team ${team.id} is archived`);
  }
  if (archiveIntent) {
    throw new TeamApplicationError(
      "team_archive_in_progress",
      `Team ${team.id} has an archive in progress`,
    );
  }
}

function validateMethodologyUpgrade(
  current: TeamV2,
  startIntent: StoredTeamProfile["startIntent"],
  input: UpdateTeamInput,
  methodologies: TeamMissionServiceOptions["methodologies"],
): void {
  const upgrade = input.methodologyUpgrade;
  if (!upgrade) return;
  if (!exactMethodologyRefsEqual(current.methodologyBinding.ref, upgrade.expectedRef)) {
    throw new TeamApplicationError(
      "methodology_ref_conflict",
      `Team ${current.id} Methodology changed after the upgrade was planned`,
    );
  }
  if (current.activeMissionId || startIntent) {
    throw new TeamApplicationError(
      "methodology_upgrade_requires_idle_team",
      `Team ${current.id} must be idle before its Methodology can be upgraded`,
    );
  }
  if (input.memberAdds?.length || input.memberRemovals?.length || input.skills) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      "Methodology upgrade cannot be combined with Team catalog or roster shape changes",
    );
  }
  const methodology = methodologies.get(upgrade.ref);
  if (!methodology) {
    throw new TeamApplicationError(
      "methodology_not_found",
      `Methodology ${upgrade.ref.bundleId}@${upgrade.ref.version} was not found`,
    );
  }
  validatePersistedMethodologyBinding(
    {
      ...current,
      methodologyBinding: {
        ref: structuredClone(upgrade.ref),
        presetId: upgrade.presetId,
        memberArchetypeBindings: structuredClone(upgrade.memberArchetypeBindings),
        skillBindings: structuredClone(upgrade.skillBindings),
      },
    },
    methodology,
  );
}

function validatePersistedMethodologyBinding(
  team: TeamV2,
  methodology: MethodologyDescriptor,
): void {
  const presetId = team.methodologyBinding.presetId;
  if (presetId !== null && !methodology.presets.some((preset) => preset.presetId === presetId)) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      `Methodology preset ${presetId} does not exist`,
    );
  }
  const memberIds = new Set(team.members.map((member) => member.memberId));
  const boundMemberIds = new Set<string>();
  for (const binding of team.methodologyBinding.memberArchetypeBindings) {
    const archetypeExists = methodology.archetypes.some(
      (archetype) => archetype.archetypeId === binding.archetypeId,
    );
    if (
      !memberIds.has(binding.memberId) ||
      boundMemberIds.has(binding.memberId) ||
      (binding.archetypeId !== null && !archetypeExists)
    ) {
      throw new TeamApplicationError(
        "methodology_binding_invalid",
        `Invalid Member binding for ${binding.memberId}`,
      );
    }
    boundMemberIds.add(binding.memberId);
  }
  if (boundMemberIds.size !== memberIds.size) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      "Every Team Member must have one Methodology archetype binding",
    );
  }
  const skillIds = new Set(team.skills.map((skill) => skill.skillId));
  const boundSkillIds = new Set<string>();
  for (const binding of team.methodologyBinding.skillBindings) {
    const methodologySkillExists = methodology.skills.some(
      (skill) => skill.skillId === binding.methodologySkillId,
    );
    if (
      !skillIds.has(binding.teamSkillId) ||
      boundSkillIds.has(binding.teamSkillId) ||
      (binding.methodologySkillId !== null && !methodologySkillExists)
    ) {
      throw new TeamApplicationError(
        "methodology_binding_invalid",
        `Invalid Skill binding for ${binding.teamSkillId}`,
      );
    }
    boundSkillIds.add(binding.teamSkillId);
  }
  if (boundSkillIds.size !== skillIds.size) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      "Every Team Skill must have one Methodology Skill binding",
    );
  }
}

function assertRosterMutationAllowed(
  team: TeamV2,
  startIntent: StoredTeamProfile["startIntent"],
  input: UpdateTeamInput,
): void {
  const removesMember = (input.memberRemovals?.length ?? 0) > 0;
  const changesLead = input.leadMemberId !== undefined && input.leadMemberId !== team.leadMemberId;
  if ((team.activeMissionId || startIntent) && (removesMember || changesLead)) {
    throw new TeamApplicationError(
      "mission_roster_change_requires_transition",
      `Team ${team.id} roster ownership can only change through a Mission transition`,
    );
  }
}

function assertMissionBelongsToTeam(team: StoredTeamProfile, mission: StoredMission): void {
  if (mission.mission.teamId !== team.profile.id) {
    throw new TeamApplicationError(
      "mission_team_conflict",
      `Mission ${mission.mission.id} does not belong to Team ${team.profile.id}`,
    );
  }
}

function assertMissionMatchesStartWorkspace(
  mission: StoredMission | null,
  intent: NonNullable<StoredTeamProfile["startIntent"]>,
): void {
  if (!mission || mission.mission.workspaceId === intent.workspaceId) return;
  throw new TeamApplicationError(
    "mission_start_workspace_conflict",
    `Mission ${intent.missionId} targets workspace ${mission.mission.workspaceId}, but its start intent targets ${intent.workspaceId}`,
  );
}

function normalizeMissionWorkspaceId(workspaceId: string): string {
  return workspaceId.trim();
}

function requireAttention(mission: TeamMission, attentionId: string) {
  const attention = mission.attentionItems.find((item) => item.attentionId === attentionId);
  if (!attention) {
    throw new TeamApplicationError(
      "attention_not_found",
      `Attention ${attentionId} does not exist`,
    );
  }
  return attention;
}

function notificationDeliveryId(attentionId: string): string {
  const prefix = "notification:";
  if (!attentionId.startsWith(prefix) || attentionId.length === prefix.length) {
    throw new TeamApplicationError(
      "notification_delivery_not_found",
      `Attention ${attentionId} has no notification delivery`,
    );
  }
  return attentionId.slice(prefix.length);
}

function notificationRecoveryDeliveryId(deliveryId: string): string {
  return `${deliveryId}:recovery`;
}

function validateCreateMethodologyBinding(
  input: CreateTeamInput,
  methodology: MethodologyDescriptor,
): void {
  const presetId = input.methodologyBinding.presetId;
  if (presetId !== null && !methodology.presets.some((preset) => preset.presetId === presetId)) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      `Methodology preset ${presetId} does not exist`,
    );
  }
  const memberKeys = new Set(input.members.map((member) => member.clientMemberKey));
  const boundMemberKeys = new Set<string>();
  for (const binding of input.methodologyBinding.memberArchetypeBindings) {
    if (!memberKeys.has(binding.clientMemberKey) || boundMemberKeys.has(binding.clientMemberKey)) {
      throw new TeamApplicationError(
        "methodology_binding_invalid",
        `Invalid Member binding for ${binding.clientMemberKey}`,
      );
    }
    if (
      binding.archetypeId !== null &&
      !methodology.archetypes.some((archetype) => archetype.archetypeId === binding.archetypeId)
    ) {
      throw new TeamApplicationError(
        "methodology_binding_invalid",
        `Methodology archetype ${binding.archetypeId} does not exist`,
      );
    }
    boundMemberKeys.add(binding.clientMemberKey);
  }
  if (boundMemberKeys.size !== memberKeys.size) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      "Every Team Member must have one Methodology archetype binding",
    );
  }

  const teamSkillIds = new Set(input.skills.map((skill) => skill.skillId));
  const boundSkillIds = new Set<string>();
  for (const binding of input.methodologyBinding.skillBindings) {
    if (!teamSkillIds.has(binding.teamSkillId) || boundSkillIds.has(binding.teamSkillId)) {
      throw new TeamApplicationError(
        "methodology_binding_invalid",
        `Invalid Skill binding for ${binding.teamSkillId}`,
      );
    }
    if (
      binding.methodologySkillId !== null &&
      !methodology.skills.some((skill) => skill.skillId === binding.methodologySkillId)
    ) {
      throw new TeamApplicationError(
        "methodology_binding_invalid",
        `Methodology Skill ${binding.methodologySkillId} does not exist`,
      );
    }
    boundSkillIds.add(binding.teamSkillId);
  }
  if (boundSkillIds.size !== teamSkillIds.size) {
    throw new TeamApplicationError(
      "methodology_binding_invalid",
      "Every Team Skill must have one Methodology Skill binding",
    );
  }
}

function assignMentionHandles<
  Member extends {
    memberId: string;
    role: string;
    mentionHandle: string;
  },
>(
  members: Member[],
  reservedMentionHandles: readonly string[] = [],
): Array<Member & { mentionHandle: string }> {
  return assignTeamMentionHandles(
    members.map((member) => Object.assign({}, member, { agentId: member.memberId })),
    { reservedHandles: reservedMentionHandles },
  ).map(({ agentId: _agentId, ...member }) => member as Member & { mentionHandle: string });
}

function assertValidTeamProfile(team: TeamV2): void {
  const validation = validateTeamProfile(team);
  if (!validation.ok) {
    throw new TeamApplicationError(
      "invalid_team_profile",
      `Team profile is invalid: ${validation.issues.map((issue) => issue.kind).join(", ")}`,
    );
  }
}

function fingerprint(operation: string, value: unknown): string {
  return `${operation}:${stableJson(value)}`;
}

const STRUCTURAL_CAPABILITY_ATTENTION_KINDS = new Set<MissionAttentionItem["kind"]>([
  "review_gate_reviewer_unavailable",
  "review_gate_capability_unknown",
  "final_verifier_unavailable",
  "final_verifier_capability_unknown",
]);

function isOpenStructuralCapabilityAttention(attention: MissionAttentionItem): boolean {
  return (
    attention.status === "open" &&
    attention.scope.kind === "workstream" &&
    STRUCTURAL_CAPABILITY_ATTENTION_KINDS.has(attention.kind)
  );
}

function deterministicCapabilityRefreshId(
  kind: "request" | "delivery" | "message",
  owner: string,
  key: string,
): string {
  const digest = createHash("sha256")
    .update(`${kind}\0${owner}\0${key}`)
    .digest("hex")
    .slice(0, 32);
  return `capability-refresh-${kind}-${digest}`;
}

function capabilityRefreshResult(
  missionRevision: number,
  request: MissionCapabilityReplanRequest,
): RefreshMissionCapabilitiesResult {
  return {
    disposition: "replan_requested",
    missionRevision,
    rosterSnapshotRevision: request.rosterSnapshotRevision,
    requestId: request.requestId,
    sourceAttentionIds: [...request.sourceAttentionIds],
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactMethodologyRefsEqual(
  left: MethodologyDescriptor["ref"],
  right: MethodologyDescriptor["ref"],
): boolean {
  return (
    left.bundleId === right.bundleId &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

function methodologyRosterProjection(roster: MissionRosterSnapshot): {
  rosterSnapshotRevision: number;
  leadMemberId: string;
  members: Array<{
    memberId: string;
    role: string;
    level: number;
    skillIds: string[];
    capabilityFacts: MissionCapabilityFacts;
  }>;
} {
  return {
    rosterSnapshotRevision: roster.revision,
    leadMemberId: roster.leadMemberId,
    members: roster.members.map((member) => ({
      memberId: member.memberId,
      role: member.role,
      level: member.level,
      skillIds: structuredClone(member.skillIds),
      capabilityFacts: structuredClone(member.capabilityFacts),
    })),
  };
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined)
    throw new TeamApplicationError("invalid_state", message);
  return value;
}

function isTerminalMission(mission: TeamMission): boolean {
  return (
    mission.status === "completed" || mission.status === "failed" || mission.status === "canceled"
  );
}

function addRecoveryAttention(
  mission: TeamMission,
  input: RecordMissionRecoveryAttentionInput,
  createdAt: string,
): TeamMission {
  if (isTerminalMission(mission)) return mission;
  const generationPrefix = `${input.attentionId}:generation:`;
  const matching = mission.attentionItems.filter(
    (item) =>
      item.attentionId === input.attentionId || item.attentionId.startsWith(generationPrefix),
  );
  if (matching.some((item) => item.status === "open")) return mission;

  let priorMissionStatus: TeamMission["suspendedStatus"] = null;
  if (mission.status === "needs_attention") {
    priorMissionStatus = mission.suspendedStatus;
  } else if (
    mission.status === "planning" ||
    mission.status === "active" ||
    mission.status === "verifying"
  ) {
    priorMissionStatus = mission.status;
  } else {
    priorMissionStatus = "verifying";
  }
  if (
    priorMissionStatus !== "planning" &&
    priorMissionStatus !== "active" &&
    priorMissionStatus !== "verifying"
  ) {
    return mission;
  }
  const maxGeneration = matching.reduce((maximum, item) => {
    if (!item.attentionId.startsWith(generationPrefix)) return maximum;
    const generation = Number.parseInt(item.attentionId.slice(generationPrefix.length), 10);
    return Number.isSafeInteger(generation) ? Math.max(maximum, generation) : maximum;
  }, 0);
  const attentionId =
    matching.length === 0
      ? input.attentionId
      : `${generationPrefix}${Math.max(1, maxGeneration + 1)}`;
  return applyMissionAttentionTransition(mission, {
    kind: "raise",
    item: {
      attentionId,
      kind: input.kind,
      scope: { kind: "mission" },
      status: "open",
      priorMissionStatus,
      assignmentId: null,
      summary: input.summary,
      pathEvidence: [],
      createdAt,
      resolution: null,
    },
  });
}

function lifecycleAttentionId(intentId: string): string {
  return `lifecycle-start-${intentId}`;
}

function hasOpenLifecycleAttention(mission: StoredMission | null, intentId: string): boolean {
  const attentionId = lifecycleAttentionId(intentId);
  return (
    mission?.mission.attentionItems.some(
      (item) => item.attentionId === attentionId && item.status === "open",
    ) ?? false
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireActiveRoster(mission: TeamMission) {
  const roster = mission.rosterSnapshots.find(
    (snapshot) => snapshot.revision === mission.activeRosterSnapshotRevision,
  );
  if (!roster) throw new Error(`Mission ${mission.id} has no active roster snapshot`);
  return roster;
}

function latestActiveParticipant(mission: TeamMission, memberId: string) {
  return (
    mission.participants
      .filter((participant) => participant.memberId === memberId && participant.archivedAt === null)
      .toSorted((left, right) => right.bindingEpoch - left.bindingEpoch)[0] ?? null
  );
}

function recoveryErrorCode(error: unknown): string {
  return error instanceof TeamApplicationError ? error.code : "lifecycle_recovery_failed";
}

function toAttentionResolution(
  input: ResolveMissionAttentionInput,
  resolvedAt: string,
): MissionAttentionResolution {
  const common = {
    actorId: input.actorId,
    reason: input.resolution.reason,
    resolvedAt,
  };
  if (input.resolution.kind === "waive_review") {
    if (!input.waiverSource) {
      throw new TeamApplicationError(
        "team_controller_capability_required",
        "Review waiver source attribution is missing",
      );
    }
    return {
      kind: "waive_review",
      idempotencyKey: input.idempotencyKey,
      gateKeyFingerprint: input.resolution.gateKeyFingerprint,
      subjectFingerprint: input.resolution.subjectFingerprint,
      connectionId: input.waiverSource.connectionId,
      selfReportedClientLabel: input.waiverSource.selfReportedClientLabel,
      reason: input.resolution.reason.trim(),
      resolvedAt,
      ownerAssignmentId: null,
      recoveryAssignmentId: null,
    };
  }
  if (input.resolution.kind === "attribute_owner") {
    return {
      kind: input.resolution.kind,
      ...common,
      ownerAssignmentId: input.resolution.ownerAssignmentId,
      recoveryAssignmentId: null,
    };
  }
  if (input.resolution.kind === "recovery_assignment") {
    return {
      kind: input.resolution.kind,
      ...common,
      ownerAssignmentId: null,
      recoveryAssignmentId: input.resolution.recoveryAssignmentId,
    };
  }
  if (input.resolution.kind === "replace_lead") {
    return {
      kind: input.resolution.kind,
      ...common,
      ownerAssignmentId: null,
      recoveryAssignmentId: null,
      replacementMemberId: input.resolution.replacementMemberId,
    };
  }
  if (input.resolution.kind === "replan") {
    return {
      kind: input.resolution.kind,
      ...common,
      ownerAssignmentId: null,
      recoveryAssignmentId: null,
      rosterSnapshotRevision: null,
    };
  }
  return {
    kind: input.resolution.kind,
    ...common,
    ownerAssignmentId: null,
    recoveryAssignmentId: null,
  };
}
