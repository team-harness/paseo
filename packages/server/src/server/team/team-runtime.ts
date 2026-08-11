import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";
import type { RegisterPaseoTool } from "../agent/tools/paseo-tools.js";
import type { InstallPaseoTeamRuntimeOptions } from "./adapters/paseo/team-runtime-install.js";
export type { TeamPersistenceFaultInjector } from "./persistence/transactions.js";
import {
  TeamApplicationError,
  type ArchiveTeamInput,
  type CancelMissionInput,
  type CreateTeamInput,
  type ResolveMissionAttentionInput,
  type StartMissionInput,
  type TeamMissionService,
  type UpdateTeamInput,
} from "./application/team-mission-service.js";

export interface TeamMissionsRuntimeOptions {
  enabled: boolean;
  toolIds?: readonly string[];
  reconcileIntervalMs?: number;
}

const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;

export type TeamRuntimeRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "team.profile.create.request"
      | "team.profile.list.request"
      | "team.profile.inspect.request"
      | "team.profile.update.request"
      | "team.profile.archive.request"
      | "team.mission.start.request"
      | "team.mission.list.request"
      | "team.mission.inspect.request"
      | "team.mission.cancel.request"
      | "team.mission.message.post.request"
      | "team.mission.room.subscribe.request"
      | "team.mission.room.unsubscribe.request"
      | "team.mission.attention.resolve.request";
  }
>;

export interface TeamRuntimeRequestContext {
  actorId: string;
  subscribeMissionRoom?(missionId: string): void;
  unsubscribeMissionRoom?(missionId: string): void;
}

type TeamMissionRoomRequest = Extract<
  TeamRuntimeRequest,
  {
    type:
      | "team.mission.message.post.request"
      | "team.mission.room.subscribe.request"
      | "team.mission.room.unsubscribe.request";
  }
>;

export interface TeamRuntimeRoomMessageEvent {
  missionId: string;
  message: TeamRoomMessage;
  cursor: number;
}

export interface TeamRuntimeService {
  reconcile(): Promise<void>;
  createTeam(input: CreateTeamInput): ReturnType<TeamMissionService["createTeam"]>;
  listTeams(includeArchived?: boolean): ReturnType<TeamMissionService["listTeams"]>;
  inspectTeam(teamId: string): ReturnType<TeamMissionService["inspectTeam"]>;
  updateTeam(input: UpdateTeamInput): ReturnType<TeamMissionService["updateTeam"]>;
  archiveTeam(input: ArchiveTeamInput): ReturnType<TeamMissionService["archiveTeam"]>;
  startMission(input: StartMissionInput): ReturnType<TeamMissionService["startMission"]>;
  listMissions(
    teamId: string,
    includeTerminal?: boolean,
  ): ReturnType<TeamMissionService["listMissions"]>;
  inspectMission(missionId: string): ReturnType<TeamMissionService["inspectMission"]>;
  postMissionMessage(input: {
    missionId: string;
    actorId: string;
    body: string;
    replyToMessageId?: string;
  }): Promise<TeamRuntimeRoomMessageEvent>;
  readMissionRoom(input: { missionId: string; afterCursor?: number; limit?: number }): Promise<{
    messages: TeamRoomMessage[];
    cursor: number;
    hasMore: boolean;
  }>;
  onMissionRoomMessage(listener: (event: TeamRuntimeRoomMessageEvent) => void): () => void;
  cancelMission(input: CancelMissionInput): ReturnType<TeamMissionService["cancelMission"]>;
  resolveAttention(
    input: ResolveMissionAttentionInput,
  ): ReturnType<TeamMissionService["resolveAttention"]>;
}

export interface TeamRuntimeSessionDeps {
  handleRequest(
    request: TeamRuntimeRequest,
    context: TeamRuntimeRequestContext,
  ): Promise<SessionOutboundMessage>;
  onMissionRoomMessage(listener: (event: TeamRuntimeRoomMessageEvent) => void): () => void;
}

export interface TeamRuntime {
  start(): Promise<void>;
  stop(): void;
  isReady(): boolean;
  serverFeatures(): { teamMissions?: true };
  sessionDeps(): TeamRuntimeSessionDeps | null;
  registerAgentTools(callerAgentId: string | undefined, registerTool: RegisterPaseoTool): void;
}

