import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  MissionAssignmentContract,
  TeamMission,
  TeamProfileMemberInput,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";
import pino from "pino";
import { describe, expect, test } from "vitest";

import { CodexAppServerAgentClient } from "../agent/providers/codex-app-server-agent.js";
import type { TeamPersistenceFaultPoint } from "../team/persistence/transactions.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import type { UsageLedger, UsageTotalsDelta } from "../usage-ledger/index.js";
import {
  type AssignmentDispatchAudit,
  auditAssignmentDispatchEvidence,
  auditParallelDeliveryDag,
  auditRecoveryDependencyDag,
  auditRuntimeRecovery,
  auditToolDiscipline,
  captureWorkspaceEvidence,
  collectCompleteTeamMissionRoomEvidence,
  collectCompleteTimelineEvidence,
  type CompleteTeamMissionRoomEvidence,
  type CompleteTimelineEvidence,
  createStartTurnEvidenceAgentClient,
  executeEvidenceLifecycle,
  type ParallelDeliveryDagAudit,
  persistSanitizedEvidenceManifest,
  persistSanitizedPinoLogEvidence,
  type PersistedSanitizedPinoLogEvidence,
  type ProviderStartTurnEvidence,
  type RecoveryDependencyDagAudit,
  type RuntimeRecoveryAudit,
  type ToolDisciplineAudit,
  validatePositiveTokenUsage,
  waitForMissionEvidence,
  type WorkspaceEvidence,
} from "./team-missions-coordination-evidence.js";

const RUN_REAL_COORDINATION = process.env.PASEO_TEAM_MISSIONS_REAL_E2E === "1";
const PARALLEL_RUN_TIMEOUT_MS = 12 * 60_000;
const RECOVERY_RUN_TIMEOUT_MS = 18 * 60_000;
const TEAM_TOOL_NAMES = [
  "team_status",
  "mission_status",
  "team_member_history",
  "mission_plan",
  "assign_task",
  "assignment_report",
  "team_message",
  "chat_read",
] as const;

type TaskShape = "parallel_delivery" | "recovery_dependency";

interface ShapeDefinition {
  shape: TaskShape;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  skills: Array<{ skillId: string; name: string; description: string }>;
  lead: TeamProfileMemberInput;
  members: TeamProfileMemberInput[];
  scaffold(workspaceRoot: string): void;
  minimumParallelAssignments: number;
  injectedFaultPoint: TeamPersistenceFaultPoint | null;
  timeoutMs: number;
}

interface RunEvidence {
  shape: TaskShape;
  repetition: number;
  provider: "codex";
  model: string | null;
  teamId: string;
  missionId: string;
  missionStatus: TeamMission["status"];
  durationMs: number;
  planningLatencyMs: number | null;
  maxParallelAssignments: number;
  memberIdleMs: Record<string, number>;
  toolCalls: Record<string, number>;
  tokenUsage: UsageTotalsDelta;
  tokenUsageViolations: string[];
  providerStartTurns: ProviderStartTurnEvidence[];
  assignmentDispatchAudit: AssignmentDispatchAudit;
  participantTimelines: Array<{
    memberId: string;
    agentId: string;
    timeline: CompleteTimelineEvidence;
  }>;
  roomHistory: CompleteTeamMissionRoomEvidence;
  sanitizedPinoLog: PersistedSanitizedPinoLogEvidence | null;
  parallelDagAudit: ParallelDeliveryDagAudit | null;
  recoveryDagAudit: RecoveryDependencyDagAudit | null;
  toolDisciplineAudit: ToolDisciplineAudit;
  validationViolations: string[];
  scopeConflicts: number;
  runtimeMetrics: {
    acceptedTurnReplayCount: number;
    busyWaitCallCount: number;
    unresolvedReportCount: number;
    unresolvedAttentionCount: number;
  };
  attentionItems: TeamMission["attentionItems"];
  recovery: RuntimeRecoveryAudit;
  reworkCount: number;
  workspace: WorkspaceEvidence;
  verification: { command: string; passed: boolean; output: string };
  scores: {
    workstreamFit: 0 | 1 | 2;
    coordination: 0 | 1 | 2;
    toolDiscipline: 0 | 1 | 2;
    delivery: 0 | 1 | 2;
    runtimeReliability: 0 | 1 | 2;
    total: number;
    qualifies: boolean;
  };
  mission: TeamMission;
}

