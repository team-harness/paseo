import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentClient, AgentSession } from "../agent/agent-sdk-types.js";
import type { DaemonClient } from "../test-utils/daemon-client.js";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  auditAssignmentDispatchEvidence,
  auditParallelDeliveryDag,
  auditRecoveryDependencyDag,
  auditRuntimeRecovery,
  auditToolDiscipline,
  captureWorkspaceEvidence,
  collectCompleteTeamMissionRoomEvidence,
  collectCompleteTimelineEvidence,
  createStartTurnEvidenceAgentClient,
  executeEvidenceLifecycle,
  persistSanitizedEvidenceManifest,
  persistSanitizedPinoLogEvidence,
  sanitizeEvidenceForPersistence,
  sanitizeFailureError,
  type ProviderStartTurnEvidence,
  validatePositiveTokenUsage,
  waitForMissionEvidence,
} from "./team-missions-coordination-evidence.js";

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("captureWorkspaceEvidence", () => {
  test("preserves tracked and untracked content without mutating the real index", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-team-evidence-test-"));
    roots.push(root);
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Paseo Team Evidence"]);
    git(root, ["config", "user.email", "team-evidence@localhost"]);
    writeFileSync(path.join(root, "tracked.txt"), "before\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "baseline"]);

    writeFileSync(path.join(root, "tracked.txt"), "after\n");
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "new.txt"), "new artifact\n");
    const statusBefore = git(root, ["status", "--short"]);

    const evidence = captureWorkspaceEvidence(root);

    expect(evidence.gitStatus).toBe(statusBefore);
    expect(git(root, ["status", "--short"])).toBe(statusBefore);
    expect(evidence.gitDiffStat).toContain("src/new.txt");
    expect(evidence.gitDiffStat).toContain("tracked.txt");
    expect(evidence.gitPatch).toContain("+++ b/src/new.txt");
    expect(evidence.gitPatch).toContain("+new artifact");
    expect(evidence.gitPatch).toContain("-before");
    expect(evidence.gitPatch).toContain("+after");
    expect(evidence.artifacts).toEqual([
      {
        path: "src/new.txt",
        bytes: 13,
        sha256: sha256("new artifact\n"),
        encoding: "utf8",
        content: "new artifact\n",
      },
      {
        path: "tracked.txt",
        bytes: 6,
        sha256: sha256("after\n"),
        encoding: "utf8",
        content: "after\n",
      },
    ]);
  });

  test("records an external symlink without reading its target or mutating the real index", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-team-evidence-test-"));
    const secretRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-team-secret-test-"));
    roots.push(root, secretRoot);
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Paseo Team Evidence"]);
    git(root, ["config", "user.email", "team-evidence@localhost"]);
    writeFileSync(path.join(root, "baseline.txt"), "baseline\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "baseline"]);

    const secret = "outside-workspace-secret-value\n";
    const secretPath = path.join(secretRoot, "secret.txt");
    writeFileSync(secretPath, secret);
    symlinkSync(secretPath, path.join(root, "secret-link"));
    const statusBefore = git(root, ["status", "--short"]);
    const indexPath = path.join(root, git(root, ["rev-parse", "--git-path", "index"]));
    const indexBefore = readFileSync(indexPath);

    const evidence = captureWorkspaceEvidence(root);

    expect(JSON.stringify(evidence)).not.toContain(secret.trim());
    expect(evidence.artifacts).toEqual([
      {
        kind: "symlink",
        path: "secret-link",
        target: secretPath,
        bytes: Buffer.byteLength(secretPath),
        sha256: sha256(secretPath),
      },
    ]);
    expect(readFileSync(indexPath)).toEqual(indexBefore);
    expect(git(root, ["status", "--short"])).toBe(statusBefore);
  });
});

describe("createStartTurnEvidenceAgentClient", () => {
  test("records accepted and rejected provider startTurn boundary outcomes", async () => {
    const records: ProviderStartTurnEvidence[] = [];
    let call = 0;
    const session = {
      startTurn: async () => {
        call += 1;
        if (call === 2) throw new Error("provider rejected turn");
        return { turnId: "provider-turn-1" };
      },
    } as unknown as AgentSession;
    const client = {
      createSession: async () => session,
      resumeSession: async () => session,
    } as unknown as AgentClient;
    const wrapped = createStartTurnEvidenceAgentClient(client, records);
    const launchContext = {
      agentId: "agent-1",
    } as NonNullable<Parameters<AgentClient["createSession"]>[1]>;
    const wrappedSession = await wrapped.createSession(
      {} as Parameters<AgentClient["createSession"]>[0],
      launchContext,
    );

    await expect(
      wrappedSession.startTurn("first" as never, {
        clientMessageId: "team-mission:mission-1:assignment:a-1:dispatch",
      }),
    ).resolves.toEqual({ turnId: "provider-turn-1" });
    await expect(
      wrappedSession.startTurn("second" as never, {
        clientMessageId: "team-mission:mission-1:assignment:a-2:dispatch",
      }),
    ).rejects.toThrow("provider rejected turn");
    expect(records).toEqual([
      {
        agentId: "agent-1",
        clientMessageId: "team-mission:mission-1:assignment:a-1:dispatch",
        turnId: "provider-turn-1",
        outcome: "accepted",
        error: null,
      },
      {
        agentId: "agent-1",
        clientMessageId: "team-mission:mission-1:assignment:a-2:dispatch",
        turnId: null,
        outcome: "rejected",
        error: "provider rejected turn",
      },
    ]);
  });
});

describe("auditAssignmentDispatchEvidence", () => {
  test("counts deterministic provider boundary crossings instead of duplicate final turn ids", () => {
    const mission = {
      id: "mission-1",
      assignments: [
        { assignmentId: "a-1", runtimeAgentId: "agent-1", acceptedTurnId: "shared-turn" },
        { assignmentId: "a-2", runtimeAgentId: "agent-2", acceptedTurnId: "shared-turn" },
      ],
    };
    const records: ProviderStartTurnEvidence[] = [
      {
        agentId: "agent-1",
        clientMessageId: "team-mission:mission-1:assignment:a-1:dispatch",
        turnId: "shared-turn",
        outcome: "accepted",
        error: null,
      },
      {
        agentId: "agent-2",
        clientMessageId: "team-mission:mission-1:assignment:a-2:dispatch",
        turnId: "shared-turn",
        outcome: "accepted",
        error: null,
      },
    ];

    expect(auditAssignmentDispatchEvidence(mission, records)).toMatchObject({
      valid: true,
      duplicateBoundaryCrossings: 0,
      violations: [],
    });

    const duplicate = auditAssignmentDispatchEvidence(mission, [...records, records[0]]);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.duplicateBoundaryCrossings).toBe(1);
    expect(duplicate.violations).toContain("assignment:a-1:provider_boundary_crossings:2");
  });
});

describe("validatePositiveTokenUsage", () => {
  test("rejects missing or empty input and output token evidence", () => {
    expect(validatePositiveTokenUsage({})).toEqual([
      "token_usage:input_tokens_must_be_positive",
      "token_usage:output_tokens_must_be_positive",
    ]);
    expect(validatePositiveTokenUsage({ inputTokens: 12, outputTokens: 0 })).toEqual([
      "token_usage:output_tokens_must_be_positive",
    ]);
    expect(validatePositiveTokenUsage({ inputTokens: 12, outputTokens: 3 })).toEqual([]);
  });
});

