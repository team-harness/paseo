import type { Logger } from "pino";

import { TEAM_ERROR_CODES } from "@getpaseo/protocol/team/rpc-schemas";
import { toTeamTask, type TeamTaskList } from "@getpaseo/protocol/team/task-types";
import { toTeamSnapshot, type StoredTeam, type TeamSnapshot } from "@getpaseo/protocol/team/types";

import type { TeamInbox } from "./team-inbox.js";
import {
  TeamCreateConflictError,
  TeamCreateValidationError,
  type TeamService,
} from "./team-service.js";
import type { TeamStore } from "./team-store.js";

export type TeamInboundMessage =
  | {
      type: "team.create.request";
      requestId: string;
      idempotencyKey: string;
      name: string;
      workspaceId: string;
      task: string;
      lead: TeamMemberSpecInput;
      members: TeamMemberSpecInput[];
      templateId?: string;
    }
  | { type: "team.list.request"; requestId: string; includeArchived?: boolean }
  | { type: "team.inspect.request"; requestId: string; teamId: string }
  | { type: "team.archive.request"; requestId: string; teamId: string }
  | {
      type: "team.member.remove.request";
      requestId: string;
      teamId: string;
      agentId: string;
    }
  | { type: "team.tasks.list.request"; requestId: string; teamId: string };

interface TeamMemberSpecInput {
  role: string;
  title?: string;
  provider: string;
  settings?: Record<string, unknown>;
  briefing?: string;
}

const TEAM_REQUEST_TYPES: ReadonlySet<string> = new Set([
  "team.create.request",
  "team.list.request",
  "team.inspect.request",
  "team.archive.request",
  "team.member.remove.request",
  "team.tasks.list.request",
]);

/** Narrows a session message to one this module owns. */
export function isTeamInboundMessage(message: { type: string }): message is TeamInboundMessage {
  return TEAM_REQUEST_TYPES.has(message.type);
}

/**
 * The reply shape for a request the daemon parsed but cannot serve.
 *
 * Every team request is correlated by `requestId`, so dropping one leaves the
 * client waiting on a promise that never settles.
 */
export function teamUnavailableResponse(
  message: TeamInboundMessage,
  reason: string,
): TeamOutboundMessage {
  switch (message.type) {
    case "team.create.request":
      return {
        type: "team.create.response",
        payload: { requestId: message.requestId, team: null, error: reason, errorCode: null },
      };
    case "team.list.request":
      return {
        type: "team.list.response",
        payload: { requestId: message.requestId, teams: [], error: reason },
      };
    case "team.inspect.request":
      return {
        type: "team.inspect.response",
        payload: { requestId: message.requestId, team: null, error: reason },
      };
    case "team.archive.request":
      return {
        type: "team.archive.response",
        payload: { requestId: message.requestId, team: null, error: reason },
      };
    case "team.member.remove.request":
      return {
        type: "team.member.remove.response",
        payload: { requestId: message.requestId, team: null, error: reason },
      };
    case "team.tasks.list.request":
      return {
        type: "team.tasks.list.response",
        payload: { requestId: message.requestId, tasks: null, error: reason },
      };
  }
}

export type TeamOutboundMessage =
  | {
      type: "team.create.response";
      payload: {
        requestId: string;
        team: TeamSnapshot | null;
        error: string | null;
        errorCode: string | null;
      };
    }
  | {
      type: "team.list.response";
      payload: { requestId: string; teams: TeamSnapshot[]; error: string | null };
    }
  | {
      type: "team.inspect.response";
      payload: { requestId: string; team: TeamSnapshot | null; error: string | null };
    }
  | {
      type: "team.archive.response";
      payload: { requestId: string; team: TeamSnapshot | null; error: string | null };
    }
  | {
      type: "team.member.remove.response";
      payload: { requestId: string; team: TeamSnapshot | null; error: string | null };
    }
  | {
      type: "team.tasks.list.response";
      payload: { requestId: string; tasks: TeamTaskList | null; error: string | null };
    }
  | { type: "team.update"; payload: { team: TeamSnapshot } }
  | { type: "team.tasks.update"; payload: { tasks: TeamTaskList } };