interface RunFailureContext {
  phase: string;
  partialMission: TeamMission | null;
  providerStartTurns: ProviderStartTurnEvidence[];
}

const runDescribe = RUN_REAL_COORDINATION ? describe : describe.skip;

runDescribe("Team Missions real-provider coordination", () => {
  for (const definition of [parallelShape(), recoveryShape()]) {
    for (const repetition of [1, 2, 3]) {
      test(
        `${definition.shape} qualifies on consecutive run ${repetition}`,
        async () => {
          const evidence = await runCoordinationMission(definition, repetition);
          expect(evidence.missionStatus).toBe("completed");
          expect(evidence.verification.passed).toBe(true);
          expect(evidence.scores.delivery).toBe(2);
          expect(Object.values(evidence.scores).slice(0, 5)).not.toContain(0);
          expect(evidence.scores.total).toBeGreaterThanOrEqual(8);
          expect(evidence.scores.qualifies).toBe(true);
          expect(evidence.tokenUsage.inputTokens).toBeGreaterThan(0);
          expect(evidence.tokenUsage.outputTokens).toBeGreaterThan(0);
          expect(evidence.assignmentDispatchAudit.valid).toBe(true);
          expect(evidence.validationViolations).toEqual([]);
          if (definition.shape === "parallel_delivery") {
            expect(evidence.parallelDagAudit?.valid).toBe(true);
          } else {
            expect(evidence.recoveryDagAudit?.valid).toBe(true);
          }
          expect(evidence.maxParallelAssignments).toBeGreaterThanOrEqual(
            definition.minimumParallelAssignments,
          );
          expect(evidence.scopeConflicts).toBe(0);
          expect(evidence.runtimeMetrics).toEqual({
            acceptedTurnReplayCount: 0,
            busyWaitCallCount: 0,
            unresolvedReportCount: 0,
            unresolvedAttentionCount: 0,
          });
        },
        definition.timeoutMs,
      );
    }
  }
});

