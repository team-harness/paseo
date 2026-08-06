import path from "node:path";
import type { Logger } from "pino";

import type { StoredTeam, TeamSnapshot } from "@getpaseo/protocol/team/types";
import { toTeamSnapshot } from "@getpaseo/protocol/team/types";

import { resolveRequiredProviderModel } from "../agent/mcp-shared.js";
import { sendPromptToAgent } from "../agent/agent-prompt.js";
import type { AgentManager, AgentRecordChange } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { FileBackedChatService } from "../chat/chat-service.js";
import { TeamInbox } from "./team-inbox.js";
import { TeamPump, type TeamPumpGateway, type TurnLookup } from "./team-pump.js";
import { TeamScheduler } from "./team-scheduler.js";
import { TeamStore } from "./team-store.js";
import { TeamService, type TeamAgentGateway, type TeamRoomGateway } from "./team-service.js";
import {
  createTeamRecruitmentHook,
  registerTeamTools,
  type RegisterTeamToolsOptions,
  type TeamRecruitmentHook,
  type TeamToolsRoster,
} from "./team-tools.js";

/** Label keys the roster is indexed by. Written by the service, read by everything else. */
const TEAM_ID_LABEL = "paseo.team.id";
const TEAM_ROLE_LABEL = "paseo.team.role";

/**
 * Lifecycles a member can be woken from (DEC-10).
 *
 * A whitelist rather than "anything but running": `initializing` is busy too,
 * and a prompt sent into it is a prompt sent into a session that does not exist
 * yet.
 */
const WAKEABLE_LIFECYCLES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);

export interface TeamRuntimeOptions {
  paseoHome: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  chatService: FileBackedChatService;
  /** Where a team's agents run when the request does not say. */
  resolveWorkspaceCwd(workspaceId: string): Promise<string | null>;
  /** Publishes a team snapshot to subscribed clients. */
  publishTeamUpdate(snapshot: TeamSnapshot): void;
  logger: Logger;
}

/**
 * Everything teams need, assembled and attached to the daemon.
 *
 * The composition lives here rather than in `bootstrap.ts` so the feature is
 * one call there: the daemon's own wiring keeps its shape, and this file is
 * where anyone looking for how a team reaches the agent runtime should start.
 */
export interface TeamRuntime {
  service: TeamService;
  store: TeamStore;
  inbox: TeamInbox;
  recruitmentHook: TeamRecruitmentHook;
  /** Per-agent tool registration, called when a catalog is built for that agent. */
  registerToolsFor(options: Pick<RegisterTeamToolsOptions, "registerTool" | "callerAgentId">): void;
  recruitmentHookFor(callerAgentId: string | undefined): TeamRecruitmentHook;
  start(): Promise<void>;
  stop(): void;
}

