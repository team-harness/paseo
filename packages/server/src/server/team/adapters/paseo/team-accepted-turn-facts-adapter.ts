import type { AgentManager, AgentRecordChange } from "../../../agent/agent-manager.js";
import type { AgentStorage } from "../../../agent/agent-storage.js";
import type {
  TeamAcceptedTurnFactsPort,
  TeamAcceptedTurnReference,
  TeamTerminalTurnFact,
} from "../../application/ports.js";
import type { AcceptedTurnFact } from "../../domain/assignment-contract-validation.js";
import { TEAM_MISSION_ID_LABEL } from "./team-participant-adapter.js";

interface PaseoTeamAcceptedTurnFactsAdapterOptions {
  agentStorage: AgentStorage;
  agentManager: AgentManager;
}

export class PaseoTeamAcceptedTurnFactsAdapter implements TeamAcceptedTurnFactsPort {
  private terminalFactListener: ((fact: TeamTerminalTurnFact) => Promise<void>) | null = null;
  private readonly pendingChanges = new Map<string, TerminalTurnChange>();
  private readonly pendingFacts = new Map<string, TeamTerminalTurnFact>();
  private readonly unsubscribeAgentChanges: () => void;
  private terminalFactQueue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: PaseoTeamAcceptedTurnFactsAdapterOptions) {
    this.unsubscribeAgentChanges = this.options.agentManager.onAgentRecordChange(async (change) => {
      if (this.stopped || !isTerminalTurnChange(change)) return;
      this.pendingChanges.set(turnFactKey(change.agentId, change.turnId), change);
      await this.enqueueTerminalFactDrain();
    });
  }

  onTerminalFact(listener: (fact: TeamTerminalTurnFact) => Promise<void>): void {
    if (this.stopped) return;
    this.terminalFactListener = listener;
    if (this.pendingChanges.size > 0 || this.pendingFacts.size > 0) {
      void this.enqueueTerminalFactDrain().catch(() => undefined);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.terminalFactListener = null;
    this.pendingChanges.clear();
    this.pendingFacts.clear();
    this.unsubscribeAgentChanges();
  }

  async read(
    turns: ReadonlyArray<TeamAcceptedTurnReference>,
  ): Promise<ReadonlyMap<string, AcceptedTurnFact>> {
    const facts = await Promise.all(
      turns.map(async (turn): Promise<AcceptedTurnFact> => {
        const record = await this.options.agentStorage.get(turn.runtimeAgentId);
        const terminal = record?.turnOutcomes?.find((outcome) => outcome.turnId === turn.turnId);
        const outcome =
          terminal?.outcome ?? (record?.activeTurn?.turnId === turn.turnId ? "running" : "unknown");
        return {
          assignmentId: turn.assignmentId,
          turnId: turn.turnId,
          runtimeAgentId: turn.runtimeAgentId,
          outcome,
        };
      }),
    );
    return new Map(facts.map((fact) => [fact.turnId, fact]));
  }

  private async enqueueTerminalFactDrain(): Promise<void> {
    const next = this.terminalFactQueue
      .catch(() => undefined)
      .then(() => this.drainTerminalFacts());
    this.terminalFactQueue = next;
    await next;
  }

  private async drainTerminalFacts(): Promise<void> {
    let firstError: unknown = null;
    const blockedAgentIds = new Set<string>();
    for (const [key, change] of this.pendingChanges) {
      if (blockedAgentIds.has(change.agentId)) continue;
      try {
        const record = await this.options.agentStorage.get(change.agentId);
        const missionId = record?.labels?.[TEAM_MISSION_ID_LABEL]?.trim();
        this.pendingChanges.delete(key);
        if (!missionId) continue;
        this.pendingFacts.set(key, {
          missionId,
          turnId: change.turnId,
          runtimeAgentId: change.agentId,
          outcome: change.outcome,
        });
      } catch (error) {
        firstError ??= error;
        blockedAgentIds.add(change.agentId);
      }
    }
    if (this.terminalFactListener) {
      const blockedMissionIds = new Set<string>();
      for (const [key, fact] of this.pendingFacts) {
        if (blockedMissionIds.has(fact.missionId)) continue;
        try {
          await this.terminalFactListener(fact);
          this.pendingFacts.delete(key);
        } catch (error) {
          firstError ??= error;
          blockedMissionIds.add(fact.missionId);
        }
      }
    }
    if (firstError) throw firstError;
  }
}

type TerminalTurnChange = Extract<AgentRecordChange, { kind: "turn_settled" }>;

function isTerminalTurnChange(
  change: AgentRecordChange,
): change is Extract<AgentRecordChange, { kind: "turn_settled" }> {
  return change.kind === "turn_settled";
}

function turnFactKey(agentId: string, turnId: string): string {
  return `${agentId}\0${turnId}`;
}