async function runCoordinationMission(
  definition: ShapeDefinition,
  repetition: number,
): Promise<RunEvidence> {
  const providerStartTurns: ProviderStartTurnEvidence[] = [];
  let injected = false;
  const staticDirectories = new Set<string>();
  let phase = "resolve_evidence_root";
  let evidenceRoot: string | null = null;
  let workspaceRoot: string | null = null;
  let paseoHomeRoot: string | null = null;
  let rawLogSourcePath: string | null = null;
  let logDestination: ReturnType<typeof pino.destination> | null = null;
  let logger: ReturnType<typeof pino> | null = null;
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;
  let finalizedPinoLog: PersistedSanitizedPinoLogEvidence | null = null;
  let lastObservedMission: TeamMission | null = null;

  const evidence = await executeEvidenceLifecycle<RunEvidence, RunFailureContext>({
    captureFailureContext: () => ({
      phase,
      partialMission: lastObservedMission,
      providerStartTurns: providerStartTurns.map((record) => ({ ...record })),
    }),
    run: async () => {
      evidenceRoot = requireEvidenceRoot();
      phase = "create_workspace_root";
      workspaceRoot = mkdtempSync(path.join(os.tmpdir(), `paseo-team-real-${definition.shape}-`));
      phase = "create_paseo_home";
      paseoHomeRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-team-real-home-"));
      phase = "scaffold_workspace";
      definition.scaffold(workspaceRoot);
      initializeGitBaseline(workspaceRoot);

      phase = "create_logger";
      rawLogSourcePath = path.join(paseoHomeRoot, "daemon-provider.pino.log");
      logDestination = pino.destination({ dest: rawLogSourcePath, mkdir: true, sync: true });
      logger = pino(
        { level: process.env.PASEO_TEAM_MISSIONS_REAL_E2E_LOG_LEVEL ?? "trace" },
        logDestination,
      );
      const launchDaemon = async (reconcileIntervalMs: number): Promise<TestPaseoDaemon> => {
        if (!paseoHomeRoot || !logger) throw new Error("Daemon launch resources are unavailable");
        const started = await createTestPaseoDaemon({
          paseoHomeRoot,
          cleanup: false,
          logger,
          agentClients: {
            codex: createStartTurnEvidenceAgentClient(
              new CodexAppServerAgentClient(logger),
              providerStartTurns,
            ),
          },
          teamMissionsRuntime: {
            enabled: true,
            reconcileIntervalMs,
            toolIds: [...TEAM_TOOL_NAMES],
          },
          ...(definition.injectedFaultPoint
            ? {
                teamPersistenceFaultInjector: {
                  hit: async (point: TeamPersistenceFaultPoint) => {
                    if (!injected && point === definition.injectedFaultPoint) {
                      injected = true;
                      throw new Error(`real coordination injected crash at ${point}`);
                    }
                  },
                },
              }
            : {}),
        });
        staticDirectories.add(started.staticDir);
        return started;
      };
      const connectClient = async (target: TestPaseoDaemon): Promise<DaemonClient> => {
        const connected = new DaemonClient({
          url: `ws://127.0.0.1:${target.port}/ws`,
          appVersion: "0.3.0-beta.3",
        });
        client = connected;
        await connected.connect();
        await connected.fetchAgents({
          subscribe: { subscriptionId: `real-team-${definition.shape}` },
        });
        expect(connected.supportsTeamMissions()).toBe(true);
        return connected;
      };

      phase = "launch_daemon";
      daemon = await launchDaemon(definition.injectedFaultPoint ? definition.timeoutMs : 5_000);
      phase = "connect_client";
      client = await connectClient(daemon);
      phase = "create_workspace";
      const workspace = await client.createWorkspace({
        source: { kind: "directory", path: workspaceRoot },
        title: `Real Team ${definition.shape} ${repetition}`,
      });
      if (!workspace.workspace) throw new Error(workspace.error ?? "Workspace creation failed");

      phase = "create_team";
      const created = await client.createTeamProfile({
        idempotencyKey: `${definition.shape}-${repetition}-team`,
        name: `${definition.shape} team ${repetition}`,
        workspaceId: workspace.workspace.id,
        skills: definition.skills,
        lead: definition.lead,
        members: definition.members,
      });
      if (!created.team) throw new Error(created.error ?? "Team profile creation failed");

      phase = "start_mission";
      const startedAt = Date.now();
      const startRequest = {
        idempotencyKey: `${definition.shape}-${repetition}-mission`,
        teamId: created.team.id,
        expectedTeamRevision: created.team.revision,
        objective: definition.objective,
        constraints: definition.constraints,
        acceptanceCriteria: definition.acceptanceCriteria,
      };
      const firstStart = await client.startTeamMission(startRequest);
      const firstStartFailed = firstStart.mission === null;
      let startAttempts = 1;
      let startResult = firstStart;
      if (!firstStart.mission && definition.injectedFaultPoint) {
        expect(firstStart.error).toContain("real coordination injected crash");
        phase = "restart_after_injected_start_fault";
        await client.close();
        client = null;
        await daemon.close();
        daemon = null;
        daemon = await launchDaemon(5_000);
        client = await connectClient(daemon);
        startAttempts += 1;
        startResult = await client.startTeamMission(startRequest);
      }
      if (!startResult.mission) {
        throw new Error(startResult.error ?? firstStart.error ?? "Mission start failed");
      }
      lastObservedMission = startResult.mission;

      phase = "wait_for_mission";
      const completed = await waitForMissionEvidence({
        client,
        missionId: startResult.mission.id,
        predicate: (mission) =>
          mission.status === "completed" ||
          mission.status === "failed" ||
          mission.status === "canceled",
        label: "real provider Mission terminal state",
        timeoutMs: definition.timeoutMs - 30_000,
        onObservedMission: (mission) => {
          lastObservedMission = mission;
        },
      });
      const finishedAt = Date.now();
      phase = "verify_workspace";
      const verification = runWorkspaceVerification(workspaceRoot);
      phase = "collect_evidence";
      return collectEvidence({
        client,
        definition,
        repetition,
        team: created.team,
        mission: completed,
        startedAt,
        finishedAt,
        firstStartFailed,
        startAttempts,
        providerStartTurns,
        verification,
        workspaceRoot,
        usageLedger: daemon.daemon.usageLedger,
      });
    },
    finalize: async ({ result, error }) => {
      let finalError = error;
      phase = error === null ? "close_resources" : phase;
      finalError = await retainFirstFailure(finalError, async () => client?.close());
      client = null;
      finalError = await retainFirstFailure(finalError, async () => daemon?.close());
      daemon = null;
      finalError = await retainFirstFailure(finalError, async () => logDestination?.flushSync());

      const persistenceRoot = evidenceRoot ?? failedEvidenceRoot();
      if (rawLogSourcePath && existsSync(rawLogSourcePath)) {
        finalError = await retainFirstFailure(finalError, async () => {
          finalizedPinoLog = persistSanitizedPinoLogEvidence(
            rawLogSourcePath,
            persistenceRoot,
            `${definition.shape}/run-${repetition}.daemon-provider.sanitized.jsonl`,
          );
        });
      }
      if (result && finalError === null) {
        result.sanitizedPinoLog = finalizedPinoLog;
        finalError = await retainFirstFailure(finalError, async () => {
          phase = "validate_evidence";
          assertRunEvidence(result);
        });
      }
      if (error === null && finalError !== null) throw finalError;
    },
    cleanup: async () => {
      phase = "cleanup";
      if (paseoHomeRoot) rmSync(paseoHomeRoot, { recursive: true, force: true });
      if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
      for (const staticDirectory of staticDirectories) {
        rmSync(staticDirectory, { recursive: true, force: true });
      }
    },
    commit: async ({ result, error, failureContext }) => {
      const persistenceRoot = evidenceRoot ?? failedEvidenceRoot();
      if (result && error === null) {
        phase = "persist_evidence";
        await persistEvidence(persistenceRoot, result);
        return;
      }
      await persistFailedEvidence(
        persistenceRoot,
        definition,
        repetition,
        finalizedPinoLog,
        failureContext?.phase ?? phase,
        error ?? new Error("Evidence collection completed without a result"),
        failureContext?.partialMission ?? lastObservedMission,
        failureContext?.providerStartTurns ?? providerStartTurns,
      );
    },
  });
  return evidence;
}