describe("sanitized evidence persistence", () => {
  test("persists only allow-listed pino fields after PASEO_HOME is deleted", () => {
    const paseoHome = mkdtempSync(path.join(os.tmpdir(), "paseo-team-log-home-"));
    const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-team-log-evidence-"));
    roots.push(paseoHome, evidenceRoot);
    const secret = "SECRET_SENTINEL_ROUND_3";
    const raw = `${JSON.stringify({
      time: "2026-01-01T00:00:00.000Z",
      level: 30,
      component: "team-mission-scheduler",
      event: "assignment_dispatch",
      teamId: "team-1",
      missionId: "mission-1",
      assignmentId: "assignment-1",
      turnId: "turn-1",
      clientMessageId: "client-message-1",
      status: "completed",
      params: { token: secret },
      content: `file:${secret}`,
      msg: `provider failed ${secret}`,
      err: { message: secret, stack: `stack:${secret}` },
    })}\nnot-json-${secret}\n`;
    const sourcePath = path.join(paseoHome, "daemon-provider.pino.log");
    writeFileSync(sourcePath, raw);

    const metadata = persistSanitizedPinoLogEvidence(
      sourcePath,
      evidenceRoot,
      "parallel-delivery/run-1.daemon-provider.sanitized.jsonl",
    );
    rmSync(paseoHome, { recursive: true, force: true });

    expect(metadata).toMatchObject({
      sanitized: true,
      relativePath: "parallel-delivery/run-1.daemon-provider.sanitized.jsonl",
      sourceBytes: Buffer.byteLength(raw),
      sourceSha256: sha256(raw),
    });
    const persisted = readFileSync(path.join(evidenceRoot, metadata.relativePath), "utf8");
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain('"component":"team-mission-scheduler"');
    expect(persisted).toContain('"assignmentId":"assignment-1"');
    expect(persisted).not.toContain("params");
    expect(persisted).not.toContain("content");
    expect(metadata.bytes).toBe(Buffer.byteLength(persisted));
    expect(metadata.sha256).toBe(sha256(persisted));
  });

  test("removes secret-bearing values from success and failed manifests", () => {
    const secret = "SECRET_SENTINEL_ROUND_3";
    const success = sanitizeEvidenceForPersistence({
      missionId: "mission-1",
      status: "completed",
      workspace: { artifacts: [{ path: "src/result.ts", content: secret }] },
      timeline: {
        item: {
          type: "tool_call",
          callId: "call-1",
          status: "failed",
          params: { token: secret },
          error: { message: secret, stack: `stack:${secret}` },
        },
      },
    });
    const failed = {
      phase: "connect_client",
      error: sanitizeFailureError(
        Object.assign(new Error(`provider ${secret}`), {
          code: "PROVIDER_FAILURE",
          stack: `stack:${secret}`,
        }),
      ),
    };

    expect(JSON.stringify({ success, failed })).not.toContain(secret);
    expect(success).toMatchObject({ missionId: "mission-1", status: "completed" });
    expect(failed.error).toMatchObject({ name: "Error", code: "PROVIDER_FAILURE" });
    expect(failed.error.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(failed.error).not.toHaveProperty("message");
    expect(failed.error).not.toHaveProperty("stack");
  });

  test("projects success manifests through a structural allow-list", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-team-success-evidence-"));
    roots.push(root);
    const manifestPath = path.join(root, "parallel-delivery-run-1.json");
    const secret = "SECRET_SENTINEL_ALLOWLISTED_SUCCESS";

    await persistSanitizedEvidenceManifest(manifestPath, {
      sanitized: true,
      evidencePolicy: "allowlisted_v1",
      shape: "parallel_delivery",
      repetition: 1,
      provider: "codex",
      model: "gpt-5.6-sol",
      teamId: "team-1",
      missionId: "mission-1",
      missionStatus: "completed",
      durationMs: 125,
      planningLatencyMs: 10,
      maxParallelAssignments: 2,
      toolDisciplineAudit: {
        score: 2,
        violations: [],
        successfulCounts: { mission_plan: 1 },
        calls: [
          {
            agentId: "agent-1",
            seq: 1,
            rawName: "mission_plan",
            name: "mission_plan",
            status: "completed",
            successful: true,
            missionAssociation: "verified",
            assignmentActivation: "atomic_mission_plan",
            inputDigest: "a".repeat(64),
            outputDigest: "b".repeat(64),
          },
        ],
      },
      recoveryDagAudit: {
        valid: true,
        violations: [],
        nodes: {
          contract: { workstreamId: "contract-root", assignmentId: "contract-root-assignment" },
          contractTail: {
            workstreamId: "contract-amendment",
            assignmentId: "contract-amendment-assignment",
          },
          contractChainWorkstreamIds: ["contract-root", "contract-amendment"],
          contractChainAssignmentIds: ["contract-root-assignment", "contract-amendment-assignment"],
          implementation: {
            workstreamId: "implementation",
            assignmentId: "implementation-assignment",
          },
          finalVerification: {
            workstreamId: "final",
            assignmentId: "final-assignment",
          },
          finalSubjectAssignmentIds: [
            "contract-root-assignment",
            "contract-amendment-assignment",
            "implementation-assignment",
          ],
        },
      },
      participantTimelines: [
        {
          memberId: "member-1",
          agentId: "agent-1",
          timeline: {
            pages: [
              {
                requestId: "request-1",
                epoch: "epoch-1",
                startCursor: { epoch: "epoch-1", seq: 1 },
                endCursor: { epoch: "epoch-1", seq: 2 },
                entries: [],
                arbitraryPageMetadata: secret,
              },
            ],
            entries: [
              {
                provider: "codex",
                timestamp: "2026-08-10T00:00:00.000Z",
                seqStart: 1,
                seqEnd: 2,
                sourceSeqRanges: [{ startSeq: 1, endSeq: 2 }],
                collapsed: ["tool_lifecycle"],
                item: {
                  type: "tool_call",
                  callId: "call-1",
                  name: "mission_status",
                  status: "completed",
                  error: null,
                  detail: {
                    type: "edit",
                    filePath: `src/${secret}.ts`,
                    oldString: secret,
                    newString: secret,
                    unifiedDiff: secret,
                    command: secret,
                    log: secret,
                    query: secret,
                    url: secret,
                    codeText: secret,
                    label: secret,
                  },
                  metadata: {
                    nested: { unknownSecret: secret },
                  },
                },
              },
              {
                provider: "codex",
                timestamp: "2026-08-10T00:00:01.000Z",
                seqStart: 3,
                seqEnd: 3,
                item: {
                  type: "tool_call",
                  callId: "call-2",
                  name: `shell-${secret}`,
                  status: "completed",
                  error: null,
                  detail: { type: "shell", command: secret },
                  metadata: { nested: { unknownSecret: `${secret}-different` } },
                },
              },
              {
                provider: "codex",
                timestamp: "2026-08-10T00:00:02.000Z",
                seqStart: 4,
                seqEnd: 4,
                item: { type: "assistant_message", messageId: "message-1", text: secret },
              },
            ],
          },
        },
      ],
      mission: {
        id: "mission-1",
        teamId: "team-1",
        workspaceId: "workspace-1",
        objective: secret,
        constraints: [secret],
        acceptanceCriteria: [secret],
        status: "completed",
        suspendedStatus: null,
        activeRosterSnapshotRevision: 1,
        rosterSnapshots: [
          {
            revision: 1,
            teamRevision: 1,
            leadMemberId: "member-1",
            reason: "initial",
            skills: [],
            members: [
              {
                memberId: "member-1",
                role: secret,
                level: "senior",
                skillIds: [],
                mentionHandle: secret,
              },
            ],
            createdAt: "2026-08-10T00:00:00.000Z",
          },
        ],
        planRevision: 3,
        revision: 12,
        chatRoomId: "room-1",
        participants: [
          {
            memberId: "member-1",
            agentId: "agent-1",
            bindingEpoch: 2,
            joinedAt: "2026-08-10T00:00:00.000Z",
            archivedAt: "2026-08-10T00:01:00.000Z",
          },
        ],
        workstreams: [
          {
            workstreamId: "workstream-1",
            kind: "delivery",
            title: secret,
            deliverables: [secret],
            acceptanceCriteria: [secret],
            ownerMemberId: "member-1",
            ownerOverrideReason: secret,
            reviewerMemberId: "member-2",
            reviewerOverrideReason: secret,
            planRevision: 3,
            rosterSnapshotRevision: 1,
            dependencyWorkstreamIds: [],
            status: "accepted",
          },
        ],
        assignments: [
          {
            assignmentId: "assignment-1",
            revision: 4,
            kind: "delivery",
            missionId: "mission-1",
            workstreamId: "workstream-1",
            assigneeMemberId: "member-1",
            runtimeAgentId: "agent-1",
            bindingEpoch: 2,
            planRevision: 3,
            rosterSnapshotRevision: 1,
            dispatchState: "settled",
            semanticState: "completed",
            acceptedTurnId: "turn-1",
            report: {
              status: "failed",
              blockers: [secret],
              decisions: [secret],
              tests: [{ command: secret, passed: false }],
              handoffs: [{ targetWorkstreamId: "workstream-2", summary: secret }],
            },
          },
        ],
        attentionItems: [
          {
            attentionId: "attention-1",
            kind: "assignment_requires_replan",
            status: "resolved",
            priorMissionStatus: "active",
            assignmentId: "assignment-1",
            summary: secret,
            resolution: {
              kind: "replan",
              actorId: "member-1",
              reason: secret,
              resolvedAt: "2026-08-10T00:02:00.000Z",
              ownerAssignmentId: null,
              recoveryAssignmentId: null,
            },
          },
        ],
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:02:00.000Z",
        completedAt: "2026-08-10T00:02:00.000Z",
      },
      unexpectedTopLevel: { arbitraryMetadata: secret },
    });

    const persistedText = readFileSync(manifestPath, "utf8");
    const persisted = JSON.parse(persistedText);
    expect(persistedText).not.toContain(secret);
    expect(persisted).not.toHaveProperty("unexpectedTopLevel");
    expect(persisted).toMatchObject({
      sanitized: true,
      evidencePolicy: "allowlisted_v1",
      teamId: "team-1",
      missionId: "mission-1",
      missionStatus: "completed",
      toolDisciplineAudit: {
        score: 2,
        calls: [{ assignmentActivation: "atomic_mission_plan" }],
      },
      recoveryDagAudit: {
        valid: true,
        nodes: {
          contractTail: {
            workstreamId: "contract-amendment",
            assignmentId: "contract-amendment-assignment",
          },
          contractChainWorkstreamIds: ["contract-root", "contract-amendment"],
          contractChainAssignmentIds: ["contract-root-assignment", "contract-amendment-assignment"],
        },
      },
      participantTimelines: [
        {
          memberId: "member-1",
          agentId: "agent-1",
          timeline: {
            pageCount: 1,
            entryCount: 3,
            entries: [
              {
                seqStart: 1,
                seqEnd: 2,
                item: {
                  type: "tool_call",
                  callId: "call-1",
                  name: "mission_status",
                  status: "completed",
                },
              },
              {
                seqStart: 3,
                seqEnd: 3,
                item: { type: "tool_call", callId: "call-2", status: "completed" },
              },
              {
                seqStart: 4,
                seqEnd: 4,
                item: { type: "assistant_message", messageId: "message-1" },
              },
            ],
          },
        },
      ],
      mission: {
        id: "mission-1",
        revision: 12,
        planRevision: 3,
        status: "completed",
        workstreams: [
          {
            workstreamId: "workstream-1",
            planRevision: 3,
            status: "accepted",
          },
        ],
        assignments: [
          {
            assignmentId: "assignment-1",
            revision: 4,
            status: "completed",
            acceptedTurnId: "turn-1",
            report: { status: "failed", testCount: 1, blockerCount: 1, decisionCount: 1 },
          },
        ],
        attentionItems: [
          {
            attentionId: "attention-1",
            status: "resolved",
            resolution: { kind: "replan", actorId: "member-1" },
          },
        ],
      },
    });
    const persistedItem = persisted.participantTimelines[0].timeline.entries[0].item;
    expect(persistedItem).not.toHaveProperty("metadata");
    expect(persistedItem.metadataDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedItem.detail).toEqual({
      type: "edit",
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const persistedNonTeamTool = persisted.participantTimelines[0].timeline.entries[1].item;
    expect(persistedNonTeamTool).not.toHaveProperty("name");
    expect(persistedNonTeamTool.nameDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedNonTeamTool.metadataDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedNonTeamTool.metadataDigest).not.toBe(persistedItem.metadataDigest);
    const persistedMessage = persisted.participantTimelines[0].timeline.entries[2].item;
    expect(persistedMessage).not.toHaveProperty("text");
    expect(persistedMessage.textDigest).toMatch(/^[a-f0-9]{64}$/);
    const persistedMember = persisted.mission.rosterSnapshots[0].members[0];
    expect(persistedMember).not.toHaveProperty("mentionHandle");
    expect(persistedMember.mentionHandleDigest).toMatch(/^[a-f0-9]{64}$/);
    const persistedWorkstream = persisted.mission.workstreams[0];
    expect(persistedWorkstream).not.toHaveProperty("title");
    expect(persistedWorkstream.deliverables).toEqual({
      count: 1,
      digests: [expect.stringMatching(/^[a-f0-9]{64}$/)],
    });
    expect(persistedWorkstream.titleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedWorkstream.ownerOverrideReasonDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedWorkstream.reviewerOverrideReasonDigest).toMatch(/^[a-f0-9]{64}$/);
    const persistedReport = persisted.mission.assignments[0].report;
    expect(persistedReport.tests).toEqual([
      { commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/), passed: false },
    ]);
    expect(persistedReport.blockers).toMatchObject({ count: 1 });
    expect(persistedReport.decisions).toMatchObject({ count: 1 });
    expect(persisted.mission.attentionItems[0].resolution).not.toHaveProperty("reason");
    expect(persisted.mission.attentionItems[0].resolution.reasonDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("persists timeout diagnostics as structural Mission and provider evidence only", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-team-failure-diagnostics-"));
    roots.push(root);
    const manifestPath = path.join(root, "parallel-delivery-run-2.json");
    const secret = "SECRET_SENTINEL_TIMEOUT_DIAGNOSTICS";
    const workspacePath = `src/private-${secret}.ts`;

    await persistSanitizedEvidenceManifest(manifestPath, {
      evidencePolicy: "failure_diagnostics_v1",
      shape: "parallel_delivery",
      repetition: 2,
      status: "evidence_collection_failed",
      phase: "wait_for_mission",
      error: new Error(`Timed out after reading ${workspacePath}`),
      providerStartTurns: [
        {
          agentId: "agent-worker",
          clientMessageId: "team-mission:mission-1:assignment:assignment-1:dispatch",
          turnId: "turn-1",
          outcome: "accepted",
          error: null,
        },
      ],
      partialMission: {
        id: "mission-1",
        teamId: "team-1",
        workspaceId: "workspace-1",
        objective: secret,
        status: "active",
        activeRosterSnapshotRevision: 3,
        planRevision: 4,
        revision: 17,
        workstreams: [
          {
            workstreamId: "workstream-1",
            kind: "delivery",
            title: secret,
            objective: secret,
            deliverables: [workspacePath],
            acceptanceCriteria: [secret],
            planRevision: 4,
            status: "executing",
          },
        ],
        assignments: [
          {
            assignmentId: "assignment-1",
            revision: 6,
            kind: "delivery",
            missionId: "mission-1",
            workstreamId: "workstream-1",
            assigneeMemberId: "member-worker",
            runtimeAgentId: "agent-worker",
            bindingEpoch: 2,
            objective: secret,
            deliverables: [workspacePath],
            planRevision: 4,
            dispatchState: "accepted",
            semanticState: "running",
            acceptedTurnId: "turn-1",
            report: {
              status: "completed",
              summary: secret,
              artifactPaths: [workspacePath],
            },
          },
        ],
        attentionItems: [
          {
            attentionId: "attention-1",
            kind: "provider_unavailable",
            status: "open",
            summary: secret,
            priorMissionStatus: "active",
            resolution: null,
          },
        ],
        participants: [
          {
            memberId: "member-worker",
            agentId: "agent-worker",
            bindingEpoch: 2,
            joinedAt: "2026-08-10T00:00:00.000Z",
            archivedAt: null,
          },
        ],
      },
      unknownTopLevelPayload: secret,
    });

    const persistedText = readFileSync(manifestPath, "utf8");
    const persisted = JSON.parse(persistedText);
    expect(persistedText).not.toContain(secret);
    expect(persistedText).not.toContain(workspacePath);
    expect(persisted).not.toHaveProperty("unknownTopLevelPayload");
    expect(persisted).toMatchObject({
      sanitized: true,
      evidencePolicy: "failure_diagnostics_v1",
      shape: "parallel_delivery",
      repetition: 2,
      status: "evidence_collection_failed",
      phase: "wait_for_mission",
      error: {
        name: "Error",
        code: null,
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      providerStartTurns: [
        {
          agentId: "agent-worker",
          clientMessageId: "team-mission:mission-1:assignment:assignment-1:dispatch",
          turnId: "turn-1",
          outcome: "accepted",
          error: null,
        },
      ],
      partialMission: {
        id: "mission-1",
        teamId: "team-1",
        workspaceId: "workspace-1",
        status: "active",
        activeRosterSnapshotRevision: 3,
        planRevision: 4,
        revision: 17,
        workstreams: [
          {
            workstreamId: "workstream-1",
            kind: "delivery",
            planRevision: 4,
            status: "executing",
          },
        ],
        assignments: [
          {
            assignmentId: "assignment-1",
            revision: 6,
            kind: "delivery",
            workstreamId: "workstream-1",
            runtimeAgentId: "agent-worker",
            bindingEpoch: 2,
            planRevision: 4,
            dispatchState: "accepted",
            semanticState: "running",
            status: "running",
            acceptedTurnId: "turn-1",
          },
        ],
        attentionItems: [
          {
            attentionId: "attention-1",
            kind: "provider_unavailable",
            status: "open",
            priorMissionStatus: "active",
            resolution: null,
          },
        ],
        participants: [
          {
            memberId: "member-worker",
            agentId: "agent-worker",
            bindingEpoch: 2,
            joinedAt: "2026-08-10T00:00:00.000Z",
            archivedAt: null,
          },
        ],
      },
    });
    expect(persisted.partialMission.objectiveDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.partialMission.workstreams[0].titleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.partialMission.assignments[0].report.summaryDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("collectCompleteTimelineEvidence", () => {
  test("paginates from tail to hasOlder=false and preserves every raw page", async () => {
    const calls: unknown[] = [];
    const newest = {
      requestId: "timeline-1",
      agentId: "agent-1",
      error: null,
      staleCursor: false,
      gap: false,
      hasOlder: true,
      startCursor: { epoch: "epoch-1", seq: 3 },
      entries: [{ seq: 3, item: { type: "assistant_message", text: "newest" } }],
    };
    const oldest = {
      requestId: "timeline-2",
      agentId: "agent-1",
      error: null,
      staleCursor: false,
      gap: false,
      hasOlder: false,
      startCursor: { epoch: "epoch-1", seq: 1 },
      entries: [
        { seq: 1, item: { type: "user_message", text: "oldest" } },
        { seq: 2, item: { type: "assistant_message", text: "middle" } },
      ],
    };
    const pages = [newest, oldest];
    const client = {
      fetchAgentTimeline: async (_agentId: string, options: unknown) => {
        calls.push(options);
        return pages.shift();
      },
    } as unknown as DaemonClient;

    const result = await collectCompleteTimelineEvidence(client, "agent-1", 2);

    expect(calls).toEqual([
      { direction: "tail", limit: 2, projection: "canonical" },
      {
        direction: "before",
        cursor: { epoch: "epoch-1", seq: 3 },
        limit: 2,
        projection: "canonical",
      },
    ]);
    expect(result.pages).toEqual([newest, oldest]);
    expect(result.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  test.each([
    ["error", "timeline failed", "Timeline agent-1 page 0 error: timeline failed"],
    ["staleCursor", true, "Timeline agent-1 page 0 returned staleCursor"],
    ["gap", true, "Timeline agent-1 page 0 returned gap"],
  ] as const)("rejects a page with %s", async (field, value, expectedError) => {
    const client = {
      fetchAgentTimeline: async () => ({
        error: null,
        staleCursor: false,
        gap: false,
        hasOlder: false,
        startCursor: null,
        entries: [],
        [field]: value,
      }),
    } as unknown as DaemonClient;

    await expect(collectCompleteTimelineEvidence(client, "agent-1")).rejects.toThrow(expectedError);
  });
});

describe("collectCompleteTeamMissionRoomEvidence", () => {
  test("subscribes from cursor zero through hasMore=false and always unsubscribes", async () => {
    const subscribeCalls: unknown[] = [];
    const unsubscribeCalls: unknown[] = [];
    const first = {
      requestId: "team-room-1",
      missionId: "mission-1",
      messages: [{ id: "m-1" }, { id: "m-2" }],
      cursor: 2,
      hasMore: true,
      error: null,
      errorCode: null,
    };
    const second = {
      requestId: "team-room-2",
      missionId: "mission-1",
      messages: [{ id: "m-3" }],
      cursor: 3,
      hasMore: false,
      error: null,
      errorCode: null,
    };
    const pages = [first, second];
    const unsubscribed = {
      requestId: "team-room-unsubscribe",
      missionId: "mission-1",
      error: null,
      errorCode: null,
    };
    const client = {
      subscribeTeamMissionRoom: async (options: unknown) => {
        subscribeCalls.push(options);
        return pages.shift();
      },
      unsubscribeTeamMissionRoom: async (options: unknown) => {
        unsubscribeCalls.push(options);
        return unsubscribed;
      },
    } as unknown as DaemonClient;

    const result = await collectCompleteTeamMissionRoomEvidence(client, "mission-1", 2);

    expect(subscribeCalls).toEqual([
      { missionId: "mission-1", afterCursor: 0, limit: 2 },
      { missionId: "mission-1", afterCursor: 2, limit: 2 },
    ]);
    expect(unsubscribeCalls).toEqual([{ missionId: "mission-1" }]);
    expect(result).toEqual({
      pages: [first, second],
      messages: [{ id: "m-1" }, { id: "m-2" }, { id: "m-3" }],
      unsubscribe: unsubscribed,
    });
  });

  test("rejects subscribe errors but still unsubscribes", async () => {
    let unsubscribed = false;
    const client = {
      subscribeTeamMissionRoom: async () => ({
        missionId: "mission-1",
        messages: [],
        cursor: 0,
        hasMore: false,
        error: "subscribe failed",
        errorCode: "team_room_subscribe_failed",
      }),
      unsubscribeTeamMissionRoom: async () => {
        unsubscribed = true;
        return { missionId: "mission-1", error: null, errorCode: null };
      },
    } as unknown as DaemonClient;

    await expect(collectCompleteTeamMissionRoomEvidence(client, "mission-1")).rejects.toThrow(
      "Team Mission room mission-1 page 0 error: subscribe failed",
    );
    expect(unsubscribed).toBe(true);
  });

  test("reports unsubscribe errors ahead of collection errors", async () => {
    const client = {
      subscribeTeamMissionRoom: async () => ({
        missionId: "mission-1",
        messages: [],
        cursor: 0,
        hasMore: false,
        error: "subscribe failed",
        errorCode: "team_room_subscribe_failed",
      }),
      unsubscribeTeamMissionRoom: async () => ({
        missionId: "mission-1",
        error: "unsubscribe failed",
        errorCode: "team_room_unsubscribe_failed",
      }),
    } as unknown as DaemonClient;

    await expect(collectCompleteTeamMissionRoomEvidence(client, "mission-1")).rejects.toThrow(
      "Team Mission room mission-1 unsubscribe error: unsubscribe failed",
    );
  });
});

describe("auditParallelDeliveryDag", () => {
  test("requires exact delivery scopes and does not count an API review as parallel delivery", () => {
    const valid = parallelDagFixture();
    expect(auditParallelDeliveryDag(valid)).toMatchObject({
      valid: true,
      violations: [],
      commonDeliveryOverlap: {
        startedAt: "2026-01-01T00:00:02.000Z",
        settledAt: "2026-01-01T00:00:08.000Z",
      },
    });

    const serializedApi = parallelDagFixture();
    const apiDelivery = serializedApi.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-api",
    );
    if (!apiDelivery) throw new Error("missing API delivery fixture");
    apiDelivery.dispatchedAt = "2026-01-01T00:00:09.000Z";
    apiDelivery.settledAt = "2026-01-01T00:00:10.000Z";
    const audit = auditParallelDeliveryDag(serializedApi);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("parallel_delivery:no_common_delivery_overlap");
    expect(audit.nodes.api.assignmentId).toBe("assignment-api");
    expect(audit.nodes.apiReviewAssignmentIds).toEqual(["assignment-api-review"]);
  });

  test.each([
    [
      "missing review",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        fixture.assignments = fixture.assignments.filter(
          (assignment) => assignment.assignmentId !== "assignment-api-review",
        );
      },
      "parallel_delivery:api_review_assignment_matches:0",
    ],
    [
      "self review",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const api = fixture.workstreams.find(
          (workstream) => workstream.workstreamId === "workstream-api",
        );
        if (!api) throw new Error("missing API workstream fixture");
        api.reviewerMemberId = api.ownerMemberId;
      },
      "parallel_delivery:api_reviewer_must_differ_from_owner",
    ],
    [
      "writable review",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const review = fixture.assignments.find(
          (assignment) => assignment.assignmentId === "assignment-api-review",
        );
        if (!review) throw new Error("missing API review fixture");
        review.mutableScope = { kind: "paths", pathPrefixes: ["src/profile-api.mjs"] };
      },
      "parallel_delivery:api_review_must_be_read_only",
    ],
    [
      "unapproved review",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const review = fixture.assignments.find(
          (assignment) => assignment.assignmentId === "assignment-api-review",
        );
        if (!review?.report) throw new Error("missing API review report fixture");
        review.report.verdict = "rejected";
      },
      "parallel_delivery:api_review_must_be_completed_approved",
    ],
    [
      "non-required review policy",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const api = fixture.workstreams.find(
          (workstream) => workstream.workstreamId === "workstream-api",
        );
        if (!api) throw new Error("missing API workstream fixture");
        api.reviewPolicy = "none";
      },
      "parallel_delivery:api_review_policy_must_be_required",
    ],
    [
      "review assigned to the delivery owner",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const review = fixture.assignments.find(
          (assignment) => assignment.assignmentId === "assignment-api-review",
        );
        if (!review) throw new Error("missing API review fixture");
        review.assigneeMemberId = "member-api";
      },
      "parallel_delivery:api_review_assignee_mismatch",
    ],
    [
      "review without the API delivery dependency",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const review = fixture.assignments.find(
          (assignment) => assignment.assignmentId === "assignment-api-review",
        );
        if (!review) throw new Error("missing API review fixture");
        review.dependencyAssignmentIds = [];
      },
      "parallel_delivery:api_review_dependencies_mismatch",
    ],
    [
      "review dispatched before API delivery settled",
      (fixture: ReturnType<typeof parallelDagFixture>) => {
        const review = fixture.assignments.find(
          (assignment) => assignment.assignmentId === "assignment-api-review",
        );
        if (!review) throw new Error("missing API review fixture");
        review.dispatchedAt = "2026-01-01T00:00:09.000Z";
      },
      "parallel_delivery:api_review_dispatched_before_api_settled",
    ],
  ] as const)("rejects %s", (_label, mutate, expectedViolation) => {
    const fixture = parallelDagFixture();
    mutate(fixture);

    const audit = auditParallelDeliveryDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(expectedViolation);
  });

  test("requires final verification to cover every current-plan delivery and review subject", () => {
    const fixture = parallelDagFixture();
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!final) throw new Error("missing final verification fixture");
    final.dependencyAssignmentIds = ["assignment-integration"];
    final.subjectAssignmentIds = ["assignment-integration"];

    const audit = auditParallelDeliveryDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("parallel_delivery:final_assignment_dependencies_mismatch");
    expect(audit.violations).toContain("parallel_delivery:final_subject_assignments_mismatch");
  });

  test("rejects a final verification dependency that is not a current-plan subject", () => {
    const fixture = parallelDagFixture();
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!final) throw new Error("missing final verification fixture");
    final.dependencyAssignmentIds.push("assignment-from-another-plan");
    final.subjectAssignmentIds.push("assignment-from-another-plan");

    const audit = auditParallelDeliveryDag(fixture);

    expect(audit.violations).toContain("parallel_delivery:final_assignment_dependencies_mismatch");
    expect(audit.violations).toContain("parallel_delivery:final_subject_assignments_mismatch");
  });

  test("rejects an extra delivery node even when final verification covers it", () => {
    const fixture = parallelDagFixture();
    fixture.workstreams.push({
      workstreamId: "workstream-extra",
      kind: "delivery",
      mutableScope: { kind: "paths", pathPrefixes: ["src/extra.mjs"] },
      dependencyWorkstreamIds: [],
      ownerMemberId: "member-extra",
      reviewPolicy: "none",
      reviewerMemberId: null,
    });
    fixture.assignments.push(
      makeAssignment(
        "assignment-extra",
        "delivery",
        "workstream-extra",
        "member-extra",
        { kind: "paths", pathPrefixes: ["src/extra.mjs"] },
        [],
        2,
        7,
      ),
    );
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!final) throw new Error("missing final verification fixture");
    final.dependencyAssignmentIds.push("assignment-extra");
    final.subjectAssignmentIds.push("assignment-extra");

    const audit = auditParallelDeliveryDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("parallel_delivery:unexpected_workstream_nodes:1");
    expect(audit.violations).toContain("parallel_delivery:unexpected_assignment_nodes:1");
  });
});

describe("auditRecoveryDependencyDag", () => {
  test("requires exact recovery scopes, dependencies, subjects, and settle gates", () => {
    expect(auditRecoveryDependencyDag(recoveryDagFixture())).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        contract: { assignmentId: "assignment-contract" },
        implementation: { assignmentId: "assignment-implementation" },
        finalVerification: { assignmentId: "assignment-final" },
        finalSubjectAssignmentIds: ["assignment-contract", "assignment-implementation"],
      },
    });
  });

  test("accepts an integration Workstream for the dependency-gated implementation", () => {
    const fixture = recoveryDagFixture();
    const implementation = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-implementation",
    );
    if (!implementation) throw new Error("missing recovery implementation fixture");
    implementation.kind = "integration";

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        implementation: { assignmentId: "assignment-implementation" },
      },
    });
  });

  test("accepts a completed historical contract reused by a replanned implementation", () => {
    const fixture = recoveryDagFixture();
    const contract = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-contract",
    );
    if (!contract) throw new Error("missing recovery contract fixture");
    fixture.planRevision = 2;
    contract.planRevision = 1;
    for (const assignment of fixture.assignments) {
      if (assignment !== contract) assignment.planRevision = 2;
    }

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        contract: { assignmentId: "assignment-contract" },
        implementation: { assignmentId: "assignment-implementation" },
        finalSubjectAssignmentIds: ["assignment-contract", "assignment-implementation"],
      },
    });
  });

  test("accepts a linear contract amendment before the replanned implementation", () => {
    const fixture = recoveryDagFixture();
    addRecoveryContractAmendment(fixture);

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        contract: { assignmentId: "assignment-contract" },
        contractTail: { assignmentId: "assignment-contract-amendment" },
        contractChainWorkstreamIds: ["workstream-contract", "workstream-contract-amendment"],
        contractChainAssignmentIds: ["assignment-contract", "assignment-contract-amendment"],
        implementation: { assignmentId: "assignment-implementation" },
        finalSubjectAssignmentIds: [
          "assignment-contract",
          "assignment-contract-amendment",
          "assignment-implementation",
        ],
      },
    });
  });

  test("rejects branching contract amendments even when final verification covers both", () => {
    const fixture = recoveryDagFixture();
    addRecoveryContractAmendment(fixture);
    const branchWorkstreamId = "workstream-contract-alternative-amendment";
    fixture.workstreams.splice(2, 0, {
      workstreamId: branchWorkstreamId,
      kind: "delivery",
      mutableScope: { kind: "paths", pathPrefixes: ["docs/feature-flags-contract.md"] },
      dependencyWorkstreamIds: ["workstream-contract"],
      ownerMemberId: "member-contract",
      reviewPolicy: "none",
      reviewerMemberId: null,
    });
    const branch = makeAssignment(
      "assignment-contract-alternative-amendment",
      "delivery",
      branchWorkstreamId,
      "member-contract",
      { kind: "paths", pathPrefixes: ["docs/feature-flags-contract.md"] },
      ["assignment-contract"],
      4,
      6,
    );
    branch.planRevision = 2;
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!final) throw new Error("missing recovery final fixture");
    fixture.assignments.splice(-1, 0, branch);
    final.dependencyAssignmentIds.push(branch.assignmentId);
    final.subjectAssignmentIds.push(branch.assignmentId);

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:contract_workstream_chain_branches:1");
  });

  test("rejects a same-plan contract node masquerading as a replan amendment", () => {
    const fixture = recoveryDagFixture();
    addRecoveryContractAmendment(fixture);
    const amendment = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-contract-amendment",
    );
    if (!amendment) throw new Error("missing recovery amendment fixture");
    amendment.planRevision = 1;

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:contract_assignment_plan_revision_not_increasing",
    );
  });

  test("rejects an implementation that bypasses the contract amendment tail", () => {
    const fixture = recoveryDagFixture();
    addRecoveryContractAmendment(fixture);
    const implementationWorkstream = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-implementation",
    );
    const implementation = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-implementation",
    );
    if (!implementationWorkstream || !implementation) {
      throw new Error("missing recovery implementation fixture");
    }
    implementationWorkstream.dependencyWorkstreamIds = ["workstream-contract"];
    implementation.dependencyAssignmentIds = ["assignment-contract"];

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:implementation_workstream_dependencies_mismatch",
    );
    expect(audit.violations).toContain(
      "recovery_dependency:implementation_assignment_dependencies_mismatch",
    );
  });

  test("rejects an amendment Assignment that bypasses or races its predecessor", () => {
    const fixture = recoveryDagFixture();
    addRecoveryContractAmendment(fixture);
    const amendment = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-contract-amendment",
    );
    if (!amendment) throw new Error("missing recovery amendment fixture");
    amendment.dependencyAssignmentIds = [];
    amendment.dispatchedAt = "2026-01-01T00:00:03.000Z";

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:contract_assignment_dependencies_mismatch",
    );
    expect(audit.violations).toContain(
      "recovery_dependency:contract_amendment_dispatched_before_predecessor_settled",
    );
  });

  test("includes an approved amendment review in final verification subjects", () => {
    const fixture = recoveryDagFixture();
    addRecoveryContractAmendment(fixture);
    const amendmentWorkstream = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-contract-amendment",
    );
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!amendmentWorkstream || !final) throw new Error("missing recovery review fixture");
    amendmentWorkstream.reviewPolicy = "required";
    amendmentWorkstream.reviewerMemberId = "member-verification";
    const review = makeAssignment(
      "assignment-contract-amendment-review",
      "review",
      amendmentWorkstream.workstreamId,
      "member-verification",
      { kind: "read_only" },
      ["assignment-contract-amendment"],
      6,
      7,
    );
    review.planRevision = 2;
    fixture.assignments.splice(-1, 0, review);
    final.dependencyAssignmentIds.push(review.assignmentId);
    final.subjectAssignmentIds.push(review.assignmentId);

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        finalSubjectAssignmentIds: [
          "assignment-contract",
          "assignment-contract-amendment",
          "assignment-contract-amendment-review",
          "assignment-implementation",
        ],
      },
    });
  });

  test("accepts final verification that reaches the contract through implementation", () => {
    const fixture = recoveryDagFixture();
    const finalWorkstream = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-final",
    );
    if (!finalWorkstream) throw new Error("missing recovery final Workstream fixture");
    finalWorkstream.dependencyWorkstreamIds = ["workstream-implementation"];

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        finalSubjectAssignmentIds: ["assignment-contract", "assignment-implementation"],
      },
    });
  });

  test("accepts a required independent contract review in final verification subjects", () => {
    const fixture = recoveryDagFixture();
    const finalWorkstream = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-final",
    );
    if (!finalWorkstream) throw new Error("missing recovery final Workstream fixture");
    finalWorkstream.dependencyWorkstreamIds = ["workstream-implementation"];
    addRequiredRecoveryReview(fixture, "contract", 4, 5);

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        finalSubjectAssignmentIds: [
          "assignment-contract",
          "assignment-contract-review",
          "assignment-implementation",
        ],
      },
    });
  });

  test("accepts a required independent implementation review in final subjects", () => {
    const fixture = recoveryDagFixture();
    const { final } = addRequiredRecoveryReview(fixture, "implementation", 8, 9);
    final.dispatchedAt = "2026-01-01T00:00:09.000Z";
    final.settledAt = "2026-01-01T00:00:10.000Z";

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        finalSubjectAssignmentIds: [
          "assignment-contract",
          "assignment-implementation",
          "assignment-implementation-review",
        ],
      },
    });
  });

  test("accepts a historical approved review after the current reviewer changes", () => {
    const fixture = recoveryDagFixture();
    const { review, workstream } = addRequiredRecoveryReview(fixture, "contract", 4, 5);
    fixture.planRevision = 2;
    workstream.reviewerMemberId = "member-current-reviewer";
    review.planRevision = 1;
    for (const assignment of fixture.assignments) {
      if (assignment.assignmentId !== "assignment-contract" && assignment !== review) {
        assignment.planRevision = 2;
      }
    }

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        finalSubjectAssignmentIds: [
          "assignment-contract",
          "assignment-contract-review",
          "assignment-implementation",
        ],
      },
    });
  });

  test("accepts required independent reviews for both delivery Workstreams", () => {
    const fixture = recoveryDagFixture();
    addRequiredRecoveryReview(fixture, "contract", 4, 5);
    const { final } = addRequiredRecoveryReview(fixture, "implementation", 8, 9);
    final.dispatchedAt = "2026-01-01T00:00:09.000Z";
    final.settledAt = "2026-01-01T00:00:10.000Z";

    expect(auditRecoveryDependencyDag(fixture)).toMatchObject({
      valid: true,
      violations: [],
      nodes: {
        finalSubjectAssignmentIds: [
          "assignment-contract",
          "assignment-contract-review",
          "assignment-implementation",
          "assignment-implementation-review",
        ],
      },
    });
  });

  test("rejects a required review dispatched before its delivery settles", () => {
    const fixture = recoveryDagFixture();
    addRequiredRecoveryReview(fixture, "contract", 3, 4);

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:contract_review_dispatched_before_delivery_settled",
    );
  });

  test("rejects a writable self-review", () => {
    const fixture = recoveryDagFixture();
    const { delivery, review, workstream } = addRequiredRecoveryReview(fixture, "contract", 4, 5);
    workstream.reviewerMemberId = delivery.assigneeMemberId;
    review.assigneeMemberId = delivery.assigneeMemberId;
    review.mutableScope = { kind: "paths", pathPrefixes: ["docs/feature-flags-contract.md"] };

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:contract_reviewer_must_differ_from_owner",
    );
    expect(audit.violations).toContain(
      "recovery_dependency:contract_review_assignee_must_differ_from_delivery",
    );
    expect(audit.violations).toContain("recovery_dependency:contract_review_must_be_read_only");
  });

  test("rejects a required review that was not completed and approved", () => {
    const fixture = recoveryDagFixture();
    const contractWorkstream = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-contract",
    );
    if (!contractWorkstream) throw new Error("missing recovery contract Workstream fixture");
    contractWorkstream.reviewPolicy = "required";
    contractWorkstream.reviewerMemberId = "member-verification";

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:contract_review_assignment_matches:0");
  });

  test("rejects multiple approved reviews for the same Workstream revision", () => {
    const fixture = recoveryDagFixture();
    addRequiredRecoveryReview(fixture, "contract", 4, 5);
    fixture.assignments.splice(
      -1,
      0,
      makeAssignment(
        "assignment-contract-review-duplicate",
        "review",
        "workstream-contract",
        "member-verification",
        { kind: "read_only" },
        ["assignment-contract"],
        5,
        6,
      ),
    );

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:contract_review_assignment_matches:2");
    expect(audit.violations).toContain("recovery_dependency:unexpected_assignment_nodes:1");
  });

  test("rejects a required review bound to the wrong delivery", () => {
    const fixture = recoveryDagFixture();
    const { review } = addRequiredRecoveryReview(fixture, "contract", 4, 5);
    review.dependencyAssignmentIds = ["assignment-implementation"];
    review.subjectAssignmentIds = ["assignment-implementation"];

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:contract_review_dependencies_mismatch");
    expect(audit.violations).toContain("recovery_dependency:contract_review_subjects_mismatch");
  });

  test("rejects final verification that omits a required review", () => {
    const fixture = recoveryDagFixture();
    const { final, review } = addRequiredRecoveryReview(fixture, "contract", 4, 5);
    final.dependencyAssignmentIds = final.dependencyAssignmentIds.filter(
      (assignmentId) => assignmentId !== review.assignmentId,
    );
    final.subjectAssignmentIds = final.subjectAssignmentIds.filter(
      (assignmentId) => assignmentId !== review.assignmentId,
    );

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:final_assignment_dependencies_mismatch",
    );
    expect(audit.violations).toContain("recovery_dependency:final_subject_assignments_mismatch");
  });

  test("rejects an extra review when the Workstream review policy is none", () => {
    const fixture = recoveryDagFixture();
    const review = makeAssignment(
      "assignment-contract-review",
      "review",
      "workstream-contract",
      "member-verification",
      { kind: "read_only" },
      ["assignment-contract"],
      4,
      5,
    );
    fixture.assignments.splice(1, 0, review);

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:unexpected_assignment_nodes:1");
  });

  test.each([
    ["has no dependency", []],
    ["omits implementation", ["workstream-contract"]],
    ["adds an unrelated dependency", ["workstream-implementation", "workstream-extra"]],
    ["duplicates implementation", ["workstream-implementation", "workstream-implementation"]],
  ])("rejects final verification that %s", (_description, dependencyWorkstreamIds) => {
    const fixture = recoveryDagFixture();
    const finalWorkstream = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-final",
    );
    if (!finalWorkstream) throw new Error("missing recovery final Workstream fixture");
    finalWorkstream.dependencyWorkstreamIds = dependencyWorkstreamIds;

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:final_workstream_dependencies_mismatch",
    );
  });

  test("rejects a blocked historical contract as a reusable prerequisite", () => {
    const fixture = recoveryDagFixture();
    const contract = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-contract",
    );
    if (!contract) throw new Error("missing recovery contract fixture");
    fixture.planRevision = 2;
    contract.planRevision = 1;
    contract.semanticState = "blocked";
    if (contract.report) contract.report.status = "blocked";
    for (const assignment of fixture.assignments) {
      if (assignment !== contract) assignment.planRevision = 2;
    }

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:contract_assignment_matches:0");
  });

  test("rejects an arbitrary implementation dependency and the old final-only dependency", () => {
    const fixture = recoveryDagFixture();
    const implementation = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-implementation",
    );
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!implementation || !final) throw new Error("missing recovery assignment fixture");
    implementation.dependencyAssignmentIds = ["assignment-final"];
    final.dependencyAssignmentIds = ["assignment-implementation"];
    final.subjectAssignmentIds = ["assignment-implementation"];

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:implementation_assignment_dependencies_mismatch",
    );
    expect(audit.violations).toContain(
      "recovery_dependency:final_assignment_dependencies_mismatch",
    );
    expect(audit.violations).toContain("recovery_dependency:final_subject_assignments_mismatch");
  });

  test("rejects dispatch before prerequisite settle", () => {
    const fixture = recoveryDagFixture();
    const implementation = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-implementation",
    );
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!implementation || !final) throw new Error("missing recovery assignment fixture");
    implementation.dispatchedAt = "2026-01-01T00:00:03.000Z";
    final.dispatchedAt = "2026-01-01T00:00:07.000Z";

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain(
      "recovery_dependency:implementation_dispatched_before_contract_settled",
    );
    expect(audit.violations).toContain(
      "recovery_dependency:final_dispatched_before_subjects_settled",
    );
  });

  test("rejects a contract workstream with an inexact mutable scope", () => {
    const fixture = recoveryDagFixture();
    const contract = fixture.workstreams.find(
      (workstream) => workstream.workstreamId === "workstream-contract",
    );
    if (!contract) throw new Error("missing recovery contract fixture");
    contract.mutableScope = { kind: "paths", pathPrefixes: ["docs/"] };

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:contract_workstream_matches:0");
  });

  test("rejects an extra recovery node even when final verification covers it", () => {
    const fixture = recoveryDagFixture();
    fixture.workstreams.push({
      workstreamId: "workstream-extra",
      kind: "delivery",
      mutableScope: { kind: "paths", pathPrefixes: ["src/extra-recovery.mjs"] },
      dependencyWorkstreamIds: [],
      ownerMemberId: "member-extra",
      reviewPolicy: "none",
      reviewerMemberId: null,
    });
    fixture.assignments.push(
      makeAssignment(
        "assignment-extra",
        "delivery",
        "workstream-extra",
        "member-extra",
        { kind: "paths", pathPrefixes: ["src/extra-recovery.mjs"] },
        [],
        1,
        3,
      ),
    );
    const final = fixture.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-final",
    );
    if (!final) throw new Error("missing recovery final fixture");
    final.dependencyAssignmentIds.push("assignment-extra");
    final.subjectAssignmentIds.push("assignment-extra");

    const audit = auditRecoveryDependencyDag(fixture);

    expect(audit.valid).toBe(false);
    expect(audit.violations).toContain("recovery_dependency:unexpected_workstream_nodes:1");
    expect(audit.violations).toContain("recovery_dependency:unexpected_assignment_nodes:1");
  });
});

