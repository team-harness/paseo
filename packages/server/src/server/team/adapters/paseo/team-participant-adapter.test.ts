import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { AgentManager } from "../../../agent/agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "../../../agent/agent-storage.js";
import { createTestAgentClients } from "../../../test-utils/fake-agent-client.js";
import { PaseoTeamParticipantAdapter } from "./team-participant-adapter.js";

describe("PaseoTeamParticipantAdapter", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-participant-adapter-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("archives a stored-only participant through the durable lifecycle command", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    await storage.upsert(storedAgent("agent-stored"));
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const adapter = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => "/workspace/project",
      logger,
    });

    await adapter.archiveParticipant({
      agentId: "agent-stored",
      teamId: "team-1",
      missionId: "mission-1",
    });

    expect((await storage.get("agent-stored"))?.archivedAt).toEqual(expect.any(String));
    expect(manager.getAgent("agent-stored")).toBeNull();
    await manager.flush();
  });

  test("refuses to archive an Agent owned by another Mission", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    await storage.upsert(
      storedAgent("agent-other", {
        "paseo.team-id": "team-other",
        "paseo.team-mission-id": "mission-other",
      }),
    );
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const adapter = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => "/workspace/project",
      logger,
    });

    await expect(
      adapter.archiveParticipant({
        agentId: "agent-other",
        teamId: "team-1",
        missionId: "mission-1",
      }),
    ).rejects.toThrow("is not owned by Team team-1 Mission mission-1");

    expect((await storage.get("agent-other"))?.archivedAt).toBeNull();
    expect(manager.getAgent("agent-other")).toBeNull();
    await manager.flush();
  });

  test("reloads an owned stored-only Lead into a fresh AgentManager", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const firstManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const input = leadInput(rootDirectory);
    const firstAdapter = new PaseoTeamParticipantAdapter({
      agentManager: firstManager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await firstAdapter.createLead(input);
    expect(firstManager.getAgent(input.agentId)).not.toBeNull();
    await firstManager.closeAgent(input.agentId);
    expect(firstManager.getAgent(input.agentId)).toBeNull();

    const restartedManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const restartedAdapter = new PaseoTeamParticipantAdapter({
      agentManager: restartedManager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await restartedAdapter.createLead(input);

    expect(restartedManager.getAgent(input.agentId)).toMatchObject({
      id: input.agentId,
      labels: {
        "paseo.team-id": input.teamId,
        "paseo.team-mission-id": input.missionId,
        "paseo.team-member-id": input.memberId,
      },
    });
    await restartedManager.closeAgent(input.agentId);
    await Promise.all([firstManager.flush(), restartedManager.flush(), storage.flush()]);
  });

  test("sends one recovery wake when a persisted Lead wake was canceled before activation", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const firstManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const input = leadInput(rootDirectory);
    const firstAdapter = new PaseoTeamParticipantAdapter({
      agentManager: firstManager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });
    const wakeMessageId = "team-mission:mission-1:member:member-lead:wake:1";

    await firstAdapter.createLead(input);
    const firstTurnId = await storage.getAcceptedTurnId(input.agentId, wakeMessageId);
    expect(firstTurnId).toEqual(expect.any(String));
    await firstManager.closeAgent(input.agentId);
    expect(await storage.getTurnOutcome(input.agentId, firstTurnId!)).toMatchObject({
      outcome: "canceled",
    });

    const restartedManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const restartedAdapter = new PaseoTeamParticipantAdapter({
      agentManager: restartedManager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await restartedAdapter.createLead(input);
    await restartedAdapter.createLead(input);

    const recoveryMessageId = `${wakeMessageId}:recovery:1`;
    expect(await storage.getAcceptedTurnId(input.agentId, recoveryMessageId)).toEqual(
      expect.any(String),
    );
    expect(
      restartedManager
        .fetchTimeline(input.agentId, { direction: "tail", limit: 0 })
        .rows.filter(
          (row) =>
            row.item.type === "user_message" && row.item.clientMessageId === recoveryMessageId,
        ),
    ).toHaveLength(1);

    await restartedManager.closeAgent(input.agentId);
    await Promise.all([firstManager.flush(), restartedManager.flush(), storage.flush()]);
  });

  test("does not bypass an unknown accepted Lead wake after restart", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const firstManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const input = leadInput(rootDirectory);
    const firstAdapter = new PaseoTeamParticipantAdapter({
      agentManager: firstManager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });
    const wakeMessageId = "team-mission:mission-1:member:member-lead:wake:1";

    await firstAdapter.createLead(input);
    await firstManager.closeAgent(input.agentId);
    const record = await storage.get(input.agentId);
    expect(record).not.toBeNull();
    await storage.upsert({ ...record!, activeTurn: null, turnOutcomes: [] });

    const restartedManager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const restartedAdapter = new PaseoTeamParticipantAdapter({
      agentManager: restartedManager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await expect(restartedAdapter.createLead(input)).rejects.toThrow(
      "has unknown outcome after acceptance",
    );
    expect(
      await storage.getAcceptedTurnId(input.agentId, `${wakeMessageId}:recovery:1`),
    ).toBeNull();

    await restartedManager.closeAgent(input.agentId);
    await Promise.all([firstManager.flush(), restartedManager.flush(), storage.flush()]);
  });

  test("sends one minimal tool-directed wake prompt across a replayed Lead creation", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const input = leadInput(rootDirectory);
    const adapter = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await adapter.createLead(input);
    await adapter.createLead(input);

    const prompts = manager
      .fetchTimeline(input.agentId, { direction: "tail", limit: 20 })
      .rows.flatMap((row) =>
        row.item.type === "user_message" &&
        row.item.clientMessageId === "team-mission:mission-1:member:member-lead:wake:1"
          ? [row.item.text]
          : [],
      );
    expect(prompts).toEqual([
      [
        "<paseo-system>",
        'You are Team Member "member-lead" (@technical-lead), the Lead for Mission "mission-1" in Team "team-1".',
        'Call mission_status with missionId "mission-1" now. Then use one mission_plan call with the complete Workstream DAG and its assignments field covering every delivery and integration Workstream, including nodes whose dependencies are not ready yet. The daemon derives Assignment dependencies from the Workstream DAG, gates dispatch, and materializes required review and final verification Assignments.',
        "</paseo-system>",
      ].join("\n"),
    ]);

    await manager.closeAgent(input.agentId);
    await Promise.all([manager.flush(), storage.flush()]);
  });

  test("coalesces concurrent replayed Lead creation after the wake turn is accepted", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const input = leadInput(rootDirectory);
    const adapter = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await Promise.all([adapter.createLead(input), adapter.createLead(input)]);

    const messageId = "team-mission:mission-1:member:member-lead:wake:1";
    expect(await storage.getAcceptedTurnId(input.agentId, messageId)).toEqual(expect.any(String));
    expect(
      manager
        .fetchTimeline(input.agentId, { direction: "tail", limit: 0 })
        .rows.filter(
          (row) => row.item.type === "user_message" && row.item.clientMessageId === messageId,
        ),
    ).toHaveLength(1);

    await manager.closeAgent(input.agentId);
    await Promise.all([manager.flush(), storage.flush()]);
  });

  test("provisions a regular Member without opening a turn", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      registry: storage,
      logger,
    });
    const adapter = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });

    await adapter.ensureParticipant({
      agentId: "00000000-0000-4000-8000-000000000402",
      teamId: "team-1",
      missionId: "mission-1",
      workspaceId: "workspace-sdk",
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

    expect(manager.getAgent("00000000-0000-4000-8000-000000000402")).toMatchObject({
      labels: {
        "paseo.team-id": "team-1",
        "paseo.team-mission-id": "mission-1",
        "paseo.team-member-id": "member-api",
        "paseo.team-binding-epoch": "1",
      },
    });
    expect(
      manager.fetchTimeline("00000000-0000-4000-8000-000000000402", {
        direction: "tail",
        limit: 20,
      }).rows,
    ).toEqual([]);

    await manager.closeAgent("00000000-0000-4000-8000-000000000402");
    await Promise.all([manager.flush(), storage.flush()]);
  });

  test("inspects participant availability from durable storage and ownership labels", async () => {
    const logger = createTestLogger();
    const storage = new AgentStorage(join(rootDirectory, "agents"), logger);
    await storage.initialize();
    const participant = storedAgent("agent-inspected", {
      "paseo.team-id": "team-1",
      "paseo.team-mission-id": "mission-1",
      "paseo.team-member-id": "member-api",
      "paseo.team-binding-epoch": "1",
    });
    await storage.upsert(participant);
    const manager = new AgentManager({ registry: storage, logger });
    const adapter = new PaseoTeamParticipantAdapter({
      agentManager: manager,
      agentStorage: storage,
      resolveWorkspaceCwd: async () => rootDirectory,
      logger,
    });
    const input = {
      agentId: participant.id,
      teamId: "team-1",
      missionId: "mission-1",
      memberId: "member-api",
      bindingEpoch: 1,
    };

    await expect(adapter.inspectParticipant(input)).resolves.toBe("active");
    await storage.upsert({ ...participant, archivedAt: NOW, updatedAt: NOW });
    await expect(adapter.inspectParticipant(input)).resolves.toBe("archived");
    await expect(adapter.inspectParticipant({ ...input, agentId: "agent-missing" })).resolves.toBe(
      "missing",
    );
    await expect(adapter.inspectParticipant({ ...input, memberId: "member-other" })).resolves.toBe(
      "missing",
    );
  });
});

const NOW = "2026-08-08T10:00:00.000Z";

function storedAgent(
  id: string,
  labels: Record<string, string> = {
    "paseo.team-id": "team-1",
    "paseo.team-mission-id": "mission-1",
  },
): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: "/workspace/project",
    workspaceId: "workspace-sdk",
    createdAt: "2026-08-08T09:00:00.000Z",
    updatedAt: "2026-08-08T09:00:00.000Z",
    labels,
    lastStatus: "closed",
    config: null,
    persistence: null,
    archivedAt: null,
  };
}

function leadInput(cwd: string) {
  return {
    agentId: "00000000-0000-4000-8000-000000000401",
    teamId: "team-1",
    missionId: "mission-1",
    workspaceId: "workspace-sdk",
    memberId: "member-lead",
    role: "Technical lead",
    mentionHandle: "technical-lead",
    bindingEpoch: 1,
    executionProfile: {
      provider: "codex",
      model: null,
      modeId: null,
      thinkingOptionId: null,
      featureValues: {},
    },
    cwd,
  };
}