async function retainFirstFailure(
  failure: unknown | null,
  operation: () => Promise<unknown>,
): Promise<unknown | null> {
  try {
    await operation();
    return failure;
  } catch (error) {
    return failure ?? error;
  }
}

async function collectEvidence(input: {
  client: DaemonClient;
  definition: ShapeDefinition;
  repetition: number;
  team: TeamV2;
  mission: TeamMission;
  startedAt: number;
  finishedAt: number;
  firstStartFailed: boolean;
  startAttempts: number;
  providerStartTurns: ProviderStartTurnEvidence[];
  verification: RunEvidence["verification"];
  workspaceRoot: string;
  usageLedger: UsageLedger;
}): Promise<RunEvidence> {
  let busyWaitCallCount = 0;
  const participantTimelines: RunEvidence["participantTimelines"] = [];
  for (const participant of input.mission.participants) {
    const timeline = await collectCompleteTimelineEvidence(input.client, participant.agentId);
    participantTimelines.push({
      memberId: participant.memberId,
      agentId: participant.agentId,
      timeline,
    });
    const items = timeline.entries.map((entry) => entry.item);
    for (const item of items) {
      if (item.type !== "tool_call") continue;
      if (
        item.status === "completed" &&
        (item.name === "chat_wait" || item.name.endsWith("chat_wait"))
      ) {
        busyWaitCallCount += 1;
      }
    }
  }
  const toolDisciplineAudit = auditToolDiscipline(
    participantTimelines.map((participant) => ({
      agentId: participant.agentId,
      entries: participant.timeline.entries,
    })),
    input.mission,
  );
  const toolCalls: Record<string, number> = { ...toolDisciplineAudit.successfulCounts };
  const tokenUsage = await input.usageLedger.getTotals({ workspaceId: input.team.workspaceId });
  const tokenUsageViolations = validatePositiveTokenUsage(tokenUsage);
  const roomHistory = await collectCompleteTeamMissionRoomEvidence(input.client, input.mission.id);
  const workspace = captureWorkspaceEvidence(input.workspaceRoot);
  const assignmentDispatchAudit = auditAssignmentDispatchEvidence(
    input.mission,
    input.providerStartTurns,
  );
  const parallelDagAudit =
    input.definition.shape === "parallel_delivery" ? auditParallelDeliveryDag(input.mission) : null;
  const recoveryDagAudit =
    input.definition.shape === "recovery_dependency"
      ? auditRecoveryDependencyDag(input.mission)
      : null;
  const validationViolations = [
    ...tokenUsageViolations,
    ...assignmentDispatchAudit.violations,
    ...(parallelDagAudit?.violations ?? []),
    ...(recoveryDagAudit?.violations ?? []),
  ];

  const assignmentIntervals = input.mission.assignments.flatMap((assignment) => {
    const start = parseTimestamp(assignment.dispatchedAt);
    const end = parseTimestamp(assignment.settledAt);
    return start === null || end === null ? [] : [{ assignment, start, end }];
  });
  const durationMs = input.finishedAt - input.startedAt;
  const memberIdleMs: Record<string, number> = {};
  for (const profile of input.team.members) {
    const busyMs = assignmentIntervals
      .filter((entry) => entry.assignment.assigneeMemberId === profile.memberId)
      .reduce((total, entry) => total + Math.max(0, entry.end - entry.start), 0);
    memberIdleMs[profile.memberId] = Math.max(0, durationMs - busyMs);
  }
  const maxParallelAssignments = maxConcurrency(assignmentIntervals);
  const planningLatencyMs = input.mission.assignments.length
    ? Math.max(
        0,
        Math.min(
          ...input.mission.assignments.map((assignment) => Date.parse(assignment.createdAt)),
        ) - Date.parse(input.mission.createdAt),
      )
    : null;
  const workstreamFit = scoreWorkstreamFit(input.mission, input.team);
  const coordination = scoreCoordination(
    input.mission,
    input.definition,
    maxParallelAssignments,
    parallelDagAudit,
    recoveryDagAudit,
  );
  const toolDiscipline = toolDisciplineAudit.score;
  const delivery = scoreDelivery(input.mission, input.verification.passed);
  const recovery = auditRuntimeRecovery({
    mission: input.mission,
    injectedFaultPoint: input.definition.injectedFaultPoint,
    firstStartFailed: input.firstStartFailed,
    startAttempts: input.startAttempts,
    assignmentDispatchValid: assignmentDispatchAudit.valid,
    providerStartTurns: input.providerStartTurns,
  });
  const runtimeReliability = recovery.score;
  const total = workstreamFit + coordination + toolDiscipline + delivery + runtimeReliability;
  const dimensionScores = [
    workstreamFit,
    coordination,
    toolDiscipline,
    delivery,
    runtimeReliability,
  ];
  return {
    shape: input.definition.shape,
    repetition: input.repetition,
    provider: "codex",
    model:
      input.mission.rosterSnapshots
        .at(-1)
        ?.members.find((candidate) => candidate.memberId === input.team.leadMemberId)
        ?.executionProfile.model ?? null,
    teamId: input.team.id,
    missionId: input.mission.id,
    missionStatus: input.mission.status,
    durationMs,
    planningLatencyMs,
    maxParallelAssignments,
    memberIdleMs,
    toolCalls,
    tokenUsage,
    tokenUsageViolations,
    providerStartTurns: [...input.providerStartTurns],
    assignmentDispatchAudit,
    participantTimelines,
    roomHistory,
    sanitizedPinoLog: null,
    parallelDagAudit,
    recoveryDagAudit,
    toolDisciplineAudit,
    validationViolations,
    scopeConflicts: input.mission.attentionItems.filter(
      (item) => item.kind === "ownership_violation",
    ).length,
    runtimeMetrics: {
      acceptedTurnReplayCount: assignmentDispatchAudit.duplicateBoundaryCrossings,
      busyWaitCallCount,
      unresolvedReportCount: input.mission.assignments.filter(
        (assignment) => assignment.semanticState === "needs_report" || assignment.report === null,
      ).length,
      unresolvedAttentionCount: input.mission.attentionItems.filter(
        (item) => item.status === "open",
      ).length,
    },
    attentionItems: input.mission.attentionItems,
    recovery,
    reworkCount:
      Math.max(0, input.mission.planRevision - 1) +
      input.mission.assignments.filter((assignment) => assignment.supersededBy !== null).length,
    workspace,
    verification: input.verification,
    scores: {
      workstreamFit,
      coordination,
      toolDiscipline,
      delivery,
      runtimeReliability,
      total,
      qualifies: total >= 8 && !dimensionScores.includes(0) && delivery === 2,
    },
    mission: input.mission,
  };
}