describe("auditToolDiscipline", () => {
  test("awards full credit only to completed calls associated with the current Mission", () => {
    const audit = auditToolDiscipline(toolTimelineFixture(), toolMissionFixture());

    expect(audit.score).toBe(2);
    expect(audit.violations).toEqual([]);
    expect(audit.successfulCounts).toMatchObject({
      mission_plan: 1,
      assignment_report: 1,
      team_message: 1,
      chat_read: 1,
    });
    expect(audit.calls.find((call) => call.name === "mission_plan")?.missionAssociation).toBe(
      "verified",
    );
    expect(audit.calls.find((call) => call.name === "assignment_report")?.missionAssociation).toBe(
      "verified",
    );
  });

  test("accepts an atomic mission_plan as the Assignment activation tool", () => {
    const timelines = toolTimelineFixture();
    const leadTimeline = timelines[0];
    if (!leadTimeline) throw new Error("missing Lead timeline fixture");
    leadTimeline.entries = leadTimeline.entries.filter(
      (entry) => entry.item.type !== "tool_call" || entry.item.name !== "assign_task",
    );
    const plan = leadTimeline.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "mission_plan",
    )?.item;
    if (!plan || plan.type !== "tool_call" || plan.detail.type !== "unknown") {
      throw new Error("missing mission plan fixture");
    }
    plan.detail.input = {
      ...toolInput("mission_plan"),
      assignments: [
        { clientKey: "delivery", kind: "delivery", workstreamId: "workstream-current" },
      ],
    };
    plan.detail.output = {
      ...toolOutput("mission_plan"),
      assignments: [
        {
          ...toolMissionFixture().assignments[0],
          kind: "delivery",
          workstreamId: "workstream-current",
        },
      ],
    };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(2);
    expect(audit.violations).toEqual([]);
    expect(audit.successfulCounts.assign_task ?? 0).toBe(0);
    expect(audit.calls.find((call) => call.name === "mission_plan")?.assignmentActivation).toBe(
      "atomic_mission_plan",
    );
  });

  test("rejects atomic mission_plan activation for a Workstream absent from the Mission", () => {
    const timelines = toolTimelineFixture();
    const leadTimeline = timelines[0];
    if (!leadTimeline) throw new Error("missing Lead timeline fixture");
    leadTimeline.entries = leadTimeline.entries.filter(
      (entry) => entry.item.type !== "tool_call" || entry.item.name !== "assign_task",
    );
    const plan = leadTimeline.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "mission_plan",
    )?.item;
    if (!plan || plan.type !== "tool_call" || plan.detail.type !== "unknown") {
      throw new Error("missing mission plan fixture");
    }
    plan.detail.input = {
      ...toolInput("mission_plan"),
      assignments: [
        { clientKey: "delivery", kind: "delivery", workstreamId: "workstream-invented" },
      ],
    };
    plan.detail.output = {
      ...toolOutput("mission_plan"),
      assignments: [
        {
          ...toolMissionFixture().assignments[0],
          kind: "delivery",
          workstreamId: "workstream-invented",
        },
      ],
    };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(0);
    expect(
      audit.calls.find((call) => call.name === "mission_plan")?.assignmentActivation,
    ).toBeNull();
  });

  test("rejects atomic mission_plan activation that omits a delivery Workstream", () => {
    const mission = toolMissionFixture();
    mission.assignments.push({
      ...mission.assignments[0],
      assignmentId: "assignment-second",
      workstreamId: "workstream-second",
    });
    const timelines = toolTimelineFixture();
    const leadTimeline = timelines[0];
    if (!leadTimeline) throw new Error("missing Lead timeline fixture");
    leadTimeline.entries = leadTimeline.entries.filter(
      (entry) => entry.item.type !== "tool_call" || entry.item.name !== "assign_task",
    );
    const plan = leadTimeline.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "mission_plan",
    )?.item;
    if (!plan || plan.type !== "tool_call" || plan.detail.type !== "unknown") {
      throw new Error("missing mission plan fixture");
    }
    plan.detail.input = {
      ...toolInput("mission_plan"),
      assignments: [
        { clientKey: "delivery", kind: "delivery", workstreamId: "workstream-current" },
      ],
    };
    plan.detail.output = {
      ...toolOutput("mission_plan"),
      assignments: [mission.assignments[0]],
    };

    const audit = auditToolDiscipline(timelines, mission);

    expect(audit.score).toBe(0);
    expect(
      audit.calls.find((call) => call.name === "mission_plan")?.assignmentActivation,
    ).toBeNull();
  });

  test("does not count a failed atomic mission_plan as Assignment activation", () => {
    const timelines = toolTimelineFixture();
    const leadTimeline = timelines[0];
    if (!leadTimeline) throw new Error("missing Lead timeline fixture");
    leadTimeline.entries = leadTimeline.entries.filter(
      (entry) => entry.item.type !== "tool_call" || entry.item.name !== "assign_task",
    );
    const plan = leadTimeline.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "mission_plan",
    )?.item;
    if (!plan || plan.type !== "tool_call" || plan.detail.type !== "unknown") {
      throw new Error("missing mission plan fixture");
    }
    plan.status = "failed";
    plan.error = { code: "PLAN_FAILED" };
    plan.detail.input = {
      ...toolInput("mission_plan"),
      assignments: [
        { clientKey: "delivery", kind: "delivery", workstreamId: "workstream-current" },
      ],
    };
    plan.detail.output = {
      ...toolOutput("mission_plan"),
      assignments: [toolMissionFixture().assignments[0]],
    };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(0);
    expect(audit.violations).toContain("tool_discipline:mission_plan_not_completed:failed");
  });

  test("gives zero when neither activation tool path is observed", () => {
    const timelines = toolTimelineFixture();
    const leadTimeline = timelines[0];
    if (!leadTimeline) throw new Error("missing Lead timeline fixture");
    leadTimeline.entries = leadTimeline.entries.filter(
      (entry) => entry.item.type !== "tool_call" || entry.item.name !== "assign_task",
    );

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(0);
    expect(
      audit.calls.find((call) => call.name === "mission_plan")?.assignmentActivation,
    ).toBeNull();
  });

  test("does not award full credit when a completed read targets another Mission", () => {
    const timelines = toolTimelineFixture();
    const status = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "team_status",
    )?.item;
    if (!status || status.type !== "tool_call" || status.detail.type !== "unknown") {
      throw new Error("missing Team status fixture");
    }
    status.detail.input = { missionId: "mission-other" };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.successfulCounts.team_status ?? 0).toBe(0);
    expect(audit.violations).toContain("tool_discipline:team_status_association_mismatch");
  });

  test("does not award full credit to assign_task against a stale plan revision", () => {
    const timelines = toolTimelineFixture();
    const assign = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "assign_task",
    )?.item;
    if (!assign || assign.type !== "tool_call" || assign.detail.type !== "unknown") {
      throw new Error("missing assign task fixture");
    }
    assign.detail.input = {
      missionId: "mission-current",
      expectedRevision: 4,
      expectedPlanRevision: 999,
    };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.successfulCounts.assign_task ?? 0).toBe(0);
    expect(audit.violations).toContain("tool_discipline:assign_task_association_mismatch");
  });

  test("rejects assign_task output that does not advance the expected Mission revision", () => {
    const timelines = toolTimelineFixture();
    const assign = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "assign_task",
    )?.item;
    if (!assign || assign.type !== "tool_call" || assign.detail.type !== "unknown") {
      throw new Error("missing assign task fixture");
    }
    const output = assign.detail.output as ReturnType<typeof toolOutput>;
    const mission = output.mission as { revision: number };
    mission.revision = 1;

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.violations).toContain("tool_discipline:assign_task_association_mismatch");
  });

  test.each(["failed", "canceled", "running"] as const)(
    "does not count a %s tool call as successful",
    (status) => {
      const timelines = toolTimelineFixture();
      const call = timelines[0]?.entries.find(
        (entry) => entry.item.type === "tool_call" && entry.item.name === "team_message",
      )?.item;
      if (!call || call.type !== "tool_call") throw new Error("missing tool fixture");
      call.status = status;
      call.error = status === "failed" ? { message: "boom" } : null;

      const audit = auditToolDiscipline(timelines, toolMissionFixture());

      expect(audit.score).toBe(1);
      expect(audit.successfulCounts.team_message ?? 0).toBe(0);
      expect(audit.violations).toContain(`tool_discipline:team_message_not_completed:${status}`);
    },
  );

  test("records unavailable mission input as unverifiable and withholds full credit", () => {
    const timelines = toolTimelineFixture();
    const plan = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "mission_plan",
    )?.item;
    if (!plan || plan.type !== "tool_call") throw new Error("missing mission plan fixture");
    plan.detail = { type: "plain_text", text: "plan complete" };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.calls.find((call) => call.name === "mission_plan")?.missionAssociation).toBe(
      "unverifiable",
    );
    expect(audit.violations).toContain("tool_discipline:mission_plan_association_unverifiable");
  });

  test("gives zero when a core tool only has a failed call", () => {
    const timelines = toolTimelineFixture();
    const plan = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "mission_plan",
    )?.item;
    if (!plan || plan.type !== "tool_call") throw new Error("missing mission plan fixture");
    plan.status = "failed";
    plan.error = { message: "revision conflict" };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(0);
    expect(audit.successfulCounts.mission_plan ?? 0).toBe(0);
    expect(audit.violations).toContain("tool_discipline:mission_plan_not_completed:failed");
  });

  test("withholds full credit when a failed tool call is followed by a success", () => {
    const timelines = toolTimelineFixture();
    const timeline = timelines[0];
    const messageEntry = timeline?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "team_message",
    );
    if (!timeline || !messageEntry || messageEntry.item.type !== "tool_call") {
      throw new Error("missing team message fixture");
    }
    messageEntry.item.status = "failed";
    messageEntry.item.error = { message: "transient failure" };
    timeline.entries.push({
      seq: 99,
      item: {
        ...messageEntry.item,
        callId: "call-team-message-retry",
        status: "completed",
        error: null,
      },
    });

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.successfulCounts.team_message).toBe(1);
    expect(audit.violations).toContain("tool_discipline:team_message_not_completed:failed");
  });

  test("does not count a successful call associated with another Mission", () => {
    const timelines = toolTimelineFixture();
    const timeline = timelines[0];
    const statusEntry = timeline?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "team_status",
    );
    if (!timeline || !statusEntry || statusEntry.item.type !== "tool_call") {
      throw new Error("missing team status fixture");
    }
    timeline.entries.push({
      seq: 99,
      item: {
        ...statusEntry.item,
        callId: "call-other-mission",
        detail: {
          type: "unknown",
          input: { missionId: "mission-other" },
          output: { missionId: "mission-other", teamId: "team-other" },
        },
      },
    });

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.violations).toContain("tool_discipline:team_status_association_mismatch");
  });

  test("rejects team_status evidence for a different Team", () => {
    const timelines = toolTimelineFixture();
    const status = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "team_status",
    )?.item;
    if (!status || status.type !== "tool_call" || status.detail.type !== "unknown") {
      throw new Error("missing team status fixture");
    }
    status.detail.output = {
      mission: { id: "mission-current", teamId: "team-other", revision: 8, planRevision: 1 },
      team: { id: "team-other" },
    };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(1);
    expect(audit.violations).toContain("tool_discipline:team_status_association_mismatch");
  });

  test("rejects assignment_report when the Assignment binding is no longer current", () => {
    const mission = toolMissionFixture();
    const worker = mission.participants.find(
      (participant) => participant.memberId === "member-worker",
    );
    if (!worker) throw new Error("missing worker participant fixture");
    worker.bindingEpoch += 1;

    const audit = auditToolDiscipline(toolTimelineFixture(), mission);

    expect(audit.score).toBe(1);
    expect(audit.successfulCounts.assignment_report ?? 0).toBe(0);
    expect(audit.violations).toContain("tool_discipline:assignment_report_association_mismatch");
  });

  test("associates a team_message addressed by handle through its resolved Member output", () => {
    const timelines = toolTimelineFixture();
    const message = timelines[0]?.entries.find(
      (entry) => entry.item.type === "tool_call" && entry.item.name === "team_message",
    )?.item;
    if (!message || message.type !== "tool_call" || message.detail.type !== "unknown") {
      throw new Error("missing Team message fixture");
    }
    message.detail.input = { missionId: "mission-current", recipient: "@worker" };

    const audit = auditToolDiscipline(timelines, toolMissionFixture());

    expect(audit.score).toBe(2);
    expect(audit.violations).toEqual([]);
  });
});

