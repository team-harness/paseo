import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    const created = await client.createTeamProfile({
      idempotencyKey: "team-e2e-create",
      name: "Compiler delivery team",
      workspaceId,
      skills: [
        { skillId: "backend", name: "Backend", description: null },
        { skillId: "frontend", name: "Frontend", description: null },
        { skillId: "integration", name: "Integration", description: null },
        { skillId: "verification", name: "Verification", description: null },
      ],
      lead: member("Technical lead", 5, ["integration"]),
      members: [
        member("Backend engineer", 4, ["backend"]),
        member("Frontend engineer", 4, ["frontend"]),
        member("Quality engineer", 4, ["verification"]),
      ],
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
      reviewerMemberId: memberByRole["Quality engineer"]?.memberId,
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
    await reportAssignment({
      client,
      mcp: await mcpFor(requireRuntimeAgentId(verification)),
      errorLog: daemonErrors,
      missionId: verifying.id,
      assignmentId: verification.assignmentId,
      report: completedReport({
        summary: "Final verification approved every Mission criterion",
        artifactPaths: [],
        verdict: "approved",
      }),
    });
    await provider.completeTurn(requireAcceptedTurnId(verification));

    let completed: TeamMission;
    try {
      completed = await waitForMission(
        client,
        verifying.id,
        isCompletedAndArchived,
        "Mission completion and participant archival",
        30_000,
      );
    } catch (error) {
      const stalled = await inspectMission(client, verifying.id);
      const stored = StoredMissionSchema.parse(
        JSON.parse(
          await readFile(
            path.join(daemon.paseoHome, "team-missions", "missions", `${verifying.id}.json`),
            "utf8",
          ),
        ),
      );
      throw new Error(
        `${String(error)}\n${JSON.stringify(missionDiagnostic(stalled, stored), null, 2)}\n${daemonErrors.slice(-5).join("\n")}`,
        { cause: error },
      );
    }
    expect(completed.assignments.map((assignment) => assignment.kind).toSorted()).toEqual([
      "delivery",
      "delivery",
      "delivery",
      "review",
      "verification",
    ]);
    expect(
      completed.assignments.every(
        (assignment) =>
          assignment.semanticState === "completed" &&
          assignment.dispatchState === "settled" &&
          assignment.report?.status === "completed" &&
          assignment.acceptedTurnId !== null,
      ),
    ).toBe(true);
    expect(completed.attentionItems).toEqual([]);
    expect(provider.assignmentTurns()).toHaveLength(5);
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
  verdict: "approved" | null;
}): Record<string, unknown> {
  return {
    status: "completed",
    verdict: input.verdict,
    summary: input.summary,
    artifactPaths: input.artifactPaths,
    tests: [{ command: "team-e2e-check", passed: true }],
    decisions: [],
    handoffs: [],
  };
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