function parallelShape(): ShapeDefinition {
  return {
    shape: "parallel_delivery",
    objective:
      "Build a profile-card feature with an API module, a UI renderer, and acceptance tests owned by three independent engineers, then integrate the public exports and verify the finished package.",
    constraints: [
      "Persist the complete DAG with mission_plan, then create the API, UI, and test delivery Assignments in one assign_task batch so all three run in parallel.",
      "Use exact disjoint scopes: API writes only src/profile-api.mjs, UI writes only src/profile-card.mjs, and tests write only test/profile.acceptance.test.mjs. Integration writes only src/index.mjs and final verification is read-only.",
      "The three initial delivery Workstreams have no dependencies. Integration depends on all three, and final verification depends on integration.",
      "Require an independent read-only review for the API delivery. The test engineer may validate the test artifact with node --check before the implementations exist; integration owns the first complete npm test run.",
      "Use Team status, message, history, and chat tools for coordination; no shell polling or prompt text may replace persisted Team state.",
      "Every assignee must call assignment_report with real artifact paths and test evidence before ending the turn.",
    ],
    acceptanceCriteria: [
      "npm test exits successfully.",
      "createProfile trims name and role, rejects empty values with TypeError, and returns a frozen object with the normalized fields.",
      "renderProfileCard returns the exact string '<name> — <role>' for a profile, and src/index.mjs exports both public functions.",
      "test/profile.acceptance.test.mjs verifies API validation, immutable normalized data, UI output, and the integrated public exports.",
      "Final verification approves all criteria from a read-only Assignment.",
    ],
    skills: skills(["coordination", "api", "ui", "testing", "integration", "verification"]),
    lead: profileMember("Technical lead", 5, ["coordination", "integration"]),
    members: [
      profileMember("API engineer", 4, ["api"]),
      profileMember("UI engineer", 4, ["ui"]),
      profileMember("Test engineer", 4, ["testing"]),
      profileMember("Verification engineer", 5, ["verification"]),
    ],
    scaffold: scaffoldParallel,
    minimumParallelAssignments: 3,
    injectedFaultPoint: null,
    timeoutMs: PARALLEL_RUN_TIMEOUT_MS,
  };
}

