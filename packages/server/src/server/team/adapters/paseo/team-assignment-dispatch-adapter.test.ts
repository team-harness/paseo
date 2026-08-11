import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { AgentManager } from "../../../agent/agent-manager.js";
import { AgentStorage } from "../../../agent/agent-storage.js";
import { createTestAgentClients } from "../../../test-utils/fake-agent-client.js";
import { PaseoTeamAssignmentDispatchAdapter } from "./team-assignment-dispatch-adapter.js";
import { PaseoTeamParticipantAdapter } from "./team-participant-adapter.js";

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

    await manager.closeAgent(agentId);
    await Promise.all([manager.flush(), storage.flush()]);
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