export interface TeamRuntimeAgentTools {
  reconcile(): Promise<void>;
  register(callerAgentId: string | undefined, registerTool: RegisterPaseoTool): void;
  stop?(): void;
}

interface CreateTeamRuntimeOptions {
  runtime: TeamMissionsRuntimeOptions;
  service?: TeamRuntimeService;
  agentTools?: TeamRuntimeAgentTools;
  onReconcileError?: (error: unknown) => void;
}

export function createTeamRuntime(options: CreateTeamRuntimeOptions): TeamRuntime {
  const controller = new TeamRuntimeController(
    options.runtime,
    options.service ?? null,
    options.agentTools ?? null,
    options.onReconcileError ?? (() => undefined),
  );
  return controller;
}

export async function installPaseoTeamRuntime(
  options: InstallPaseoTeamRuntimeOptions,
): Promise<TeamRuntime> {
  const { installPaseoTeamRuntimeAdapter } =
    await import("./adapters/paseo/team-runtime-install.js");
  return installPaseoTeamRuntimeAdapter(options, createTeamRuntime);
}

export type { InstallPaseoTeamRuntimeOptions };

class TeamRuntimeController implements TeamRuntime, TeamRuntimeSessionDeps {
  private state: "disabled" | "installed" | "starting" | "ready" | "stopped";
  private startPromise: Promise<void> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private sweepPromise: Promise<void> | null = null;
  private readonly reconcileIntervalMs: number;

  constructor(
    runtime: TeamMissionsRuntimeOptions,
    private readonly service: TeamRuntimeService | null,
    private readonly agentTools: TeamRuntimeAgentTools | null,
    private readonly onReconcileError: (error: unknown) => void,
  ) {
    if (runtime.enabled && !service) {
      throw new Error("Enabled Team Missions runtime requires an application service");
    }
    this.reconcileIntervalMs = runtime.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    if (!Number.isFinite(this.reconcileIntervalMs) || this.reconcileIntervalMs <= 0) {
      throw new Error("Team Missions reconcile interval must be a positive number");
    }
    this.state = runtime.enabled ? "installed" : "disabled";
  }