function recoveryShape(): ShapeDefinition {
  return {
    shape: "recovery_dependency",
    objective:
      "Turn requirements.md into a frozen feature-flag contract, implement parseFeatureFlags from that contract, and verify the public behavior.",
    constraints: [
      "Create a contract Workstream that writes only docs/feature-flags-contract.md, an implementation Workstream that depends on it and writes only src/parse-feature-flags.mjs, then a read-only final verification Workstream.",
      "Do not dispatch implementation until the contract Assignment is accepted and reported.",
      "Use Team status, message, history, and chat tools for coordination; no shell polling or prompt text may replace persisted Team state.",
      "Every assignee must call assignment_report with real artifact paths and test evidence before ending the turn.",
    ],
    acceptanceCriteria: [
      "npm test exits successfully.",
      "The durable Mission id and Lead binding survive the injected start checkpoint failure without duplicate provider work.",
      "The contract documents lowercase normalization, sorted uniqueness, empty-token rejection, and a five-flag limit.",
      "parseFeatureFlags implements the frozen contract and final verification approves it.",
    ],
    skills: skills(["coordination", "contract", "implementation", "verification"]),
    lead: profileMember("Technical lead", 5, ["coordination"]),
    members: [
      profileMember("Contract engineer", 4, ["contract"]),
      profileMember("Implementation engineer", 4, ["implementation"]),
      profileMember("Verification engineer", 5, ["verification"]),
    ],
    scaffold: scaffoldRecovery,
    minimumParallelAssignments: 1,
    injectedFaultPoint: "after_lead_participant_write",
    timeoutMs: RECOVERY_RUN_TIMEOUT_MS,
  };
}

function profileMember(role: string, level: 4 | 5, skillIds: string[]): TeamProfileMemberInput {
  return {
    role,
    level,
    skillIds,
    executionProfile: {
      provider: "codex",
      model: null,
      modeId: "full-access",
      thinkingOptionId: "medium",
      featureValues: {},
    },
  };
}