export interface TeamSessionHandlersOptions {
  service: TeamService;
  store: TeamStore;
  inbox: TeamInbox;
  /** Answers the client that asked. Correlated by `requestId`. */
  send: (message: TeamOutboundMessage) => void;
  /** Tells every subscribed client. Not correlated with any request. */
  publish: (team: TeamSnapshot) => void;
  logger: Logger;
}

/**
 * The wire surface for teams.
 *
 * Beyond forwarding, its one job is to keep the daemon's working notes off the
 * wire: the stored record carries a creation plan, a request fingerprint and
 * recruitment intents, and spreading it into a response would publish all of
 * them. Every reply goes through `toTeamSnapshot`, which is an explicit
 * projection rather than an omission list — a field added to the record does
 * not leak by default.
 *
 * Lives here rather than in the session so the session only needs a line to
 * hand a message over.
 */
export class TeamSessionHandlers {
  private readonly service: TeamService;
  private readonly store: TeamStore;
  private readonly inbox: TeamInbox;
  private readonly send: (message: TeamOutboundMessage) => void;
  private readonly publish: (team: TeamSnapshot) => void;
  private readonly logger: Logger;

  constructor(options: TeamSessionHandlersOptions) {
    this.service = options.service;
    this.store = options.store;
    this.inbox = options.inbox;
    this.send = options.send;
    this.publish = options.publish;
    this.logger = options.logger.child({ module: "team", component: "team-session" });
  }

  async handle(message: TeamInboundMessage): Promise<void> {
    switch (message.type) {
      case "team.create.request":
        return await this.handleCreate(message);
      case "team.list.request":
        return await this.handleList(message);
      case "team.inspect.request":
        return await this.handleInspect(message);
      case "team.archive.request":
        return await this.handleArchive(message);
      case "team.member.remove.request":
        return await this.handleMemberRemove(message);
      case "team.tasks.list.request":
        return await this.handleTasksList(message);
    }
  }

  private async handleCreate(
    message: Extract<TeamInboundMessage, { type: "team.create.request" }>,
  ): Promise<void> {
    try {
      const team = await this.service.create({
        idempotencyKey: message.idempotencyKey,
        name: message.name,
        workspaceId: message.workspaceId,
        task: message.task,
        lead: toMemberRequest(message.lead),
        members: message.members.map(toMemberRequest),
        templateId: message.templateId ?? null,
      });
      this.send({
        type: "team.create.response",
        payload: {
          requestId: message.requestId,
          team: toTeamSnapshot(team),
          error: null,
          errorCode: null,
        },
      });
      this.broadcast(team);
    } catch (error) {
      this.send({
        type: "team.create.response",
        payload: {
          requestId: message.requestId,
          team: null,
          error: describe(error),
          // A client retrying with a key needs to tell "your retry worked" from
          // "that key now means something else".
          errorCode:
            error instanceof TeamCreateConflictError ? TEAM_ERROR_CODES.idempotencyConflict : null,
        },
      });
      this.logFailure("create", error);
    }
  }

  private async handleList(
    message: Extract<TeamInboundMessage, { type: "team.list.request" }>,
  ): Promise<void> {
    try {
      const teams = await this.store.list();
      const visible = message.includeArchived
        ? teams
        : teams.filter((team) => team.lifecycle !== "archived");
      this.send({
        type: "team.list.response",
        payload: { requestId: message.requestId, teams: visible.map(toTeamSnapshot), error: null },
      });
    } catch (error) {
      this.send({
        type: "team.list.response",
        payload: { requestId: message.requestId, teams: [], error: describe(error) },
      });
      this.logFailure("list", error);
    }
  }

