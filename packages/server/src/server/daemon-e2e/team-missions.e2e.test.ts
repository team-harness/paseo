import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { experimental_createMCPClient } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import {
  MissionAssignmentContractSchema,
  TeamMissionSchema,
  type MissionAssignmentContract,
  type TeamMission,
} from "@getpaseo/protocol/team/v2-types";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import {
  TeamMissionsTestProvider,
  type AcceptedTestProviderTurn,
} from "./team-missions-test-provider.js";
import { StoredMissionSchema } from "../team/persistence/schemas.js";
import { testCreateMember, testCreateMethodologyBinding } from "../team/test-fixtures.js";

interface McpToolResult {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string; structuredContent?: Record<string, unknown> }>;
  isError?: boolean;
}

interface McpClient {
  callTool(input: { name: string; args?: Record<string, unknown> }): Promise<McpToolResult>;
  close(): Promise<void>;
}

describe("Team Missions real-daemon WebSocket contract", () => {
  const clients = new Set<DaemonClient>();
  const daemons = new Set<TestPaseoDaemon>();
  const mcpClients = new Set<McpClient>();
  const temporaryPaths = new Set<string>();

  afterEach(async () => {
    await Promise.all([...mcpClients].map(closeIgnoringErrors));
    await Promise.all([...clients].map(closeIgnoringErrors));
    await Promise.all([...daemons].map(closeIgnoringErrors));
    await Promise.all(
      [...temporaryPaths].map((target) => rm(target, { recursive: true, force: true })),
    );
    clients.clear();
    daemons.clear();
    mcpClients.clear();
    temporaryPaths.clear();
  }, 60_000);

  test("replays, replies, and pages through a Mission Room", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-team-room-home-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-team-room-workspace-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot, stdio: "ignore" });
    temporaryPaths.add(paseoHomeRoot);
    temporaryPaths.add(workspaceRoot);
    const provider = new TeamMissionsTestProvider();
    const daemon = await createTeamDaemon({ paseoHomeRoot, provider });
    daemons.add(daemon);
    temporaryPaths.add(daemon.staticDir);

    const client = await connectTeamClient(daemon);
    clients.add(client);
    const workspace = await client.createWorkspace({
      source: { kind: "directory", path: workspaceRoot },
      title: "Team Room replay E2E",
    });
    if (!workspace.workspace) throw new Error(workspace.error ?? "Workspace creation failed");
    const members = [
      testCreateMember("technical-lead", member("Technical lead", 5, ["coordination"])),
    ];
    const skills = [{ skillId: "coordination", name: "Coordination", description: null }];
    const created = await client.createTeamProfile({
      idempotencyKey: "team-room-replay-create",
      name: "Room replay team",
      creationWorkspaceId: workspace.workspace.id,
      skills,
      leadClientMemberKey: "technical-lead",
      members,
      methodologyBinding: testCreateMethodologyBinding(
        members.map((candidate) => candidate.clientMemberKey),
        skills.map((skill) => skill.skillId),
      ),
    });
    if (!created.team) throw new Error(created.error ?? "Team creation failed");
    const started = await client.startTeamMission({
      idempotencyKey: "team-room-replay-start",
      teamId: created.team.id,
      expectedTeamRevision: created.team.revision,
      expectedMethodologyRef: created.team.methodologyBinding.ref,
      workspaceId: workspace.workspace.id,
      objective: "Verify Room message retry idempotency",
      constraints: [],
      acceptanceCriteria: ["The Room contains one copy of a retried message"],
    });
    if (!started.mission) throw new Error(started.error ?? "Mission start failed");

    const post = {
      requestId: "team-room-replay-post",
      missionId: started.mission.id,
      body: "What is the current status?",
    };
    const first = await client.postTeamMissionMessage(post);
    const replay = await client.postTeamMissionMessage(post);
    expect(first).toMatchObject({ error: null, errorCode: null });
    expect(replay).toEqual(first);
    if (!first.message) throw new Error("First Room message was not persisted");

    const second = await client.postTeamMissionMessage({
      requestId: "team-room-replay-second",
      missionId: started.mission.id,
      body: "The implementation is ready.",
    });
    expect(second).toMatchObject({ error: null, errorCode: null });
    const reply = await client.postTeamMissionMessage({
      requestId: "team-room-replay-reply",
      missionId: started.mission.id,
      body: "Thanks, please continue.",
      replyToMessageId: first.message.id,
    });
    expect(reply).toMatchObject({
      error: null,
      errorCode: null,
      message: { replyToMessageId: first.message.id },
    });

    const latest = await client.subscribeTeamMissionRoom({
      requestId: "team-room-replay-latest",
      missionId: started.mission.id,
      limit: 2,
    });
    expect(latest).toMatchObject({ error: null, errorCode: null, cursor: 3 });
    expect(latest.messages.map((message) => message.id)).toEqual([
      second.message?.id,
      reply.message?.id,
    ]);

    const older = await client.subscribeTeamMissionRoom({
      requestId: "team-room-replay-older",
      missionId: started.mission.id,
      afterCursor: 0,
      limit: 1,
    });
    expect(older).toMatchObject({ error: null, errorCode: null, cursor: 1 });
    expect(older.messages).toEqual([first.message]);
  }, 30_000);

  // eslint-disable-next-line complexity -- This test preserves one real Mission lifecycle.
  test("isolates a review-gate blocker to one fork of a real-daemon Workstream DAG", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-team-attention-home-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-team-attention-workspace-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot, stdio: "ignore" });
    temporaryPaths.add(paseoHomeRoot);
    temporaryPaths.add(workspaceRoot);
    const provider = new TeamMissionsTestProvider();
    const daemonErrors: string[] = [];
    const daemon = await createTeamDaemon({ paseoHomeRoot, provider, errorLog: daemonErrors });
    daemons.add(daemon);
    temporaryPaths.add(daemon.staticDir);

    const client = await connectTeamClient(daemon);
    clients.add(client);
    const workspaceResult = await client.createWorkspace({
      source: { kind: "directory", path: workspaceRoot },
      title: "Scoped Attention E2E",
    });
    const workspaceId = workspaceResult.workspace?.id;
    if (!workspaceId) throw new Error(workspaceResult.error ?? "Workspace creation failed");

    const members = [
      testCreateMember("technical-lead", member("Technical lead", 5, ["integration"])),
      testCreateMember("backend-engineer", member("Backend engineer", 4, ["backend"])),
      testCreateMember("frontend-engineer", member("Frontend engineer", 4, ["frontend"])),
      testCreateMember("quality-engineer", member("Quality engineer", 4, ["verification"])),
    ];
    const skills = [
      { skillId: "backend", name: "Backend", description: null },
      { skillId: "frontend", name: "Frontend", description: null },
      { skillId: "integration", name: "Integration", description: null },
      { skillId: "verification", name: "Verification", description: null },
      { skillId: "audit", name: "Audit", description: null },
    ];
    const created = await client.createTeamProfile({
      idempotencyKey: "team-scoped-attention-create",
      name: "Scoped Attention team",
      creationWorkspaceId: workspaceId,
      skills,
      leadClientMemberKey: "technical-lead",
      members,
      methodologyBinding: testCreateMethodologyBinding(
        members.map((candidate) => candidate.clientMemberKey),
        skills.map((skill) => skill.skillId),
      ),
    });
    if (!created.team) throw new Error(created.error ?? "Team creation failed");
    const team = created.team;
    const started = await client.startTeamMission({
      idempotencyKey: "team-scoped-attention-start",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      expectedMethodologyRef: team.methodologyBinding.ref,
      workspaceId,
      objective: "Keep the frontend fork running while backend review is blocked",
      constraints: ["Use disjoint delivery scopes"],
      acceptanceCriteria: ["Scoped review blockers do not pause unrelated work"],
    });
    if (!started.mission) throw new Error(started.error ?? "Mission start failed");
    const initialMission = started.mission;
    await provider.waitForTurns(
      (turns) => turns.length === 1 && turns[0]?.state === "running",
      "Lead briefing acceptance",
    );
    await provider.completeTurn(provider.turns[0]!.turnId);

    const mcpFor = async (agentId: string): Promise<McpClient> => {
      const mcp = await createMcpClient(
        `http://127.0.0.1:${daemon.port}/mcp/agents?callerAgentId=${encodeURIComponent(agentId)}`,
      );
      mcpClients.add(mcp);
      return mcp;
    };
    const leadMcp = await mcpFor(initialMission.participants[0]!.agentId);
    const planDrafts = missionPlanDrafts();
    const backendDraft = planDrafts.find((draft) => draft.workstreamId === "backend");
    if (!backendDraft) throw new Error("Backend Workstream draft is missing");
    backendDraft.reviewerRequirements = {
      requiredSkillIds: ["audit"],
      preferredSkillIds: [],
      requiredRuntimeCapabilityIds: ["structured-tools"],
      minimumLevel: 4,
    };
    const planResult = await leadMcp.callTool({
      name: "mission_plan",
      args: {
        missionId: initialMission.id,
        expectedRevision: initialMission.revision,
        expectedPlanRevision: 0,
        workstreams: planDrafts,
      },
    });
    if (planResult.isError) throw new Error(toolErrorText(planResult));
    const planned = TeamMissionSchema.parse(requireToolSuccess(planResult));
    expect(
      planned.workstreams.find((item) => item.workstreamId === "backend")?.reviewGate,
    ).toMatchObject({ kind: "required", selection: { kind: "awaiting_reviewer" } });

    const assignResult = await leadMcp.callTool({
      name: "assign_task",
      args: {
        missionId: planned.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: planned.planRevision,
        assignments: [
          deliveryDraft("backend"),
          deliveryDraft("frontend"),
          deliveryDraft("integration"),
        ],
      },
    });
    if (assignResult.isError) throw new Error(toolErrorText(assignResult));
    const parallel = await waitForMission(
      client,
      planned.id,
      hasTwoRunningDeliveries,
      "parallel delivery dispatch before scoped blocker",
    );
    const backend = requireAssignment(parallel, "backend");
    const frontend = requireAssignment(parallel, "frontend");
    await reportAssignment({
      client,
      mcp: await mcpFor(requireRuntimeAgentId(backend)),
      errorLog: daemonErrors,
      missionId: parallel.id,
      assignmentId: backend.assignmentId,
      report: completedReport({
        summary: "Backend delivery completed",
        artifactPaths: [],
        verdict: null,
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(backend));

    const isolated = await waitForMission(
      client,
      parallel.id,
      hasOpenBackendReviewAttention,
      "Workstream-scoped review gate Attention",
    );
    expect(isolated).toMatchObject({ status: "active", suspendedStatus: null, completedAt: null });
    expect(
      isolated.workstreams.map((workstream) => [workstream.workstreamId, workstream.status]),
    ).toEqual([
      ["backend", "blocked"],
      ["frontend", "active"],
      ["integration", "blocked"],
      ["final-verification", "blocked"],
    ]);
    expect(
      isolated.assignments.find((item) => item.assignmentId === frontend.assignmentId),
    ).toMatchObject({
      semanticState: "running",
      acceptedTurnId: frontend.acceptedTurnId,
    });
    expect(provider.turns.find((turn) => turn.turnId === frontend.acceptedTurnId)?.state).toBe(
      "running",
    );

    const reviewAttention = isolated.attentionItems.find(
      (attention) =>
        attention.status === "open" &&
        attention.kind === "review_gate_reviewer_unavailable" &&
        attention.scope.kind === "workstream" &&
        attention.scope.workstreamId === "backend",
    );
    if (!reviewAttention || reviewAttention.kind !== "review_gate_reviewer_unavailable") {
      throw new Error("Known-empty backend review Attention is missing");
    }
    const limitedClient = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.3.0-beta.3",
      clientId: "limited-physical-source",
      capabilities: { team_missions: false },
    });
    clients.add(limitedClient);
    await limitedClient.connect();
    await limitedClient.fetchAgents({ subscribe: { subscriptionId: "limited-source" } });
    const denied = await limitedClient.resolveTeamMissionAttention({
      missionId: isolated.id,
      attentionId: reviewAttention.attentionId,
      expectedRevision: isolated.revision,
      idempotencyKey: "waive-backend-from-limited-source",
      resolution: {
        kind: "waive_review",
        gateKeyFingerprint: reviewAttention.reviewGateDetails.gateKeyFingerprint,
        subjectFingerprint: reviewAttention.reviewGateDetails.subjectFingerprint,
        reason: "No independent reviewer has the frozen audit capability.",
      },
    });
    expect(denied).toMatchObject({ mission: null, errorCode: "unsupported" });

    const deniedRefresh = await limitedClient.refreshTeamMissionCapabilities({
      missionId: isolated.id,
      attentionId: reviewAttention.attentionId,
      expectedRevision: isolated.revision,
      idempotencyKey: "refresh-backend-from-limited-source",
    });
    expect(deniedRefresh).toMatchObject({ result: null, errorCode: "unsupported" });

    const currentBeforeRefresh = await inspectMission(client, isolated.id);
    const originalRoster = currentBeforeRefresh.rosterSnapshots.find(
      (snapshot) => snapshot.revision === currentBeforeRefresh.activeRosterSnapshotRevision,
    );
    if (!originalRoster) throw new Error("Original active roster snapshot is missing");
    const missionPath = path.join(
      daemon.paseoHome,
      "team-missions",
      "missions",
      `${isolated.id}.json`,
    );
    const staleStored = StoredMissionSchema.parse(JSON.parse(await readFile(missionPath, "utf8")));
    const staleRoster = staleStored.mission.rosterSnapshots.find(
      (snapshot) => snapshot.revision === staleStored.mission.activeRosterSnapshotRevision,
    );
    if (!staleRoster) throw new Error("Active roster snapshot is missing from the aggregate");
    const staleLead = staleRoster.members.find(
      (candidate) => candidate.memberId === team.leadMemberId,
    );
    if (!staleLead) throw new Error("Lead is missing from the active roster snapshot");
    staleLead.capabilityFacts = {
      kind: "unknown",
      providerId: staleLead.executionProfile.provider,
      reason: "provider_declaration_unavailable",
    };
    await writeFile(missionPath, JSON.stringify(staleStored, null, 2), "utf8");
    const frozenBeforeRefresh = {
      planRevision: currentBeforeRefresh.planRevision,
      workstreams: currentBeforeRefresh.workstreams,
      assignments: currentBeforeRefresh.assignments,
      participants: currentBeforeRefresh.participants,
      attentionItems: currentBeforeRefresh.attentionItems,
    };
    const refreshResponse = await client.refreshTeamMissionCapabilities({
      missionId: isolated.id,
      attentionId: reviewAttention.attentionId,
      expectedRevision: currentBeforeRefresh.revision,
      idempotencyKey: "refresh-backend-capabilities",
    });
    if (!refreshResponse.result || refreshResponse.result.disposition !== "replan_requested") {
      throw new Error(refreshResponse.error ?? "Controller capability refresh failed");
    }
    const refreshed = await inspectMission(client, isolated.id);
    const storedAfterRefresh = StoredMissionSchema.parse(
      JSON.parse(await readFile(missionPath, "utf8")),
    );
    expect(storedAfterRefresh.storageRevision).toBe(staleStored.storageRevision + 1);
    expect(refreshed.activeRosterSnapshotRevision).toBe(
      currentBeforeRefresh.activeRosterSnapshotRevision + 1,
    );
    const replanRequest = refreshed.capabilityReplanRequests.at(-1);
    expect(refreshResponse.result).toMatchObject({
      rosterSnapshotRevision: currentBeforeRefresh.activeRosterSnapshotRevision + 1,
      sourceAttentionIds: [reviewAttention.attentionId],
    });
    expect(refreshed.rosterSnapshots).toHaveLength(currentBeforeRefresh.rosterSnapshots.length + 1);
    expect(refreshed.rosterSnapshots.at(-1)).toMatchObject({
      revision: currentBeforeRefresh.activeRosterSnapshotRevision + 1,
      reason: "replan",
    });
    const refreshedLead = refreshed.rosterSnapshots
      .at(-1)
      ?.members.find((candidate) => candidate.memberId === team.leadMemberId);
    expect(refreshedLead?.capabilityFacts).toEqual(
      originalRoster.members.find((candidate) => candidate.memberId === team.leadMemberId)
        ?.capabilityFacts,
    );
    expect(replanRequest).toMatchObject({
      requestId: refreshResponse.result.requestId,
      consumedAt: null,
      rosterSnapshotRevision: currentBeforeRefresh.activeRosterSnapshotRevision + 1,
    });
    expect(
      storedAfterRefresh.recipientAttentionOutbox.filter(
        (delivery) => delivery.deliveryId === replanRequest?.deliveryId,
      ),
    ).toEqual([
      expect.objectContaining({
        recipientMemberId: team.leadMemberId,
        senderMemberId: team.leadMemberId,
        bindingEpoch: 1,
        body: expect.stringContaining("mission_status"),
      }),
    ]);
    expect({
      planRevision: refreshed.planRevision,
      workstreams: refreshed.workstreams,
      assignments: refreshed.assignments,
      participants: refreshed.participants,
      attentionItems: refreshed.attentionItems,
    }).toEqual(frozenBeforeRefresh);

    const persistedOriginalRoster = storedAfterRefresh.mission.rosterSnapshots.find(
      (snapshot) => snapshot.revision === currentBeforeRefresh.activeRosterSnapshotRevision,
    );
    if (!persistedOriginalRoster) {
      throw new Error("Original roster snapshot is missing after capability refresh");
    }
    for (const rosterMember of persistedOriginalRoster.members) {
      const originalMember = originalRoster.members.find(
        (candidate) => candidate.memberId === rosterMember.memberId,
      );
      if (!originalMember) {
        throw new Error(`Original roster Member ${rosterMember.memberId} is missing`);
      }
      rosterMember.capabilityFacts = structuredClone(originalMember.capabilityFacts);
    }
    await writeFile(missionPath, JSON.stringify(storedAfterRefresh, null, 2), "utf8");

    const currentBeforeWaiver = await inspectMission(client, isolated.id);
    const waivedResponse = await client.resolveTeamMissionAttention({
      missionId: isolated.id,
      attentionId: reviewAttention.attentionId,
      expectedRevision: currentBeforeWaiver.revision,
      idempotencyKey: "waive-backend-review",
      resolution: {
        kind: "waive_review",
        gateKeyFingerprint: reviewAttention.reviewGateDetails.gateKeyFingerprint,
        subjectFingerprint: reviewAttention.reviewGateDetails.subjectFingerprint,
        reason: "No independent reviewer has the frozen audit capability.",
      },
    });
    if (!waivedResponse.mission) {
      throw new Error(waivedResponse.error ?? "Controller review waiver failed");
    }
    expect(
      waivedResponse.mission.workstreams.find((item) => item.workstreamId === "backend"),
    ).toMatchObject({ status: "accepted", reviewGate: { outcome: { kind: "waived" } } });
    expect(waivedResponse.mission.reviewWaivers).toContainEqual(
      expect.objectContaining({
        attentionId: reviewAttention.attentionId,
        selfReportedClientLabel: expect.stringMatching(/^clid_test_client_/),
        reason: "No independent reviewer has the frozen audit capability.",
      }),
    );

    await reportAssignment({
      client,
      mcp: await mcpFor(requireRuntimeAgentId(frontend)),
      errorLog: daemonErrors,
      missionId: waivedResponse.mission.id,
      assignmentId: frontend.assignmentId,
      report: completedReport({
        summary: "Frontend delivery completed",
        artifactPaths: [],
        verdict: null,
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(frontend));
    const integrating = await waitForMission(
      client,
      isolated.id,
      hasRunningIntegration,
      "integration dispatch after waived review",
    );
    const integration = requireAssignment(integrating, "integration");
    await reportAssignment({
      client,
      mcp: leadMcp,
      errorLog: daemonErrors,
      missionId: integrating.id,
      assignmentId: integration.assignmentId,
      report: completedReport({
        summary: "Integration completed after the scoped review waiver",
        artifactPaths: [],
        verdict: null,
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(integration));
    const verifying = await waitForMission(
      client,
      isolated.id,
      hasRunningVerification,
      "final verification after waived review",
    );
    const verification = requireKindAssignment(verifying, "verification");
    expect(verification.reviewGateEvidence).toContainEqual(
      expect.objectContaining({
        kind: "waived",
        reason: "No independent reviewer has the frozen audit capability.",
      }),
    );
    await reportAssignment({
      client,
      mcp: await mcpFor(requireRuntimeAgentId(verification)),
      errorLog: daemonErrors,
      missionId: verifying.id,
      assignmentId: verification.assignmentId,
      report: finalVerificationReport(
        verification,
        "approved",
        "Final verification completed after the scoped review waiver",
      ),
    });
    await provider.completeTurn(requireAcceptedTurnId(verification));
    const completed = await waitForMission(
      client,
      isolated.id,
      isCompletedAndArchived,
      "Mission completion after required final verification",
      30_000,
    );
    expect(
      completed.assignments.find((item) => item.assignmentId === verification.assignmentId),
    ).toMatchObject({
      report: {
        finalVerificationEvidence: {
          verdict: "approved",
          reviewGateEvidence: [
            expect.objectContaining({
              kind: "waived",
              reason: "No independent reviewer has the frozen audit capability.",
            }),
          ],
        },
      },
    });
  }, 30_000);

  test("keeps a known-empty final verifier gate waiting with zero verification Assignments", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-final-waiting-home-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-final-waiting-workspace-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot, stdio: "ignore" });
    temporaryPaths.add(paseoHomeRoot);
    temporaryPaths.add(workspaceRoot);
    const provider = new TeamMissionsTestProvider();
    const daemonErrors: string[] = [];
    const daemon = await createTeamDaemon({ paseoHomeRoot, provider, errorLog: daemonErrors });
    daemons.add(daemon);
    temporaryPaths.add(daemon.staticDir);
    const client = await connectTeamClient(daemon);
    clients.add(client);
    const workspace = await client.createWorkspace({
      source: { kind: "directory", path: workspaceRoot },
      title: "Final verifier waiting E2E",
    });
    if (!workspace.workspace) throw new Error(workspace.error ?? "Workspace creation failed");
    const members = [
      testCreateMember("technical-lead", member("Technical lead", 5, ["backend"])),
      testCreateMember("backend-engineer", member("Backend engineer", 4, ["backend"])),
    ];
    const skills = [
      { skillId: "backend", name: "Backend", description: null },
      { skillId: "verification", name: "Verification", description: null },
    ];
    const created = await client.createTeamProfile({
      idempotencyKey: "team-final-waiting-create",
      name: "Final waiting team",
      creationWorkspaceId: workspace.workspace.id,
      skills,
      leadClientMemberKey: "technical-lead",
      members,
      methodologyBinding: testCreateMethodologyBinding(
        members.map((candidate) => candidate.clientMemberKey),
        skills.map((skill) => skill.skillId),
      ),
    });
    if (!created.team) throw new Error(created.error ?? "Team creation failed");
    const started = await client.startTeamMission({
      idempotencyKey: "team-final-waiting-start",
      teamId: created.team.id,
      expectedTeamRevision: created.team.revision,
      expectedMethodologyRef: created.team.methodologyBinding.ref,
      workspaceId: workspace.workspace.id,
      objective: "Deliver backend work and require final verification",
      constraints: [],
      acceptanceCriteria: ["Final verifier remains mandatory"],
    });
    if (!started.mission) throw new Error(started.error ?? "Mission start failed");
    await provider.waitForTurns(
      (turns) => turns.length === 1 && turns[0]?.state === "running",
      "Lead briefing acceptance",
    );
    await provider.completeTurn(provider.turns[0]!.turnId);
    const leadMcp = await createMcpClient(
      `http://127.0.0.1:${daemon.port}/mcp/agents?callerAgentId=${encodeURIComponent(started.mission.participants[0]!.agentId)}`,
    );
    mcpClients.add(leadMcp);
    const drafts = [
      workstreamDraft({
        workstreamId: "backend",
        kind: "delivery",
        skillId: "backend",
        scope: { kind: "paths", pathPrefixes: ["src/backend"] },
        dependencies: [],
        review: false,
      }),
      workstreamDraft({
        workstreamId: "final-verification",
        kind: "verification",
        skillId: "verification",
        scope: { kind: "read_only" },
        dependencies: ["backend"],
        review: false,
      }),
    ];
    const planResult = await leadMcp.callTool({
      name: "mission_plan",
      args: {
        missionId: started.mission.id,
        expectedRevision: started.mission.revision,
        expectedPlanRevision: 0,
        workstreams: drafts,
      },
    });
    if (planResult.isError) throw new Error(toolErrorText(planResult));
    const planned = TeamMissionSchema.parse(requireToolSuccess(planResult));
    expect(planned.workstreams.find((item) => item.kind === "verification")).toMatchObject({
      finalVerificationGate: { selection: { kind: "awaiting_verifier" } },
    });
    const assignedResult = await leadMcp.callTool({
      name: "assign_task",
      args: {
        missionId: planned.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: planned.planRevision,
        assignments: [deliveryDraft("backend")],
      },
    });
    if (assignedResult.isError) throw new Error(toolErrorText(assignedResult));
    const running = await waitForMission(
      client,
      planned.id,
      (mission) => hasRunningAssignment(mission, "delivery"),
      "backend dispatch",
    );
    const backend = requireAssignment(running, "backend");
    const backendMcp = await createMcpClient(
      `http://127.0.0.1:${daemon.port}/mcp/agents?callerAgentId=${encodeURIComponent(requireRuntimeAgentId(backend))}`,
    );
    mcpClients.add(backendMcp);
    await reportAssignment({
      client,
      mcp: backendMcp,
      errorLog: daemonErrors,
      missionId: running.id,
      assignmentId: backend.assignmentId,
      report: completedReport({
        summary: "Backend delivery completed",
        artifactPaths: [],
        verdict: null,
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(backend));
    const waiting = await waitForMission(
      client,
      running.id,
      hasOpenFinalVerifierUnavailableAttention,
      "final verifier unavailable Attention",
    );
    expect(waiting).toMatchObject({ status: "active", completedAt: null });
    expect(currentVerificationAssignments(waiting)).toEqual([]);
    expect(waiting.assignments.filter((assignment) => assignment.kind === "verification")).toEqual(
      [],
    );
  }, 30_000);

  test("coordinates a lazy, parallel DAG through WebSocket and agent-scoped MCP", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-team-flow-home-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-team-flow-workspace-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot, stdio: "ignore" });
    temporaryPaths.add(paseoHomeRoot);
    temporaryPaths.add(workspaceRoot);
    const provider = new TeamMissionsTestProvider();
    const daemonErrors: string[] = [];
    const daemon = await createTeamDaemon({ paseoHomeRoot, provider, errorLog: daemonErrors });
    daemons.add(daemon);
    temporaryPaths.add(daemon.staticDir);

    const client = await connectTeamClient(daemon);
    clients.add(client);
    const workspaceResult = await client.createWorkspace({
      source: { kind: "directory", path: workspaceRoot },
      title: "Team Mission E2E",
    });
    expect(workspaceResult.error).toBeNull();
    expect(workspaceResult.workspace).not.toBeNull();
    const workspaceId = workspaceResult.workspace!.id;

    const leadClientMemberKey = "technical-lead";
    const members = [
      testCreateMember(leadClientMemberKey, member("Technical lead", 5, ["integration"])),
      testCreateMember("backend-engineer", member("Backend engineer", 4, ["backend"])),
      testCreateMember("frontend-engineer", member("Frontend engineer", 4, ["frontend"])),
      testCreateMember("quality-engineer", member("Quality engineer", 4, ["verification"])),
    ];
    const skills = [
      { skillId: "backend", name: "Backend", description: null },
      { skillId: "frontend", name: "Frontend", description: null },
      { skillId: "integration", name: "Integration", description: null },
      { skillId: "verification", name: "Verification", description: null },
    ];
    const created = await client.createTeamProfile({
      idempotencyKey: "team-e2e-create",
      name: "Compiler delivery team",
      creationWorkspaceId: workspaceId,
      skills,
      leadClientMemberKey,
      members,
      methodologyBinding: testCreateMethodologyBinding(
        members.map((candidate) => candidate.clientMemberKey),
        skills.map((skill) => skill.skillId),
      ),
    });
    expect(created).toMatchObject({ error: null, errorCode: null });
    expect(created.team).not.toBeNull();
    expect(provider.sessions).toHaveLength(0);
    expect((await client.fetchAgents({ scope: "active" })).entries).toEqual([]);
    const team = created.team!;

    const started = await client.startTeamMission({
      idempotencyKey: "team-e2e-start",
      teamId: team.id,
      expectedTeamRevision: team.revision,
      expectedMethodologyRef: team.methodologyBinding.ref,
      workspaceId,
      objective: "Deliver independent backend and frontend changes, integrate, and verify",
      constraints: ["Use disjoint delivery scopes"],
      acceptanceCriteria: ["Backend, frontend, integration, review, and verification pass"],
    });
    expect(started).toMatchObject({ error: null, errorCode: null });
    expect(started.mission).not.toBeNull();
    const initialMission = started.mission!;
    const initialList = await client.listTeamMissions({ teamId: team.id, includeTerminal: true });
    expect(initialList).toMatchObject({ error: null, errorCode: null });
    expect(initialList.missions).toEqual([initialMission]);
    expect(initialMission.participants).toHaveLength(1);
    expect(initialMission.participants[0]?.memberId).toBe(team.leadMemberId);
    await provider.waitForTurns(
      (turns) => turns.length === 1 && turns[0]?.state === "running",
      "Lead briefing acceptance",
    );
    const briefingTurn = provider.turns[0]!;
    expect(briefingTurn.assignmentId).toBeNull();
    await provider.completeTurn(briefingTurn.turnId);

    const mcpByAgentId = new Map<string, McpClient>();
    const mcpFor = async (agentId: string): Promise<McpClient> => {
      const existing = mcpByAgentId.get(agentId);
      if (existing) return existing;
      const mcp = await createMcpClient(
        `http://127.0.0.1:${daemon.port}/mcp/agents?callerAgentId=${encodeURIComponent(agentId)}`,
      );
      mcpByAgentId.set(agentId, mcp);
      mcpClients.add(mcp);
      return mcp;
    };
    const leadAgentId = initialMission.participants[0]!.agentId;
    const leadMcp = await mcpFor(leadAgentId);
    const initialStatus = requireToolSuccess(
      await leadMcp.callTool({ name: "mission_status", args: { missionId: initialMission.id } }),
    );
    expect(TeamMissionSchema.parse(initialStatus.mission)).toMatchObject({
      id: initialMission.id,
      status: "planning",
      planRevision: 0,
    });

    const planDrafts = missionPlanDrafts();
    const planResult = await leadMcp.callTool({
      name: "mission_plan",
      args: {
        missionId: initialMission.id,
        expectedRevision: initialMission.revision,
        expectedPlanRevision: 0,
        workstreams: planDrafts,
      },
    });
    if (planResult.isError) {
      throw new Error(`${toolErrorText(planResult)}\n${daemonErrors.slice(-5).join("\n")}`);
    }
    const planned = TeamMissionSchema.parse(requireToolSuccess(planResult));
    const memberByRole = Object.fromEntries(
      team.members.map((candidate) => [candidate.role, candidate]),
    );
    expect(
      planned.workstreams.map((workstream) => [workstream.workstreamId, workstream.ownerMemberId]),
    ).toEqual([
      ["backend", memberByRole["Backend engineer"]?.memberId],
      ["frontend", memberByRole["Frontend engineer"]?.memberId],
      ["integration", team.leadMemberId],
      ["final-verification", memberByRole["Quality engineer"]?.memberId],
    ]);
    expect(
      planned.workstreams.find((workstream) => workstream.workstreamId === "backend"),
    ).toMatchObject({
      reviewGate: {
        kind: "required",
        selection: {
          kind: "assigned",
          reviewerMemberId: memberByRole["Quality engineer"]?.memberId,
        },
        outcome: { kind: "pending" },
      },
    });

    const assignResult = await leadMcp.callTool({
      name: "assign_task",
      args: {
        missionId: initialMission.id,
        expectedRevision: planned.revision,
        expectedPlanRevision: planned.planRevision,
        assignments: [
          deliveryDraft("backend"),
          deliveryDraft("frontend"),
          deliveryDraft("integration"),
        ],
      },
    });
    if (assignResult.isError) {
      throw new Error(`${toolErrorText(assignResult)}\n${daemonErrors.slice(-5).join("\n")}`);
    }
    const assignedPayload = requireToolSuccess(assignResult);
    const createdAssignments = MissionAssignmentContractSchema.array().parse(
      assignedPayload.assignments,
    );
    expect(createdAssignments.map((assignment) => assignment.workstreamId)).toEqual([
      "backend",
      "frontend",
      "integration",
    ]);

    const parallel = await waitForMission(
      client,
      initialMission.id,
      hasTwoRunningDeliveries,
      "parallel delivery dispatch",
    );
    const deliveryAssignments = parallel.assignments.filter(
      (assignment) =>
        assignment.workstreamId === "backend" || assignment.workstreamId === "frontend",
    );
    expect(deliveryAssignments).toHaveLength(2);
    expect(deliveryAssignments.every((assignment) => assignment.acceptedTurnId !== null)).toBe(
      true,
    );
    expect(
      parallel.participants.filter((participant) => participant.archivedAt === null),
    ).toHaveLength(3);
    expect(
      parallel.participants.some(
        (participant) => participant.memberId === memberByRole["Quality engineer"]?.memberId,
      ),
    ).toBe(false);
    await provider.waitForTurns(
      hasTwoRunningAssignmentTurns,
      "two provider turns active before either completes",
    );
    expect(
      provider
        .assignmentTurns()
        .map((turn) => turn.assignmentId)
        .toSorted(),
    ).toEqual(deliveryAssignments.map((assignment) => assignment.assignmentId).toSorted());

    const backend = requireAssignment(parallel, "backend");
    const backendMcp = await mcpFor(requireRuntimeAgentId(backend));
    const forbiddenPlan = await backendMcp.callTool({
      name: "mission_plan",
      args: {
        missionId: parallel.id,
        expectedRevision: parallel.revision,
        expectedPlanRevision: parallel.planRevision,
        workstreams: planDrafts,
      },
    });
    expect(forbiddenPlan.isError).toBe(true);
    expect(toolErrorText(forbiddenPlan)).toContain("lead_required");

    for (const assignment of deliveryAssignments) {
      const relativePath = `src/${assignment.workstreamId}/result.txt`;
      await provider.writeArtifact(
        requireAcceptedTurnId(assignment),
        relativePath,
        `${assignment.workstreamId} delivered`,
      );
      await reportAssignment({
        client,
        mcp: await mcpFor(requireRuntimeAgentId(assignment)),
        errorLog: daemonErrors,
        missionId: parallel.id,
        assignmentId: assignment.assignmentId,
        report: completedReport({
          summary: `${assignment.workstreamId} delivery completed`,
          artifactPaths: [relativePath],
          verdict: null,
        }),
      });
    }
    await Promise.all(
      deliveryAssignments.map((assignment) =>
        provider.completeTurn(requireAcceptedTurnId(assignment)),
      ),
    );

    const reviewing = await waitForMission(
      client,
      parallel.id,
      hasRunningReview,
      "independent review dispatch",
    );
    const review = requireKindAssignment(reviewing, "review");
    expect(review.mutableScope).toEqual({ kind: "read_only" });
    expect(review.assigneeMemberId).toBe(memberByRole["Quality engineer"]?.memberId);
    expect(
      reviewing.participants.some(
        (participant) =>
          participant.memberId === memberByRole["Quality engineer"]?.memberId &&
          participant.archivedAt === null,
      ),
    ).toBe(true);
    await reportAssignment({
      client,
      mcp: await mcpFor(requireRuntimeAgentId(review)),
      errorLog: daemonErrors,
      missionId: reviewing.id,
      assignmentId: review.assignmentId,
      report: completedReport({
        summary: "Independent backend review approved",
        artifactPaths: [],
        verdict: "approved",
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(review));

    const readyForIntegration = await waitForMission(
      client,
      reviewing.id,
      deliveryWorkstreamsAccepted,
      "delivery workstreams accepted",
    );

    const integrating = await waitForMission(
      client,
      readyForIntegration.id,
      hasRunningIntegration,
      "integration dispatch after dependencies",
    );
    const integration = requireAssignment(integrating, "integration");
    expect(integration.assigneeMemberId).toBe(team.leadMemberId);
    await provider.writeArtifact(
      requireAcceptedTurnId(integration),
      "src/integration/result.txt",
      "integration delivered",
    );
    await reportAssignment({
      client,
      mcp: leadMcp,
      errorLog: daemonErrors,
      missionId: integrating.id,
      assignmentId: integration.assignmentId,
      report: completedReport({
        summary: "Integration completed",
        artifactPaths: ["src/integration/result.txt"],
        verdict: null,
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(integration));

    const verifying = await waitForMission(
      client,
      integrating.id,
      hasRunningVerification,
      "final verification dispatch",
    );
    const verification = requireKindAssignment(verifying, "verification");
    const verificationWorkstream = verifying.workstreams.find(
      (workstream) => workstream.kind === "verification",
    );
    expect(verificationWorkstream?.finalVerificationGate).toMatchObject({
      selection: {
        kind: "assigned",
        verifierMemberId: verification.assigneeMemberId,
      },
      fingerprint: verification.finalVerificationGateFingerprint,
    });
    expect(currentVerificationAssignments(verifying)).toEqual([verification]);
    expect(verifying).toMatchObject({ status: "verifying", completedAt: null });
    const verificationMcp = await mcpFor(requireRuntimeAgentId(verification));
    const untypedReport = await verificationMcp.callTool({
      name: "assignment_report",
      args: {
        missionId: verifying.id,
        assignmentId: verification.assignmentId,
        expectedRevision: verifying.revision,
        expectedAssignmentRevision: verification.revision,
        report: completedReport({
          summary: "Generic approval must not satisfy final verification",
          artifactPaths: [],
          verdict: "approved",
        }),
      },
    });
    expect(untypedReport.isError).toBe(true);
    expect(toolErrorText(untypedReport)).toContain("invalid_assignment_report");
    await reportAssignment({
      client,
      mcp: verificationMcp,
      errorLog: daemonErrors,
      missionId: verifying.id,
      assignmentId: verification.assignmentId,
      report: finalVerificationReport(
        verification,
        "changes_requested",
        "Final verification requires a corrected integration proof",
      ),
    });
    await provider.completeTurn(requireAcceptedTurnId(verification));

    const changesRequested = await waitForMission(
      client,
      verifying.id,
      (mission) => hasFailedFinalVerification(mission, verification.assignmentId),
      "changes-requested final verification remains incomplete",
    );
    expect(changesRequested.completedAt).toBeNull();

    const replanResult = await leadMcp.callTool({
      name: "mission_plan",
      args: {
        missionId: changesRequested.id,
        expectedRevision: changesRequested.revision,
        expectedPlanRevision: changesRequested.planRevision,
        workstreams: missionPlanDrafts(),
      },
    });
    if (replanResult.isError) {
      throw new Error(`${toolErrorText(replanResult)}\n${daemonErrors.slice(-5).join("\n")}`);
    }
    const replanned = TeamMissionSchema.parse(requireToolSuccess(replanResult));
    const replacementVerifying = await waitForMission(
      client,
      replanned.id,
      (mission) =>
        currentVerificationAssignments(mission).length === 1 &&
        currentVerificationAssignments(mission)[0]?.semanticState === "running" &&
        currentVerificationAssignments(mission)[0]?.assignmentId !== verification.assignmentId,
      "replacement final verification dispatch",
    );
    const replacementVerification = currentVerificationAssignments(replacementVerifying)[0]!;
    expect(replacementVerification.mutableScope).toEqual({ kind: "read_only" });
    await reportAssignment({
      client,
      mcp: await mcpFor(requireRuntimeAgentId(replacementVerification)),
      errorLog: daemonErrors,
      missionId: replacementVerifying.id,
      assignmentId: replacementVerification.assignmentId,
      report: finalVerificationReport(
        replacementVerification,
        "approved",
        "Final verification approved every Mission criterion",
      ),
    });
    await provider.completeTurn(requireAcceptedTurnId(replacementVerification));

    let completed: TeamMission;
    try {
      completed = await waitForMission(
        client,
        replacementVerifying.id,
        isCompletedAndArchived,
        "Mission completion and participant archival",
        30_000,
      );
    } catch (error) {
      const stalled = await inspectMission(client, replacementVerifying.id);
      const stored = StoredMissionSchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              daemon.paseoHome,
              "team-missions",
              "missions",
              `${replacementVerifying.id}.json`,
            ),
            "utf8",
          ),
        ),
      );
      throw new Error(
        `${String(error)}\n${JSON.stringify(missionDiagnostic(stalled, stored), null, 2)}\n${daemonErrors.slice(-5).join("\n")}`,
        { cause: error },
      );
    }
    expect(currentVerificationAssignments(completed)).toHaveLength(1);
    expect(
      currentVerificationAssignments(completed)[0]?.report?.finalVerificationEvidence?.verdict,
    ).toBe("approved");
    expect(
      completed.assignments
        .filter((assignment) => assignment.assignmentId !== verification.assignmentId)
        .every(
          (assignment) =>
            assignment.semanticState === "completed" &&
            assignment.dispatchState === "settled" &&
            assignment.report?.status === "completed" &&
            assignment.acceptedTurnId !== null,
        ),
    ).toBe(true);
    expect(
      completed.assignments.find(
        (assignment) => assignment.assignmentId === verification.assignmentId,
      ),
    ).toMatchObject({
      semanticState: "canceled",
      supersededBy: replacementVerification.assignmentId,
      terminationReason: "superseded",
      report: {
        finalVerificationEvidence: { verdict: "changes_requested" },
      },
    });
    expect(completed.attentionItems.filter((item) => item.status === "open")).toEqual([]);
    expect(completed.attentionItems).toContainEqual(
      expect.objectContaining({
        kind: "assignment_requires_replan",
        status: "resolved",
        resolution: expect.objectContaining({ kind: "replan" }),
      }),
    );
    expect(provider.assignmentTurns()).toHaveLength(6);
    expect(
      provider
        .assignmentTurns()
        .map((turn) => turn.clientMessageId)
        .toSorted(),
    ).toEqual(
      completed.assignments
        .map(
          (assignment) =>
            `team-mission:${completed.id}:assignment:${assignment.assignmentId}:dispatch`,
        )
        .toSorted(),
    );
    expect(await readFile(path.join(workspaceRoot, "src/backend/result.txt"), "utf8")).toBe(
      "backend delivered",
    );
    expect(await readFile(path.join(workspaceRoot, "src/frontend/result.txt"), "utf8")).toBe(
      "frontend delivered",
    );
    expect(await readFile(path.join(workspaceRoot, "src/integration/result.txt"), "utf8")).toBe(
      "integration delivered",
    );

    await client.close();
    clients.delete(client);
    await daemon.close();
    daemons.delete(daemon);

    const restarted = await createTeamDaemon({
      paseoHomeRoot,
      provider: new TeamMissionsTestProvider(),
    });
    daemons.add(restarted);
    temporaryPaths.add(restarted.staticDir);
    const restartedClient = await connectTeamClient(restarted);
    clients.add(restartedClient);
    expect(restartedClient.supportsTeamMissions()).toBe(true);
    const persistedMission = await restartedClient.inspectTeamMission({ missionId: completed.id });
    expect(persistedMission).toMatchObject({ error: null, errorCode: null });
    expect(persistedMission.mission).toEqual(completed);
    const persistedTeam = await restartedClient.inspectTeamProfile({ teamId: team.id });
    expect(persistedTeam).toMatchObject({ error: null, errorCode: null });
    expect(persistedTeam.team).toMatchObject({
      id: team.id,
      activeMissionId: null,
      lifecycle: "active",
    });
    const cancelTarget = await restartedClient.startTeamMission({
      idempotencyKey: "team-e2e-cancel-target",
      teamId: team.id,
      expectedTeamRevision: persistedTeam.team!.revision,
      expectedMethodologyRef: persistedTeam.team!.methodologyBinding.ref,
      workspaceId,
      objective: "Prove Mission cancellation is externally durable",
      constraints: [],
      acceptanceCriteria: ["Cancellation reaches a terminal state"],
    });
    expect(cancelTarget).toMatchObject({ error: null, errorCode: null });
    expect(cancelTarget.mission).not.toBeNull();
    const canceled = await restartedClient.cancelTeamMission({
      idempotencyKey: "team-e2e-cancel",
      missionId: cancelTarget.mission!.id,
      expectedRevision: cancelTarget.mission!.revision,
      reason: "E2E cancellation contract",
    });
    expect(canceled).toMatchObject({ error: null, errorCode: null });
    expect(canceled.mission).toMatchObject({
      id: cancelTarget.mission!.id,
      status: "canceled",
    });
    const finalList = await restartedClient.listTeamMissions({
      teamId: team.id,
      includeTerminal: true,
    });
    expect(finalList.missions).toHaveLength(2);
    expect(finalList.missions.map((mission) => [mission.id, mission.status])).toEqual(
      expect.arrayContaining([
        [completed.id, "completed"],
        [cancelTarget.mission!.id, "canceled"],
      ]),
    );
  }, 90_000);
});

async function closeIgnoringErrors(resource: { close(): Promise<void> }): Promise<void> {
  try {
    await Promise.race([resource.close(), delay(2_000)]);
  } catch {
    // Cleanup is best effort; the assertion failure remains the primary error.
  }
}

function missionDiagnostic(
  mission: TeamMission,
  stored: ReturnType<typeof StoredMissionSchema.parse>,
) {
  return {
    status: mission.status,
    suspendedStatus: mission.suspendedStatus,
    workstreams: mission.workstreams.map((workstream) => ({
      id: workstream.workstreamId,
      status: workstream.status,
    })),
    assignments: mission.assignments.map((assignment) => ({
      id: assignment.assignmentId,
      kind: assignment.kind,
      workstreamId: assignment.workstreamId,
      semanticState: assignment.semanticState,
      dispatchState: assignment.dispatchState,
      acceptedTurnId: assignment.acceptedTurnId,
      report: assignment.report,
    })),
    attentionItems: mission.attentionItems,
    participants: mission.participants,
    ownershipIntervals: stored.ownershipIntervals,
    assignmentReportRecoveryOutbox: stored.assignmentReportRecoveryOutbox,
    acceptedTurnFacts: stored.acceptedTurnFacts,
    assignmentDispatchIntents: stored.assignmentDispatchIntents,
    finishIntent: stored.finishIntent,
  };
}

function hasTwoRunningDeliveries(mission: TeamMission): boolean {
  let count = 0;
  for (const assignment of mission.assignments) {
    if (assignment.kind === "delivery" && assignment.semanticState === "running") count += 1;
  }
  return count === 2;
}

function hasTwoRunningAssignmentTurns(turns: readonly AcceptedTestProviderTurn[]): boolean {
  let count = 0;
  for (const turn of turns) {
    if (turn.assignmentId !== null && turn.state === "running") count += 1;
  }
  return count === 2;
}

function hasRunningReview(mission: TeamMission): boolean {
  return hasRunningAssignment(mission, "review");
}

function hasRunningVerification(mission: TeamMission): boolean {
  return hasRunningAssignment(mission, "verification");
}

function hasRunningAssignment(
  mission: TeamMission,
  kind: MissionAssignmentContract["kind"],
): boolean {
  for (const assignment of mission.assignments) {
    if (assignment.kind === kind && assignment.semanticState === "running") return true;
  }
  return false;
}

function deliveryWorkstreamsAccepted(mission: TeamMission): boolean {
  let backendAccepted = false;
  let frontendAccepted = false;
  for (const workstream of mission.workstreams) {
    if (workstream.workstreamId === "backend") backendAccepted = workstream.status === "accepted";
    if (workstream.workstreamId === "frontend") frontendAccepted = workstream.status === "accepted";
  }
  return backendAccepted && frontendAccepted;
}

function hasRunningIntegration(mission: TeamMission): boolean {
  for (const assignment of mission.assignments) {
    if (assignment.workstreamId === "integration" && assignment.semanticState === "running") {
      return true;
    }
  }
  return false;
}

function hasOpenBackendReviewAttention(mission: TeamMission): boolean {
  return mission.attentionItems.some(
    (item) =>
      item.status === "open" &&
      item.kind === "review_gate_reviewer_unavailable" &&
      item.scope.workstreamId === "backend",
  );
}

function isCompletedAndArchived(mission: TeamMission): boolean {
  if (mission.status !== "completed") return false;
  for (const participant of mission.participants) {
    if (participant.archivedAt === null) return false;
  }
  return true;
}

async function createTeamDaemon(input: {
  paseoHomeRoot: string;
  provider: TeamMissionsTestProvider;
  errorLog?: string[];
}): Promise<TestPaseoDaemon> {
  return createTestPaseoDaemon({
    paseoHomeRoot: input.paseoHomeRoot,
    cleanup: false,
    agentClients: { claude: input.provider },
    logger: input.errorLog
      ? pino({ level: "error" }, { write: (message) => input.errorLog?.push(message) })
      : undefined,
    teamMissionsRuntime: {
      enabled: true,
      reconcileIntervalMs: 60_000,
      toolIds: [
        "team_status",
        "mission_status",
        "team_member_history",
        "mission_plan",
        "assign_task",
        "assignment_report",
        "team_message",
        "chat_read",
      ],
    },
  });
}

async function connectTeamClient(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.3.0-beta.3",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: { subscriptionId: "team-missions-main-flow" } });
  expect(client.supportsTeamMissions()).toBe(true);
  return client;
}

async function createMcpClient(url: string): Promise<McpClient> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const rawClient = await experimental_createMCPClient({ transport });
  const callTool = Reflect.get(rawClient, "callTool").bind(rawClient) as McpClient["callTool"];
  return { callTool, close: () => rawClient.close() };
}

function requireToolSuccess(result: McpToolResult): Record<string, unknown> {
  if (result.isError) throw new Error(`Team MCP tool failed: ${toolErrorText(result)}`);
  if (result.structuredContent) return result.structuredContent;
  const nested = result.content?.find((item) => item.structuredContent)?.structuredContent;
  if (nested) return nested;
  throw new Error("Team MCP tool returned no structured content");
}

function toolErrorText(result: McpToolResult): string {
  return result.content?.map((item) => item.text ?? "").join("\n") ?? "";
}

async function waitForMission(
  client: DaemonClient,
  missionId: string,
  predicate: (mission: TeamMission) => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<TeamMission> {
  return new Promise<TeamMission>((resolve, reject) => {
    let settled = false;
    const finish = (mission: TeamMission): void => {
      if (settled || !predicate(mission)) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve(mission);
    };
    const unsubscribe = client.on("team.mission.snapshot", (message) => {
      if (message.payload.mission.id === missionId) finish(message.payload.mission);
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error(`Timed out waiting for Mission state: ${label}`));
    }, timeoutMs);
    void client.inspectTeamMission({ missionId }).then(
      (result) => {
        if (result.mission) finish(result.mission);
        return undefined;
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
        return undefined;
      },
    );
  });
}

async function inspectMission(client: DaemonClient, missionId: string): Promise<TeamMission> {
  const response = await client.inspectTeamMission({ missionId });
  if (!response.mission) throw new Error(response.error ?? `Mission ${missionId} was not found`);
  return response.mission;
}

async function reportAssignment(input: {
  client: DaemonClient;
  mcp: McpClient;
  errorLog: string[];
  missionId: string;
  assignmentId: string;
  report: Record<string, unknown>;
}): Promise<void> {
  const current = await inspectMission(input.client, input.missionId);
  const assignment = current.assignments.find(
    (candidate) => candidate.assignmentId === input.assignmentId,
  );
  if (!assignment) throw new Error(`Assignment ${input.assignmentId} was not found`);
  const result = await input.mcp.callTool({
    name: "assignment_report",
    args: {
      missionId: current.id,
      assignmentId: assignment.assignmentId,
      expectedRevision: current.revision,
      expectedAssignmentRevision: assignment.revision,
      report: input.report,
    },
  });
  if (result.isError) {
    throw new Error(`${toolErrorText(result)}\n${input.errorLog.slice(-5).join("\n")}`);
  }
  requireToolSuccess(result);
}

function member(role: string, level: 4 | 5, skillIds: string[]) {
  return {
    role,
    level,
    skillIds,
    executionProfile: {
      provider: "claude",
      model: "team-e2e-model",
      modeId: "bypassPermissions",
      thinkingOptionId: null,
      featureValues: {},
    },
  };
}

function missionPlanDrafts(): Array<Record<string, unknown>> {
  return [
    workstreamDraft({
      workstreamId: "backend",
      kind: "delivery",
      skillId: "backend",
      scope: { kind: "paths", pathPrefixes: ["src/backend"] },
      dependencies: [],
      review: true,
    }),
    workstreamDraft({
      workstreamId: "frontend",
      kind: "delivery",
      skillId: "frontend",
      scope: { kind: "paths", pathPrefixes: ["src/frontend"] },
      dependencies: [],
      review: false,
    }),
    workstreamDraft({
      workstreamId: "integration",
      kind: "integration",
      skillId: "integration",
      scope: { kind: "paths", pathPrefixes: ["src/integration"] },
      dependencies: ["backend", "frontend"],
      review: false,
    }),
    workstreamDraft({
      workstreamId: "final-verification",
      kind: "verification",
      skillId: "verification",
      scope: { kind: "read_only" },
      dependencies: ["integration"],
      review: false,
    }),
  ];
}

function workstreamDraft(input: {
  workstreamId: string;
  kind: "delivery" | "integration" | "verification";
  skillId: string;
  scope: Record<string, unknown>;
  dependencies: string[];
  review: boolean;
}): Record<string, unknown> {
  return {
    workstreamId: input.workstreamId,
    kind: input.kind,
    title: `${input.workstreamId} workstream`,
    objective: `Complete ${input.workstreamId}`,
    deliverables: [`${input.workstreamId} result`],
    acceptanceCriteria: [`${input.workstreamId} passes`],
    requiredSkillIds: [input.skillId],
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: ["structured-tools"],
    minimumLevel: 4,
    dependencyWorkstreamIds: input.dependencies,
    mutableScope: input.scope,
    reviewPolicy: input.review ? "required" : "none",
    reviewerRequirements: input.review
      ? {
          requiredSkillIds: ["verification"],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: ["structured-tools"],
          minimumLevel: 4,
        }
      : null,
  };
}

function deliveryDraft(workstreamId: "backend" | "frontend" | "integration") {
  return {
    clientKey: `${workstreamId}-delivery`,
    kind: "delivery",
    workstreamId,
    subjectKeys: [],
    dependencyKeys: [],
    objective: `Deliver ${workstreamId}`,
    inputRefs: [],
    deliverables: [`${workstreamId} result`],
    acceptanceCriteria: [`${workstreamId} passes`],
    mutableScope: { kind: "paths", pathPrefixes: [`src/${workstreamId}`] },
    priority: workstreamId === "integration" ? 5 : 10,
  };
}

function completedReport(input: {
  summary: string;
  artifactPaths: string[];
  verdict: "approved" | "changes_requested" | null;
}): Record<string, unknown> {
  return {
    status: "completed",
    verdict: input.verdict,
    finalVerificationEvidence: null,
    summary: input.summary,
    artifactPaths: input.artifactPaths,
    tests: [{ command: "team-e2e-check", passed: true }],
    decisions: [],
    handoffs: [],
  };
}

function finalVerificationReport(
  assignment: MissionAssignmentContract,
  verdict: "approved" | "changes_requested",
  summary: string,
): Record<string, unknown> {
  if (!assignment.finalVerificationGateFingerprint) {
    throw new Error(`Verification Assignment ${assignment.assignmentId} has no final gate`);
  }
  return {
    ...completedReport({ summary, artifactPaths: [], verdict }),
    finalVerificationEvidence: {
      kind: "final_verification",
      finalGateFingerprint: assignment.finalVerificationGateFingerprint,
      verdict,
      reviewGateEvidence: assignment.reviewGateEvidence,
    },
  };
}

function hasOpenFinalVerifierUnavailableAttention(mission: TeamMission): boolean {
  return mission.attentionItems.some(
    (item) => item.status === "open" && item.kind === "final_verifier_unavailable",
  );
}

function hasFailedFinalVerification(mission: TeamMission, assignmentId: string): boolean {
  if (mission.status === "completed") return false;
  return mission.assignments.some(
    (assignment) =>
      assignment.assignmentId === assignmentId &&
      assignment.report?.finalVerificationEvidence?.verdict === "changes_requested" &&
      assignment.semanticState === "failed",
  );
}

function currentVerificationAssignments(mission: TeamMission): MissionAssignmentContract[] {
  return mission.assignments.filter(
    (assignment) =>
      assignment.kind === "verification" &&
      assignment.planRevision === mission.planRevision &&
      assignment.semanticState !== "canceled",
  );
}

function requireAssignment(mission: TeamMission, workstreamId: string): MissionAssignmentContract {
  const assignment = mission.assignments.find(
    (candidate) => candidate.kind === "delivery" && candidate.workstreamId === workstreamId,
  );
  if (!assignment) throw new Error(`Delivery Assignment for ${workstreamId} was not found`);
  return assignment;
}

function requireKindAssignment(
  mission: TeamMission,
  kind: "review" | "verification",
): MissionAssignmentContract {
  const assignment = mission.assignments.find((candidate) => candidate.kind === kind);
  if (!assignment) throw new Error(`${kind} Assignment was not found`);
  return assignment;
}

function requireAcceptedTurnId(assignment: MissionAssignmentContract): string {
  if (!assignment.acceptedTurnId) {
    throw new Error(`Assignment ${assignment.assignmentId} has no accepted turn`);
  }
  return assignment.acceptedTurnId;
}

function requireRuntimeAgentId(assignment: MissionAssignmentContract): string {
  if (!assignment.runtimeAgentId) {
    throw new Error(`Assignment ${assignment.assignmentId} has no runtime Agent`);
  }
  return assignment.runtimeAgentId;
}