function skills(skillIds: string[]): ShapeDefinition["skills"] {
  return skillIds.map((skillId) => ({
    skillId,
    name: skillId.replaceAll("-", " "),
    description: `${skillId} ownership for this Mission`,
  }));
}

function scaffoldParallel(workspaceRoot: string): void {
  writeJson(path.join(workspaceRoot, "package.json"), {
    type: "module",
    scripts: { test: "node --test" },
  });
  writeFileSync(
    path.join(workspaceRoot, "spec.md"),
    [
      "# Profile card contract",
      "",
      "- `createProfile(name, role)` trims both strings, throws `TypeError` when either result is empty, and returns `Object.freeze({ name, role })`.",
      "- `renderProfileCard(profile)` returns `${profile.name} — ${profile.role}` exactly.",
      "- `src/index.mjs` exports both functions.",
      "- `test/profile.acceptance.test.mjs` covers normalization, validation, immutability, rendering, and imports only from `src/index.mjs`.",
      "",
    ].join("\n"),
  );
}

function scaffoldRecovery(workspaceRoot: string): void {
  writeJson(path.join(workspaceRoot, "package.json"), {
    type: "module",
    scripts: { test: "node --test" },
  });
  mkdirSync(path.join(workspaceRoot, "test"), { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "requirements.md"),
    "Feature flags are comma-separated. Normalize to lowercase, return sorted unique flags, reject empty tokens, and reject more than five flags.\n",
  );
  writeFileSync(
    path.join(workspaceRoot, "test", "acceptance.test.mjs"),
    `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { parseFeatureFlags } from "../src/parse-feature-flags.mjs";\n\ntest("parses sorted unique flags", () => {\n  assert.deepEqual(parseFeatureFlags(" Beta,alpha,beta "), ["alpha", "beta"]);\n});\n\ntest("rejects empty tokens", () => {\n  assert.throws(() => parseFeatureFlags("alpha,,beta"), TypeError);\n});\n\ntest("rejects more than five flags", () => {\n  assert.throws(() => parseFeatureFlags("a,b,c,d,e,f"), RangeError);\n});\n`,
  );
}

function initializeGitBaseline(workspaceRoot: string): void {
  git(workspaceRoot, ["init", "-q"]);
  git(workspaceRoot, ["config", "user.name", "Paseo Team E2E"]);
  git(workspaceRoot, ["config", "user.email", "team-e2e@localhost"]);
  git(workspaceRoot, ["add", "."]);
  git(workspaceRoot, ["commit", "-qm", "baseline"]);
}