  private async handleInspect(
    message: Extract<TeamInboundMessage, { type: "team.inspect.request" }>,
  ): Promise<void> {
    try {
      const team = await this.store.get(message.teamId);
      this.send({
        type: "team.inspect.response",
        payload: {
          requestId: message.requestId,
          team: team ? toTeamSnapshot(team) : null,
          error: team ? null : `Team not found: ${message.teamId}`,
        },
      });
    } catch (error) {
      this.send({
        type: "team.inspect.response",
        payload: { requestId: message.requestId, team: null, error: describe(error) },
      });
      this.logFailure("inspect", error);
    }
  }

  private async handleArchive(
    message: Extract<TeamInboundMessage, { type: "team.archive.request" }>,
  ): Promise<void> {
    try {
      const team = await this.service.archive(message.teamId);
      this.send({
        type: "team.archive.response",
        payload: {
          requestId: message.requestId,
          team: team ? toTeamSnapshot(team) : null,
          error: team ? null : `Team not found: ${message.teamId}`,
        },
      });
      if (team) this.broadcast(team);
    } catch (error) {
      this.send({
        type: "team.archive.response",
        payload: { requestId: message.requestId, team: null, error: describe(error) },
      });
      this.logFailure("archive", error);
    }
  }

  private async handleMemberRemove(
    message: Extract<TeamInboundMessage, { type: "team.member.remove.request" }>,
  ): Promise<void> {
    try {
      const team = await this.service.removeMember({
        teamId: message.teamId,
        agentId: message.agentId,
      });
      this.send({
        type: "team.member.remove.response",
        payload: {
          requestId: message.requestId,
          team: team ? toTeamSnapshot(team) : null,
          error: team ? null : `Team not found: ${message.teamId}`,
        },
      });
      if (team) this.broadcast(team);
    } catch (error) {
      this.send({
        type: "team.member.remove.response",
        payload: { requestId: message.requestId, team: null, error: describe(error) },
      });
      this.logFailure("member remove", error);
    }
  }

  private async handleTasksList(
    message: Extract<TeamInboundMessage, { type: "team.tasks.list.request" }>,
  ): Promise<void> {
    try {
      // Asked of the store rather than inferred from the ledger: a team that has
      // never been assigned anything has no ledger file, and reading one gives
      // the same empty list as a team id that was never real.
      const team = await this.store.get(message.teamId);
      this.send({
        type: "team.tasks.list.response",
        payload: {
          requestId: message.requestId,
          tasks: team ? await readTeamTaskList(this.inbox, message.teamId) : null,
          error: team ? null : `Team not found: ${message.teamId}`,
        },
      });
    } catch (error) {
      this.send({
        type: "team.tasks.list.response",
        payload: { requestId: message.requestId, tasks: null, error: describe(error) },
      });
      this.logFailure("tasks list", error);
    }
  }

  /**
   * Tells every connected client, not just the one that asked.
   *
   * A `team.update` describes the team, not the request — a second client
   * watching the list has to learn about a team the first one created, and
   * about a member it removed.
   */
  private broadcast(team: StoredTeam): void {
    this.publish(toTeamSnapshot(team));
  }

  /**
   * A refused request is an answer, not an incident: the caller asked for
   * something the rules do not allow and has been told so.
   */
  private logFailure(operation: string, error: unknown): void {
    if (error instanceof TeamCreateValidationError || error instanceof TeamCreateConflictError) {
      return;
    }
    this.logger.error({ err: error, operation }, "A team request failed");
  }
}

/**
 * The ledger as the wire sees it.
 *
 * Shared by the correlated reply and the broadcast so the two cannot disagree
 * about what a task looks like, and exported because the broadcast is wired
 * where the inbox is, not where the session is.
 */
export async function readTeamTaskList(inbox: TeamInbox, teamId: string): Promise<TeamTaskList> {
  const ledger = await inbox.readLedger(teamId);
  return {
    teamId,
    revision: ledger.revision,
    tasks: ledger.assignments.map((assignment) => toTeamTask(assignment)),
  };
}

function toMemberRequest(spec: TeamMemberSpecInput) {
  return {
    role: spec.role,
    provider: spec.provider,
    title: spec.title ?? null,
    briefing: spec.briefing ?? null,
    settings: spec.settings ?? null,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "The team request failed";
}
