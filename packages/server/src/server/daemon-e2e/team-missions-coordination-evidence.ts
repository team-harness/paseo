import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir as mkdirAsync,
  rename,
  rm as rmAsync,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TeamMission } from "@getpaseo/protocol/team/v2-types";

import type { AgentClient, AgentSession } from "../agent/agent-sdk-types.js";
import type { DaemonClient } from "../test-utils/daemon-client.js";

export interface WorkspaceFileArtifactEvidence {
  path: string;
  bytes: number;
  sha256: string;
  encoding: "utf8" | "base64";
  content: string;
}

export interface WorkspaceSymlinkArtifactEvidence {
  kind: "symlink";
  path: string;
  target: string;
  bytes: number;
  sha256: string;
}

export type WorkspaceArtifactEvidence =
  | WorkspaceFileArtifactEvidence
  | WorkspaceSymlinkArtifactEvidence;

export interface WorkspaceEvidence {
  gitStatus: string;
  gitDiffStat: string;
  gitPatch: string;
  artifacts: WorkspaceArtifactEvidence[];
}

export async function executeEvidenceLifecycle<T, FailureContext = never>(actions: {
  captureFailureContext?: () => FailureContext;
  run: () => Promise<T>;
  finalize: (outcome: { result: T | null; error: unknown | null }) => Promise<void>;
  cleanup: () => Promise<void>;
  commit: (outcome: {
    result: T | null;
    error: unknown | null;
    failureContext: FailureContext | null;
  }) => Promise<void>;
}): Promise<T> {
  let result: T | null = null;
  let failure: unknown | null = null;
  let failureContext: FailureContext | null = null;
  const retainFailure = (error: unknown): void => {
    if (failure !== null) return;
    failure = error;
    if (!actions.captureFailureContext) return;
    try {
      failureContext = actions.captureFailureContext();
    } catch {
      // Diagnostic capture must never replace the failure it is describing.
    }
  };
  try {
    result = await actions.run();
  } catch (error) {
    retainFailure(error);
  }
  try {
    await actions.finalize({ result, error: failure });
  } catch (error) {
    retainFailure(error);
  }
  try {
    await actions.cleanup();
  } catch (error) {
    retainFailure(error);
  }
  if (result === null && failure === null) {
    retainFailure(new Error("Evidence lifecycle completed without a result"));
  }
  try {
    await actions.commit({ result, error: failure, failureContext });
  } catch (error) {
    retainFailure(error);
  }
  if (failure !== null) throw failure;
  if (result === null) throw new Error("Evidence lifecycle completed without a result");
  return result;
}

export function waitForMissionEvidence(options: {
  client: DaemonClient;
  missionId: string;
  predicate: (mission: TeamMission) => boolean;
  label: string;
  timeoutMs: number;
  onObservedMission: (mission: TeamMission) => void;
}): Promise<TeamMission> {
  return new Promise<TeamMission>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = (): void => undefined;
    const stop = (): void => {
      if (timeout !== null) clearTimeout(timeout);
      unsubscribe();
    };
    const observe = (mission: TeamMission): void => {
      if (settled) return;
      options.onObservedMission(mission);
      if (!options.predicate(mission)) return;
      settled = true;
      stop();
      resolve(mission);
    };
    unsubscribe = options.client.on("team.mission.snapshot", (message) => {
      if (message.payload.mission.id === options.missionId) observe(message.payload.mission);
    });
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error(`Timed out waiting for ${options.label}`));
    }, options.timeoutMs);
    void options.client.inspectTeamMission({ missionId: options.missionId }).then(
      (response) => {
        if (response.mission) observe(response.mission);
        return undefined;
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        stop();
        reject(error);
      },
    );
  });
}

export interface ProviderStartTurnEvidence {
  agentId: string | null;
  clientMessageId: string | null;
  turnId: string | null;
  outcome: "accepted" | "rejected";
  error: string | null;
}

interface AssignmentDispatchMissionEvidence {
  id: string;
  assignments: Array<{
    assignmentId: string;
    runtimeAgentId: string | null;
    acceptedTurnId: string | null;
  }>;
}

export interface AssignmentDispatchAudit {
  valid: boolean;
  duplicateBoundaryCrossings: number;
  violations: string[];
  assignments: Array<{
    assignmentId: string;
    clientMessageId: string;
    boundaryCrossings: ProviderStartTurnEvidence[];
  }>;
}

export function auditAssignmentDispatchEvidence(
  mission: AssignmentDispatchMissionEvidence,
  records: ProviderStartTurnEvidence[],
): AssignmentDispatchAudit {
  const violations: string[] = [];
  let duplicateBoundaryCrossings = 0;
  const expectedMessageIds = new Set<string>();
  const assignments = mission.assignments.map((assignment) => {
    const clientMessageId = assignmentDispatchClientMessageId(mission.id, assignment.assignmentId);
    expectedMessageIds.add(clientMessageId);
    const boundaryCrossings = records.filter(
      (record) => record.clientMessageId === clientMessageId,
    );
    if (boundaryCrossings.length !== 1) {
      violations.push(
        `assignment:${assignment.assignmentId}:provider_boundary_crossings:${boundaryCrossings.length}`,
      );
      duplicateBoundaryCrossings += Math.max(0, boundaryCrossings.length - 1);
    }
    const crossing = boundaryCrossings.length === 1 ? boundaryCrossings[0] : undefined;
    if (crossing && crossing.agentId !== assignment.runtimeAgentId) {
      violations.push(`assignment:${assignment.assignmentId}:provider_agent_mismatch`);
    }
    if (crossing && crossing.outcome !== "accepted") {
      violations.push(`assignment:${assignment.assignmentId}:provider_rejected`);
    }
    if (crossing && crossing.turnId !== assignment.acceptedTurnId) {
      violations.push(`assignment:${assignment.assignmentId}:accepted_turn_mismatch`);
    }
    return { assignmentId: assignment.assignmentId, clientMessageId, boundaryCrossings };
  });
  const missionDispatchPrefix = `team-mission:${mission.id}:assignment:`;
  for (const record of records) {
    if (
      record.clientMessageId?.startsWith(missionDispatchPrefix) &&
      record.clientMessageId.endsWith(":dispatch") &&
      !expectedMessageIds.has(record.clientMessageId)
    ) {
      violations.push(`unexpected_assignment_dispatch:${record.clientMessageId}`);
    }
  }
  return {
    valid: violations.length === 0,
    duplicateBoundaryCrossings,
    violations,
    assignments,
  };
}

interface RuntimeRecoveryMissionEvidence {
  id: string;
  status: string;
  attentionItems: Array<{ status: string }>;
  assignments: Array<{
    assignmentId: string;
    runtimeAgentId?: string | null;
  }>;
}

export interface RuntimeRecoveryAudit {
  score: 0 | 1 | 2;
  violations: string[];
  startupSaga: {
    injectedFaultPoint: string | null;
    observed: boolean;
    valid: boolean;
    firstStartFailed: boolean;
    startAttempts: number;
    replayedSameIdempotentStart: boolean;
  };
  reportRecovery: {
    observed: boolean;
    valid: boolean;
    reason: string | null;
    outcome: "unobserved" | "accepted" | "recovered_after_rejection" | "failed";
    turnCount: number;
    rejectedTurnCount: number;
    maxAttempt: number | null;
    turns: Array<
      ProviderStartTurnEvidence & {
        assignmentId: string;
        attempt: number | null;
      }
    >;
  };
}

type ReportRecoveryTurn = RuntimeRecoveryAudit["reportRecovery"]["turns"][number];

export function auditRuntimeRecovery(input: {
  mission: RuntimeRecoveryMissionEvidence;
  injectedFaultPoint: string | null;
  firstStartFailed: boolean;
  startAttempts: number;
  assignmentDispatchValid: boolean;
  providerStartTurns: ProviderStartTurnEvidence[];
}): RuntimeRecoveryAudit {
  const violations: string[] = [];
  const startupObserved = input.injectedFaultPoint !== null && input.firstStartFailed;
  const startupValid =
    input.injectedFaultPoint === null
      ? !input.firstStartFailed && input.startAttempts === 1
      : input.firstStartFailed && input.startAttempts === 2;
  if (!startupValid) violations.push("runtime_recovery:startup_saga_invalid");

  const reportTurns = collectReportRecoveryTurns(input.mission.id, input.providerStartTurns);
  const reportReason = reportRecoveryFailureReason(reportTurns, input.mission);
  const reportValid = reportReason === null;
  const rejectedTurnCount = reportTurns.filter((turn) => turn.outcome !== "accepted").length;
  if (!reportValid) violations.push(`runtime_recovery:${reportReason}`);
  const observedAttempts = reportTurns.flatMap((turn) =>
    turn.attempt === null ? [] : [turn.attempt],
  );

  const noOpenAttention = input.mission.attentionItems.every((item) => item.status !== "open");
  if (!input.assignmentDispatchValid) {
    violations.push("runtime_recovery:assignment_dispatch_invalid");
  }
  if (!noOpenAttention) violations.push("runtime_recovery:open_attention_remaining");
  let score: RuntimeRecoveryAudit["score"] = 1;
  if (input.mission.status !== "completed") {
    score = 0;
  } else if (startupValid && input.assignmentDispatchValid && noOpenAttention && reportValid) {
    score = 2;
  }
  return {
    score,
    violations,
    startupSaga: {
      injectedFaultPoint: input.injectedFaultPoint,
      observed: startupObserved,
      valid: startupValid,
      firstStartFailed: input.firstStartFailed,
      startAttempts: input.startAttempts,
      replayedSameIdempotentStart: startupObserved && input.startAttempts === 2,
    },
    reportRecovery: {
      observed: reportTurns.length > 0,
      valid: reportValid,
      reason: reportReason,
      outcome: reportRecoveryOutcome(reportTurns, reportValid, rejectedTurnCount),
      turnCount: reportTurns.length,
      rejectedTurnCount,
      maxAttempt: observedAttempts.length > 0 ? Math.max(...observedAttempts) : null,
      turns: reportTurns,
    },
  };
}

function collectReportRecoveryTurns(
  missionId: string,
  records: ProviderStartTurnEvidence[],
): ReportRecoveryTurn[] {
  const prefix = `team-mission:${missionId}:assignment:`;
  const marker = ":report-recovery:";
  return records.flatMap((turn) => {
    if (!turn.clientMessageId?.startsWith(prefix)) return [];
    const markerIndex = turn.clientMessageId.lastIndexOf(marker);
    if (markerIndex < prefix.length) return [];
    const assignmentId = turn.clientMessageId.slice(prefix.length, markerIndex);
    const attemptText = turn.clientMessageId.slice(markerIndex + marker.length);
    const attempt = /^\d+$/.test(attemptText) ? Number.parseInt(attemptText, 10) : null;
    return [{ ...turn, assignmentId, attempt }];
  });
}

function reportRecoveryFailureReason(
  turns: ReportRecoveryTurn[],
  mission: RuntimeRecoveryMissionEvidence,
): string | null {
  if (turns.length === 0) return "no_report_recovery_turn_observed";
  if (
    turns.length > 2 ||
    turns.some((turn, index) => turn.attempt === null || turn.attempt !== index + 1)
  ) {
    return "report_recovery_attempt_sequence_invalid";
  }
  const assignmentById = new Map(
    mission.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  const invalidIdentity = turns.some((turn) => {
    const assignment = assignmentById.get(turn.assignmentId);
    return (
      !assignment ||
      turn.attempt === null ||
      turn.attempt < 1 ||
      turn.attempt > 2 ||
      (assignment.runtimeAgentId !== undefined &&
        assignment.runtimeAgentId !== null &&
        assignment.runtimeAgentId !== turn.agentId)
    );
  });
  if (invalidIdentity) return "report_recovery_identity_or_attempt_invalid";
  const boundaryCounts = new Map<string, number>();
  for (const turn of turns) {
    if (!turn.clientMessageId) continue;
    boundaryCounts.set(turn.clientMessageId, (boundaryCounts.get(turn.clientMessageId) ?? 0) + 1);
  }
  if ([...boundaryCounts.values()].some((count) => count !== 1)) {
    return "report_recovery_boundary_crossed_more_than_once";
  }
  const acceptedTurns = turns.filter((turn) => turn.outcome === "accepted" && turn.turnId !== null);
  if (acceptedTurns.length === 0) {
    return "report_recovery_boundary_not_accepted";
  }
  if (acceptedTurns.length !== 1) return "report_recovery_multiple_accepted_turns";
  const acceptedAttempt = acceptedTurns[0]?.attempt;
  if (
    acceptedAttempt === null ||
    acceptedAttempt === undefined ||
    turns.some(
      (turn) =>
        turn.outcome !== "accepted" &&
        (turn.attempt ?? Number.POSITIVE_INFINITY) >= acceptedAttempt,
    )
  ) {
    return "report_recovery_attempt_order_invalid";
  }
  return null;
}

function reportRecoveryOutcome(
  turns: ReportRecoveryTurn[],
  valid: boolean,
  rejectedTurnCount: number,
): RuntimeRecoveryAudit["reportRecovery"]["outcome"] {
  if (turns.length === 0) return "unobserved";
  if (!valid) return "failed";
  return rejectedTurnCount > 0 ? "recovered_after_rejection" : "accepted";
}

function assignmentDispatchClientMessageId(missionId: string, assignmentId: string): string {
  return `team-mission:${missionId}:assignment:${assignmentId}:dispatch`;
}

export function validatePositiveTokenUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
}): string[] {
  const violations: string[] = [];
  if (typeof usage.inputTokens !== "number" || usage.inputTokens <= 0) {
    violations.push("token_usage:input_tokens_must_be_positive");
  }
  if (typeof usage.outputTokens !== "number" || usage.outputTokens <= 0) {
    violations.push("token_usage:output_tokens_must_be_positive");
  }
  return violations;
}