export async function createTeamRuntime(options: TeamRuntimeOptions): Promise<TeamRuntime> {
  const { agentManager, agentStorage, chatService, logger } = options;
  const teamLogger = logger.child({ module: "team" });

  const store = new TeamStore(path.join(options.paseoHome, "teams"), teamLogger);
  await store.initialize();
  const inbox = new TeamInbox(path.join(options.paseoHome, "teams", "inbox"), teamLogger);

  const rooms: TeamRoomGateway = {
    createRoom: async (input) => {
      await chatService.createRoom({
        roomId: input.roomId,
        name: input.name,
        displayName: input.displayName,
        ownerKind: "team",
        ownerId: input.ownerId,
      });
    },
    discardRoom: async (input) => {
      await chatService.discardOwnedRoom({
        roomId: input.roomId,
        ownerKind: "team",
        ownerId: input.ownerId,
      });
    },
  };

  /**
   * Live state first, storage second.
   *
   * A member the daemon has not loaded still has a record, and reading only
   * memory would report it missing — which the reconciler would act on.
   */
  async function agentState(agentId: string) {
    const live = agentManager.getAgent(agentId);
    const record = await agentStorage.get(agentId);
    return { live, record };
  }

  const agents: TeamAgentGateway = {
    createAgent: async (input) => {
      const cwd = await options.resolveWorkspaceCwd(input.workspaceId);
      if (!cwd) {
        throw new Error(`Workspace ${input.workspaceId} has no directory to run an agent in`);
      }
      // "codex/gpt-5.4" is one string on the wire and two fields here.
      const { provider, model } = input.provider.includes("/")
        ? resolveRequiredProviderModel(input.provider)
        : { provider: input.provider, model: undefined };
      await agentManager.createAgent(
        {
          provider,
          cwd,
          ...(model ? { model } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...input.settings,
        },
        input.agentId,
        {
          workspaceId: input.workspaceId,
          labels: input.labels,
          // Replaying a plan finds what it built last time instead of refusing
          // the id or destroying the agent behind it.
          reuseIfOwnedBy: { [TEAM_ID_LABEL]: input.labels[TEAM_ID_LABEL] ?? "" },
        },
      );
    },

    sendPrompt: async (input) => {
      await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId: input.agentId,
        prompt: input.prompt,
        messageId: input.clientMessageId,
        // A briefing is the agent's first turn; there is nothing to replace.
        unarchive: false,
        logger: teamLogger,
      });
    },

    archiveAgent: async (agentId) => {
      const record = await agentStorage.get(agentId);
      // Missing means hard-deleted, which for a team is already the end state.
      // Anything else has to fail loudly, or a team records itself archived
      // with a member still running.
      if (!record) return { kind: "not_found" as const };
      if (record.archivedAt) return { kind: "archived" as const };
      await agentManager.archiveAgent(agentId);
      return { kind: "archived" as const };
    },

    clearTeamLabels: async (agentId) => {
      const record = await agentStorage.get(agentId);
      if (!record) return;
      const labels = { ...record.labels };
      delete labels[TEAM_ID_LABEL];
      delete labels[TEAM_ROLE_LABEL];
      await agentManager.setLabels(agentId, labels);
    },

    restoreTeamLabels: async (input) => {
      const record = await agentStorage.get(input.agentId);
      if (!record) return;
      await agentManager.setLabels(input.agentId, {
        ...record.labels,
        [TEAM_ID_LABEL]: input.teamId,
        [TEAM_ROLE_LABEL]: input.role,
      });
    },

    getAgentState: async (agentId) => {
      const { live, record } = await agentState(agentId);
      if (!record && !live) return { kind: "missing" as const };
      if (record?.archivedAt) return { kind: "archived" as const };
      const labels = record?.labels ?? live?.labels ?? {};
      const teamId = labels[TEAM_ID_LABEL];
      const role = labels[TEAM_ROLE_LABEL];
      return {
        kind: "active" as const,
        teamLabel: teamId && role ? { teamId, role } : null,
      };
    },
  };

  const service = new TeamService({ store, rooms, agents, logger: teamLogger });

  const pumpGateway: TeamPumpGateway = {
    isWakeable: async (agentId) => {
      const { live, record } = await agentState(agentId);
      if (record?.archivedAt) return false;
      if (live) return WAKEABLE_LIFECYCLES.has(live.lifecycle);
      // Not loaded is not busy. A stored-only member is woken by loading it.
      return record !== null;
    },

    dispatchAssignment: async (input) => {
      await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId: input.agentId,
        prompt: input.prompt,
        messageId: input.clientMessageId,
        unarchive: false,
        // The dispatch contract: never interrupt. A member mid-turn keeps its
        // turn and the assignment stays queued for the next pass.
        replaceRunning: false,
        logger: teamLogger,
      });
      // The turn the provider opened for this prompt. Without it the assignment
      // has nothing to bind to and could never be settled.
      return agentManager.getAgent(input.agentId)?.activeTurnId ?? null;
    },

    deliverCompletions: async (input) => {
      const { outOfBand } = await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId: input.agentId,
        prompt: input.body,
        messageId: input.deliveryId,
        unarchive: false,
        replaceRunning: false,
        logger: teamLogger,
      });
      return outOfBand || agentManager.getAgent(input.agentId)?.activeTurnId !== null;
    },

    lookUpTurnOutcome: async ({ agentId, turnId }): Promise<TurnLookup> => {
      const outcome = await agentStorage.getTurnOutcome(agentId, turnId);
      if (outcome) return { kind: "settled", outcome: outcome.outcome };
      const record = await agentStorage.get(agentId);
      if (record?.activeTurn?.turnId === turnId) return { kind: "running" };
      // No outcome and no active marker: the turn died with a daemon, or its
      // result has rolled out of the bounded history. Either way it is over.
      return { kind: "unknown" };
    },
  };

  const pump = new TeamPump({ inbox, gateway: pumpGateway, logger: teamLogger });
  const scheduler = new TeamScheduler({
    logger: teamLogger,
    listActiveTeams: async () =>
      (await store.list())
        .filter((team) => team.lifecycle === "active")
        .map((team) => ({ id: team.id, leadAgentId: team.leadAgentId })),
    runPass: (input) => pump.run(input),
  });

  async function kickTeam(teamId: string): Promise<void> {
    const team = await store.get(teamId);
    if (!team || team.lifecycle !== "active") return;
    await scheduler.kick({ teamId, leadAgentId: team.leadAgentId });
  }

  const roster: TeamToolsRoster = {
    findTeamForAgent: async (agentId) => {
      const team = await findTeamOfAgent(store, agentId);
      return team
        ? {
            id: team.id,
            name: team.name,
            chatRoomId: team.chatRoomId,
            leadAgentId: team.leadAgentId,
            lifecycle: team.lifecycle,
            members: team.members,
          }
        : null;
    },
    getMemberStatus: async (agentId) => {
      const { live, record } = await agentState(agentId);
      if (live) return live.lifecycle;
      if (!record) return "deleted";
      return record.archivedAt ? "archived" : (record.lastStatus ?? "idle");
    },
  };

  function recruitmentHookFor(callerAgentId: string | undefined): TeamRecruitmentHook {
    return createTeamRecruitmentHook({
      ...(callerAgentId ? { callerAgentId } : {}),
      roster,
      recruit: (input) => service.recruit(input),
      describeAgent: async (agentId) => {
        const { live, record } = await agentState(agentId);
        return {
          agentId,
          provider: live?.provider ?? record?.provider ?? "unknown",
          status: live?.lifecycle ?? record?.lastStatus ?? "initializing",
          cwd: live?.cwd ?? record?.cwd ?? "",
        };
      },
      logger: teamLogger,
    });
  }

  /**
   * Reacts to what happens to a team's agents outside the team.
   *
   * The reconciler covers the same ground on a timer; this is the fast path,
   * not the guarantee. An event that never arrives is a delay, not a loss.
   */
  const detachRecordChanges = agentManager.onAgentRecordChange(async (change) => {
    try {
      await handleRecordChange(change);
    } catch (error) {
      teamLogger.warn({ err: error, change: change.kind }, "Team failed to handle a record change");
    }
  });

  async function handleRecordChange(change: AgentRecordChange): Promise<void> {
    switch (change.kind) {
      case "archived":
        await publish(await service.onAgentArchived(change.agentId));
        break;
      case "unarchived":
        await publish(await service.onAgentUnarchived(change.agentId));
        break;
      case "deleted":
        await publish(await service.onAgentDeleted(change.agentId));
        break;
      case "turn_settled": {
        // The assignee just came free: settle what it finished and give it
        // whatever was waiting behind it.
        const team = await findTeamOfAgent(store, change.agentId);
        if (team) await kickTeam(team.id);
        break;
      }
      case "labels_changed":
        break;
    }
  }

  async function publish(team: StoredTeam | null): Promise<void> {
    if (!team) return;
    options.publishTeamUpdate(toTeamSnapshot(team));
    await kickTeam(team.id);
  }

  /**
   * An agent in a team being created cannot be hard-deleted.
   *
   * Hard delete keeps no tombstone, so afterwards "no record" cannot be told
   * from "not built yet" — and the creation replay would build a second one.
   * Refusing up front is the only way to close that window without one.
   */
  const detachDeletionGuard = agentManager.registerAgentDeletionGuard((agentId) => {
    const teamName = store.creatingTeamNameOf(agentId);
    return teamName
      ? `${agentId} belongs to team ${teamName}, which is still being created.`
      : null;
  });

  return {
    service,
    store,
    inbox,
    recruitmentHook: recruitmentHookFor(undefined),
    recruitmentHookFor,
    registerToolsFor(toolOptions) {
      registerTeamTools({
        ...toolOptions,
        roster,
        inbox,
        chat: {
          post: (input) => chatService.post(input),
          readMessages: (input) => chatService.readMessages(input),
          waitForMessages: (input) => chatService.waitForMessages(input),
        },
        kickPump: kickTeam,
        logger: teamLogger,
      });
    },
    async start() {
      // Reconcile before sweeping: a pass over a team whose creation never
      // finished would dispatch against a roster that is not settled yet.
      await service.reconcile();
      await scheduler.start();
    },
    stop() {
      scheduler.stop();
      detachRecordChanges();
      detachDeletionGuard();
    },
  };
}

async function findTeamOfAgent(store: TeamStore, agentId: string): Promise<StoredTeam | null> {
  for (const team of await store.list()) {
    if (team.members.some((member) => member.agentId === agentId)) return team;
  }
  return null;
}
