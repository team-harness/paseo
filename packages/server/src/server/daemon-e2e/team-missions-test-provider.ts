import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  FetchCatalogOptions,
} from "../agent/agent-sdk-types.js";

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsNativePaseoTools: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

const MODES: AgentMode[] = [
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    isUnattended: true,
  },
];

const MODELS: AgentModelDefinition[] = [
  {
    provider: "claude",
    id: "team-e2e-model",
    label: "Team E2E model",
    isDefault: true,
  },
];

export interface AcceptedTestProviderTurn {
  turnId: string;
  sessionId: string;
  agentId: string | null;
  cwd: string;
  prompt: string;
  clientMessageId: string | null;
  assignmentId: string | null;
  state: "running" | "completed" | "canceled";
  artifactPaths: string[];
}

interface TurnWaiter {
  predicate: (turns: readonly AcceptedTestProviderTurn[]) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Deterministic provider adapter for real-daemon Team tests.
 *
 * It does not know about Mission state and never deduplicates a dispatch. Every
 * startTurn call creates a new provider-side acceptance record. The test drives
 * artifact writes and terminal events through this adapter, while the daemon
 * remains responsible for dispatch idempotency, DAG ordering, and persistence.
 */
export class TeamMissionsTestProvider implements AgentClient {
  readonly provider = "claude";
  readonly capabilities = CAPABILITIES;
  readonly turns: AcceptedTestProviderTurn[] = [];
  readonly sessions: TeamMissionsTestSession[] = [];
  private readonly sessionsById = new Map<string, TeamMissionsTestSession>();
  private readonly waiters = new Set<TurnWaiter>();
  private nextSessionOrdinal = 1;
  private nextTurnOrdinal = 1;

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return this.createControlledSession(
      `team-e2e-session-${this.nextSessionOrdinal++}`,
      config,
      launchContext?.agentId ?? null,
    );
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const existing = this.sessionsById.get(handle.sessionId);
    if (existing) return existing;
    return this.createControlledSession(
      handle.sessionId,
      {
        provider: this.provider,
        cwd: overrides?.cwd ?? process.cwd(),
        ...overrides,
      },
      launchContext?.agentId ?? null,
    );
  }

