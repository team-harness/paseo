import { describe, expect, test, vi } from "vitest";

import type { RegisterPaseoTool } from "../../../agent/tools/paseo-tools.js";
import type { PaseoToolDefinition } from "../../../agent/tools/types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { TeamApplicationError } from "../../application/team-mission-service.js";
import { MissionRevisionConflictError } from "../../persistence/mission-store.js";
import { PaseoTeamToolRegistrar } from "./team-tool-registrar.js";

describe("PaseoTeamToolRegistrar", () => {
  test("registers the v2 collaboration catalog and injects the caller identity", async () => {
    const teamStatus = vi.fn(async () => ({ team: { id: "team-1" } }));
    const service = collaborationFake({ teamStatus });
    const registrar = new PaseoTeamToolRegistrar({ service, logger: createTestLogger() });
    const tools = new Map<string, PaseoToolDefinition>();

    registrar.register("agent-lead", captureTools(tools));

    expect([...tools.keys()].toSorted()).toEqual([
      "assign_task",
      "assignment_report",
      "chat_read",
      "mission_plan",
      "mission_status",
      "team_member_history",
      "team_message",
      "team_status",
    ]);
    const result = await tools.get("team_status")?.handler({ missionId: "mission-1" }, {});
    expect(teamStatus).toHaveBeenCalledWith({
      callerAgentId: "agent-lead",
      missionId: "mission-1",
    });
    expect(result).toMatchObject({ structuredContent: { team: { id: "team-1" } } });
  });

  test("registers nothing without a caller Agent identity", () => {
    const registrar = new PaseoTeamToolRegistrar({
      service: collaborationFake(),
      logger: createTestLogger(),
    });
    const tools = new Map<string, PaseoToolDefinition>();

    registrar.register(undefined, captureTools(tools));

    expect(tools.size).toBe(0);
  });

  test("rejects the scalar assign shape at the strict schema boundary", async () => {
    const registrar = new PaseoTeamToolRegistrar({
      service: collaborationFake(),
      logger: createTestLogger(),
    });
    const tools = new Map<string, PaseoToolDefinition>();
    registrar.register("agent-lead", captureTools(tools));
    const schema = tools.get("assign_task")?.inputSchema;
    if (!schema || !("safeParseAsync" in schema)) throw new Error("assign_task schema is missing");

    const parsed = await schema.safeParseAsync({
      assigneeAgentId: "agent-member",
      prompt: "Implement the parser",
    });

    expect(parsed.success).toBe(false);
  });

  test("preserves atomic replacement and additional Assignment batches in mission_plan", async () => {
    const registrar = new PaseoTeamToolRegistrar({
      service: collaborationFake(),
      logger: createTestLogger(),
    });
    const tools = new Map<string, PaseoToolDefinition>();
    registrar.register("agent-lead", captureTools(tools));
    const schema = tools.get("mission_plan")?.inputSchema;
    if (!schema || !("safeParseAsync" in schema)) throw new Error("mission_plan schema is missing");
    const assignment = {
      clientKey: "implementation",
      kind: "delivery" as const,
      workstreamId: "implementation",
      subjectKeys: [],
      dependencyKeys: ["contract"],
      objective: "Implement the contract",
      inputRefs: [],
      deliverables: ["Implementation"],
      acceptanceCriteria: ["Tests pass"],
      mutableScope: { kind: "paths" as const, pathPrefixes: ["packages/server/src"] },
      priority: 10,
    };

    const parsed = await schema.safeParseAsync({
      missionId: "mission-1",
      expectedRevision: 11,
      expectedPlanRevision: 1,
      workstreams: [
        {
          workstreamId: "implementation",
          kind: "delivery",
          title: "Implementation",
          objective: "Implement the contract",
          deliverables: ["Implementation"],
          acceptanceCriteria: ["Tests pass"],
          requiredSkillIds: ["typescript"],
          preferredSkillIds: [],
          requiredRuntimeCapabilityIds: ["structured-tools"],
          minimumLevel: 3,
          dependencyWorkstreamIds: [],
          mutableScope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
          reviewPolicy: "none",
          reviewerRequirements: null,
        },
      ],
      replacementAssignments: [
        { ...assignment, clientKey: "contract", supersedesAssignmentId: "assignment-old" },
      ],
      assignments: [assignment],
    });

    expect(parsed).toMatchObject({
      success: true,
      data: {
        replacementAssignments: [
          { clientKey: "contract", supersedesAssignmentId: "assignment-old" },
        ],
        assignments: [{ clientKey: "implementation", dependencyKeys: ["contract"] }],
      },
    });
  });

  test("rejects user-authored quality-gate Assignments at the tool schema boundary", async () => {
    const registrar = new PaseoTeamToolRegistrar({
      service: collaborationFake(),
      logger: createTestLogger(),
    });
    const tools = new Map<string, PaseoToolDefinition>();
    registrar.register("agent-lead", captureTools(tools));
    const schema = tools.get("assign_task")?.inputSchema;
    if (!schema || !("safeParseAsync" in schema)) throw new Error("assign_task schema is missing");

    const parsed = await schema.safeParseAsync({
      missionId: "mission-1",
      expectedRevision: 11,
      expectedPlanRevision: 1,
      assignments: [
        {
          clientKey: "manual-verification",
          kind: "verification",
          workstreamId: "final-verification",
          subjectKeys: ["delivery"],
          dependencyKeys: ["delivery"],
          objective: "Verify the Mission",
          inputRefs: [],
          deliverables: ["Verification report"],
          acceptanceCriteria: ["All checks pass"],
          mutableScope: { kind: "read_only" },
          priority: 10,
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  test("returns an actionable refusal instead of exposing an application stack", async () => {
    const service = collaborationFake({
      missionStatus: vi.fn(async () => {
        throw new TeamApplicationError("not_mission_participant", "Agent is not a participant");
      }),
    });
    const registrar = new PaseoTeamToolRegistrar({ service, logger: createTestLogger() });
    const tools = new Map<string, PaseoToolDefinition>();
    registrar.register("agent-outsider", captureTools(tools));

    const result = await tools.get("mission_status")?.handler({ missionId: "mission-1" }, {});

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "not_mission_participant: Agent is not a participant",
        },
      ],
      isError: true,
    });
  });

  test("returns a specific refusal for a residual Mission revision conflict", async () => {
    const service = collaborationFake({
      reportAssignment: vi.fn(async () => {
        throw new MissionRevisionConflictError("mission-1", 11, 12);
      }),
    });
    const registrar = new PaseoTeamToolRegistrar({ service, logger: createTestLogger() });
    const tools = new Map<string, PaseoToolDefinition>();
    registrar.register("agent-member", captureTools(tools));

    const result = await tools.get("assignment_report")?.handler(
      {
        missionId: "mission-1",
        assignmentId: "assignment-1",
        expectedRevision: 11,
        expectedAssignmentRevision: 1,
        report: {
          status: "completed",
          summary: "Completed the Assignment",
          artifactPaths: [],
          handoffNotes: [],
          blocker: null,
          verdict: null,
        },
      },
      {},
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "mission_revision_conflict: Mission mission-1 revision 12 does not match 11",
        },
      ],
      isError: true,
    });
  });
});

function captureTools(tools: Map<string, PaseoToolDefinition>): RegisterPaseoTool {
  return (name, config, handler) => {
    tools.set(name, {
      name,
      title: config.title,
      description: config.description ?? name,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      handler,
    });
  };
}

function collaborationFake(overrides: Record<string, unknown> = {}) {
  return {
    teamStatus: vi.fn(),
    missionStatus: vi.fn(),
    teamMemberHistory: vi.fn(),
    planMission: vi.fn(),
    assignTasks: vi.fn(),
    reportAssignment: vi.fn(),
    sendTeamMessage: vi.fn(),
    readTeamChat: vi.fn(),
    reconcilePendingMessages: vi.fn(),
    ...overrides,
  };
}
