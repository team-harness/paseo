import type {
  MissionAssignmentContract,
  MissionMemberRuntimeSnapshot,
  TeamExecutionProfile,
  TeamMission,
  TeamRoomMessage,
  TeamRoomMessageAuthor,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";

import type { TeamPersistenceReconciliationResult } from "../persistence/reconciliation.js";
import type {
  AcceptedTurnFact,
  AcceptedTurnOutcome,
} from "../domain/assignment-contract-validation.js";
import type { TeamOperationPermit } from "./team-operation-coordinator.js";

export type TeamIdentityKind =
  | "team"
  | "member"
  | "mission"
  | "room"
  | "agent"
  | "start"
  | "replacement"
  | "archive"
  | "finish"
  | "event"
  | "assignment"
  | "lease"
  | "delivery"
  | "message";

export interface TeamIdentityPort {
  next(kind: TeamIdentityKind): string;
}

export interface TeamClockPort {
  now(): string;
}

export interface ProviderCapabilityResolver {
  resolve(executionProfile: TeamExecutionProfile): Promise<MissionMemberRuntimeSnapshot>;
}

export interface TeamRoomPort {
  createMissionRoom(input: {
    roomId: string;
    teamId: string;
    missionId: string;
    teamName: string;
    objective: string;
  }): Promise<void>;
}

export interface TeamParticipantPort {
  createLead(input: {
    agentId: string;
    teamId: string;
    missionId: string;
    workspaceId: string;
    memberId: string;
    role: string;
    mentionHandle: string;
    executionProfile: TeamExecutionProfile;
    bindingEpoch: number;
  }): Promise<void>;
  archiveParticipant(input: { agentId: string; teamId: string; missionId: string }): Promise<void>;
}

export interface TeamMemberHistory {
  agentId: string;
  updateCount: number;
  totalActivities: number;
  shownActivities: number;
  currentModeId: string | null;
  content: string;
}

export interface TeamMemberHistoryPort {
  read(input: { agentId: string; limit: number }): Promise<TeamMemberHistory>;
}

export interface TeamMessagePort {
  post(input: {
    messageId: string;
    missionId: string;
    roomId: string;
    author: TeamRoomMessageAuthor;
    body: string;
    replyToMessageId?: string | null;
    mentionAgentIds?: readonly string[];
  }): Promise<{ message: TeamRoomMessage; cursor: number }>;
  read(input: {
    missionId: string;
    roomId: string;
    afterCursor?: number;
    limit?: number;
  }): Promise<{ messages: TeamRoomMessage[]; cursor: number; hasMore: boolean }>;
}

export interface TeamAcceptedTurnFactsPort {
  read(
    turns: ReadonlyArray<TeamAcceptedTurnReference>,
  ): Promise<ReadonlyMap<string, AcceptedTurnFact>>;
  onTerminalFact(listener: (fact: TeamTerminalTurnFact) => Promise<void>): void;
}

export interface TeamAcceptedTurnReference {
  assignmentId: string;
  turnId: string;
  runtimeAgentId: string;
  semanticState: MissionAssignmentContract["semanticState"];
}

export interface TeamTerminalTurnFact {
  missionId: string;
  turnId: string;
  runtimeAgentId: string;
  outcome: Exclude<AcceptedTurnOutcome, "running">;
}

export type TeamRecipientAttentionAttempt = "notified" | "busy" | "unavailable";

export interface TeamRecipientAttentionPort {
  attempt(input: {
    deliveryId: string;
    missionId: string;
    origin: "agent_message" | "human_mention";
    roomMessageId: string;
    recipientAgentId: string;
    bindingEpoch: number;
    attempt: number;
  }): Promise<TeamRecipientAttentionAttempt>;
  onEligibilityChange(listener: (agentId: string) => Promise<void>): void;
}

export interface TeamRuntimeEventPort {
  publishTeam(team: TeamV2): Promise<void>;
  publishMission(mission: TeamMission): Promise<void>;
}

export interface TeamMissionReconcilePort {
  reconcileMission(missionId: string, permit?: TeamOperationPermit): Promise<unknown>;
}

export interface TeamRecoveryPort {
  reconcile(): Promise<TeamPersistenceReconciliationResult>;
}