  async fetchCatalog(_options: FetchCatalogOptions) {
    return { models: MODELS, modes: MODES, defaultModeId: MODES[0]?.id ?? null };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  assignmentTurns(): AcceptedTestProviderTurn[] {
    return this.turns.filter((turn) => turn.assignmentId !== null);
  }

  async waitForTurns(
    predicate: (turns: readonly AcceptedTestProviderTurn[]) => boolean,
    label: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    if (predicate(this.turns)) return;
    await new Promise<void>((resolve, reject) => {
      const waiter: TurnWaiter = {
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for deterministic provider state: ${label}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async writeArtifact(turnId: string, relativePath: string, content: string): Promise<void> {
    const turn = this.requireTurn(turnId);
    if (turn.state !== "running") {
      throw new Error(`Turn ${turnId} is ${turn.state}; it cannot write an artifact`);
    }
    const normalized = path.posix.normalize(relativePath);
    if (path.isAbsolute(relativePath) || normalized === ".." || normalized.startsWith("../")) {
      throw new Error(`Artifact path escapes the workspace: ${relativePath}`);
    }
    const absolutePath = path.join(turn.cwd, normalized);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    turn.artifactPaths.push(normalized);
  }

  async completeTurn(turnId: string): Promise<void> {
    await this.requireSessionForTurn(turnId).settleTurn(turnId, "completed");
  }

  private createControlledSession(
    sessionId: string,
    config: AgentSessionConfig,
    agentId: string | null,
  ): TeamMissionsTestSession {
    const session = new TeamMissionsTestSession({
      controller: this,
      sessionId,
      config: { ...config },
      agentId,
    });
    this.sessions.push(session);
    this.sessionsById.set(sessionId, session);
    return session;
  }

  acceptTurn(input: {
    session: TeamMissionsTestSession;
    prompt: AgentPromptInput;
    options?: AgentRunOptions;
  }): AcceptedTestProviderTurn {
    const prompt = promptText(input.prompt);
    const turn: AcceptedTestProviderTurn = {
      turnId: `team-e2e-turn-${this.nextTurnOrdinal++}`,
      sessionId: input.session.id,
      agentId: input.session.agentId,
      cwd: input.session.cwd,
      prompt,
      clientMessageId: input.options?.clientMessageId ?? null,
      assignmentId: parseAssignmentId(prompt),
      state: "running",
      artifactPaths: [],
    };
    this.turns.push(turn);
    this.resolveWaiters();
    return turn;
  }

  turnSettled(): void {
    this.resolveWaiters();
  }

  private resolveWaiters(): void {
    for (const waiter of this.waiters) {
      if (!waiter.predicate(this.turns)) continue;
      clearTimeout(waiter.timeout);
      this.waiters.delete(waiter);
      waiter.resolve();
    }
  }

  private requireTurn(turnId: string): AcceptedTestProviderTurn {
    const turn = this.turns.find((candidate) => candidate.turnId === turnId);
    if (!turn) throw new Error(`Unknown deterministic provider turn ${turnId}`);
    return turn;
  }

  private requireSessionForTurn(turnId: string): TeamMissionsTestSession {
    const turn = this.requireTurn(turnId);
    const session = this.sessionsById.get(turn.sessionId);
    if (!session) throw new Error(`Session ${turn.sessionId} is unavailable`);
    return session;
  }
}

interface TeamMissionsTestSessionOptions {
  controller: TeamMissionsTestProvider;
  sessionId: string;
  config: AgentSessionConfig;
  agentId: string | null;
}

class TeamMissionsTestSession implements AgentSession {
  readonly provider = "claude";
  readonly capabilities = CAPABILITIES;
  readonly id: string;
  readonly agentId: string | null;
  readonly cwd: string;
  private readonly controller: TeamMissionsTestProvider;
  private readonly config: AgentSessionConfig;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly history: AgentStreamEvent[] = [];
  private activeTurnId: string | null = null;

  constructor(options: TeamMissionsTestSessionOptions) {
    this.controller = options.controller;
    this.id = options.sessionId;
    this.config = options.config;
    this.agentId = options.agentId;
    this.cwd = options.config.cwd;
  }

  async run(_prompt: AgentPromptInput): Promise<AgentRunResult> {
    return {
      sessionId: this.id,
      finalText: "deterministic provider run",
      timeline: [{ type: "assistant_message", text: "deterministic provider run" }],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.activeTurnId) throw new Error(`Session ${this.id} already has an active turn`);
    const turn = this.controller.acceptTurn({ session: this, prompt, options });
    this.activeTurnId = turn.turnId;
    queueMicrotask(() => {
      this.emit({ type: "thread_started", provider: this.provider, sessionId: this.id });
      this.emit({ type: "turn_started", provider: this.provider, turnId: turn.turnId });
    });
    return { turnId: turn.turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.history) yield structuredClone(event);
  }

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return structuredClone(MODES);
  }

  async getCurrentMode(): Promise<string | null> {
    return this.config.modeId ?? null;
  }

  async setMode(modeId: string): Promise<void> {
    this.config.modeId = modeId;
  }

  getPendingPermissions(): [] {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {
    if (this.activeTurnId) await this.settleTurn(this.activeTurnId, "canceled");
  }

  async close(): Promise<void> {}

  async settleTurn(turnId: string, outcome: "completed" | "canceled"): Promise<void> {
    if (this.activeTurnId !== turnId) {
      throw new Error(`Turn ${turnId} is not active in session ${this.id}`);
    }
    const turn = this.controller.turns.find((candidate) => candidate.turnId === turnId);
    if (!turn) throw new Error(`Unknown deterministic provider turn ${turnId}`);
    turn.state = outcome;
    this.emit(
      outcome === "completed"
        ? {
            type: "turn_completed",
            provider: this.provider,
            turnId,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        : { type: "turn_canceled", provider: this.provider, turnId, reason: "test interrupt" },
    );
    this.activeTurnId = null;
    this.controller.turnSettled();
  }

  private emit(event: AgentStreamEvent): void {
    this.history.push(structuredClone(event));
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt
    .filter(
      (block): block is Extract<(typeof prompt)[number], { type: "text" }> => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

function parseAssignmentId(prompt: string): string | null {
  return /Assignment "([^"]+)"/.exec(prompt)?.[1] ?? null;
}