describe("auditRuntimeRecovery", () => {
  test("separates verified startup saga recovery from unobserved report recovery", () => {
    const audit = auditRuntimeRecovery({
      mission: runtimeMissionFixture(),
      injectedFaultPoint: "after_lead_participant_write",
      firstStartFailed: true,
      startAttempts: 2,
      assignmentDispatchValid: true,
      providerStartTurns: [],
    });

    expect(audit.score).toBe(1);
    expect(audit.startupSaga).toMatchObject({ observed: true, valid: true });
    expect(audit.reportRecovery).toMatchObject({
      observed: false,
      valid: false,
      reason: "no_report_recovery_turn_observed",
      turnCount: 0,
    });
  });

  test("awards full reliability only when a bounded report recovery turn is accepted", () => {
    const mission = runtimeMissionFixture();
    const audit = auditRuntimeRecovery({
      mission,
      injectedFaultPoint: "after_lead_participant_write",
      firstStartFailed: true,
      startAttempts: 2,
      assignmentDispatchValid: true,
      providerStartTurns: [
        {
          agentId: "agent-assignee",
          clientMessageId:
            "team-mission:mission-current:assignment:assignment-current:report-recovery:1",
          turnId: "turn-recovery-1",
          outcome: "accepted",
          error: null,
        },
      ],
    });

    expect(audit.score).toBe(2);
    expect(audit.reportRecovery).toMatchObject({
      observed: true,
      valid: true,
      reason: null,
      turnCount: 1,
      maxAttempt: 1,
    });
  });

  test("does not award full reliability for a failed recovery boundary call", () => {
    const audit = auditRuntimeRecovery({
      mission: runtimeMissionFixture(),
      injectedFaultPoint: null,
      firstStartFailed: false,
      startAttempts: 1,
      assignmentDispatchValid: true,
      providerStartTurns: [
        {
          agentId: "agent-assignee",
          clientMessageId:
            "team-mission:mission-current:assignment:assignment-current:report-recovery:1",
          turnId: null,
          outcome: "rejected",
          error: "agent_busy",
        },
      ],
    });

    expect(audit.score).toBe(1);
    expect(audit.reportRecovery).toMatchObject({
      observed: true,
      valid: false,
      reason: "report_recovery_boundary_not_accepted",
    });
  });

  test("accepts a bounded second report recovery attempt after an observed busy rejection", () => {
    const messagePrefix =
      "team-mission:mission-current:assignment:assignment-current:report-recovery:";
    const audit = auditRuntimeRecovery({
      mission: runtimeMissionFixture(),
      injectedFaultPoint: null,
      firstStartFailed: false,
      startAttempts: 1,
      assignmentDispatchValid: true,
      providerStartTurns: [
        {
          agentId: "agent-assignee",
          clientMessageId: `${messagePrefix}1`,
          turnId: null,
          outcome: "rejected",
          error: "agent_busy",
        },
        {
          agentId: "agent-assignee",
          clientMessageId: `${messagePrefix}2`,
          turnId: "turn-recovery-2",
          outcome: "accepted",
          error: null,
        },
      ],
    });

    expect(audit.score).toBe(2);
    expect(audit.reportRecovery).toMatchObject({
      valid: true,
      outcome: "recovered_after_rejection",
      rejectedTurnCount: 1,
      maxAttempt: 2,
    });
  });

  test.each([
    ["attempt 2 without attempt 1", ["2"]],
    ["duplicate attempt 1", ["1", "1"]],
    ["a gap from attempt 1 to attempt 3", ["1", "3"]],
    ["a non-numeric attempt", ["retry"]],
  ])("rejects %s", (_label, attempts) => {
    const prefix = "team-mission:mission-current:assignment:assignment-current:report-recovery:";
    const audit = auditRuntimeRecovery({
      mission: runtimeMissionFixture(),
      injectedFaultPoint: null,
      firstStartFailed: false,
      startAttempts: 1,
      assignmentDispatchValid: true,
      providerStartTurns: attempts.map((attempt, index) => ({
        agentId: "agent-assignee",
        clientMessageId: `${prefix}${attempt}`,
        turnId: `turn-recovery-${index + 1}`,
        outcome: "accepted" as const,
        error: null,
      })),
    });

    expect(audit.score).toBe(1);
    expect(audit.reportRecovery).toMatchObject({
      valid: false,
      reason: "report_recovery_attempt_sequence_invalid",
    });
  });
});