export interface PersistedSanitizedPinoLogEvidence {
  sanitized: true;
  relativePath: string;
  sourceBytes: number;
  sourceSha256: string;
  bytes: number;
  sha256: string;
}

const SAFE_PINO_FIELDS = [
  "time",
  "level",
  "component",
  "event",
  "teamId",
  "missionId",
  "workstreamId",
  "assignmentId",
  "agentId",
  "memberId",
  "turnId",
  "clientMessageId",
  "status",
  "outcome",
  "phase",
  "code",
] as const;

const SENSITIVE_EVIDENCE_KEYS = new Set([
  "acceptancecriteria",
  "body",
  "content",
  "constraints",
  "description",
  "gitpatch",
  "input",
  "message",
  "msg",
  "objective",
  "output",
  "params",
  "payload",
  "prompt",
  "raw",
  "result",
  "stack",
  "stderr",
  "stdout",
  "summary",
  "target",
  "text",
]);

export function persistSanitizedPinoLogEvidence(
  sourcePath: string,
  evidenceRoot: string,
  relativePath: string,
): PersistedSanitizedPinoLogEvidence {
  const source = readFileSync(sourcePath);
  const sanitized = sanitizePinoJsonLines(source.toString("utf8"));
  const sanitizedBytes = Buffer.from(sanitized);
  const metadata = {
    sanitized: true as const,
    relativePath,
    sourceBytes: source.byteLength,
    sourceSha256: sha256Bytes(source),
    bytes: sanitizedBytes.byteLength,
    sha256: sha256Bytes(sanitizedBytes),
  };
  const resolvedRoot = path.resolve(evidenceRoot);
  const destinationPath = path.resolve(resolvedRoot, relativePath);
  if (!destinationPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Raw log evidence path escapes evidence root: ${relativePath}`);
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, sanitizedBytes);
  return metadata;
}

export interface SanitizedFailureError {
  name: string;
  code: string | null;
  digest: string;
}

export function sanitizeFailureError(error: unknown): SanitizedFailureError {
  const record = asRecord(error);
  const name =
    error instanceof Error
      ? safeEvidenceToken(error.name, "Error")
      : safeEvidenceToken(record?.name, "UnknownError");
  const code = safeEvidenceToken(record?.code, null);
  const digestSource =
    error instanceof Error
      ? { name: error.name, code: record?.code, message: error.message, stack: error.stack }
      : error;
  return { name, code, digest: sha256Text(stableEvidenceString(digestSource)) };
}

export function sanitizeEvidenceForPersistence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeEvidenceForPersistence(entry));
  const record = asRecord(value);
  if (!record) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key.toLowerCase() === "error") {
      sanitized[key] = entry === null ? null : sanitizeFailureError(entry);
      continue;
    }
    if (SENSITIVE_EVIDENCE_KEYS.has(key.toLowerCase())) continue;
    sanitized[key] = sanitizeEvidenceForPersistence(entry);
  }
  return sanitized;
}

export async function persistSanitizedEvidenceManifest(
  filePath: string,
  value: unknown,
): Promise<void> {
  const record = asRecord(value);
  let sanitized: unknown;
  if (record?.evidencePolicy === "allowlisted_v1") {
    sanitized = projectAllowlistedSuccessEvidence(record);
  } else if (record?.evidencePolicy === "failure_diagnostics_v1") {
    sanitized = projectAllowlistedFailureEvidence(record);
  } else {
    sanitized = sanitizeEvidenceForPersistence(value);
  }
  const serialized = JSON.stringify(sanitized, null, 2);
  if (serialized === undefined) throw new Error("Evidence manifest is not JSON serializable");
  await mkdirAsync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFileAsync(temporaryPath, `${serialized}\n`);
    await rename(temporaryPath, filePath);
  } finally {
    await rmAsync(temporaryPath, { force: true });
  }
}

function projectAllowlistedFailureEvidence(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sanitized: true,
    evidencePolicy: "failure_diagnostics_v1",
    shape: structuralScalar(record, "shape"),
    repetition: structuralScalar(record, "repetition"),
    status: structuralScalar(record, "status"),
    phase: structuralScalar(record, "phase"),
    error: record.error === null ? null : sanitizeFailureError(record.error),
    sanitizedPinoLog: projectSanitizedPinoLog(record.sanitizedPinoLog),
    providerStartTurns: projectProviderStartTurns(record.providerStartTurns),
    partialMission: projectMissionEvidence(record.partialMission),
  };
}

function projectAllowlistedSuccessEvidence(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sanitized: true,
    evidencePolicy: "allowlisted_v1",
    shape: structuralScalar(record, "shape"),
    repetition: structuralScalar(record, "repetition"),
    provider: structuralScalar(record, "provider"),
    model: structuralScalar(record, "model"),
    teamId: structuralScalar(record, "teamId"),
    missionId: structuralScalar(record, "missionId"),
    missionStatus: structuralScalar(record, "missionStatus"),
    durationMs: structuralScalar(record, "durationMs"),
    planningLatencyMs: structuralScalar(record, "planningLatencyMs"),
    maxParallelAssignments: structuralScalar(record, "maxParallelAssignments"),
    memberIdleMs: projectNumericRecord(record.memberIdleMs),
    toolCalls: projectKnownToolCounts(record.toolCalls),
    tokenUsage: projectTokenUsage(record.tokenUsage),
    tokenUsageViolations: projectDigestSummary(record.tokenUsageViolations),
    providerStartTurns: projectProviderStartTurns(record.providerStartTurns),
    assignmentDispatchAudit: projectAssignmentDispatchAudit(record.assignmentDispatchAudit),
    participantTimelines: projectParticipantTimelines(record.participantTimelines),
    roomHistory: projectRoomHistory(record.roomHistory),
    sanitizedPinoLog: projectSanitizedPinoLog(record.sanitizedPinoLog),
    parallelDagAudit: projectDagAudit(record.parallelDagAudit, [
      "api",
      "ui",
      "test",
      "integration",
      "finalVerification",
    ]),
    recoveryDagAudit: projectDagAudit(record.recoveryDagAudit, [
      "contract",
      "contractTail",
      "implementation",
      "finalVerification",
    ]),
    toolDisciplineAudit: projectToolDisciplineAudit(record.toolDisciplineAudit),
    validationViolations: projectDigestSummary(record.validationViolations),
    scopeConflicts: structuralScalar(record, "scopeConflicts"),
    runtimeMetrics: projectNumericRecord(record.runtimeMetrics),
    attentionItems: projectAttentionItems(record.attentionItems),
    recovery: projectRuntimeRecovery(record.recovery),
    reworkCount: structuralScalar(record, "reworkCount"),
    workspace: projectWorkspaceEvidence(record.workspace),
    verification: projectVerificationEvidence(record.verification),
    scores: projectScores(record.scores),
    mission: projectMissionEvidence(record.mission),
  };
}

function structuralScalar(record: Record<string, unknown>, key: string): unknown {
  const value = record[key];
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    ? value
    : undefined;
}

function structuralStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return record ? [record] : [];
      })
    : [];
}

function projectNumericRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) =>
      typeof entry === "number" && Number.isFinite(entry) ? [[key, entry]] : [],
    ),
  );
}

function projectKnownToolCounts(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    AUDITED_TEAM_TOOL_NAMES.flatMap((name) =>
      typeof record[name] === "number" && Number.isFinite(record[name])
        ? [[name, record[name]]]
        : [],
    ),
  );
}

function projectTokenUsage(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    inputTokens: structuralScalar(record, "inputTokens"),
    outputTokens: structuralScalar(record, "outputTokens"),
    cacheReadTokens: structuralScalar(record, "cacheReadTokens"),
    cacheCreationTokens: structuralScalar(record, "cacheCreationTokens"),
    totalCostUsd: structuralScalar(record, "totalCostUsd"),
  };
}

function projectDigestSummary(value: unknown): { count: number; digests: string[] } {
  const entries = Array.isArray(value) ? value : [];
  return {
    count: entries.length,
    digests: entries.map((entry) => sha256Text(stableEvidenceString(entry))),
  };
}

function digestValue(value: unknown): string | undefined {
  return value === undefined || value === null
    ? undefined
    : sha256Text(stableEvidenceString(value));
}

function projectProviderStartTurns(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((record) => ({
    agentId: structuralScalar(record, "agentId"),
    clientMessageId: structuralScalar(record, "clientMessageId"),
    turnId: structuralScalar(record, "turnId"),
    outcome: structuralScalar(record, "outcome"),
    error: record.error === null ? null : sanitizeFailureError(record.error),
  }));
}

function projectAssignmentDispatchAudit(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    valid: structuralScalar(record, "valid"),
    duplicateBoundaryCrossings: structuralScalar(record, "duplicateBoundaryCrossings"),
    violations: projectDigestSummary(record.violations),
    assignments: recordArray(record.assignments).map((assignment) => ({
      assignmentId: structuralScalar(assignment, "assignmentId"),
      clientMessageId: structuralScalar(assignment, "clientMessageId"),
      boundaryCrossings: projectProviderStartTurns(assignment.boundaryCrossings),
    })),
  };
}

function projectParticipantTimelines(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((participant) => {
    const timeline = asRecord(participant.timeline);
    const pages = recordArray(timeline?.pages);
    const entries = recordArray(timeline?.entries);
    return {
      memberId: structuralScalar(participant, "memberId"),
      agentId: structuralScalar(participant, "agentId"),
      timeline: {
        pageCount: pages.length,
        entryCount: entries.length,
        pages: pages.map(projectTimelinePage),
        entries: entries.map(projectTimelineEntry),
      },
    };
  });
}

function projectTimelinePage(page: Record<string, unknown>): Record<string, unknown> {
  return {
    requestId: structuralScalar(page, "requestId"),
    agentId: structuralScalar(page, "agentId"),
    direction: structuralScalar(page, "direction"),
    projection: structuralScalar(page, "projection"),
    epoch: structuralScalar(page, "epoch"),
    reset: structuralScalar(page, "reset"),
    staleCursor: structuralScalar(page, "staleCursor"),
    gap: structuralScalar(page, "gap"),
    window: projectTimelineWindow(page.window),
    startCursor: projectCursor(page.startCursor),
    endCursor: projectCursor(page.endCursor),
    hasOlder: structuralScalar(page, "hasOlder"),
    hasNewer: structuralScalar(page, "hasNewer"),
    mergeWindow: structuralScalar(page, "mergeWindow"),
    entryCount: Array.isArray(page.entries) ? page.entries.length : 0,
  };
}

function projectTimelineWindow(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        minSeq: structuralScalar(record, "minSeq"),
        maxSeq: structuralScalar(record, "maxSeq"),
        nextSeq: structuralScalar(record, "nextSeq"),
      }
    : null;
}

function projectCursor(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? { epoch: structuralScalar(record, "epoch"), seq: structuralScalar(record, "seq") }
    : null;
}

function projectTimelineEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    provider: structuralScalar(entry, "provider"),
    timestamp: structuralScalar(entry, "timestamp"),
    seq: structuralScalar(entry, "seq"),
    seqStart: structuralScalar(entry, "seqStart"),
    seqEnd: structuralScalar(entry, "seqEnd"),
    sourceSeqRanges: recordArray(entry.sourceSeqRanges).map((range) => ({
      startSeq: structuralScalar(range, "startSeq"),
      endSeq: structuralScalar(range, "endSeq"),
    })),
    collapsed: structuralStringArray(entry.collapsed),
    item: projectTimelineItem(entry.item),
  };
}

function projectTimelineItem(value: unknown): Record<string, unknown> | null {
  const item = asRecord(value);
  if (!item) return null;
  const type = structuralScalar(item, "type");
  if (type !== "tool_call") {
    return {
      type,
      messageId: structuralScalar(item, "messageId"),
      clientMessageId: structuralScalar(item, "clientMessageId"),
      textDigest: digestValue(item.text),
    };
  }
  const detail = asRecord(item.detail);
  return {
    type,
    callId: structuralScalar(item, "callId"),
    name: allowlistedTimelineToolName(item.name),
    nameDigest: digestValue(item.name),
    status: structuralScalar(item, "status"),
    detail: detail ? { type: structuralScalar(detail, "type"), digest: digestValue(detail) } : null,
    metadataDigest: digestValue(item.metadata),
    error: item.error === null ? null : sanitizeFailureError(item.error),
  };
}

function allowlistedTimelineToolName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return AUDITED_TEAM_TOOL_NAMES.find(
    (candidate) => value === candidate || value.endsWith(candidate),
  );
}

function projectRoomHistory(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const pages = recordArray(record.pages);
  const messages = recordArray(record.messages);
  return {
    pageCount: pages.length,
    messageCount: messages.length,
    pages: pages.map((page) => ({
      requestId: structuralScalar(page, "requestId"),
      missionId: structuralScalar(page, "missionId"),
      cursor: structuralScalar(page, "cursor"),
      hasMore: structuralScalar(page, "hasMore"),
      messageCount: Array.isArray(page.messages) ? page.messages.length : 0,
      error: page.error === null ? null : sanitizeFailureError(page.error),
      errorCode: structuralScalar(page, "errorCode"),
    })),
    messages: messages.map((message) => {
      const author = asRecord(message.author);
      return {
        id: structuralScalar(message, "id"),
        missionId: structuralScalar(message, "missionId"),
        roomId: structuralScalar(message, "roomId"),
        authorAgentId: structuralScalar(message, "authorAgentId"),
        author: author
          ? { kind: structuralScalar(author, "kind"), id: structuralScalar(author, "id") }
          : null,
        replyToMessageId: structuralScalar(message, "replyToMessageId"),
        mentionAgentIds: structuralStringArray(message.mentionAgentIds),
        createdAt: structuralScalar(message, "createdAt"),
        bodyDigest: digestValue(message.body),
      };
    }),
    unsubscribe: projectRoomUnsubscribe(record.unsubscribe),
  };
}

function projectRoomUnsubscribe(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        requestId: structuralScalar(record, "requestId"),
        missionId: structuralScalar(record, "missionId"),
        error: record.error === null ? null : sanitizeFailureError(record.error),
        errorCode: structuralScalar(record, "errorCode"),
      }
    : null;
}

function projectSanitizedPinoLog(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        sanitized: structuralScalar(record, "sanitized"),
        relativePath: structuralScalar(record, "relativePath"),
        sourceBytes: structuralScalar(record, "sourceBytes"),
        sourceSha256: structuralScalar(record, "sourceSha256"),
        bytes: structuralScalar(record, "bytes"),
        sha256: structuralScalar(record, "sha256"),
      }
    : null;
}

function projectDagAudit(value: unknown, nodeNames: string[]): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const nodes = asRecord(record.nodes);
  return {
    valid: structuralScalar(record, "valid"),
    violations: projectDigestSummary(record.violations),
    commonDeliveryOverlap: projectDagInterval(record.commonDeliveryOverlap),
    nodes: nodes
      ? Object.fromEntries(
          nodeNames
            .map((name) => [name, projectDagNode(nodes[name])])
            .concat([
              ["apiReviewAssignmentIds", structuralStringArray(nodes.apiReviewAssignmentIds)],
              [
                "contractChainWorkstreamIds",
                structuralStringArray(nodes.contractChainWorkstreamIds),
              ],
              [
                "contractChainAssignmentIds",
                structuralStringArray(nodes.contractChainAssignmentIds),
              ],
              ["finalSubjectAssignmentIds", structuralStringArray(nodes.finalSubjectAssignmentIds)],
            ]),
        )
      : null,
  };
}

function projectDagInterval(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        startedAt: structuralScalar(record, "startedAt"),
        settledAt: structuralScalar(record, "settledAt"),
      }
    : null;
}

function projectDagNode(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        workstreamId: structuralScalar(record, "workstreamId"),
        assignmentId: structuralScalar(record, "assignmentId"),
        dispatchedAt: structuralScalar(record, "dispatchedAt"),
        settledAt: structuralScalar(record, "settledAt"),
      }
    : null;
}

function projectToolDisciplineAudit(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    score: structuralScalar(record, "score"),
    violations: projectDigestSummary(record.violations),
    successfulCounts: projectKnownToolCounts(record.successfulCounts),
    calls: recordArray(record.calls).map((call) => ({
      agentId: structuralScalar(call, "agentId"),
      seq: structuralScalar(call, "seq"),
      name: structuralScalar(call, "name"),
      rawNameDigest: digestValue(call.rawName),
      status: structuralScalar(call, "status"),
      successful: structuralScalar(call, "successful"),
      missionAssociation: structuralScalar(call, "missionAssociation"),
      assignmentActivation: structuralScalar(call, "assignmentActivation"),
      inputDigest: structuralScalar(call, "inputDigest"),
      outputDigest: structuralScalar(call, "outputDigest"),
    })),
  };
}

function projectRuntimeRecovery(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const startup = asRecord(record.startupSaga);
  const report = asRecord(record.reportRecovery);
  return {
    score: structuralScalar(record, "score"),
    violations: projectDigestSummary(record.violations),
    startupSaga: startup
      ? {
          injectedFaultPoint: structuralScalar(startup, "injectedFaultPoint"),
          observed: structuralScalar(startup, "observed"),
          valid: structuralScalar(startup, "valid"),
          firstStartFailed: structuralScalar(startup, "firstStartFailed"),
          startAttempts: structuralScalar(startup, "startAttempts"),
          replayedSameIdempotentStart: structuralScalar(startup, "replayedSameIdempotentStart"),
        }
      : null,
    reportRecovery: report
      ? {
          observed: structuralScalar(report, "observed"),
          valid: structuralScalar(report, "valid"),
          reason: structuralScalar(report, "reason"),
          outcome: structuralScalar(report, "outcome"),
          turnCount: structuralScalar(report, "turnCount"),
          rejectedTurnCount: structuralScalar(report, "rejectedTurnCount"),
          maxAttempt: structuralScalar(report, "maxAttempt"),
          turns: recordArray(report.turns).map((turn) => ({
            agentId: structuralScalar(turn, "agentId"),
            clientMessageId: structuralScalar(turn, "clientMessageId"),
            turnId: structuralScalar(turn, "turnId"),
            outcome: structuralScalar(turn, "outcome"),
            error: turn.error === null ? null : sanitizeFailureError(turn.error),
            assignmentId: structuralScalar(turn, "assignmentId"),
            attempt: structuralScalar(turn, "attempt"),
          })),
        }
      : null,
  };
}

function projectWorkspaceEvidence(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const artifacts = recordArray(record.artifacts);
  return {
    gitStatusDigest: digestValue(record.gitStatus),
    gitDiffStatDigest: digestValue(record.gitDiffStat),
    gitPatchDigest: digestValue(record.gitPatch),
    artifactCount: artifacts.length,
    artifacts: artifacts.map((artifact) => ({
      kind: structuralScalar(artifact, "kind") ?? "file",
      pathDigest: digestValue(artifact.path),
      targetDigest: digestValue(artifact.target),
      bytes: structuralScalar(artifact, "bytes"),
      sha256: structuralScalar(artifact, "sha256"),
      encoding: structuralScalar(artifact, "encoding"),
      contentDigest: digestValue(artifact.content),
    })),
  };
}

function projectVerificationEvidence(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        passed: structuralScalar(record, "passed"),
        commandDigest: digestValue(record.command),
        outputDigest: digestValue(record.output),
        outputBytes: typeof record.output === "string" ? Buffer.byteLength(record.output) : 0,
      }
    : null;
}

function projectScores(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    workstreamFit: structuralScalar(record, "workstreamFit"),
    coordination: structuralScalar(record, "coordination"),
    toolDiscipline: structuralScalar(record, "toolDiscipline"),
    delivery: structuralScalar(record, "delivery"),
    runtimeReliability: structuralScalar(record, "runtimeReliability"),
    total: structuralScalar(record, "total"),
    qualifies: structuralScalar(record, "qualifies"),
  };
}

function projectMissionEvidence(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    id: structuralScalar(record, "id"),
    teamId: structuralScalar(record, "teamId"),
    workspaceId: structuralScalar(record, "workspaceId"),
    objectiveDigest: digestValue(record.objective),
    constraints: projectDigestSummary(record.constraints),
    acceptanceCriteria: projectDigestSummary(record.acceptanceCriteria),
    status: structuralScalar(record, "status"),
    suspendedStatus: structuralScalar(record, "suspendedStatus"),
    activeRosterSnapshotRevision: structuralScalar(record, "activeRosterSnapshotRevision"),
    planRevision: structuralScalar(record, "planRevision"),
    revision: structuralScalar(record, "revision"),
    workspaceAuditPolicy: projectWorkspaceAuditPolicy(record.workspaceAuditPolicy),
    chatRoomId: structuralScalar(record, "chatRoomId"),
    participants: recordArray(record.participants).map((participant) => ({
      memberId: structuralScalar(participant, "memberId"),
      agentId: structuralScalar(participant, "agentId"),
      bindingEpoch: structuralScalar(participant, "bindingEpoch"),
      joinedAt: structuralScalar(participant, "joinedAt"),
      archivedAt: structuralScalar(participant, "archivedAt"),
    })),
    rosterSnapshots: recordArray(record.rosterSnapshots).map(projectRosterSnapshot),
    workstreams: recordArray(record.workstreams).map(projectWorkstream),
    workstreamPlanSnapshots: recordArray(record.workstreamPlanSnapshots).map((snapshot) => ({
      planRevision: structuralScalar(snapshot, "planRevision"),
      createdAt: structuralScalar(snapshot, "createdAt"),
      workstreams: recordArray(snapshot.workstreams).map(projectWorkstream),
    })),
    assignments: recordArray(record.assignments).map(projectAssignment),
    attentionItems: projectAttentionItems(record.attentionItems),
    lifecycleRecoveryFailure: projectLifecycleRecoveryFailure(record.lifecycleRecoveryFailure),
    createdAt: structuralScalar(record, "createdAt"),
    updatedAt: structuralScalar(record, "updatedAt"),
    completedAt: structuralScalar(record, "completedAt"),
  };
}

function projectWorkspaceAuditPolicy(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        revision: structuralScalar(record, "revision"),
        includeTrackedPaths: structuralScalar(record, "includeTrackedPaths"),
        includeNonIgnoredUntrackedPaths: structuralScalar(
          record,
          "includeNonIgnoredUntrackedPaths",
        ),
        includeDeclaredArtifactPaths: structuralScalar(record, "includeDeclaredArtifactPaths"),
        excludeGitignoredPathsByDefault: structuralScalar(
          record,
          "excludeGitignoredPathsByDefault",
        ),
        excludedPathPrefixes: projectDigestSummary(record.excludedPathPrefixes),
      }
    : null;
}

function projectRosterSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    revision: structuralScalar(snapshot, "revision"),
    teamRevision: structuralScalar(snapshot, "teamRevision"),
    leadMemberId: structuralScalar(snapshot, "leadMemberId"),
    reason: structuralScalar(snapshot, "reason"),
    skills: recordArray(snapshot.skills).map((skill) => ({
      skillId: structuralScalar(skill, "skillId"),
      nameDigest: digestValue(skill.name),
      descriptionDigest: digestValue(skill.description),
    })),
    members: recordArray(snapshot.members).map(projectRosterMember),
    createdAt: structuralScalar(snapshot, "createdAt"),
  };
}

function projectRosterMember(member: Record<string, unknown>): Record<string, unknown> {
  const runtime = asRecord(member.runtimeSnapshot);
  const execution = asRecord(member.executionProfile);
  return {
    memberId: structuralScalar(member, "memberId"),
    roleDigest: digestValue(member.role),
    level: structuralScalar(member, "level"),
    skillIds: structuralStringArray(member.skillIds),
    mentionHandleDigest: digestValue(member.mentionHandle),
    executionProfile: execution
      ? {
          provider: structuralScalar(execution, "provider"),
          model: structuralScalar(execution, "model"),
          modeId: structuralScalar(execution, "modeId"),
          thinkingOptionId: structuralScalar(execution, "thinkingOptionId"),
          featureValuesDigest: digestValue(execution.featureValues),
        }
      : null,
    runtimeSnapshot: runtime
      ? {
          providerAvailable: structuralScalar(runtime, "providerAvailable"),
          toolIds: structuralStringArray(runtime.toolIds),
          capabilityIds: structuralStringArray(runtime.capabilityIds),
        }
      : null,
  };
}

function projectWorkstream(workstream: Record<string, unknown>): Record<string, unknown> {
  return {
    workstreamId: structuralScalar(workstream, "workstreamId"),
    kind: structuralScalar(workstream, "kind"),
    titleDigest: digestValue(workstream.title),
    objectiveDigest: digestValue(workstream.objective),
    deliverables: projectDigestSummary(workstream.deliverables),
    acceptanceCriteria: projectDigestSummary(workstream.acceptanceCriteria),
    requiredSkillIds: structuralStringArray(workstream.requiredSkillIds),
    preferredSkillIds: structuralStringArray(workstream.preferredSkillIds),
    requiredRuntimeCapabilityIds: structuralStringArray(workstream.requiredRuntimeCapabilityIds),
    minimumLevel: structuralScalar(workstream, "minimumLevel"),
    planRevision: structuralScalar(workstream, "planRevision"),
    rosterSnapshotRevision: structuralScalar(workstream, "rosterSnapshotRevision"),
    dependencyWorkstreamIds: structuralStringArray(workstream.dependencyWorkstreamIds),
    mutableScope: projectMutableScope(workstream.mutableScope),
    ownerMemberId: structuralScalar(workstream, "ownerMemberId"),
    ownerMatchExplanation: projectMatchExplanation(workstream.ownerMatchExplanation),
    ownerOverrideReasonDigest: digestValue(workstream.ownerOverrideReason),
    reviewPolicy: structuralScalar(workstream, "reviewPolicy"),
    reviewerRequirements: projectMemberRequirements(workstream.reviewerRequirements),
    reviewerMemberId: structuralScalar(workstream, "reviewerMemberId"),
    reviewerMatchExplanation: projectMatchExplanation(workstream.reviewerMatchExplanation),
    reviewerOverrideReasonDigest: digestValue(workstream.reviewerOverrideReason),
    status: structuralScalar(workstream, "status"),
  };
}

function projectMutableScope(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        kind: structuralScalar(record, "kind"),
        pathPrefixes: projectDigestSummary(record.pathPrefixes),
      }
    : null;
}

function projectMatchExplanation(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        recommendedMemberId: structuralScalar(record, "recommendedMemberId"),
        requiredSkillIds: structuralStringArray(record.requiredSkillIds),
        preferredSkillIds: structuralStringArray(record.preferredSkillIds),
        matchedPreferredSkillIds: structuralStringArray(record.matchedPreferredSkillIds),
        requiredRuntimeCapabilityIds: structuralStringArray(record.requiredRuntimeCapabilityIds),
        minimumLevel: structuralScalar(record, "minimumLevel"),
        selectedLevel: structuralScalar(record, "selectedLevel"),
        eligibleMemberIds: structuralStringArray(record.eligibleMemberIds),
        excludedMemberIds: structuralStringArray(record.excludedMemberIds),
        previousMemberId: structuralScalar(record, "previousMemberId"),
        candidateOpenAssignments: recordArray(record.candidateOpenAssignments).map((candidate) => ({
          memberId: structuralScalar(candidate, "memberId"),
          openAssignments: structuralScalar(candidate, "openAssignments"),
        })),
        continuedPreviousMember: structuralScalar(record, "continuedPreviousMember"),
        openAssignments: structuralScalar(record, "openAssignments"),
        rosterIndex: structuralScalar(record, "rosterIndex"),
      }
    : null;
}

function projectMemberRequirements(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        requiredSkillIds: structuralStringArray(record.requiredSkillIds),
        preferredSkillIds: structuralStringArray(record.preferredSkillIds),
        requiredRuntimeCapabilityIds: structuralStringArray(record.requiredRuntimeCapabilityIds),
        minimumLevel: structuralScalar(record, "minimumLevel"),
      }
    : null;
}

function projectAssignment(assignment: Record<string, unknown>): Record<string, unknown> {
  return {
    assignmentId: structuralScalar(assignment, "assignmentId"),
    revision: structuralScalar(assignment, "revision"),
    kind: structuralScalar(assignment, "kind"),
    subjectAssignmentIds: structuralStringArray(assignment.subjectAssignmentIds),
    missionId: structuralScalar(assignment, "missionId"),
    workstreamId: structuralScalar(assignment, "workstreamId"),
    assigneeMemberId: structuralScalar(assignment, "assigneeMemberId"),
    runtimeAgentId: structuralScalar(assignment, "runtimeAgentId"),
    bindingEpoch: structuralScalar(assignment, "bindingEpoch"),
    objectiveDigest: digestValue(assignment.objective),
    inputRefs: projectDigestSummary(assignment.inputRefs),
    deliverables: projectDigestSummary(assignment.deliverables),
    acceptanceCriteria: projectDigestSummary(assignment.acceptanceCriteria),
    mutableScope: projectMutableScope(assignment.mutableScope),
    dependencyAssignmentIds: structuralStringArray(assignment.dependencyAssignmentIds),
    priority: structuralScalar(assignment, "priority"),
    planRevision: structuralScalar(assignment, "planRevision"),
    rosterSnapshotRevision: structuralScalar(assignment, "rosterSnapshotRevision"),
    supersededBy: structuralScalar(assignment, "supersededBy"),
    terminationReason: structuralScalar(assignment, "terminationReason"),
    scopeLease: projectScopeLease(assignment.scopeLease),
    workspaceBaseline: projectWorkspaceBaseline(assignment.workspaceBaseline),
    report: projectAssignmentReport(assignment.report),
    dispatchState: structuralScalar(assignment, "dispatchState"),
    semanticState: structuralScalar(assignment, "semanticState"),
    status: structuralScalar(assignment, "semanticState"),
    attempt: structuralScalar(assignment, "attempt"),
    acceptedTurnId: structuralScalar(assignment, "acceptedTurnId"),
    terminalEvidence: projectTerminalEvidence(assignment.terminalEvidence),
    createdAt: structuralScalar(assignment, "createdAt"),
    dispatchedAt: structuralScalar(assignment, "dispatchedAt"),
    settledAt: structuralScalar(assignment, "settledAt"),
  };
}

function projectScopeLease(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        leaseId: structuralScalar(record, "leaseId"),
        workspaceId: structuralScalar(record, "workspaceId"),
        assignmentId: structuralScalar(record, "assignmentId"),
        scope: projectMutableScope(record.scope),
        state: structuralScalar(record, "state"),
        acquiredAt: structuralScalar(record, "acquiredAt"),
        transitionedAt: structuralScalar(record, "transitionedAt"),
        capturedDelta: projectPathEvidence(record.capturedDelta),
        recoveryAttempts: structuralScalar(record, "recoveryAttempts"),
      }
    : null;
}

function projectWorkspaceBaseline(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        baselineId: structuralScalar(record, "baselineId"),
        workspaceId: structuralScalar(record, "workspaceId"),
        assignmentId: structuralScalar(record, "assignmentId"),
        policyRevision: structuralScalar(record, "policyRevision"),
        capturedAt: structuralScalar(record, "capturedAt"),
        entryCount: Array.isArray(record.entries) ? record.entries.length : 0,
        entries: recordArray(record.entries).map((entry) => ({
          pathDigest: digestValue(entry.path),
          fingerprint: structuralScalar(entry, "fingerprint"),
          classification: structuralScalar(entry, "classification"),
        })),
      }
    : null;
}

function projectAssignmentReport(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const tests = recordArray(record.tests);
  const blockers = Array.isArray(record.blockers) ? record.blockers : [];
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  const handoffs = recordArray(record.handoffs);
  return {
    status: structuralScalar(record, "status"),
    verdict: structuralScalar(record, "verdict"),
    summaryDigest: digestValue(record.summary),
    artifactPaths: projectDigestSummary(record.artifactPaths),
    testCount: tests.length,
    tests: tests.map((test) => ({
      commandDigest: digestValue(test.command),
      passed: structuralScalar(test, "passed"),
    })),
    blockerCount: blockers.length,
    blockers: projectDigestSummary(blockers),
    decisionCount: decisions.length,
    decisions: projectDigestSummary(decisions),
    handoffCount: handoffs.length,
    handoffs: handoffs.map(projectHandoff),
  };
}

function projectHandoff(handoff: Record<string, unknown>): Record<string, unknown> {
  return {
    targetWorkstreamId: structuralScalar(handoff, "targetWorkstreamId"),
    summaryDigest: digestValue(handoff.summary),
    artifactPaths: projectDigestSummary(handoff.artifactPaths),
  };
}

function projectTerminalEvidence(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const turn = asRecord(record.acceptedTurn);
  return {
    assignmentId: structuralScalar(record, "assignmentId"),
    acceptedTurn: turn
      ? {
          turnId: structuralScalar(turn, "turnId"),
          runtimeAgentId: structuralScalar(turn, "runtimeAgentId"),
          outcome: structuralScalar(turn, "outcome"),
          recordedAt: structuralScalar(turn, "recordedAt"),
        }
      : null,
    capturedDelta: projectPathEvidence(record.capturedDelta),
    ownershipViolations: projectPathEvidence(record.ownershipViolations),
    report: projectAssignmentReport(record.report),
    handoffs: recordArray(record.handoffs).map(projectHandoff),
    capturedAt: structuralScalar(record, "capturedAt"),
  };
}

function projectPathEvidence(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((entry) => ({
    pathDigest: digestValue(entry.path),
    fingerprint: structuralScalar(entry, "fingerprint"),
  }));
}

function projectAttentionItems(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((item) => ({
    attentionId: structuralScalar(item, "attentionId"),
    kind: structuralScalar(item, "kind"),
    status: structuralScalar(item, "status"),
    priorMissionStatus: structuralScalar(item, "priorMissionStatus"),
    assignmentId: structuralScalar(item, "assignmentId"),
    summaryDigest: digestValue(item.summary),
    pathEvidence: projectPathEvidence(item.pathEvidence),
    createdAt: structuralScalar(item, "createdAt"),
    resolution: projectAttentionResolution(item.resolution),
  }));
}

function projectAttentionResolution(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        kind: structuralScalar(record, "kind"),
        actorId: structuralScalar(record, "actorId"),
        reasonDigest: digestValue(record.reason),
        resolvedAt: structuralScalar(record, "resolvedAt"),
        ownerAssignmentId: structuralScalar(record, "ownerAssignmentId"),
        recoveryAssignmentId: structuralScalar(record, "recoveryAssignmentId"),
        replacementMemberId: structuralScalar(record, "replacementMemberId"),
      }
    : null;
}

function projectLifecycleRecoveryFailure(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? {
        operation: structuralScalar(record, "operation"),
        intentId: structuralScalar(record, "intentId"),
        idempotencyKey: structuralScalar(record, "idempotencyKey"),
        code: structuralScalar(record, "code"),
        messageDigest: digestValue(record.message),
        retryAction: structuralScalar(record, "retryAction"),
        attempts: structuralScalar(record, "attempts"),
        failedAt: structuralScalar(record, "failedAt"),
      }
    : null;
}

function sanitizePinoJsonLines(source: string): string {
  const records = source.split(/\r?\n/).flatMap((line, index) => {
    if (!line) return [];
    const parsed = parseJsonRecord(line);
    if (!parsed) {
      return [{ line: index + 1, status: "invalid_json", sourceDigest: sha256Text(line) }];
    }
    const sanitized: Record<string, unknown> = { line: index + 1 };
    for (const field of SAFE_PINO_FIELDS) {
      const value = parsed[field];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        sanitized[field] = value;
      }
    }
    const error = parsed.err ?? parsed.error;
    if (error !== undefined && error !== null) {
      const safeError = sanitizeFailureError(error);
      sanitized.errorName = safeError.name;
      sanitized.errorCode = safeError.code;
      sanitized.errorDigest = safeError.digest;
    }
    return [sanitized];
  });
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function safeEvidenceToken<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === "string" && /^[A-Za-z0-9_.:/@+-]{1,256}$/.test(value) ? value : fallback;
}

function stableEvidenceString(value: unknown): string {
  try {
    return JSON.stringify(toCanonicalEvidenceValue(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

function toCanonicalEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCanonicalEvidenceValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, toCanonicalEvidenceValue(entry)]),
  );
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

type AgentTimelinePayload = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

export interface CompleteTimelineEvidence {
  pages: AgentTimelinePayload[];
  entries: AgentTimelinePayload["entries"];
}

export async function collectCompleteTimelineEvidence(
  client: DaemonClient,
  agentId: string,
  pageLimit = 250,
): Promise<CompleteTimelineEvidence> {
  const pages: AgentTimelinePayload[] = [];
  const seenCursors = new Set<string>();
  let page = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: pageLimit,
    projection: "canonical",
  });
  for (;;) {
    assertValidTimelinePage(page, agentId, pages.length);
    pages.push(page);
    if (!page.hasOlder) break;
    if (!page.startCursor) {
      throw new Error(`Timeline ${agentId} page ${pages.length - 1} hasOlder without startCursor`);
    }
    const cursorKey = JSON.stringify(page.startCursor);
    if (seenCursors.has(cursorKey)) {
      throw new Error(`Timeline ${agentId} repeated startCursor ${cursorKey}`);
    }
    seenCursors.add(cursorKey);
    page = await client.fetchAgentTimeline(agentId, {
      direction: "before",
      cursor: page.startCursor,
      limit: pageLimit,
      projection: "canonical",
    });
  }
  return {
    pages,
    entries: pages.toReversed().flatMap((candidate) => candidate.entries),
  };
}

function assertValidTimelinePage(
  page: AgentTimelinePayload,
  agentId: string,
  pageIndex: number,
): void {
  if (page.error) throw new Error(`Timeline ${agentId} page ${pageIndex} error: ${page.error}`);
  if (page.staleCursor) {
    throw new Error(`Timeline ${agentId} page ${pageIndex} returned staleCursor`);
  }
  if (page.gap) throw new Error(`Timeline ${agentId} page ${pageIndex} returned gap`);
}

type TeamMissionRoomSubscribePayload = Awaited<
  ReturnType<DaemonClient["subscribeTeamMissionRoom"]>
>;
type TeamMissionRoomUnsubscribePayload = Awaited<
  ReturnType<DaemonClient["unsubscribeTeamMissionRoom"]>
>;

export interface CompleteTeamMissionRoomEvidence {
  pages: TeamMissionRoomSubscribePayload[];
  messages: TeamMissionRoomSubscribePayload["messages"];
  unsubscribe: TeamMissionRoomUnsubscribePayload;
}

export async function collectCompleteTeamMissionRoomEvidence(
  client: DaemonClient,
  missionId: string,
  pageLimit = 250,
): Promise<CompleteTeamMissionRoomEvidence> {
  const pages: TeamMissionRoomSubscribePayload[] = [];
  const messages: TeamMissionRoomSubscribePayload["messages"] = [];
  let afterCursor = 0;
  let collectionError: unknown = null;
  try {
    for (;;) {
      const page = await client.subscribeTeamMissionRoom({
        missionId,
        afterCursor,
        limit: pageLimit,
      });
      if (page.error) {
        throw new Error(`Team Mission room ${missionId} page ${pages.length} error: ${page.error}`);
      }
      pages.push(page);
      messages.push(...page.messages);
      if (!page.hasMore) break;
      if (page.cursor <= afterCursor) {
        throw new Error(
          `Team Mission room ${missionId} page ${pages.length - 1} cursor did not advance`,
        );
      }
      afterCursor = page.cursor;
    }
  } catch (error) {
    collectionError = error;
  }
  const unsubscribe = await client.unsubscribeTeamMissionRoom({ missionId });
  if (unsubscribe.error) {
    throw new Error(`Team Mission room ${missionId} unsubscribe error: ${unsubscribe.error}`);
  }
  if (collectionError) throw collectionError;
  return { pages, messages, unsubscribe };
}

const AUDITED_TEAM_TOOL_NAMES = [
  "mission_status",
  "mission_plan",
  "assign_task",
  "assignment_report",
  "team_status",
  "team_member_history",
  "team_message",
  "chat_read",
] as const;

type AuditedTeamToolName = (typeof AUDITED_TEAM_TOOL_NAMES)[number];
type MissionAssociation = "verified" | "mismatch" | "unverifiable" | "not_required";

interface ToolDisciplineMissionEvidence {
  id: string;
  teamId: string;
  revision: number;
  planRevision: number;
  participants: Array<{ memberId: string; agentId: string; bindingEpoch: number }>;
  assignments: Array<{
    assignmentId: string;
    revision: number;
    planRevision: number;
    kind: "delivery" | "review" | "verification";
    workstreamId: string;
    assigneeMemberId: string;
    runtimeAgentId: string | null;
    bindingEpoch: number | null;
  }>;
}

interface ToolDisciplineTimelineEvidence {
  agentId: string;
  entries: Array<{
    seq: number;
    item: unknown;
  }>;
}

export interface ToolDisciplineAudit {
  score: 0 | 1 | 2;
  violations: string[];
  successfulCounts: Partial<Record<AuditedTeamToolName, number>>;
  calls: Array<{
    agentId: string;
    seq: number;
    rawName: string;
    name: AuditedTeamToolName;
    status: string;
    successful: boolean;
    missionAssociation: MissionAssociation;
    assignmentActivation: "assign_task" | "atomic_mission_plan" | null;
    inputDigest: string;
    outputDigest: string;
  }>;
}

export function auditToolDiscipline(
  timelines: ToolDisciplineTimelineEvidence[],
  mission: ToolDisciplineMissionEvidence,
): ToolDisciplineAudit {
  const { violations, successfulCounts, calls } = collectToolDisciplineCalls(timelines, mission);
  const core = ["mission_status", "mission_plan", "assignment_report"] as const;
  const collaboration = [
    "team_status",
    "team_member_history",
    "team_message",
    "chat_read",
  ] as const;
  const coreCompleted = core.every((name) => (successfulCounts[name] ?? 0) > 0);
  const coreObservedCompleted = core.every((name) =>
    calls.some((call) => call.name === name && call.successful),
  );
  const assignmentActivationObserved = calls.some(
    (call) => call.assignmentActivation !== null && call.successful,
  );
  const assignmentActivationCompleted = calls.some(
    (call) =>
      call.assignmentActivation !== null &&
      call.successful &&
      call.missionAssociation === "verified",
  );
  const collaborationCompleted = collaboration.every((name) => (successfulCounts[name] ?? 0) > 0);
  const requiredAssociations = calls.filter(
    (call) => call.name === "mission_plan" || call.name === "assignment_report",
  );
  const associationsVerified = (["mission_plan", "assignment_report"] as const).every((name) =>
    requiredAssociations.some(
      (call) => call.name === name && call.successful && call.missionAssociation === "verified",
    ),
  );
  let score: ToolDisciplineAudit["score"] = 1;
  if (!coreObservedCompleted || !assignmentActivationObserved) {
    score = 0;
  } else if (
    coreCompleted &&
    assignmentActivationCompleted &&
    collaborationCompleted &&
    associationsVerified &&
    violations.length === 0
  ) {
    score = 2;
  }
  return { score, violations, successfulCounts, calls };
}

function collectToolDisciplineCalls(
  timelines: ToolDisciplineTimelineEvidence[],
  mission: ToolDisciplineMissionEvidence,
): Omit<ToolDisciplineAudit, "score"> {
  const violations: string[] = [];
  const successfulCounts: ToolDisciplineAudit["successfulCounts"] = {};
  const calls: ToolDisciplineAudit["calls"] = [];
  for (const timeline of timelines) {
    for (const entry of timeline.entries) {
      const item = asRecord(entry.item);
      if (item?.type !== "tool_call" || typeof item.name !== "string") continue;
      const name = normalizeAuditedToolName(item.name);
      if (!name) continue;
      const detail = asRecord(item.detail);
      const input = detail?.type === "unknown" ? detail.input : undefined;
      const output = detail?.type === "unknown" ? detail.output : undefined;
      const status = typeof item.status === "string" ? item.status : "unknown";
      const successful = status === "completed" && item.error === null;
      const missionAssociation = assessToolMissionAssociation(
        name,
        input,
        output,
        mission,
        timeline.agentId,
      );
      const assignmentActivation = classifyAssignmentActivation(name, input, output, mission);
      calls.push({
        agentId: timeline.agentId,
        seq: entry.seq,
        rawName: item.name,
        name,
        status,
        successful,
        missionAssociation,
        assignmentActivation,
        inputDigest: sha256Text(stableEvidenceString(input)),
        outputDigest: sha256Text(stableEvidenceString(output)),
      });
      if (successful && missionAssociation === "verified") {
        successfulCounts[name] = (successfulCounts[name] ?? 0) + 1;
      } else if (!successful) {
        violations.push(`tool_discipline:${name}_not_completed:${status}`);
      }
      if (missionAssociation === "mismatch") {
        violations.push(`tool_discipline:${name}_association_mismatch`);
      } else if (missionAssociation === "unverifiable") {
        violations.push(`tool_discipline:${name}_association_unverifiable`);
      }
    }
  }
  return { violations, successfulCounts, calls };
}

function classifyAssignmentActivation(
  name: AuditedTeamToolName,
  input: unknown,
  output: unknown,
  mission: ToolDisciplineMissionEvidence,
): ToolDisciplineAudit["calls"][number]["assignmentActivation"] {
  if (name === "assign_task") return "assign_task";
  if (name !== "mission_plan") return null;
  const parsedInput = asRecord(input);
  const parsedOutput = unwrapToolOutput(output);
  const drafts =
    parsedInput && Array.isArray(parsedInput.assignments) ? parsedInput.assignments : [];
  const assignments =
    parsedOutput && Array.isArray(parsedOutput.assignments) ? parsedOutput.assignments : [];
  if (drafts.length === 0 || assignments.length === 0) return null;
  if (
    typeof parsedOutput?.planRevision !== "number" ||
    !Number.isInteger(parsedOutput.planRevision)
  ) {
    return null;
  }
  const parsedDrafts = drafts.map(asRecord);
  if (
    parsedDrafts.some(
      (draft) =>
        draft?.kind !== "delivery" ||
        typeof draft.workstreamId !== "string" ||
        draft.workstreamId.length === 0,
    )
  ) {
    return null;
  }
  const draftWorkstreamIds = parsedDrafts.map((draft) => String(draft?.workstreamId));
  const outputDeliveries = assignments
    .map(asRecord)
    .filter((assignment): assignment is Record<string, unknown> => assignment?.kind === "delivery");
  const outputWorkstreamIds = outputDeliveries.flatMap((assignment) =>
    typeof assignment.workstreamId === "string" ? [assignment.workstreamId] : [],
  );
  const expectedWorkstreamIds = [
    ...new Set(
      mission.assignments
        .filter(
          (assignment) =>
            assignment.kind === "delivery" && assignment.planRevision === parsedOutput.planRevision,
        )
        .map((assignment) => assignment.workstreamId),
    ),
  ];
  return expectedWorkstreamIds.length > 0 &&
    sameExactIds(draftWorkstreamIds, expectedWorkstreamIds) &&
    sameExactIds(outputWorkstreamIds, expectedWorkstreamIds) &&
    outputDeliveries.every((assignment) =>
      matchesMaterializedDeliveryAssignment(assignment, mission),
    )
    ? "atomic_mission_plan"
    : null;
}

function matchesMaterializedDeliveryAssignment(
  value: Record<string, unknown>,
  mission: ToolDisciplineMissionEvidence,
): boolean {
  if (!matchesCurrentAssignment(value, mission)) return false;
  const expected = mission.assignments.find(
    (assignment) => assignment.assignmentId === value.assignmentId,
  );
  return (
    expected?.kind === "delivery" &&
    value.kind === expected.kind &&
    value.workstreamId === expected.workstreamId
  );
}

function normalizeAuditedToolName(name: string): AuditedTeamToolName | null {
  return (
    AUDITED_TEAM_TOOL_NAMES.find((candidate) => name === candidate || name.endsWith(candidate)) ??
    null
  );
}

function assessToolMissionAssociation(
  name: AuditedTeamToolName,
  input: unknown,
  output: unknown,
  mission: ToolDisciplineMissionEvidence,
  callerAgentId: string,
): MissionAssociation {
  const parsedInput = asRecord(input);
  if (!parsedInput) return "unverifiable";
  if (parsedInput.missionId !== mission.id) return "mismatch";
  const caller = mission.participants.find((participant) => participant.agentId === callerAgentId);
  if (!caller) return "mismatch";
  const parsedOutput = unwrapToolOutput(output);
  if (!parsedOutput) return "unverifiable";
  const context = { input: parsedInput, output: parsedOutput, mission, caller, callerAgentId };
  switch (name) {
    case "mission_plan":
      return assessMissionPlanAssociation(context);
    case "assign_task":
      return assessAssignTaskAssociation(context);
    case "assignment_report":
      return assessAssignmentReportAssociation(context);
    case "mission_status":
      return assessMissionStatusAssociation(context);
    case "team_status":
      return assessTeamStatusAssociation(context);
    case "team_member_history":
      return assessMemberHistoryAssociation(context);
    case "team_message":
      return assessTeamMessageAssociation(context);
    case "chat_read":
      return "verified";
  }
}

interface ToolAssociationContext {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  mission: ToolDisciplineMissionEvidence;
  caller: ToolDisciplineMissionEvidence["participants"][number];
  callerAgentId: string;
}

function assessMissionPlanAssociation(context: ToolAssociationContext): MissionAssociation {
  const { input, output, mission } = context;
  if (
    !validExpectedMissionRevision(input.expectedRevision, mission.revision) ||
    typeof input.expectedPlanRevision !== "number"
  ) {
    return "unverifiable";
  }
  return Number.isInteger(input.expectedPlanRevision) &&
    input.expectedPlanRevision >= 0 &&
    input.expectedPlanRevision < mission.planRevision &&
    matchesMissionSnapshot(output, mission) &&
    advancesExpectedRevision(output.revision, input.expectedRevision) &&
    output.planRevision === input.expectedPlanRevision + 1
    ? "verified"
    : "mismatch";
}

function assessAssignTaskAssociation(context: ToolAssociationContext): MissionAssociation {
  const { input, output, mission } = context;
  const outputMission = asRecord(output.mission);
  const outputAssignments = Array.isArray(output.assignments) ? output.assignments : null;
  if (!outputMission || !outputAssignments) return "unverifiable";
  return validExpectedMissionRevision(input.expectedRevision, mission.revision) &&
    input.expectedPlanRevision === mission.planRevision &&
    matchesMissionSnapshot(outputMission, mission) &&
    advancesExpectedRevision(outputMission.revision, input.expectedRevision) &&
    outputAssignments.length > 0 &&
    outputAssignments.every((assignment) => matchesCurrentAssignment(assignment, mission))
    ? "verified"
    : "mismatch";
}

function assessAssignmentReportAssociation(context: ToolAssociationContext): MissionAssociation {
  const { input, output, mission, caller, callerAgentId } = context;
  if (typeof input.assignmentId !== "string") return "unverifiable";
  const assignment = mission.assignments.find(
    (candidate) => candidate.assignmentId === input.assignmentId,
  );
  const outputMission = asRecord(output.mission);
  const outputAssignment = asRecord(output.assignment);
  if (!assignment || !outputMission || !outputAssignment) return "mismatch";
  return assignment.runtimeAgentId === callerAgentId &&
    assignment.assigneeMemberId === caller.memberId &&
    assignment.bindingEpoch === caller.bindingEpoch &&
    validExpectedMissionRevision(input.expectedRevision, mission.revision) &&
    typeof input.expectedAssignmentRevision === "number" &&
    Number.isInteger(input.expectedAssignmentRevision) &&
    input.expectedAssignmentRevision > 0 &&
    outputAssignment.revision === input.expectedAssignmentRevision + 1 &&
    matchesMissionSnapshot(outputMission, mission) &&
    advancesExpectedRevision(outputMission.revision, input.expectedRevision) &&
    matchesCurrentAssignment(outputAssignment, mission)
    ? "verified"
    : "mismatch";
}

function assessMissionStatusAssociation(context: ToolAssociationContext): MissionAssociation {
  const outputMission = asRecord(context.output.mission);
  return outputMission && matchesMissionSnapshot(outputMission, context.mission)
    ? "verified"
    : "mismatch";
}

function assessTeamStatusAssociation(context: ToolAssociationContext): MissionAssociation {
  const { output, mission, caller } = context;
  const outputTeam = asRecord(output.team);
  return output.missionId === mission.id &&
    outputTeam?.id === mission.teamId &&
    output.callerMemberId === caller.memberId
    ? "verified"
    : "mismatch";
}

function assessMemberHistoryAssociation(context: ToolAssociationContext): MissionAssociation {
  const { input, output, mission } = context;
  if (typeof input.memberId !== "string") return "unverifiable";
  const participant = mission.participants.find(
    (candidate) => candidate.memberId === input.memberId,
  );
  const outputMember = asRecord(output.member);
  const outputParticipant = asRecord(output.participant);
  return participant &&
    output.missionId === mission.id &&
    outputMember?.memberId === participant.memberId &&
    outputParticipant?.memberId === participant.memberId &&
    outputParticipant.agentId === participant.agentId &&
    outputParticipant.bindingEpoch === participant.bindingEpoch
    ? "verified"
    : "mismatch";
}

function assessTeamMessageAssociation(context: ToolAssociationContext): MissionAssociation {
  const { input, output, mission, caller } = context;
  if (typeof input.recipient !== "string" || input.recipient.length === 0) return "unverifiable";
  const recipient = mission.participants.find(
    (participant) => participant.memberId === output.recipientMemberId,
  );
  return recipient &&
    output.senderMemberId === caller.memberId &&
    output.recipientMemberId === recipient.memberId
    ? "verified"
    : "mismatch";
}

function unwrapToolOutput(output: unknown): Record<string, unknown> | null {
  const parsed = asRecord(output);
  if (!parsed) return null;
  return asRecord(parsed.structuredContent) ?? parsed;
}

function matchesMissionSnapshot(
  value: Record<string, unknown>,
  mission: ToolDisciplineMissionEvidence,
): boolean {
  return (
    value.id === mission.id &&
    value.teamId === mission.teamId &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    value.revision <= mission.revision &&
    typeof value.planRevision === "number" &&
    Number.isInteger(value.planRevision) &&
    value.planRevision >= 0 &&
    value.planRevision <= mission.planRevision
  );
}

function matchesCurrentAssignment(
  value: unknown,
  mission: ToolDisciplineMissionEvidence,
  requireFinalRevision = false,
): boolean {
  const observed = asRecord(value);
  if (!observed || typeof observed.assignmentId !== "string") return false;
  const expected = mission.assignments.find(
    (assignment) => assignment.assignmentId === observed.assignmentId,
  );
  if (!expected) return false;
  const revisionMatches =
    typeof observed.revision === "number" &&
    Number.isInteger(observed.revision) &&
    observed.revision > 0 &&
    (requireFinalRevision
      ? observed.revision === expected.revision
      : observed.revision <= expected.revision);
  return (
    revisionMatches &&
    observed.planRevision === expected.planRevision &&
    observed.assigneeMemberId === expected.assigneeMemberId &&
    (observed.runtimeAgentId === null || observed.runtimeAgentId === expected.runtimeAgentId) &&
    (observed.bindingEpoch === null || observed.bindingEpoch === expected.bindingEpoch)
  );
}

function validExpectedMissionRevision(value: unknown, finalRevision: number): boolean {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= finalRevision
  );
}

function advancesExpectedRevision(observed: unknown, expected: unknown): boolean {
  return typeof observed === "number" && typeof expected === "number" && observed > expected;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type DagScope =
  | { kind: "read_only" }
  | { kind: "paths"; pathPrefixes: string[] }
  | { kind: "workspace" };

interface ParallelDagMissionEvidence {
  planRevision: number;
  workstreams: Array<{
    workstreamId: string;
    kind: "delivery" | "integration" | "verification";
    mutableScope: DagScope;
    dependencyWorkstreamIds: string[];
    ownerMemberId: string;
    reviewPolicy: string;
    reviewerMemberId: string | null;
  }>;
  assignments: Array<{
    assignmentId: string;
    kind: "delivery" | "review" | "verification";
    workstreamId: string;
    assigneeMemberId: string;
    mutableScope: DagScope;
    dependencyAssignmentIds: string[];
    subjectAssignmentIds: string[];
    planRevision: number;
    semanticState: string;
    report: { status: string; verdict: string | null } | null;
    dispatchedAt: string | null;
    settledAt: string | null;
  }>;
}

interface ParallelDagNodeEvidence {
  workstreamId: string | null;
  assignmentId: string | null;
  dispatchedAt: string | null;
  settledAt: string | null;
}

type DagWorkstreamEvidence = ParallelDagMissionEvidence["workstreams"][number];
type DagAssignmentEvidence = ParallelDagMissionEvidence["assignments"][number];
interface DagRoleSelection<T> {
  api: T | null;
  ui: T | null;
  test: T | null;
  integration: T | null;
  finalVerification: T | null;
}

export interface ParallelDeliveryDagAudit {
  valid: boolean;
  violations: string[];
  commonDeliveryOverlap: { startedAt: string; settledAt: string } | null;
  nodes: {
    api: ParallelDagNodeEvidence;
    ui: ParallelDagNodeEvidence;
    test: ParallelDagNodeEvidence;
    integration: ParallelDagNodeEvidence;
    finalVerification: ParallelDagNodeEvidence;
    apiReviewAssignmentIds: string[];
    finalSubjectAssignmentIds: string[];
  };
}

export interface RecoveryDependencyDagAudit {
  valid: boolean;
  violations: string[];
  nodes: {
    contract: ParallelDagNodeEvidence;
    contractTail: ParallelDagNodeEvidence;
    contractChainWorkstreamIds: string[];
    contractChainAssignmentIds: string[];
    implementation: ParallelDagNodeEvidence;
    finalVerification: ParallelDagNodeEvidence;
    finalSubjectAssignmentIds: string[];
  };
}

const PARALLEL_DAG_SCOPES = {
  api: "src/profile-api.mjs",
  ui: "src/profile-card.mjs",
  test: "test/profile.acceptance.test.mjs",
  integration: "src/index.mjs",
} as const;

export function auditParallelDeliveryDag(
  mission: ParallelDagMissionEvidence,
): ParallelDeliveryDagAudit {
  const violations: string[] = [];
  const workstream = {
    api: findExactWorkstream(mission, "api", "delivery", PARALLEL_DAG_SCOPES.api, violations),
    ui: findExactWorkstream(mission, "ui", "delivery", PARALLEL_DAG_SCOPES.ui, violations),
    test: findExactWorkstream(mission, "test", "delivery", PARALLEL_DAG_SCOPES.test, violations),
    integration: findExactWorkstream(
      mission,
      "integration",
      "integration",
      PARALLEL_DAG_SCOPES.integration,
      violations,
    ),
    finalVerification: findExactWorkstream(
      mission,
      "final_verification",
      "verification",
      null,
      violations,
    ),
  };
  const assignment = {
    api: findExactAssignment(
      mission,
      "api",
      workstream.api,
      "delivery",
      PARALLEL_DAG_SCOPES.api,
      violations,
    ),
    ui: findExactAssignment(
      mission,
      "ui",
      workstream.ui,
      "delivery",
      PARALLEL_DAG_SCOPES.ui,
      violations,
    ),
    test: findExactAssignment(
      mission,
      "test",
      workstream.test,
      "delivery",
      PARALLEL_DAG_SCOPES.test,
      violations,
    ),
    integration: findExactAssignment(
      mission,
      "integration",
      workstream.integration,
      "delivery",
      PARALLEL_DAG_SCOPES.integration,
      violations,
    ),
    finalVerification: findExactAssignment(
      mission,
      "final_verification",
      workstream.finalVerification,
      "verification",
      null,
      violations,
    ),
  };

  const apiReview = validateApiReview(mission, workstream.api, assignment.api, violations);
  validateExactDagNodeSet(
    "parallel_delivery",
    mission,
    Object.values(workstream),
    [...Object.values(assignment), apiReview],
    violations,
  );
  const finalSubjects = validateDagDependencies(mission, workstream, assignment, violations);
  const commonDeliveryOverlap = validateDagTiming(assignment, finalSubjects, violations);

  return {
    valid: violations.length === 0,
    violations,
    commonDeliveryOverlap,
    nodes: {
      api: toDagNode(workstream.api, assignment.api),
      ui: toDagNode(workstream.ui, assignment.ui),
      test: toDagNode(workstream.test, assignment.test),
      integration: toDagNode(workstream.integration, assignment.integration),
      finalVerification: toDagNode(workstream.finalVerification, assignment.finalVerification),
      apiReviewAssignmentIds: apiReview ? [apiReview.assignmentId] : [],
      finalSubjectAssignmentIds: finalSubjects.map((subject) => subject.assignmentId).toSorted(),
    },
  };
}

function validateExactDagNodeSet(
  prefix: "parallel_delivery" | "recovery_dependency",
  mission: ParallelDagMissionEvidence,
  expectedWorkstreams: Array<DagWorkstreamEvidence | null>,
  expectedAssignments: Array<DagAssignmentEvidence | null>,
  violations: string[],
): void {
  const expectedWorkstreamIds = new Set(
    expectedWorkstreams.flatMap((node) => (node ? [node.workstreamId] : [])),
  );
  const unexpectedWorkstreams = mission.workstreams.filter(
    (node) => !expectedWorkstreamIds.has(node.workstreamId),
  );
  if (unexpectedWorkstreams.length > 0) {
    violations.push(`${prefix}:unexpected_workstream_nodes:${unexpectedWorkstreams.length}`);
  }
  const expectedAssignmentIds = new Set(
    expectedAssignments.flatMap((node) => (node ? [node.assignmentId] : [])),
  );
  const unexpectedAssignments = mission.assignments.filter(
    (node) =>
      node.planRevision === mission.planRevision && !expectedAssignmentIds.has(node.assignmentId),
  );
  if (unexpectedAssignments.length > 0) {
    violations.push(`${prefix}:unexpected_assignment_nodes:${unexpectedAssignments.length}`);
  }
}

export function auditRecoveryDependencyDag(
  mission: ParallelDagMissionEvidence,
): RecoveryDependencyDagAudit {
  const violations: string[] = [];
  const contractWorkstreams = findRecoveryContractWorkstreamChain(mission, violations);
  const contractAssignments = contractWorkstreams.map((workstream) =>
    findRecoveryAssignment(
      mission,
      "contract",
      workstream,
      "delivery",
      "docs/feature-flags-contract.md",
      violations,
    ),
  );
  const contractReviews = contractWorkstreams.map((workstream, index) =>
    findRecoveryReview(
      mission,
      "contract",
      workstream,
      contractAssignments[index] ?? null,
      violations,
    ),
  );
  const contractWorkstream = contractWorkstreams.at(-1) ?? null;
  const contractAssignment = contractAssignments.at(-1) ?? null;
  const contractRootWorkstream = contractWorkstreams[0] ?? null;
  const contractRootAssignment = contractAssignments[0] ?? null;
  const implementationWorkstream = findRecoveryWorkstream(
    mission,
    "implementation",
    ["delivery", "integration"],
    "src/parse-feature-flags.mjs",
    violations,
  );
  const finalWorkstream = findRecoveryWorkstream(
    mission,
    "final_verification",
    ["verification"],
    null,
    violations,
  );
  const implementationAssignment = findRecoveryAssignment(
    mission,
    "implementation",
    implementationWorkstream,
    "delivery",
    "src/parse-feature-flags.mjs",
    violations,
  );
  const finalAssignment = findRecoveryAssignment(
    mission,
    "final_verification",
    finalWorkstream,
    "verification",
    null,
    violations,
  );
  const implementationReview = findRecoveryReview(
    mission,
    "implementation",
    implementationWorkstream,
    implementationAssignment,
    violations,
  );
  const selection = {
    contractWorkstreams,
    contractAssignments,
    contractReviews,
    implementationWorkstream,
    finalWorkstream,
    implementationAssignment,
    finalAssignment,
    implementationReview,
  };
  validateExactDagNodeSet(
    "recovery_dependency",
    mission,
    [...contractWorkstreams, implementationWorkstream, finalWorkstream],
    [
      ...contractAssignments,
      implementationAssignment,
      ...contractReviews,
      implementationReview,
      finalAssignment,
    ],
    violations,
  );
  validateRecoveryDependencies(selection, violations);
  const finalSubjects = validateRecoveryFinalSubjects(
    [...contractAssignments, implementationAssignment, ...contractReviews, implementationReview],
    finalAssignment,
    violations,
  );
  validateRecoveryTiming(selection, finalSubjects, violations);
  const finalSubjectIds = finalSubjects.map((subject) => subject.assignmentId);

  return {
    valid: violations.length === 0,
    violations,
    nodes: {
      contract: toDagNode(contractRootWorkstream, contractRootAssignment),
      contractTail: toDagNode(contractWorkstream, contractAssignment),
      contractChainWorkstreamIds: contractWorkstreams.map((workstream) => workstream.workstreamId),
      contractChainAssignmentIds: contractAssignments.flatMap((assignment) =>
        assignment ? [assignment.assignmentId] : [],
      ),
      implementation: toDagNode(implementationWorkstream, implementationAssignment),
      finalVerification: toDagNode(finalWorkstream, finalAssignment),
      finalSubjectAssignmentIds: finalSubjectIds.toSorted(),
    },
  };
}

interface RecoveryDagSelection {
  contractWorkstreams: DagWorkstreamEvidence[];
  contractAssignments: Array<DagAssignmentEvidence | null>;
  contractReviews: Array<DagAssignmentEvidence | null>;
  implementationWorkstream: DagWorkstreamEvidence | null;
  finalWorkstream: DagWorkstreamEvidence | null;
  implementationAssignment: DagAssignmentEvidence | null;
  finalAssignment: DagAssignmentEvidence | null;
  implementationReview: DagAssignmentEvidence | null;
}

function validateRecoveryDependencies(selection: RecoveryDagSelection, violations: string[]): void {
  const { contractWorkstreams, implementationWorkstream, finalWorkstream } = selection;
  const { contractAssignments, implementationAssignment } = selection;
  for (const [index, assignment] of contractAssignments.entries()) {
    if (!assignment) continue;
    const predecessor = index > 0 ? contractAssignments[index - 1] : null;
    const expectedDependencies = predecessor ? [predecessor.assignmentId] : [];
    if (!sameExactIds(assignment.dependencyAssignmentIds, expectedDependencies)) {
      violations.push("recovery_dependency:contract_assignment_dependencies_mismatch");
    }
    if (predecessor && assignment.planRevision <= predecessor.planRevision) {
      violations.push("recovery_dependency:contract_assignment_plan_revision_not_increasing");
    }
  }
  const contractWorkstream = contractWorkstreams.at(-1) ?? null;
  const contractAssignment = contractAssignments.at(-1) ?? null;
  if (
    implementationWorkstream &&
    !sameExactIds(
      implementationWorkstream.dependencyWorkstreamIds,
      contractWorkstream ? [contractWorkstream.workstreamId] : [],
    )
  ) {
    violations.push("recovery_dependency:implementation_workstream_dependencies_mismatch");
  }
  if (
    implementationAssignment &&
    !sameExactIds(
      implementationAssignment.dependencyAssignmentIds,
      contractAssignment ? [contractAssignment.assignmentId] : [],
    )
  ) {
    violations.push("recovery_dependency:implementation_assignment_dependencies_mismatch");
  }
  if (finalWorkstream) {
    const transitiveDependencies = implementationWorkstream
      ? [implementationWorkstream.workstreamId]
      : [];
    const explicitDependencies = [contractWorkstream, implementationWorkstream].flatMap(
      (workstream) => (workstream ? [workstream.workstreamId] : []),
    );
    if (
      !sameExactIds(finalWorkstream.dependencyWorkstreamIds, transitiveDependencies) &&
      !sameExactIds(finalWorkstream.dependencyWorkstreamIds, explicitDependencies)
    ) {
      violations.push("recovery_dependency:final_workstream_dependencies_mismatch");
    }
  }
}

function validateRecoveryFinalSubjects(
  expectedSubjects: Array<DagAssignmentEvidence | null>,
  finalAssignment: DagAssignmentEvidence | null,
  violations: string[],
): DagAssignmentEvidence[] {
  const subjects = expectedSubjects.flatMap((subject) => (subject ? [subject] : []));
  const subjectIds = subjects.map((subject) => subject.assignmentId);
  if (finalAssignment && !sameExactIds(finalAssignment.dependencyAssignmentIds, subjectIds)) {
    violations.push("recovery_dependency:final_assignment_dependencies_mismatch");
  }
  if (finalAssignment && !sameExactIds(finalAssignment.subjectAssignmentIds, subjectIds)) {
    violations.push("recovery_dependency:final_subject_assignments_mismatch");
  }
  return subjects;
}

function validateRecoveryTiming(
  selection: RecoveryDagSelection,
  finalSubjects: DagAssignmentEvidence[],
  violations: string[],
): void {
  const subjectIntervals = new Map(
    finalSubjects.flatMap((subject) => {
      const interval = parseRecoveryInterval(subject, violations)[0];
      return interval ? [[subject.assignmentId, interval] as const] : [];
    }),
  );
  validateContractChainTiming(selection.contractAssignments, subjectIntervals, violations);
  validateRecoveryReviewTiming(selection, subjectIntervals, violations);
  const contractAssignment = selection.contractAssignments.at(-1) ?? null;
  const contractInterval = contractAssignment
    ? subjectIntervals.get(contractAssignment.assignmentId)
    : undefined;
  const implementationInterval = selection.implementationAssignment
    ? subjectIntervals.get(selection.implementationAssignment.assignmentId)
    : undefined;
  if (
    contractInterval &&
    implementationInterval &&
    implementationInterval.start < contractInterval.end
  ) {
    violations.push("recovery_dependency:implementation_dispatched_before_contract_settled");
  }
  const finalInterval = selection.finalAssignment
    ? parseRecoveryInterval(selection.finalAssignment, violations)[0]
    : undefined;
  if (
    finalInterval &&
    subjectIntervals.size === finalSubjects.length &&
    finalInterval.start <
      Math.max(...[...subjectIntervals.values()].map((interval) => interval.end))
  ) {
    violations.push("recovery_dependency:final_dispatched_before_subjects_settled");
  }
}

interface RecoveryInterval {
  start: number;
  end: number;
}

function validateContractChainTiming(
  assignments: Array<DagAssignmentEvidence | null>,
  intervals: ReadonlyMap<string, RecoveryInterval>,
  violations: string[],
): void {
  for (let index = 1; index < assignments.length; index += 1) {
    const predecessor = assignments[index - 1];
    const assignment = assignments[index];
    const predecessorInterval = predecessor ? intervals.get(predecessor.assignmentId) : undefined;
    const assignmentInterval = assignment ? intervals.get(assignment.assignmentId) : undefined;
    if (
      predecessorInterval &&
      assignmentInterval &&
      assignmentInterval.start < predecessorInterval.end
    ) {
      violations.push(
        "recovery_dependency:contract_amendment_dispatched_before_predecessor_settled",
      );
    }
  }
}

function validateRecoveryReviewTiming(
  selection: RecoveryDagSelection,
  intervals: ReadonlyMap<string, RecoveryInterval>,
  violations: string[],
): void {
  const reviewStages: Array<
    readonly [
      "contract" | "implementation",
      DagAssignmentEvidence | null,
      DagAssignmentEvidence | null,
    ]
  > = selection.contractAssignments.map((delivery, index) => [
    "contract",
    delivery,
    selection.contractReviews[index] ?? null,
  ]);
  reviewStages.push([
    "implementation",
    selection.implementationAssignment,
    selection.implementationReview,
  ]);
  for (const [role, delivery, review] of reviewStages) {
    const deliveryInterval = delivery ? intervals.get(delivery.assignmentId) : undefined;
    const reviewInterval = review ? intervals.get(review.assignmentId) : undefined;
    if (deliveryInterval && reviewInterval && reviewInterval.start < deliveryInterval.end) {
      violations.push(`recovery_dependency:${role}_review_dispatched_before_delivery_settled`);
    }
  }
}

function findRecoveryContractWorkstreamChain(
  mission: ParallelDagMissionEvidence,
  violations: string[],
): DagWorkstreamEvidence[] {
  const candidates = mission.workstreams.filter(
    (candidate) =>
      candidate.kind === "delivery" &&
      scopeMatches(candidate.mutableScope, "docs/feature-flags-contract.md"),
  );
  if (candidates.length === 0) {
    violations.push("recovery_dependency:contract_workstream_matches:0");
    return [];
  }

  const byId = new Map(candidates.map((candidate) => [candidate.workstreamId, candidate]));
  const roots: DagWorkstreamEvidence[] = [];
  const predecessorById = new Map<string, string>();
  let invalidDependencyCount = 0;
  for (const candidate of candidates) {
    if (candidate.dependencyWorkstreamIds.length === 0) {
      roots.push(candidate);
      continue;
    }
    const [predecessorId] = candidate.dependencyWorkstreamIds;
    if (
      candidate.dependencyWorkstreamIds.length !== 1 ||
      !predecessorId ||
      !byId.has(predecessorId)
    ) {
      invalidDependencyCount += 1;
      continue;
    }
    predecessorById.set(candidate.workstreamId, predecessorId);
  }
  if (roots.length !== 1) {
    violations.push(`recovery_dependency:contract_workstream_chain_roots:${roots.length}`);
  }
  if (invalidDependencyCount > 0) {
    violations.push(
      `recovery_dependency:contract_workstream_chain_dependency_mismatches:${invalidDependencyCount}`,
    );
  }

  const childrenById = new Map<string, DagWorkstreamEvidence[]>();
  for (const candidate of candidates) {
    const predecessorId = predecessorById.get(candidate.workstreamId);
    if (!predecessorId) continue;
    const children = childrenById.get(predecessorId) ?? [];
    children.push(candidate);
    childrenById.set(predecessorId, children);
  }
  const branchCount = [...childrenById.values()].filter((children) => children.length > 1).length;
  if (branchCount > 0) {
    violations.push(`recovery_dependency:contract_workstream_chain_branches:${branchCount}`);
  }

  const ordered: DagWorkstreamEvidence[] = [];
  const visited = new Set<string>();
  let current = roots.length === 1 ? roots[0] : undefined;
  while (current && !visited.has(current.workstreamId)) {
    ordered.push(current);
    visited.add(current.workstreamId);
    const children = childrenById.get(current.workstreamId) ?? [];
    current = children.length === 1 ? children[0] : undefined;
  }
  if (visited.size !== candidates.length) {
    violations.push(
      `recovery_dependency:contract_workstream_chain_unreachable:${candidates.length - visited.size}`,
    );
  }
  return ordered.length > 0 ? ordered : candidates;
}

function findRecoveryWorkstream(
  mission: ParallelDagMissionEvidence,
  role: string,
  allowedKinds: readonly DagWorkstreamEvidence["kind"][],
  pathPrefix: string | null,
  violations: string[],
): DagWorkstreamEvidence | null {
  const matches = mission.workstreams.filter(
    (candidate) =>
      allowedKinds.includes(candidate.kind) && scopeMatches(candidate.mutableScope, pathPrefix),
  );
  if (matches.length !== 1) {
    violations.push(`recovery_dependency:${role}_workstream_matches:${matches.length}`);
  }
  return matches[0] ?? null;
}

function findRecoveryAssignment(
  mission: ParallelDagMissionEvidence,
  role: string,
  workstream: DagWorkstreamEvidence | null,
  kind: DagAssignmentEvidence["kind"],
  pathPrefix: string | null,
  violations: string[],
): DagAssignmentEvidence | null {
  const candidates = workstream
    ? mission.assignments.filter(
        (candidate) =>
          candidate.workstreamId === workstream.workstreamId &&
          candidate.kind === kind &&
          candidate.planRevision <= mission.planRevision &&
          candidate.semanticState === "completed" &&
          candidate.report?.status === "completed" &&
          scopeMatches(candidate.mutableScope, pathPrefix),
      )
    : [];
  const newestRevision = candidates.reduce(
    (revision, candidate) => Math.max(revision, candidate.planRevision),
    Number.NEGATIVE_INFINITY,
  );
  const matches = candidates.filter((candidate) => candidate.planRevision === newestRevision);
  if (matches.length !== 1) {
    violations.push(`recovery_dependency:${role}_assignment_matches:${matches.length}`);
  }
  return matches[0] ?? null;
}

function findRecoveryReview(
  mission: ParallelDagMissionEvidence,
  role: "contract" | "implementation",
  workstream: DagWorkstreamEvidence | null,
  delivery: DagAssignmentEvidence | null,
  violations: string[],
): DagAssignmentEvidence | null {
  if (!workstream || workstream.reviewPolicy !== "required") return null;
  if (!workstream.reviewerMemberId) {
    violations.push(`recovery_dependency:${role}_reviewer_required`);
  } else if (workstream.reviewerMemberId === workstream.ownerMemberId) {
    violations.push(`recovery_dependency:${role}_reviewer_must_differ_from_owner`);
  }
  const candidates = mission.assignments.filter(
    (candidate) =>
      candidate.workstreamId === workstream.workstreamId &&
      candidate.kind === "review" &&
      candidate.planRevision <= mission.planRevision &&
      candidate.semanticState === "completed" &&
      candidate.report?.status === "completed" &&
      candidate.report.verdict === "approved",
  );
  const newestRevision = candidates.reduce(
    (revision, candidate) => Math.max(revision, candidate.planRevision),
    Number.NEGATIVE_INFINITY,
  );
  const matches = candidates.filter((candidate) => candidate.planRevision === newestRevision);
  if (matches.length !== 1) {
    violations.push(`recovery_dependency:${role}_review_assignment_matches:${matches.length}`);
  }
  const review = matches[0] ?? null;
  if (!review) return null;
  if (review.mutableScope.kind !== "read_only") {
    violations.push(`recovery_dependency:${role}_review_must_be_read_only`);
  }
  if (
    review.planRevision === mission.planRevision &&
    review.assigneeMemberId !== workstream.reviewerMemberId
  ) {
    violations.push(`recovery_dependency:${role}_review_assignee_mismatch`);
  }
  if (delivery && review.assigneeMemberId === delivery.assigneeMemberId) {
    violations.push(`recovery_dependency:${role}_review_assignee_must_differ_from_delivery`);
  }
  const deliveryIds = delivery ? [delivery.assignmentId] : [];
  if (!sameExactIds(review.dependencyAssignmentIds, deliveryIds)) {
    violations.push(`recovery_dependency:${role}_review_dependencies_mismatch`);
  }
  if (!sameExactIds(review.subjectAssignmentIds, deliveryIds)) {
    violations.push(`recovery_dependency:${role}_review_subjects_mismatch`);
  }
  return review;
}

function parseRecoveryInterval(
  assignment: DagAssignmentEvidence,
  violations: string[],
): Array<{ start: number; end: number }> {
  const start = assignment.dispatchedAt ? Date.parse(assignment.dispatchedAt) : Number.NaN;
  const end = assignment.settledAt ? Date.parse(assignment.settledAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    violations.push(`recovery_dependency:assignment_interval_invalid:${assignment.assignmentId}`);
    return [];
  }
  return [{ start, end }];
}

function validateApiReview(
  mission: ParallelDagMissionEvidence,
  apiWorkstream: DagWorkstreamEvidence | null,
  apiDelivery: DagAssignmentEvidence | null,
  violations: string[],
): DagAssignmentEvidence | null {
  if (!apiWorkstream) return null;
  validateApiReviewWorkstream(apiWorkstream, violations);
  const matches = mission.assignments.filter(
    (candidate) =>
      candidate.workstreamId === apiWorkstream.workstreamId &&
      candidate.kind === "review" &&
      candidate.planRevision === mission.planRevision,
  );
  if (matches.length !== 1) {
    violations.push(`parallel_delivery:api_review_assignment_matches:${matches.length}`);
  }
  const review = matches[0] ?? null;
  if (!review) return null;
  validateApiReviewContract(review, apiWorkstream, apiDelivery, violations);
  validateApiReviewTiming(review, apiDelivery, violations);
  return review;
}

function validateApiReviewWorkstream(
  apiWorkstream: DagWorkstreamEvidence,
  violations: string[],
): void {
  if (apiWorkstream.reviewPolicy !== "required") {
    violations.push("parallel_delivery:api_review_policy_must_be_required");
  }
  if (!apiWorkstream.reviewerMemberId) {
    violations.push("parallel_delivery:api_reviewer_required");
  } else if (apiWorkstream.reviewerMemberId === apiWorkstream.ownerMemberId) {
    violations.push("parallel_delivery:api_reviewer_must_differ_from_owner");
  }
}

function validateApiReviewContract(
  review: DagAssignmentEvidence,
  apiWorkstream: DagWorkstreamEvidence,
  apiDelivery: DagAssignmentEvidence | null,
  violations: string[],
): void {
  if (review.mutableScope.kind !== "read_only") {
    violations.push("parallel_delivery:api_review_must_be_read_only");
  }
  if (review.assigneeMemberId !== apiWorkstream.reviewerMemberId) {
    violations.push("parallel_delivery:api_review_assignee_mismatch");
  }
  if (apiDelivery && review.assigneeMemberId === apiDelivery.assigneeMemberId) {
    violations.push("parallel_delivery:api_review_assignee_must_differ_from_delivery");
  }
  const apiDeliveryIds = apiDelivery ? [apiDelivery.assignmentId] : [];
  if (!sameExactIds(review.dependencyAssignmentIds, apiDeliveryIds)) {
    violations.push("parallel_delivery:api_review_dependencies_mismatch");
  }
  if (!sameExactIds(review.subjectAssignmentIds, apiDeliveryIds)) {
    violations.push("parallel_delivery:api_review_subjects_mismatch");
  }
  if (
    review.semanticState !== "completed" ||
    review.report?.status !== "completed" ||
    review.report.verdict !== "approved"
  ) {
    violations.push("parallel_delivery:api_review_must_be_completed_approved");
  }
}

function validateApiReviewTiming(
  review: DagAssignmentEvidence,
  apiDelivery: DagAssignmentEvidence | null,
  violations: string[],
): void {
  const reviewInterval = parseDagInterval(review, violations)[0];
  const deliveryInterval = apiDelivery ? parseDagInterval(apiDelivery, violations)[0] : undefined;
  if (reviewInterval && deliveryInterval && reviewInterval.start < deliveryInterval.end) {
    violations.push("parallel_delivery:api_review_dispatched_before_api_settled");
  }
}

function validateDagDependencies(
  mission: ParallelDagMissionEvidence,
  workstream: DagRoleSelection<DagWorkstreamEvidence>,
  assignment: DagRoleSelection<DagAssignmentEvidence>,
  violations: string[],
): DagAssignmentEvidence[] {
  for (const role of ["api", "ui", "test"] as const) {
    if (workstream[role] && workstream[role].dependencyWorkstreamIds.length !== 0) {
      violations.push(`parallel_delivery:${role}_workstream_must_be_independent`);
    }
    if (assignment[role] && assignment[role].dependencyAssignmentIds.length !== 0) {
      violations.push(`parallel_delivery:${role}_assignment_must_be_independent`);
    }
  }
  const deliveryWorkstreamIds = [workstream.api, workstream.ui, workstream.test].flatMap(
    (candidate) => (candidate ? [candidate.workstreamId] : []),
  );
  const deliveryAssignmentIds = [assignment.api, assignment.ui, assignment.test].flatMap(
    (candidate) => (candidate ? [candidate.assignmentId] : []),
  );
  if (
    workstream.integration &&
    !sameExactIds(workstream.integration.dependencyWorkstreamIds, deliveryWorkstreamIds)
  ) {
    violations.push("parallel_delivery:integration_workstream_dependencies_mismatch");
  }
  if (
    assignment.integration &&
    !sameExactIds(assignment.integration.dependencyAssignmentIds, deliveryAssignmentIds)
  ) {
    violations.push("parallel_delivery:integration_assignment_dependencies_mismatch");
  }
  if (
    workstream.finalVerification &&
    !sameExactIds(
      workstream.finalVerification.dependencyWorkstreamIds,
      workstream.integration ? [workstream.integration.workstreamId] : [],
    )
  ) {
    violations.push("parallel_delivery:final_workstream_dependencies_mismatch");
  }
  const verificationWorkstreamIds = new Set(
    mission.workstreams
      .filter((candidate) => candidate.kind === "verification")
      .map((candidate) => candidate.workstreamId),
  );
  const finalSubjects = mission.assignments.filter(
    (candidate) =>
      candidate.planRevision === mission.planRevision &&
      candidate.semanticState === "completed" &&
      (candidate.kind === "delivery" || candidate.kind === "review") &&
      !verificationWorkstreamIds.has(candidate.workstreamId),
  );
  const finalSubjectIds = finalSubjects.map((candidate) => candidate.assignmentId);
  if (
    assignment.finalVerification &&
    !sameExactIds(assignment.finalVerification.dependencyAssignmentIds, finalSubjectIds)
  ) {
    violations.push("parallel_delivery:final_assignment_dependencies_mismatch");
  }
  if (
    assignment.finalVerification &&
    !sameExactIds(assignment.finalVerification.subjectAssignmentIds, finalSubjectIds)
  ) {
    violations.push("parallel_delivery:final_subject_assignments_mismatch");
  }
  return finalSubjects;
}

function validateDagTiming(
  assignment: DagRoleSelection<DagAssignmentEvidence>,
  finalSubjects: DagAssignmentEvidence[],
  violations: string[],
): ParallelDeliveryDagAudit["commonDeliveryOverlap"] {
  const deliveryIntervals = [assignment.api, assignment.ui, assignment.test].flatMap((candidate) =>
    candidate ? parseDagInterval(candidate, violations) : [],
  );
  let commonDeliveryOverlap: ParallelDeliveryDagAudit["commonDeliveryOverlap"] = null;
  if (deliveryIntervals.length === 3) {
    const overlapStart = Math.max(...deliveryIntervals.map((interval) => interval.start));
    const overlapEnd = Math.min(...deliveryIntervals.map((interval) => interval.end));
    if (overlapStart < overlapEnd) {
      commonDeliveryOverlap = {
        startedAt: new Date(overlapStart).toISOString(),
        settledAt: new Date(overlapEnd).toISOString(),
      };
    } else {
      violations.push("parallel_delivery:no_common_delivery_overlap");
    }
  }
  const integrationInterval = assignment.integration
    ? parseDagInterval(assignment.integration, violations)[0]
    : undefined;
  if (
    integrationInterval &&
    deliveryIntervals.length === 3 &&
    integrationInterval.start < Math.max(...deliveryIntervals.map((interval) => interval.end))
  ) {
    violations.push("parallel_delivery:integration_dispatched_before_deliveries_settled");
  }
  const finalInterval = assignment.finalVerification
    ? parseDagInterval(assignment.finalVerification, violations)[0]
    : undefined;
  const finalSubjectIntervals = finalSubjects.flatMap((subject) =>
    parseDagInterval(subject, violations),
  );
  if (
    finalInterval &&
    finalSubjectIntervals.length === finalSubjects.length &&
    finalInterval.start < Math.max(...finalSubjectIntervals.map((interval) => interval.end))
  ) {
    violations.push("parallel_delivery:final_dispatched_before_subjects_settled");
  }
  return commonDeliveryOverlap;
}

function findExactWorkstream(
  mission: ParallelDagMissionEvidence,
  role: string,
  kind: ParallelDagMissionEvidence["workstreams"][number]["kind"],
  pathPrefix: string | null,
  violations: string[],
) {
  const matches = mission.workstreams.filter(
    (candidate) => candidate.kind === kind && scopeMatches(candidate.mutableScope, pathPrefix),
  );
  if (matches.length !== 1) {
    violations.push(`parallel_delivery:${role}_workstream_matches:${matches.length}`);
  }
  return matches[0] ?? null;
}

function findExactAssignment(
  mission: ParallelDagMissionEvidence,
  role: string,
  workstream: ParallelDagMissionEvidence["workstreams"][number] | null,
  kind: ParallelDagMissionEvidence["assignments"][number]["kind"],
  pathPrefix: string | null,
  violations: string[],
) {
  const matches = workstream
    ? mission.assignments.filter(
        (candidate) =>
          candidate.workstreamId === workstream.workstreamId &&
          candidate.kind === kind &&
          candidate.planRevision === mission.planRevision &&
          scopeMatches(candidate.mutableScope, pathPrefix),
      )
    : [];
  if (matches.length !== 1) {
    violations.push(`parallel_delivery:${role}_assignment_matches:${matches.length}`);
  }
  return matches[0] ?? null;
}

function scopeMatches(scope: DagScope, pathPrefix: string | null): boolean {
  if (pathPrefix === null) return scope.kind === "read_only";
  return (
    scope.kind === "paths" &&
    scope.pathPrefixes.length === 1 &&
    scope.pathPrefixes[0] === pathPrefix
  );
}

function sameExactIds(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.toSorted().every((id, index) => id === expected.toSorted()[index])
  );
}

function parseDagInterval(
  assignment: ParallelDagMissionEvidence["assignments"][number],
  violations: string[],
): Array<{ start: number; end: number }> {
  const start = assignment.dispatchedAt ? Date.parse(assignment.dispatchedAt) : Number.NaN;
  const end = assignment.settledAt ? Date.parse(assignment.settledAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    violations.push(`parallel_delivery:assignment_interval_invalid:${assignment.assignmentId}`);
    return [];
  }
  return [{ start, end }];
}

function toDagNode(
  workstream: ParallelDagMissionEvidence["workstreams"][number] | null,
  assignment: ParallelDagMissionEvidence["assignments"][number] | null,
): ParallelDagNodeEvidence {
  return {
    workstreamId: workstream?.workstreamId ?? null,
    assignmentId: assignment?.assignmentId ?? null,
    dispatchedAt: assignment?.dispatchedAt ?? null,
    settledAt: assignment?.settledAt ?? null,
  };
}

export function createStartTurnEvidenceAgentClient(
  client: AgentClient,
  records: ProviderStartTurnEvidence[],
): AgentClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "createSession") {
        return async (...args: Parameters<AgentClient["createSession"]>) => {
          const session = await target.createSession(...args);
          return wrapStartTurnEvidenceSession(session, args[1]?.agentId ?? null, records);
        };
      }
      if (property === "resumeSession") {
        return async (...args: Parameters<AgentClient["resumeSession"]>) => {
          const session = await target.resumeSession(...args);
          return wrapStartTurnEvidenceSession(session, args[2]?.agentId ?? null, records);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapStartTurnEvidenceSession(
  session: AgentSession,
  agentId: string | null,
  records: ProviderStartTurnEvidence[],
): AgentSession {
  return new Proxy(session, {
    get(target, property, receiver) {
      if (property === "startTurn") {
        return async (...args: Parameters<AgentSession["startTurn"]>) => {
          const clientMessageId = args[1]?.clientMessageId ?? null;
          try {
            const result = await target.startTurn(...args);
            records.push({
              agentId,
              clientMessageId,
              turnId: result.turnId,
              outcome: "accepted",
              error: null,
            });
            return result;
          } catch (error) {
            records.push({
              agentId,
              clientMessageId,
              turnId: null,
              outcome: "rejected",
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function captureWorkspaceEvidence(workspaceRoot: string): WorkspaceEvidence {
  const gitStatus = git(workspaceRoot, ["status", "--short"]);
  const trackedChanges = readNullSeparated(
    gitRaw(workspaceRoot, ["diff", "--name-only", "-z", "HEAD"]),
  );
  const untracked = readNullSeparated(
    gitRaw(workspaceRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  );
  const changedPaths = [...new Set([...trackedChanges, ...untracked])].toSorted();
  const artifacts = changedPaths.flatMap((relativePath) => {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const metadata = lstatSync(absolutePath, { throwIfNoEntry: false });
    if (!metadata) return [];
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(absolutePath);
      const bytes = Buffer.from(target);
      return [
        {
          kind: "symlink" as const,
          path: relativePath,
          target,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ];
    }
    if (!metadata.isFile()) return [];
    return [readArtifact(relativePath, absolutePath)];
  });

  const alternateIndex = path.join(os.tmpdir(), `paseo-team-evidence-${randomUUID()}.index`);
  const indexPath = git(workspaceRoot, ["rev-parse", "--git-path", "index"]);
  copyFileSync(path.resolve(workspaceRoot, indexPath), alternateIndex);
  try {
    const env = { ...process.env, GIT_INDEX_FILE: alternateIndex };
    if (untracked.length > 0) {
      git(workspaceRoot, ["add", "--intent-to-add", "--", ...untracked], env);
    }
    return {
      gitStatus,
      gitDiffStat: git(workspaceRoot, ["diff", "--stat", "HEAD"], env),
      gitPatch: git(
        workspaceRoot,
        ["diff", "--binary", "--no-ext-diff", "HEAD", "--", ...changedPaths],
        env,
      ),
      artifacts,
    };
  } finally {
    rmSync(alternateIndex, { force: true });
  }
}

function readArtifact(relativePath: string, absolutePath: string): WorkspaceArtifactEvidence {
  const bytes = readFileSync(absolutePath);
  const decoded = bytes.toString("utf8");
  const isUtf8 = Buffer.from(decoded, "utf8").equals(bytes);
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    encoding: isUtf8 ? "utf8" : "base64",
    content: isUtf8 ? decoded : bytes.toString("base64"),
  };
}

function readNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return gitRaw(cwd, args, env).trim();
}

function gitRaw(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
}
