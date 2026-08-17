import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { isSystemInjectedEnvelope } from "../../../agent/agent-prompt.js";
import { AgentManager } from "../../../agent/agent-manager.js";
import { AgentStorage } from "../../../agent/agent-storage.js";
import { createTestAgentClients } from "../../../test-utils/fake-agent-client.js";
import { PaseoTeamAssignmentDispatchAdapter } from "./team-assignment-dispatch-adapter.js";
import { PaseoTeamParticipantAdapter } from "./team-participant-adapter.js";
import { resolveFinalVerificationRecoveryAction } from "./team-room-collaboration-contract.js";

describe("PaseoTeamAssignmentDispatchAdapter", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-assignment-dispatch-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("returns the accepted turn and replays a deterministic dispatch without a second prompt", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const participant = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });
    const agentId = "00000000-0000-4000-8000-000000000402";
    await participant.ensureParticipant({
      agentId,
      teamId: "team-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      memberId: "member-api",
      bindingEpoch: 1,
      role: "API engineer",
      mentionHandle: "api-engineer",
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
    });
    const adapter = new PaseoTeamAssignmentDispatchAdapter({
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
    const input = {
      teamId: "team-1",
      missionId: "mission-1",
      assignmentId: "assignment-api",
      agentId,
      bindingEpoch: 1,
      messageId: "team-mission:mission-1:assignment:assignment-api:dispatch",
      methodologyPromptSections: [
        {
          sectionId: "delivery-contract",
          audience: "delivery" as const,
          phase: "assignment" as const,
          content: "Frozen methodology delivery contract.",
          contentDigest: `sha256:${"0".repeat(64)}`,
        },
      ],
    };

    const first = await adapter.dispatch(input);
    const replay = await adapter.dispatch(input);

    expect(first).toMatchObject({ kind: "accepted", turnId: expect.any(String) });
    expect(replay).toEqual(first);
    expect(await storage.getAcceptedTurnId(agentId, input.messageId)).toBe(
      first.kind === "accepted" ? first.turnId : null,
    );
    expect((await storage.get(agentId))?.labels?.["paseo.team-accepted-turns"]).toBeUndefined();
    const prompts = manager
      .fetchTimeline(agentId, { direction: "tail", limit: 20 })
      .rows.filter(
        (row) => row.item.type === "user_message" && row.item.clientMessageId === input.messageId,
      );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.item).toMatchObject({
      type: "user_message",
      text: expect.stringContaining('Call mission_status with missionId "mission-1"'),
    });
    const promptText = prompts[0]?.item.type === "user_message" ? prompts[0].item.text : "";
    expect(isSystemInjectedEnvelope(promptText)).toBe(true);
    expect(promptText.indexOf("Call mission_status")).toBeLessThan(
      promptText.indexOf("Frozen methodology delivery contract."),
    );
    expect(promptText.indexOf("Frozen methodology delivery contract.")).toBeLessThan(
      promptText.indexOf('Assignment "assignment-api" is ready'),
    );
    expect(promptText).toContain("Post a brief task-room update with chat_post when you start");
    expect(promptText).toContain("Before assignment_report");
    expect(promptText).toContain(
      'idempotencyKey "assignment:<assignmentId>:final-verification-outcome"',
    );
    expect(promptText).toContain("mention the Mission Lead");
    expect(promptText).toContain(
      "Wait until that Lead summary is visible before assignment_report",
    );
    expect(promptText).toContain("Do not mirror your transcript or routine tool calls");
    expect(promptText).toContain(
      "Treat the persisted Assignment as the complete scope for this turn; do not start a separate agent or review orchestration loop.",
    );
    expect(promptText).toContain(
      "Before this turn ends, call assignment_report exactly once unless the final-verification closeout rule above explicitly requires you to wait for the Lead summary. Do not end with only prose or shell output.",
    );

    await manager.closeAgent(agentId);
    await Promise.all([manager.flush(), storage.flush()]);
  });

  test("keeps report recovery focused on structured state without repeating delivery work", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const participant = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });
    const agentId = "00000000-0000-4000-8000-000000000405";
    await participant.ensureParticipant({
      agentId,
      teamId: "team-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      memberId: "member-api",
      bindingEpoch: 1,
      role: "API engineer",
      mentionHandle: "api-engineer",
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
    });
    const adapter = new PaseoTeamAssignmentDispatchAdapter({
      agentManager: manager,
      agentStorage: storage,
      logger,
    });

    await adapter.requestReport({
      teamId: "team-1",
      missionId: "mission-1",
      assignmentId: "assignment-api",
      agentId,
      bindingEpoch: 1,
      attempt: 2,
      messageId: "team-mission:mission-1:assignment:assignment-api:report-recovery:2",
      methodologyPromptSections: [],
    });

    const promptText = manager
      .fetchTimeline(agentId, { direction: "tail", limit: 20 })
      .rows.flatMap((row) => (row.item.type === "user_message" ? [row.item.text] : []))
      .at(-1);
    expect(promptText).toContain("Call chat_read before assignment_report");
    expect(promptText).toContain(
      'idempotencyKey "assignment:assignment-api:final-verification-outcome"',
    );
    expect(promptText).toContain("end this turn without assignment_report");
    expect(promptText).toContain(
      "For any other Assignment, call assignment_report now without another task-room update",
    );

    await manager.closeAgent(agentId);
    await Promise.all([manager.flush(), storage.flush()]);
  });

  test("waits without reporting when recovery sees the verifier outcome but no Lead summary", () => {
    expect(
      fakeRecoveryProviderCalls({
        outcomeVisible: true,
        leadSummaryVisible: false,
        verifierIsLead: false,
      }),
    ).toEqual([]);
  });

  test("reports without duplicating Room updates when recovery sees outcome and summary", () => {
    expect(
      fakeRecoveryProviderCalls({
        outcomeVisible: true,
        leadSummaryVisible: true,
        verifierIsLead: false,
      }),
    ).toEqual(["assignment_report"]);
  });

  test("re-reads its own Lead summary before reporting when the verifier is also Lead", () => {
    expect(
      fakeRecoveryProviderCalls({
        outcomeVisible: true,
        leadSummaryVisible: false,
        verifierIsLead: true,
      }),
    ).toEqual(["chat_post", "chat_read", "assignment_report"]);
  });

  test("replays the accepted turn after restart when another turn has intervened", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const participant = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });
    const agentId = "00000000-0000-4000-8000-000000000403";
    await participant.ensureParticipant({
      agentId,
      teamId: "team-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      memberId: "member-api",
      bindingEpoch: 1,
      role: "API engineer",
      mentionHandle: "api-engineer",
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
    });
    const input = {
      teamId: "team-1",
      missionId: "mission-1",
      assignmentId: "assignment-api",
      agentId,
      bindingEpoch: 1,
      messageId: "team-mission:mission-1:assignment:assignment-api:dispatch",
      methodologyPromptSections: [],
    };
    const firstAdapter = new PaseoTeamAssignmentDispatchAdapter({
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
    const first = await firstAdapter.dispatch(input);
    expect(first).toMatchObject({ kind: "accepted", turnId: expect.any(String) });

    await manager.waitForAgentEvent(agentId, { waitForActive: true });

    await manager.runAgent(agentId, "An unrelated turn completed after the assignment.", {
      clientMessageId: "unrelated-turn",
    });
    await manager.closeAgent(agentId);
    await Promise.all([manager.flush(), storage.flush()]);

    const restartedManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const replay = await new PaseoTeamAssignmentDispatchAdapter({
      agentManager: restartedManager,
      agentStorage: storage,
      logger,
    }).dispatch(input);

    expect(replay).toEqual(first);
    expect(restartedManager.getAgent(agentId)).toBeNull();
    await Promise.all([restartedManager.flush(), storage.flush()]);
  });

  test("fences a dispatch whose provider acceptance was not persisted before restart", async () => {
    const logger = createTestLogger();
    const storagePath = join(rootDirectory, "agents");
    class AcceptanceKillPointStorage extends AgentStorage {
      private killNextAcceptanceWrite = true;

      override async setActiveTurn(
        agentId: string,
        turn: { turnId: string; startedAt: string } | null,
        options?: { clientMessageId?: string },
      ): Promise<boolean> {
        if (turn && options?.clientMessageId && this.killNextAcceptanceWrite) {
          this.killNextAcceptanceWrite = false;
          throw new Error("simulated process exit after provider acceptance");
        }
        return await super.setActiveTurn(agentId, turn, options);
      }
    }

    let providerStarts = 0;
    const firstStorage = new AcceptanceKillPointStorage(storagePath, logger);
    await firstStorage.initialize();
    const firstManager = new AgentManager({
      clients: createTestAgentClients({
        onStartTurn: () => {
          providerStarts += 1;
        },
      }),
      registry: firstStorage,
      logger,
    });
    const agentId = "00000000-0000-4000-8000-000000000404";
    await new PaseoTeamParticipantAdapter({
      agentManager: firstManager,
      agentStorage: firstStorage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    }).ensureParticipant({
      agentId,
      teamId: "team-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      memberId: "member-api",
      bindingEpoch: 1,
      role: "API engineer",
      mentionHandle: "api-engineer",
      executionProfile: {
        provider: "codex",
        model: null,
        modeId: null,
        thinkingOptionId: null,
        featureValues: {},
      },
    });
    const input = {
      teamId: "team-1",
      missionId: "mission-1",
      assignmentId: "assignment-api",
      agentId,
      bindingEpoch: 1,
      messageId: "team-mission:mission-1:assignment:assignment-api:dispatch",
      methodologyPromptSections: [],
    };

    await new PaseoTeamAssignmentDispatchAdapter({
      agentManager: firstManager,
      agentStorage: firstStorage,
      logger,
    }).dispatch(input);
    expect(providerStarts).toBe(1);
    await firstManager.waitForAgentEvent(agentId, { waitForActive: true });
    await Promise.all([firstManager.flush(), firstStorage.flush()]);

    const restartedStorage = new AgentStorage(storagePath, logger);
    await restartedStorage.initialize();
    const restartedManager = new AgentManager({
      clients: createTestAgentClients({
        onStartTurn: () => {
          providerStarts += 1;
        },
      }),
      registry: restartedStorage,
      logger,
    });
    const replay = await new PaseoTeamAssignmentDispatchAdapter({
      agentManager: restartedManager,
      agentStorage: restartedStorage,
      logger,
    }).dispatch(input);

    expect(replay).toEqual({
      kind: "acceptance_unknown",
      reason: expect.stringMatching(/acceptance is unknown.*manual Mission resolution/i),
    });
    expect(providerStarts).toBe(1);
    expect(restartedManager.getAgent(agentId)).toBeNull();
    await Promise.all([restartedManager.flush(), restartedStorage.flush()]);
  });
});

function fakeRecoveryProviderCalls(
  observation: Parameters<typeof resolveFinalVerificationRecoveryAction>[0],
): Array<"chat_post" | "chat_read" | "assignment_report"> {
  const action = resolveFinalVerificationRecoveryAction(observation);
  return [
    ...(action.roomPost === null ? [] : (["chat_post"] as const)),
    ...(action.readAfterRoomPost ? (["chat_read"] as const) : []),
    ...(action.submitReport ? (["assignment_report"] as const) : []),
  ];
}