describe("executeEvidenceLifecycle", () => {
  test("captures the run failure context before cleanup changes the active phase", async () => {
    let phase = "wait_for_mission";
    let committedFailureContext: { phase: string } | null = null;

    await expect(
      executeEvidenceLifecycle({
        captureFailureContext: () => ({ phase }),
        run: async () => {
          throw new Error("Mission timed out");
        },
        finalize: async () => undefined,
        cleanup: async () => {
          phase = "cleanup";
        },
        commit: async ({ failureContext }) => {
          committedFailureContext = failureContext;
        },
      }),
    ).rejects.toThrow("Mission timed out");

    expect(phase).toBe("cleanup");
    expect(committedFailureContext).toEqual({ phase: "wait_for_mission" });
  });

  test("finalizes a setup failure as structured evidence and then cleans up", async () => {
    const events: string[] = [];
    await expect(
      executeEvidenceLifecycle({
        run: async () => {
          events.push("run");
          throw new Error("daemon launch failed");
        },
        finalize: async ({ result, error }) => {
          events.push(`finalize:${result === null}:${String(error)}`);
        },
        cleanup: async () => {
          events.push("cleanup");
        },
        commit: async ({ error }) => {
          events.push(`commit:${error instanceof Error ? error.message : "success"}`);
        },
      }),
    ).rejects.toThrow("daemon launch failed");

    expect(events).toEqual([
      "run",
      "finalize:true:Error: daemon launch failed",
      "cleanup",
      "commit:daemon launch failed",
    ]);
  });

  test("still cleans up when evidence finalization fails", async () => {
    const events: string[] = [];
    await expect(
      executeEvidenceLifecycle({
        run: async () => "collected",
        finalize: async () => {
          events.push("finalize");
          throw new Error("persist failed");
        },
        cleanup: async () => {
          events.push("cleanup");
        },
        commit: async ({ error }) => {
          events.push(`commit:${error instanceof Error ? error.message : "success"}`);
        },
      }),
    ).rejects.toThrow("persist failed");

    expect(events).toEqual(["finalize", "cleanup", "commit:persist failed"]);
  });

  test("commits failed evidence when finalization succeeds but cleanup fails", async () => {
    const events: string[] = [];
    let manifest: { status: string } | null = null;
    await expect(
      executeEvidenceLifecycle({
        run: async () => "collected",
        finalize: async () => {
          events.push("finalize");
        },
        cleanup: async () => {
          events.push("cleanup");
          throw new Error("cleanup failed");
        },
        commit: async ({ error }) => {
          events.push("commit");
          manifest = { status: error === null ? "success" : "evidence_collection_failed" };
        },
      }),
    ).rejects.toThrow("cleanup failed");

    expect(events).toEqual(["finalize", "cleanup", "commit"]);
    expect(manifest).toEqual({ status: "evidence_collection_failed" });
  });

  test("atomically replaces stale success evidence when cleanup fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-team-lifecycle-evidence-"));
    roots.push(root);
    const manifestPath = path.join(root, "parallel-delivery-run-1.json");
    writeFileSync(manifestPath, `${JSON.stringify({ status: "success" })}\n`);
    const secret = "SECRET_SENTINEL_CLEANUP_FAILURE";

    await expect(
      executeEvidenceLifecycle({
        run: async () => "collected",
        finalize: async () => undefined,
        cleanup: async () => {
          throw new Error(`cleanup failed ${secret}`);
        },
        commit: async ({ error }) => {
          await persistSanitizedEvidenceManifest(manifestPath, {
            status: error === null ? "success" : "evidence_collection_failed",
            error,
          });
        },
      }),
    ).rejects.toThrow("cleanup failed");

    const persisted = readFileSync(manifestPath, "utf8");
    expect(JSON.parse(persisted)).toMatchObject({
      status: "evidence_collection_failed",
      error: { name: "Error" },
    });
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain('"status":"success"');
  });
});