function runWorkspaceVerification(workspaceRoot: string): RunEvidence["verification"] {
  try {
    const output = execFileSync("npm", ["test"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { command: "npm test", passed: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { command: "npm test", passed: false, output: message };
  }
}

function scoreWorkstreamFit(mission: TeamMission, team: TeamV2): 0 | 1 | 2 {
  if (!mission.workstreams.length) return 0;
  const memberById = new Map(team.members.map((candidate) => [candidate.memberId, candidate]));
  const ids = new Set(mission.workstreams.map((workstream) => workstream.workstreamId));
  const valid = mission.workstreams.every((workstream) => {
    const owner = memberById.get(workstream.ownerMemberId);
    return (
      owner !== undefined &&
      owner.level >= workstream.minimumLevel &&
      workstream.requiredSkillIds.every((skillId) => owner.skillIds.includes(skillId)) &&
      workstream.dependencyWorkstreamIds.every((id) => ids.has(id)) &&
      (workstream.kind === "verification"
        ? workstream.mutableScope.kind === "read_only"
        : workstream.mutableScope.kind === "paths")
    );
  });
  if (!valid) return 0;
  const hasFinalVerification = mission.workstreams.some(
    (workstream) => workstream.kind === "verification",
  );
  return hasFinalVerification ? 2 : 1;
}

function scoreCoordination(
  mission: TeamMission,
  definition: ShapeDefinition,
  maxParallelAssignments: number,
  parallelDagAudit: ParallelDeliveryDagAudit | null,
  recoveryDagAudit: RecoveryDependencyDagAudit | null,
): 0 | 1 | 2 {
  if (mission.status !== "completed") return 0;
  const dependenciesValid = mission.assignments.every((assignment) =>
    assignment.dependencyAssignmentIds.every((dependencyId) =>
      mission.assignments.some((candidate) => candidate.assignmentId === dependencyId),
    ),
  );
  if (!dependenciesValid) return 0;
  if (definition.minimumParallelAssignments > 1) {
    return parallelDagAudit?.valid &&
      maxParallelAssignments >= definition.minimumParallelAssignments
      ? 2
      : 0;
  }
  return recoveryDagAudit?.valid ? 2 : 0;
}

function scoreDelivery(mission: TeamMission, verificationPassed: boolean): 0 | 1 | 2 {
  if (!verificationPassed || mission.status !== "completed") return 0;
  const complete =
    mission.assignments.length > 0 &&
    mission.assignments.every(
      (assignment) =>
        assignment.semanticState === "completed" &&
        assignment.report?.status === "completed" &&
        assignment.acceptedTurnId !== null,
    );
  return complete ? 2 : 1;
}

function maxConcurrency(
  intervals: Array<{ assignment: MissionAssignmentContract; start: number; end: number }>,
): number {
  const points = intervals
    .flatMap((interval) => [
      { at: interval.start, delta: 1 },
      { at: interval.end, delta: -1 },
    ])
    .toSorted((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let maximum = 0;
  for (const point of points) {
    current += point.delta;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireEvidenceRoot(): string {
  const root = process.env.PASEO_TEAM_MISSIONS_EVIDENCE_DIR?.trim();
  if (!root) {
    throw new Error("PASEO_TEAM_MISSIONS_EVIDENCE_DIR is required for real coordination runs");
  }
  return root;
}

function failedEvidenceRoot(): string {
  return (
    process.env.PASEO_TEAM_MISSIONS_EVIDENCE_DIR?.trim() ||
    path.join(os.tmpdir(), "paseo-team-missions-evidence-failures")
  );
}

async function persistEvidence(root: string, evidence: RunEvidence): Promise<void> {
  await persistSanitizedEvidenceManifest(
    path.join(root, `${evidence.shape}-run-${evidence.repetition}.json`),
    {
      sanitized: true,
      evidencePolicy: "allowlisted_v1",
      ...evidence,
    },
  );
}

async function persistFailedEvidence(
  root: string,
  definition: ShapeDefinition,
  repetition: number,
  sanitizedPinoLog: PersistedSanitizedPinoLogEvidence | null,
  phase: string,
  error: unknown,
  partialMission: TeamMission | null,
  providerStartTurns: ProviderStartTurnEvidence[],
): Promise<void> {
  await persistSanitizedEvidenceManifest(
    path.join(root, `${definition.shape}-run-${repetition}.json`),
    {
      sanitized: true,
      evidencePolicy: "failure_diagnostics_v1",
      shape: definition.shape,
      repetition,
      status: "evidence_collection_failed",
      phase,
      error,
      sanitizedPinoLog,
      providerStartTurns,
      partialMission,
    },
  );
}

function assertRunEvidence(evidence: RunEvidence): void {
  expect(evidence.sanitizedPinoLog).not.toBeNull();
  expect(evidence.sanitizedPinoLog?.sanitized).toBe(true);
  expect(evidence.sanitizedPinoLog?.bytes).toBeGreaterThan(0);
  expect(evidence.sanitizedPinoLog?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence.tokenUsage.inputTokens).toBeGreaterThan(0);
  expect(evidence.tokenUsage.outputTokens).toBeGreaterThan(0);
  expect(evidence.assignmentDispatchAudit.valid).toBe(true);
  expect(evidence.validationViolations).toEqual([]);
  expect(evidence.scores.delivery).toBe(2);
  expect(Object.values(evidence.scores).slice(0, 5)).not.toContain(0);
  expect(evidence.scores.total).toBeGreaterThanOrEqual(8);
  expect(evidence.scores.qualifies).toBe(true);
  if (evidence.shape === "parallel_delivery") {
    expect(evidence.parallelDagAudit?.valid).toBe(true);
  } else {
    expect(evidence.recoveryDagAudit?.valid).toBe(true);
  }
  expect(evidence.recovery.startupSaga.startAttempts).toBe(
    evidence.recovery.startupSaga.injectedFaultPoint === null ? 1 : 2,
  );
  expect(evidence.recovery.startupSaga.replayedSameIdempotentStart).toBe(
    evidence.recovery.startupSaga.injectedFaultPoint !== null,
  );
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
