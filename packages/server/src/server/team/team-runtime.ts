import path from "node:path";
import type { Logger } from "pino";

import type { StoredTeam, TeamSnapshot } from "@getpaseo/protocol/team/types";
import { toTeamSnapshot } from "@getpaseo/protocol/team/types";

import { TEAM_ID_LABEL, TEAM_ROLE_LABEL } from "@getpaseo/protocol/agent-labels";

import { resolveRequiredProviderModel } from "../agent/mcp-shared.js";
import { sendPromptToAgent, waitForAgentRunStartWithTimeout } from "../agent/agent-prompt.js";
import { archiveAgentCommand } from "../agent/lifecycle-command.js";
import { isAgentWakeable } from "../agent/agent-wakeability.js";
import { AgentAlreadyExistsError } from "../agent/agent-manager.js";
import type { AgentLabelPatch, AgentManager, AgentRecordChange } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { FileBackedChatService } from "../chat/chat-service.js";
import { TeamInbox } from "./team-inbox.js";
import { TeamPump, type TeamPumpGateway } from "./team-pump.js";
import { lookUpTurnOutcome } from "./team-turn-lookup.js";
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
 * What a session needs from the runtime: the two services the RPCs act on, and
 * the way to tell every other client what changed.
 */
export interface TeamRuntimeSessionDeps {
  service: TeamService;
  store: TeamStore;
  publishTeamUpdate: (team: TeamSnapshot) => void;
}

/**
 * Everything teams need, assembled and attached to the daemon.
 *
 * The composition lives here rather than in `bootstrap.ts` so the feature is
 * one call there: the daemon's own wiring keeps its shape, and this file is
 * where anyone looking for how a team reaches the agent runtime should start.
 */
export interface TeamRuntime extends TeamRuntimeSessionDeps {
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

  /**
   * Writes a label patch through the path that also handles a record the
   * daemon has not loaded. Members are loaded lazily, so after a restart most
   * of a team is stored-only.
   */
  async function writeTeamLabels(agentId: string, labels: AgentLabelPatch): Promise<void> {
    try {
      await agentManager.updateAgentMetadata(agentId, { labels });
    } catch (error) {
      // Hard-deleted. There is nothing left to label, and the roster change
      // that prompted this is recorded either way.
      if (!isAgentNotFound(error)) throw error;
    }
  }