describe("waitForMissionEvidence", () => {
  test("reports the latest nonterminal Mission observation before timing out", async () => {
    vi.useFakeTimers();
    const observed: unknown[] = [];
    const mission = {
      id: "mission-1",
      status: "active",
      planRevision: 3,
      revision: 12,
      workstreams: [],
      assignments: [],
      attentionItems: [],
      participants: [],
    };
    let unsubscribed = false;
    const client = {
      on: () => () => {
        unsubscribed = true;
      },
      inspectTeamMission: async () => ({ mission }),
    } as unknown as DaemonClient;

    const waiting = waitForMissionEvidence({
      client,
      missionId: "mission-1",
      predicate: () => false,
      label: "real provider Mission terminal state",
      timeoutMs: 1_000,
      onObservedMission: (candidate) => observed.push(candidate),
    });
    const rejected = expect(waiting).rejects.toThrow(
      "Timed out waiting for real provider Mission terminal state",
    );
    await vi.runAllTimersAsync();
    await rejected;

    expect(observed).toEqual([mission]);
    expect(unsubscribed).toBe(true);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function parallelDagFixture() {
  const scope = (pathPrefix: string) => ({ kind: "paths" as const, pathPrefixes: [pathPrefix] });
  return {
    planRevision: 1,
    workstreams: [
      {
        workstreamId: "workstream-api",
        kind: "delivery" as const,
        mutableScope: scope("src/profile-api.mjs"),
        dependencyWorkstreamIds: [],
        ownerMemberId: "member-api",
        reviewPolicy: "required" as const,
        reviewerMemberId: "member-api-reviewer",
      },
      {
        workstreamId: "workstream-ui",
        kind: "delivery" as const,
        mutableScope: scope("src/profile-card.mjs"),
        dependencyWorkstreamIds: [],
        ownerMemberId: "member-ui",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
      {
        workstreamId: "workstream-test",
        kind: "delivery" as const,
        mutableScope: scope("test/profile.acceptance.test.mjs"),
        dependencyWorkstreamIds: [],
        ownerMemberId: "member-test",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
      {
        workstreamId: "workstream-integration",
        kind: "integration" as const,
        mutableScope: scope("src/index.mjs"),
        dependencyWorkstreamIds: ["workstream-api", "workstream-ui", "workstream-test"],
        ownerMemberId: "member-integration",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
      {
        workstreamId: "workstream-final",
        kind: "verification" as const,
        mutableScope: { kind: "read_only" as const },
        dependencyWorkstreamIds: ["workstream-integration"],
        ownerMemberId: "member-verification",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
    ],
    assignments: [
      makeAssignment(
        "assignment-api",
        "delivery",
        "workstream-api",
        "member-api",
        scope("src/profile-api.mjs"),
        [],
        0,
        10,
      ),
      makeAssignment(
        "assignment-ui",
        "delivery",
        "workstream-ui",
        "member-ui",
        scope("src/profile-card.mjs"),
        [],
        1,
        9,
      ),
      makeAssignment(
        "assignment-test",
        "delivery",
        "workstream-test",
        "member-test",
        scope("test/profile.acceptance.test.mjs"),
        [],
        2,
        8,
      ),
      makeAssignment(
        "assignment-api-review",
        "review",
        "workstream-api",
        "member-api-reviewer",
        { kind: "read_only" as const },
        ["assignment-api"],
        10,
        11,
      ),
      makeAssignment(
        "assignment-integration",
        "delivery",
        "workstream-integration",
        "member-integration",
        scope("src/index.mjs"),
        ["assignment-api", "assignment-ui", "assignment-test"],
        10,
        12,
      ),
      makeAssignment(
        "assignment-final",
        "verification",
        "workstream-final",
        "member-verification",
        { kind: "read_only" as const },
        [
          "assignment-api",
          "assignment-ui",
          "assignment-test",
          "assignment-api-review",
          "assignment-integration",
        ],
        12,
        13,
      ),
    ],
  };
}

function recoveryDagFixture() {
  const scope = (pathPrefix: string) => ({ kind: "paths" as const, pathPrefixes: [pathPrefix] });
  return {
    planRevision: 1,
    workstreams: [
      {
        workstreamId: "workstream-contract",
        kind: "delivery" as const,
        mutableScope: scope("docs/feature-flags-contract.md"),
        dependencyWorkstreamIds: [],
        ownerMemberId: "member-contract",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
      {
        workstreamId: "workstream-implementation",
        kind: "delivery" as const,
        mutableScope: scope("src/parse-feature-flags.mjs"),
        dependencyWorkstreamIds: ["workstream-contract"],
        ownerMemberId: "member-implementation",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
      {
        workstreamId: "workstream-final",
        kind: "verification" as const,
        mutableScope: { kind: "read_only" as const },
        dependencyWorkstreamIds: ["workstream-contract", "workstream-implementation"],
        ownerMemberId: "member-verification",
        reviewPolicy: "none" as const,
        reviewerMemberId: null,
      },
    ],
    assignments: [
      makeAssignment(
        "assignment-contract",
        "delivery",
        "workstream-contract",
        "member-contract",
        scope("docs/feature-flags-contract.md"),
        [],
        0,
        4,
      ),
      makeAssignment(
        "assignment-implementation",
        "delivery",
        "workstream-implementation",
        "member-implementation",
        scope("src/parse-feature-flags.mjs"),
        ["assignment-contract"],
        4,
        8,
      ),
      makeAssignment(
        "assignment-final",
        "verification",
        "workstream-final",
        "member-verification",
        { kind: "read_only" as const },
        ["assignment-contract", "assignment-implementation"],
        8,
        9,
      ),
    ],
  };
}

function addRecoveryContractAmendment(fixture: ReturnType<typeof recoveryDagFixture>) {
  const contract = fixture.assignments.find(
    (assignment) => assignment.assignmentId === "assignment-contract",
  );
  const implementationWorkstream = fixture.workstreams.find(
    (workstream) => workstream.workstreamId === "workstream-implementation",
  );
  const finalWorkstream = fixture.workstreams.find(
    (workstream) => workstream.workstreamId === "workstream-final",
  );
  const implementation = fixture.assignments.find(
    (assignment) => assignment.assignmentId === "assignment-implementation",
  );
  const final = fixture.assignments.find(
    (assignment) => assignment.assignmentId === "assignment-final",
  );
  if (!contract || !implementationWorkstream || !finalWorkstream || !implementation || !final) {
    throw new Error("missing recovery amendment fixture");
  }

  fixture.planRevision = 2;
  contract.planRevision = 1;
  fixture.workstreams.splice(1, 0, {
    workstreamId: "workstream-contract-amendment",
    kind: "delivery",
    mutableScope: { kind: "paths", pathPrefixes: ["docs/feature-flags-contract.md"] },
    dependencyWorkstreamIds: ["workstream-contract"],
    ownerMemberId: "member-contract",
    reviewPolicy: "none",
    reviewerMemberId: null,
  });
  implementationWorkstream.dependencyWorkstreamIds = ["workstream-contract-amendment"];
  finalWorkstream.dependencyWorkstreamIds = [
    "workstream-contract-amendment",
    "workstream-implementation",
  ];

  const amendment = makeAssignment(
    "assignment-contract-amendment",
    "delivery",
    "workstream-contract-amendment",
    "member-contract",
    { kind: "paths", pathPrefixes: ["docs/feature-flags-contract.md"] },
    ["assignment-contract"],
    4,
    6,
  );
  amendment.planRevision = 2;
  implementation.planRevision = 2;
  implementation.dependencyAssignmentIds = [amendment.assignmentId];
  implementation.subjectAssignmentIds = [amendment.assignmentId];
  implementation.dispatchedAt = "2026-01-01T00:00:06.000Z";
  final.planRevision = 2;
  final.dependencyAssignmentIds = [
    contract.assignmentId,
    amendment.assignmentId,
    implementation.assignmentId,
  ];
  final.subjectAssignmentIds = [...final.dependencyAssignmentIds];
  fixture.assignments.splice(-2, 0, amendment);
}

function addRequiredRecoveryReview(
  fixture: ReturnType<typeof recoveryDagFixture>,
  role: "contract" | "implementation",
  dispatchedSecond: number,
  settledSecond: number,
) {
  const workstreamId = `workstream-${role}`;
  const deliveryId = `assignment-${role}`;
  const workstream = fixture.workstreams.find(
    (candidate) => candidate.workstreamId === workstreamId,
  );
  const delivery = fixture.assignments.find((candidate) => candidate.assignmentId === deliveryId);
  const final = fixture.assignments.find(
    (candidate) => candidate.assignmentId === "assignment-final",
  );
  if (!workstream || !delivery || !final) throw new Error("missing recovery review fixture");
  workstream.reviewPolicy = "required";
  workstream.reviewerMemberId = "member-verification";
  const review = makeAssignment(
    `${deliveryId}-review`,
    "review",
    workstreamId,
    "member-verification",
    { kind: "read_only" },
    [deliveryId],
    dispatchedSecond,
    settledSecond,
  );
  fixture.assignments.splice(-1, 0, review);
  final.dependencyAssignmentIds.push(review.assignmentId);
  final.subjectAssignmentIds.push(review.assignmentId);
  return { delivery, final, review, workstream };
}

function toolMissionFixture() {
  return {
    id: "mission-current",
    teamId: "team-current",
    revision: 8,
    planRevision: 1,
    participants: [
      { memberId: "member-lead", agentId: "agent-lead", bindingEpoch: 1 },
      { memberId: "member-worker", agentId: "agent-worker", bindingEpoch: 2 },
    ],
    assignments: [
      {
        assignmentId: "assignment-current",
        revision: 4,
        planRevision: 1,
        kind: "delivery" as const,
        workstreamId: "workstream-current",
        assigneeMemberId: "member-worker",
        runtimeAgentId: "agent-worker",
        bindingEpoch: 2,
      },
    ],
  };
}

function toolTimelineFixture() {
  const names = [
    "mission_status",
    "mission_plan",
    "assign_task",
    "team_status",
    "team_member_history",
    "team_message",
    "chat_read",
  ];
  return [
    {
      agentId: "agent-lead",
      entries: names.map((name, index) => ({
        seq: index + 1,
        item: {
          type: "tool_call" as const,
          callId: `call-${index}`,
          name,
          status: "completed" as "completed" | "failed" | "canceled" | "running",
          error: null as unknown,
          detail: {
            type: "unknown" as const,
            input: toolInput(name),
            output: toolOutput(name),
          } as
            | { type: "unknown"; input: unknown; output: unknown }
            | { type: "plain_text"; text: string },
        },
      })),
    },
    {
      agentId: "agent-worker",
      entries: [
        {
          seq: 1,
          item: {
            type: "tool_call" as const,
            callId: "call-assignment-report",
            name: "assignment_report",
            status: "completed" as "completed" | "failed" | "canceled" | "running",
            error: null as unknown,
            detail: {
              type: "unknown" as const,
              input: toolInput("assignment_report"),
              output: toolOutput("assignment_report"),
            } as
              | { type: "unknown"; input: unknown; output: unknown }
              | { type: "plain_text"; text: string },
          },
        },
      ],
    },
  ];
}

function toolInput(name: string): Record<string, unknown> {
  if (name === "mission_plan") {
    return { missionId: "mission-current", expectedRevision: 1, expectedPlanRevision: 0 };
  }
  if (name === "assign_task") {
    return { missionId: "mission-current", expectedRevision: 2, expectedPlanRevision: 1 };
  }
  if (name === "assignment_report") {
    return {
      missionId: "mission-current",
      assignmentId: "assignment-current",
      expectedRevision: 7,
      expectedAssignmentRevision: 2,
    };
  }
  if (name === "team_member_history") {
    return { missionId: "mission-current", memberId: "member-worker" };
  }
  if (name === "team_message") {
    return { missionId: "mission-current", recipient: "member-worker" };
  }
  return { missionId: "mission-current" };
}

function toolOutput(name: string): Record<string, unknown> {
  const mission = {
    id: "mission-current",
    teamId: "team-current",
    revision: name === "mission_plan" ? 2 : 8,
    planRevision: 1,
  };
  if (name === "team_status") {
    return {
      missionId: "mission-current",
      missionStatus: "active",
      team: { id: "team-current" },
      callerMemberId: "member-lead",
    };
  }
  if (name === "mission_plan") return mission;
  if (name === "assign_task") {
    return {
      mission,
      assignments: [
        {
          assignmentId: "assignment-current",
          revision: 2,
          planRevision: 1,
          assigneeMemberId: "member-worker",
          runtimeAgentId: "agent-worker",
          bindingEpoch: 2,
        },
      ],
    };
  }
  if (name === "assignment_report") {
    return {
      mission,
      assignment: { ...toolMissionFixture().assignments[0], revision: 3 },
    };
  }
  if (name === "team_member_history") {
    return {
      missionId: "mission-current",
      member: { memberId: "member-worker" },
      participant: { memberId: "member-worker", agentId: "agent-worker", bindingEpoch: 2 },
    };
  }
  if (name === "team_message") {
    return { senderMemberId: "member-lead", recipientMemberId: "member-worker" };
  }
  return { mission };
}

function runtimeMissionFixture() {
  return {
    id: "mission-current",
    status: "completed",
    attentionItems: [],
    assignments: [{ assignmentId: "assignment-current" }],
  };
}

function makeAssignment(
  assignmentId: string,
  kind: "delivery" | "review" | "verification",
  workstreamId: string,
  assigneeMemberId: string,
  mutableScope: { kind: "read_only" } | { kind: "paths"; pathPrefixes: string[] },
  dependencyAssignmentIds: string[],
  dispatchedSecond: number,
  settledSecond: number,
) {
  const timestamp = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
  return {
    assignmentId,
    kind,
    workstreamId,
    assigneeMemberId,
    mutableScope,
    dependencyAssignmentIds,
    subjectAssignmentIds: [...dependencyAssignmentIds],
    planRevision: 1,
    semanticState: "completed" as const,
    report: { status: "completed" as const, verdict: "approved" as "approved" | "rejected" },
    dispatchedAt: timestamp(dispatchedSecond),
    settledAt: timestamp(settledSecond),
  };
}