  async start(): Promise<void> {
    if (this.state === "disabled" || this.state === "ready") return;
    if (this.state === "stopped") throw new Error("Team Missions runtime has been stopped");
    if (this.startPromise) return this.startPromise;
    this.state = "starting";
    const start = this.reconcileRuntime()
      .then(() => {
        if (this.state === "starting") {
          this.state = "ready";
          this.startReconcileSweep();
        }
        return undefined;
      })
      .catch((error: unknown) => {
        if (this.state === "starting") this.state = "installed";
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    this.startPromise = start;
    return start;
  }

  stop(): void {
    this.state = "stopped";
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.agentTools?.stop?.();
  }

  isReady(): boolean {
    return this.state === "ready";
  }

  serverFeatures(): { teamMissions?: true } {
    return this.isReady() ? { teamMissions: true } : {};
  }

  sessionDeps(): TeamRuntimeSessionDeps | null {
    return this.isReady() ? this : null;
  }

  registerAgentTools(callerAgentId: string | undefined, registerTool: RegisterPaseoTool): void {
    if (this.state !== "starting" && this.state !== "ready") return;
    this.agentTools?.register(callerAgentId, registerTool);
  }

  private async reconcileRuntime(): Promise<void> {
    await this.requireService().reconcile();
    await this.agentTools?.reconcile();
  }

  private startReconcileSweep(): void {
    if (this.reconcileTimer || this.state !== "ready") return;
    const timer = setInterval(() => {
      this.runReconcileSweep();
    }, this.reconcileIntervalMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.reconcileTimer = timer;
  }

  private runReconcileSweep(): void {
    if (this.state !== "ready" || this.sweepPromise) return;
    const sweep = this.reconcileRuntime()
      .catch((error: unknown) => {
        this.onReconcileError(error);
      })
      .finally(() => {
        if (this.sweepPromise === sweep) this.sweepPromise = null;
      });
    this.sweepPromise = sweep;
  }

  async handleRequest(
    request: TeamRuntimeRequest,
    context: TeamRuntimeRequestContext,
  ): Promise<SessionOutboundMessage> {
    if (!this.isReady()) {
      return teamMissionsUnavailableResponse(request, "Team Missions is not ready on this host.");
    }
    const service = this.requireService();
    try {
      if (isTeamMissionRoomRequest(request)) {
        return await this.handleMissionRoomRequest(request, context, service);
      }
      switch (request.type) {
        case "team.profile.create.request":
          return teamResponse(
            "team.profile.create.response",
            request.requestId,
            await service.createTeam(request),
          );
        case "team.profile.list.request":
          return {
            type: "team.profile.list.response",
            payload: {
              requestId: request.requestId,
              teams: await service.listTeams(request.includeArchived),
              error: null,
              errorCode: null,
            },
          };
        case "team.profile.inspect.request":
          return teamResponse(
            "team.profile.inspect.response",
            request.requestId,
            await requireResource(
              service.inspectTeam(request.teamId),
              "team_not_found",
              request.teamId,
            ),
          );
        case "team.profile.update.request":
          return teamResponse(
            "team.profile.update.response",
            request.requestId,
            await service.updateTeam(request),
          );
        case "team.profile.archive.request":
          return teamResponse(
            "team.profile.archive.response",
            request.requestId,
            await service.archiveTeam({
              idempotencyKey: request.idempotencyKey,
              teamId: request.teamId,
              expectedRevision: request.expectedRevision,
            }),
          );
        case "team.mission.start.request":
          return missionResponse(
            "team.mission.start.response",
            request.requestId,
            await service.startMission({
              idempotencyKey: request.idempotencyKey,
              teamId: request.teamId,
              expectedTeamRevision: request.expectedTeamRevision,
              objective: request.objective,
              constraints: request.constraints,
              acceptanceCriteria: request.acceptanceCriteria,
            }),
          );
        case "team.mission.list.request":
          return {
            type: "team.mission.list.response",
            payload: {
              requestId: request.requestId,
              missions: await service.listMissions(request.teamId, request.includeTerminal),
              error: null,
              errorCode: null,
            },
          };
        case "team.mission.inspect.request":
          return missionResponse(
            "team.mission.inspect.response",
            request.requestId,
            await requireResource(
              service.inspectMission(request.missionId),
              "mission_not_found",
              request.missionId,
            ),
          );
        case "team.mission.cancel.request":
          return missionResponse(
            "team.mission.cancel.response",
            request.requestId,
            await service.cancelMission(request),
          );
        case "team.mission.attention.resolve.request":
          return missionResponse(
            "team.mission.attention.resolve.response",
            request.requestId,
            await service.resolveAttention({ ...request, actorId: context.actorId }),
          );
      }
    } catch (error) {
      return errorResponse(request, error);
    }
  }

  private async handleMissionRoomRequest(
    request: TeamMissionRoomRequest,
    context: TeamRuntimeRequestContext,
    service: TeamRuntimeService,
  ): Promise<SessionOutboundMessage> {
    switch (request.type) {
      case "team.mission.message.post.request": {
        const posted = await service.postMissionMessage({
          missionId: request.missionId,
          actorId: context.actorId,
          body: request.body,
          ...(request.replyToMessageId ? { replyToMessageId: request.replyToMessageId } : {}),
        });
        return {
          type: "team.mission.message.post.response",
          payload: {
            requestId: request.requestId,
            missionId: request.missionId,
            message: posted.message,
            error: null,
            errorCode: null,
          },
        };
      }
      case "team.mission.room.subscribe.request": {
        context.subscribeMissionRoom?.(request.missionId);
        try {
          const page = await service.readMissionRoom({
            missionId: request.missionId,
            ...(request.afterCursor !== undefined ? { afterCursor: request.afterCursor } : {}),
            ...(request.limit !== undefined ? { limit: request.limit } : {}),
          });
          return {
            type: "team.mission.room.subscribe.response",
            payload: {
              requestId: request.requestId,
              missionId: request.missionId,
              ...page,
              error: null,
              errorCode: null,
            },
          };
        } catch (error) {
          context.unsubscribeMissionRoom?.(request.missionId);
          throw error;
        }
      }
      case "team.mission.room.unsubscribe.request":
        context.unsubscribeMissionRoom?.(request.missionId);
        return {
          type: "team.mission.room.unsubscribe.response",
          payload: {
            requestId: request.requestId,
            missionId: request.missionId,
            error: null,
            errorCode: null,
          },
        };
    }
  }

  onMissionRoomMessage(listener: (event: TeamRuntimeRoomMessageEvent) => void): () => void {
    if (!this.isReady()) return () => undefined;
    return this.requireService().onMissionRoomMessage(listener);
  }

  private requireService(): TeamRuntimeService {
    if (!this.service) throw new Error("Team Missions runtime is disabled");
    return this.service;
  }
}

export function isTeamMissionsRequest(message: { type: string }): message is TeamRuntimeRequest {
  return TEAM_MISSIONS_REQUEST_TYPES.has(message.type);
}

function isTeamMissionRoomRequest(request: TeamRuntimeRequest): request is TeamMissionRoomRequest {
  return (
    request.type === "team.mission.message.post.request" ||
    request.type === "team.mission.room.subscribe.request" ||
    request.type === "team.mission.room.unsubscribe.request"
  );
}

export function teamMissionsUnavailableResponse(
  request: TeamRuntimeRequest,
  reason: string,
): SessionOutboundMessage {
  switch (request.type) {
    case "team.profile.list.request":
      return {
        type: "team.profile.list.response",
        payload: {
          requestId: request.requestId,
          teams: [],
          error: reason,
          errorCode: "unsupported",
        },
      };
    case "team.mission.list.request":
      return {
        type: "team.mission.list.response",
        payload: {
          requestId: request.requestId,
          missions: [],
          error: reason,
          errorCode: "unsupported",
        },
      };
    case "team.mission.message.post.request":
      return roomPostError(request, reason, "unsupported");
    case "team.mission.room.subscribe.request":
      return roomSubscribeError(request, reason, "unsupported");
    case "team.mission.room.unsubscribe.request":
      return roomUnsubscribeError(request, reason, "unsupported");
    case "team.profile.create.request":
      return teamError("team.profile.create.response", request.requestId, reason, "unsupported");
    case "team.profile.inspect.request":
      return teamError("team.profile.inspect.response", request.requestId, reason, "unsupported");
    case "team.profile.update.request":
      return teamError("team.profile.update.response", request.requestId, reason, "unsupported");
    case "team.profile.archive.request":
      return teamError("team.profile.archive.response", request.requestId, reason, "unsupported");
    case "team.mission.start.request":
      return missionError("team.mission.start.response", request.requestId, reason, "unsupported");
    case "team.mission.inspect.request":
      return missionError(
        "team.mission.inspect.response",
        request.requestId,
        reason,
        "unsupported",
      );
    case "team.mission.cancel.request":
      return missionError("team.mission.cancel.response", request.requestId, reason, "unsupported");
    case "team.mission.attention.resolve.request":
      return missionError(
        "team.mission.attention.resolve.response",
        request.requestId,
        reason,
        "unsupported",
      );
  }
}

const TEAM_MISSIONS_REQUEST_TYPES = new Set<string>([
  "team.profile.create.request",
  "team.profile.list.request",
  "team.profile.inspect.request",
  "team.profile.update.request",
  "team.profile.archive.request",
  "team.mission.start.request",
  "team.mission.list.request",
  "team.mission.inspect.request",
  "team.mission.cancel.request",
  "team.mission.message.post.request",
  "team.mission.room.subscribe.request",
  "team.mission.room.unsubscribe.request",
  "team.mission.attention.resolve.request",
]);

function teamResponse(
  type:
    | "team.profile.create.response"
    | "team.profile.inspect.response"
    | "team.profile.update.response"
    | "team.profile.archive.response",
  requestId: string,
  team: Awaited<ReturnType<TeamMissionService["createTeam"]>>,
): SessionOutboundMessage {
  return {
    type,
    payload: { requestId, team, error: null, errorCode: null },
  } as SessionOutboundMessage;
}

function missionResponse(
  type:
    | "team.mission.start.response"
    | "team.mission.inspect.response"
    | "team.mission.cancel.response"
    | "team.mission.attention.resolve.response",
  requestId: string,
  mission: Awaited<ReturnType<TeamMissionService["startMission"]>>,
): SessionOutboundMessage {
  return {
    type,
    payload: { requestId, mission, error: null, errorCode: null },
  } as SessionOutboundMessage;
}

function teamError(
  type:
    | "team.profile.create.response"
    | "team.profile.inspect.response"
    | "team.profile.update.response"
    | "team.profile.archive.response",
  requestId: string,
  error: string,
  errorCode: string,
): SessionOutboundMessage {
  return { type, payload: { requestId, team: null, error, errorCode } } as SessionOutboundMessage;
}

function missionError(
  type:
    | "team.mission.start.response"
    | "team.mission.inspect.response"
    | "team.mission.cancel.response"
    | "team.mission.attention.resolve.response",
  requestId: string,
  error: string,
  errorCode: string,
): SessionOutboundMessage {
  return {
    type,
    payload: { requestId, mission: null, error, errorCode },
  } as SessionOutboundMessage;
}

function roomPostError(
  request: Extract<TeamRuntimeRequest, { type: "team.mission.message.post.request" }>,
  error: string,
  errorCode: string,
): SessionOutboundMessage {
  return {
    type: "team.mission.message.post.response",
    payload: {
      requestId: request.requestId,
      missionId: request.missionId,
      message: null,
      error,
      errorCode,
    },
  };
}

function roomSubscribeError(
  request: Extract<TeamRuntimeRequest, { type: "team.mission.room.subscribe.request" }>,
  error: string,
  errorCode: string,
): SessionOutboundMessage {
  return {
    type: "team.mission.room.subscribe.response",
    payload: {
      requestId: request.requestId,
      missionId: request.missionId,
      messages: [],
      cursor: 0,
      hasMore: false,
      error,
      errorCode,
    },
  };
}

function roomUnsubscribeError(
  request: Extract<TeamRuntimeRequest, { type: "team.mission.room.unsubscribe.request" }>,
  error: string,
  errorCode: string,
): SessionOutboundMessage {
  return {
    type: "team.mission.room.unsubscribe.response",
    payload: {
      requestId: request.requestId,
      missionId: request.missionId,
      error,
      errorCode,
    },
  };
}

function errorResponse(request: TeamRuntimeRequest, error: unknown): SessionOutboundMessage {
  const errorCode = errorCodeFor(error);
  const message = error instanceof Error ? error.message : "Team Missions request failed";
  switch (request.type) {
    case "team.profile.list.request":
      return {
        type: "team.profile.list.response",
        payload: { requestId: request.requestId, teams: [], error: message, errorCode },
      };
    case "team.mission.list.request":
      return {
        type: "team.mission.list.response",
        payload: { requestId: request.requestId, missions: [], error: message, errorCode },
      };
    case "team.mission.message.post.request":
      return roomPostError(request, message, errorCode);
    case "team.mission.room.subscribe.request":
      return roomSubscribeError(request, message, errorCode);
    case "team.mission.room.unsubscribe.request":
      return roomUnsubscribeError(request, message, errorCode);
    case "team.profile.create.request":
      return teamError("team.profile.create.response", request.requestId, message, errorCode);
    case "team.profile.inspect.request":
      return teamError("team.profile.inspect.response", request.requestId, message, errorCode);
    case "team.profile.update.request":
      return teamError("team.profile.update.response", request.requestId, message, errorCode);
    case "team.profile.archive.request":
      return teamError("team.profile.archive.response", request.requestId, message, errorCode);
    case "team.mission.start.request":
      return missionError("team.mission.start.response", request.requestId, message, errorCode);
    case "team.mission.inspect.request":
      return missionError("team.mission.inspect.response", request.requestId, message, errorCode);
    case "team.mission.cancel.request":
      return missionError("team.mission.cancel.response", request.requestId, message, errorCode);
    case "team.mission.attention.resolve.request":
      return missionError(
        "team.mission.attention.resolve.response",
        request.requestId,
        message,
        errorCode,
      );
  }
}

function errorCodeFor(error: unknown): string {
  if (error instanceof TeamApplicationError) return error.code;
  if (!(error instanceof Error)) return "internal_error";
  if (error.name.includes("RevisionConflict")) return "revision_conflict";
  if (error.name.includes("NotFound")) return "not_found";
  if (error.name.includes("Conflict")) return "conflict";
  return "internal_error";
}

async function requireResource<T>(
  resource: Promise<T | null>,
  code: string,
  id: string,
): Promise<T> {
  const resolved = await resource;
  if (!resolved) throw new TeamApplicationError(code, `${id} does not exist`);
  return resolved;
}