  /**
   * Sends a prompt and returns the turn the provider opened for it, or null if
   * it would not take one.
   *
   * The turn id cannot be read straight after the send: `startAgentRun` returns
   * once it has handed the prompt to the stream, and the turn is opened inside
   * that stream after the provider accepts. Reading early sees the previous
   * turn or nothing, and binding an assignment to either means it can never be
   * settled.
   */
  async function startTeamTurn(input: {
    agentId: string;
    prompt: string;
    clientMessageId: string;
  }): Promise<string | null> {
    const { outOfBand } = await sendPromptToAgent({
      agentManager,
      agentStorage,
      agentId: input.agentId,
      prompt: input.prompt,
      messageId: input.clientMessageId,
      unarchive: false,
      replaceRunning: false,
      logger: teamLogger,
    });
    if (outOfBand) return null;
    try {
      await waitForAgentRunStartWithTimeout(agentManager, input.agentId);
    } catch (error) {
      // The provider never opened a turn — busy, archived, or too slow. The
      // assignment stays queued and the next pass tries again.
      teamLogger.info({ err: error, agentId: input.agentId }, "No turn opened for a team prompt");
      return null;
    }
    return agentManager.getAgent(input.agentId)?.activeTurnId ?? null;
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
      const owningTeamId = input.labels[TEAM_ID_LABEL];
      if (!owningTeamId) {
        throw new Error(`Team agent ${input.agentId} was built without a team label`);
      }
      try {
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
            // Replaying a plan finds what it built last time instead of
            // refusing the id or destroying the agent behind it.
            reuseIfOwnedBy: { [TEAM_ID_LABEL]: owningTeamId },
          },
        );
      } catch (error) {
        // A record this team owns, not yet loaded. That is the replay finding
        // what it built last time, which is what the plan wanted — not a
        // reason to fail the team and archive everything it has built.
        if (!(error instanceof AgentAlreadyExistsError)) throw error;
        if (error.record.labels?.[TEAM_ID_LABEL] !== owningTeamId) throw error;
      }
    },

    sendPrompt: async (input) => {
      await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId: input.agentId,
        prompt: input.prompt,
        messageId: input.clientMessageId,
        unarchive: false,
        // A briefing is normally an agent's first turn, but this path is
        // replayed: a resend after a crash can land while the agent is working,
        // and replacing there would cancel the work the first send started.
        replaceRunning: false,
        logger: teamLogger,
      });
    },

    archiveAgent: async (agentId) => {
      try {
        // The lifecycle command, not `agentManager.archiveAgent`: members are
        // loaded lazily, so after a restart most of a team is stored-only, and
        // the raw call throws for anything it does not hold in memory.
        await archiveAgentCommand({ agentManager, agentStorage, logger: teamLogger }, agentId);
        return { kind: "archived" as const };
      } catch (error) {
        // Missing means hard-deleted, which for a team is already the end
        // state. Anything else has to fail loudly, or a team records itself
        // archived with a member still running.
        if (isAgentNotFound(error)) return { kind: "not_found" as const };
        throw error;
      }
    },

    clearTeamLabels: async (agentId) => {
      // A patch, so `null` is what removes a label — passing a subset of the
      // labels only merges, and would leave both of these in place.
      await writeTeamLabels(agentId, { [TEAM_ID_LABEL]: null, [TEAM_ROLE_LABEL]: null });
    },

    restoreTeamLabels: async (input) => {
      await writeTeamLabels(input.agentId, {
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
    isWakeable: async (agentId) => isAgentWakeable(await agentState(agentId)),

    isActiveMember: async ({ teamId, agentId }) => {
      const team = await store.get(teamId);
      const entry = team?.members.find((member) => member.agentId === agentId);
      return entry?.state === "active";
    },

    dispatchAssignment: (input) =>
      // The dispatch contract: never interrupt. A member mid-turn keeps its
      // turn, `streamAgent` refuses the prompt, and the assignment stays
      // queued for the next pass.
      startTeamTurn({
        agentId: input.agentId,
        prompt: input.prompt,
        clientMessageId: input.clientMessageId,
      }),

    deliverCompletions: async (input) => {
      const turnId = await startTeamTurn({
        agentId: input.agentId,
        prompt: input.body,
        clientMessageId: input.deliveryId,
      });
      // Acknowledging on anything weaker discards the batch: a lead archived
      // between the wakeability check and the send makes `sendPromptToAgent` a
      // silent no-op, and calling that "delivered" loses the completions.
      return turnId !== null;
    },

    lookUpTurnOutcome: (input) =>
      lookUpTurnOutcome(
        {
          whenTurnStateSettled: (agentId) => agentManager.whenTurnStateSettled(agentId),
          getTurnOutcome: (agentId, turnId) => agentStorage.getTurnOutcome(agentId, turnId),
          getActiveTurnId: async (agentId) =>
            (await agentStorage.get(agentId))?.activeTurn?.turnId ?? null,
        },
        input,
      ),
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

  /**
   * Held until the first reconciliation has finished (DEC-14).
   *
   * The tools and the event subscription are live from the moment the runtime
   * is built, which is before `start()` runs. A pass over a team whose creation
   * replay has not finished would dispatch against a roster that is not settled.
   */
  let releaseReconciled = () => {};
  const reconciled = new Promise<void>((resolve) => {
    releaseReconciled = resolve;
  });

  async function kickTeam(teamId: string): Promise<void> {
    await reconciled;
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
   *
   * Detached deliberately. The emitter awaits its listeners, and the team
   * operations this triggers take the per-team lock — so archiving a team,
   * which holds that lock while it archives each member, would wait on a
   * listener that is waiting on the lock it holds. Not awaiting also keeps a
   * slow or failing subscriber out of the path of the operation that fired it.
   */
  const detachRecordChanges = agentManager.onAgentRecordChange((change) => {
    void handleRecordChange(change).catch((error: unknown) => {
      teamLogger.warn({ err: error, change: change.kind }, "Team failed to handle a record change");
    });
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
    publishTeamUpdate: options.publishTeamUpdate,
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
      try {
        await service.reconcile();
      } catch (error) {
        teamLogger.error({ err: error }, "Team reconciliation failed");
      } finally {
        // Released even on failure: the sweep is what recovers from a bad
        // reconciliation, and holding every kick forever is worse than a late
        // pass over a roster that is still settling.
        releaseReconciled();
      }
      await scheduler.start();
    },
    stop() {
      // A kick blocked on the gate would otherwise never return.
      releaseReconciled();
      scheduler.stop();
      detachRecordChanges();
      detachDeletionGuard();
    },
  };
}

/**
 * The team this agent currently belongs to.
 *
 * `removed` entries do not count. They are history — an agent that left a team,
 * was evicted, or was hard-deleted is not a member, and treating it as one
 * would let it keep reading and writing that team's room. An active team wins
 * over an archived one, so an agent recruited into a second team addresses the
 * team it is actually working in.
 */
async function findTeamOfAgent(store: TeamStore, agentId: string): Promise<StoredTeam | null> {
  let fallback: StoredTeam | null = null;
  for (const team of await store.list()) {
    const entry = team.members.find((member) => member.agentId === agentId);
    if (!entry || entry.state === "removed") continue;
    if (team.lifecycle === "active" || team.lifecycle === "creating") return team;
    fallback ??= team;
  }
  return fallback;
}

/** Whether a lifecycle call failed because the record is gone. */
function isAgentNotFound(error: unknown): boolean {
  return error instanceof Error && /not found|unknown agent/i.test(error.message);
}
