# Data Model

## Project identity

Projects are allocated for the exact root selected by the caller, normalized lexically with `path.resolve` (never `realpath`). New project IDs are opaque `prj_<16 hex>` values. Existing remote-shaped or path-shaped IDs are retained as readable compatibility records and are never rekeyed. An active exact root is idempotent; archived-only matches do not resurrect an old project. Workspace `projectId` is stable membership: reconciliation may update git-derived kind and branch metadata, but never rehomes a workspace or changes a project's root, ID, or default name.

`projectKey` is a persisted, opaque equivalence key used only to group the same logical project
across hosts. It is separate from the host-local `projectId`; today's producer prefers a normalized
Git remote and otherwise uses the local project root. Consumers never derive it from live Git.
Creation persists it with the project, and normal boot reconciliation fills it for
older records where the field is absent—there is no migration.

`kind` and `projectKey` are mutable metadata, not identity. Workspace reconciliation watches active project roots and
updates those fields and `updatedAt` when Git facts change, preserving the project's ID, root path,
names, and workspace foreign keys. Attached workspaces are independently refreshed
from their own cwd, so an explicit project root never implies a workspace checkout. Empty projects
are observed too.

The workspace registry model defines placement once: initial directory/worktree construction,
mutable reconciliation fields, and the persisted-to-wire checkout projection. Its update policy
preserves `displayName` and `baseBranch`. `WorkspaceProvisioningService` owns the corresponding
registry writes, so directory opens, agent imports, and worktree creation all enter through that
service instead of constructing records independently. The workspace record is then the durable
placement authority: `cwd` is the exact execution directory, while `worktreeRoot` is the backing
checkout root. They intentionally differ for an exact subproject inside a worktree. Archive,
restore, branch auto-name, and descriptor flows consume those persisted facts rather than
rediscovering ownership from a directory that may already be gone. Reconciliation may refresh
mutable placement facts, but never changes `projectId`, `cwd`, `displayName`, or `baseBranch`.
Workspace archive runs lifecycle teardown from the exact `cwd` but removes only the backing
`worktreeRoot` after its last active reference disappears. Worktree recovery recreates that backing
checkout from `mainRepoRoot`, then restores the relative path from `worktreeRoot` to `cwd`.

Paseo uses **file-based JSON persistence** instead of a traditional database. All data is validated at runtime with Zod schemas. Most stores write atomically (write to temp file, then rename); a few still use plain `writeFile` — see each section. There is no schema-versioning/migration framework — schemas rely on optional fields with defaults for forward compatibility, with a small amount of inline normalization in `persisted-config.ts` for legacy provider/speech entries.

All server-side stores live under `$PASEO_HOME` (defaults to `~/.paseo`).

## Store Surface Rules

Store APIs own persistence atomicity and should not make services coordinate raw reads and writes. A good store method maps cleanly to one SQL statement or one SQL transaction, even when the current implementation is JSON files. If a caller needs a queue, lock, read-merge-write loop, or uniqueness race workaround, that behavior belongs behind the store surface.

---

## Directory layout

```
$PASEO_HOME/
├── config.json                          # Daemon configuration
├── prompt-library.json                  # Host-owned saved Prompt library
├── server-id                            # Stable daemon identifier (plain text, "srv_<base64url>")
├── daemon-keypair.json                  # E2EE keypair for relay (mode 0600)
├── paseo.pid                            # Daemon PID lock file
├── daemon.log                           # Default log file (path configurable)
├── agents/
│   └── {sanitized-cwd}/
│       └── {agentId}.json               # One file per agent
├── usage-ledger/
│   └── {agentId}.json                   # Usage contributions and turn snapshot bases
├── status-summary/
│   └── session-pins.json                 # Host-owned pinned agent/session shortcuts
├── schedules/
│   └── {scheduleId}.json                # One file per schedule
├── teams/
│   ├── {teamId}.json                    # One file per team; roster is the membership authority
│   └── inbox/{teamId}.inbox.json        # That team's task ledger and undelivered completions
├── chat/
│   ├── rooms/{room-id}.json             # One room and its messages
│   └── .migrated                        # Single-file store has been dealt with
├── loops/
│   └── loops.json                       # All loop records
├── projects/
│   ├── projects.json                    # Project registry
│   ├── workspaces.json                  # Workspace registry
│   └── icons/                           # Host-local custom project icon images
├── runtime/
│   └── managed-processes/
│       └── {recordId}.json              # Helper processes owned by Paseo; reconciled on daemon bootstrap
└── push-tokens.json                     # Expo push notification tokens
```

The `agents/{sanitized-cwd}/` directory name is derived from the agent's `cwd` by stripping the filesystem root and replacing path separators with `-` (Windows drive letters become a `C-` style prefix). Persistent server stores write atomically by writing a temp file in the target directory and then renaming it into place.

---

## 1. Agent Record

**Path:** `$PASEO_HOME/agents/{project-dir}/{agentId}.json`

Each agent is stored as a separate JSON file, grouped by project directory.

| Field                | Type                                     | Description                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `string`                                 | UUID, primary key                                                                                                                                                                                                                                                                                                                                                                   |
| `provider`           | `string`                                 | Agent provider (`"claude"`, `"codex"`, `"opencode"`, etc.)                                                                                                                                                                                                                                                                                                                          |
| `cwd`                | `string`                                 | Working directory the agent operates in                                                                                                                                                                                                                                                                                                                                             |
| `workspaceId`        | `string?`                                | Owning workspace id — the single source of ownership. Every agent is stamped with one at create time; legacy cwd-only records are backfilled once by `migrations/backfill-workspace-id.migration.ts` (the only place a cwd→id mapping exists). Runtime code never infers ownership or status from cwd: status is computed per `workspaceId`, and same-cwd siblings are independent. |
| `createdAt`          | `string` (ISO 8601)                      | Creation timestamp                                                                                                                                                                                                                                                                                                                                                                  |
| `updatedAt`          | `string` (ISO 8601)                      | Last update timestamp                                                                                                                                                                                                                                                                                                                                                               |
| `lastActivityAt`     | `string?` (ISO 8601)                     | Last activity timestamp                                                                                                                                                                                                                                                                                                                                                             |
| `lastUserMessageAt`  | `string?` (ISO 8601)                     | Last user message timestamp                                                                                                                                                                                                                                                                                                                                                         |
| `title`              | `string?`                                | User-visible title                                                                                                                                                                                                                                                                                                                                                                  |
| `labels`             | `Record<string, string>`                 | Key-value labels (default `{}`). `paseo.parent-agent-id` is set automatically for agent-scoped creation and removed by detach — see [agent-lifecycle.md](./agent-lifecycle.md)                                                                                                                                                                                                      |
| `lastStatus`         | `AgentStatus`                            | One of: `"initializing"`, `"idle"`, `"running"`, `"error"`, `"closed"`. `closed` means the record is resumable but has no live provider runtime; archive remains represented separately by `archivedAt`.                                                                                                                                                                            |
| `lastModeId`         | `string?`                                | Last active mode ID                                                                                                                                                                                                                                                                                                                                                                 |
| `config`             | `SerializableConfig?`                    | Agent session configuration (see below)                                                                                                                                                                                                                                                                                                                                             |
| `runtimeInfo`        | `RuntimeInfo?`                           | Live runtime state (see below)                                                                                                                                                                                                                                                                                                                                                      |
| `features`           | `AgentFeature[]?`                        | Provider-reported features (toggles/selects)                                                                                                                                                                                                                                                                                                                                        |
| `persistence`        | `PersistenceHandle?`                     | Handle for resuming sessions                                                                                                                                                                                                                                                                                                                                                        |
| `lastError`          | `string?` (nullable)                     | Last error message, if any                                                                                                                                                                                                                                                                                                                                                          |
| `requiresAttention`  | `boolean?`                               | Whether the agent needs user attention                                                                                                                                                                                                                                                                                                                                              |
| `attentionReason`    | `"finished" \| "error" \| "permission"?` | Why attention is needed                                                                                                                                                                                                                                                                                                                                                             |
| `attentionTimestamp` | `string?` (ISO 8601)                     | When attention was flagged                                                                                                                                                                                                                                                                                                                                                          |
| `internal`           | `boolean?`                               | Whether this is a system-internal agent (loop workers, etc.)                                                                                                                                                                                                                                                                                                                        |
| `archivedAt`         | `string?` (ISO 8601)                     | Soft-delete timestamp                                                                                                                                                                                                                                                                                                                                                               |
| `turnOutcomes`       | `TurnOutcome[]?`                         | How recent turns ended, newest last, capped at 100. Lets a caller ask "how did turn X end" long after the stream event is gone; `lastStatus` cannot answer that.                                                                                                                                                                                                                    |
| `activeTurn`         | `ActiveTurn?` (nullable)                 | The turn in flight, stamped with the daemon run that started it. A turn cannot outlive its daemon, so an entry from an earlier run is dropped on load — otherwise a reader waits forever on a turn that died with its process.                                                                                                                                                      |

`turnOutcomes` and `activeTurn` live only on the record: a `ManagedAgent` snapshot knows nothing about them, so `AgentStorage` carries them forward inside its write queue rather than at each call site. Writes go through that queue as read-modify-write, because two turns settling back to back would otherwise both read the record before either write lands.

### Nested: TurnOutcome

| Field     | Type                                    | Description                     |
| --------- | --------------------------------------- | ------------------------------- |
| `turnId`  | `string`                                | Daemon-owned turn identity      |
| `outcome` | `"completed" \| "failed" \| "canceled"` | How the turn ended              |
| `endedAt` | `string` (ISO 8601)                     | When the terminal event arrived |

### Nested: ActiveTurn

| Field         | Type                | Description                                         |
| ------------- | ------------------- | --------------------------------------------------- |
| `turnId`      | `string`            | Daemon-owned turn identity                          |
| `startedAt`   | `string` (ISO 8601) | When the provider accepted the turn                 |
| `daemonRunId` | `string`            | The daemon run that owns it; stale runs are cleared |

### Nested: SerializableConfig

| Field              | Type                       | Description                  |
| ------------------ | -------------------------- | ---------------------------- |
| `title`            | `string?`                  | Configured title             |
| `modeId`           | `string?`                  | Configured mode              |
| `model`            | `string?`                  | Configured model             |
| `thinkingOptionId` | `string?`                  | Thinking/reasoning level     |
| `featureValues`    | `Record<string, unknown>?` | Feature preference overrides |
| `extra`            | `Record<string, any>?`     | Provider-specific config     |
| `systemPrompt`     | `string?`                  | Custom system prompt         |
| `mcpServers`       | `Record<string, any>?`     | MCP server configurations    |

### Nested: RuntimeInfo

| Field              | Type                       | Description                    |
| ------------------ | -------------------------- | ------------------------------ |
| `provider`         | `string`                   | Active provider                |
| `sessionId`        | `string?`                  | Active session ID              |
| `model`            | `string?`                  | Active model                   |
| `thinkingOptionId` | `string?`                  | Active thinking option         |
| `modeId`           | `string?`                  | Active mode                    |
| `extra`            | `Record<string, unknown>?` | Provider-specific runtime data |

### Nested: PersistenceHandle

| Field          | Type                   | Description                                                           |
| -------------- | ---------------------- | --------------------------------------------------------------------- |
| `provider`     | `string`               | Provider that owns the session                                        |
| `sessionId`    | `string`               | Session ID for resumption                                             |
| `nativeHandle` | `any?`                 | Provider-specific handle (Codex thread ID, Claude resume token, etc.) |
| `metadata`     | `Record<string, any>?` | Extra metadata                                                        |

### Nested: AgentFeature (discriminated union on `type`)

**Toggle:**

| Field         | Type       |
| ------------- | ---------- |
| `type`        | `"toggle"` |
| `id`          | `string`   |
| `label`       | `string`   |
| `description` | `string?`  |
| `tooltip`     | `string?`  |
| `icon`        | `string?`  |
| `value`       | `boolean`  |

**Select:**

| Field         | Type                  |
| ------------- | --------------------- |
| `type`        | `"select"`            |
| `id`          | `string`              |
| `label`       | `string`              |
| `description` | `string?`             |
| `tooltip`     | `string?`             |
| `icon`        | `string?`             |
| `value`       | `string \| null`      |
| `options`     | `AgentSelectOption[]` |

---

## Runtime-only Terminal Sessions

Terminals are live daemon state, not persisted JSON records. A terminal carries a `workspaceId` while it is running; workspace-scoped terminal lists include only terminals with the matching `workspaceId`. Legacy live terminals without an owner remain visible to unscoped terminal reads but contribute to no workspace status.

Terminal activity contributes to the workspace status bucket **per `workspaceId`**: a working terminal drives `running` onto the workspace it carries only. Same-`cwd` siblings are untouched; terminal visibility is likewise `workspaceId`-scoped.

---

## 2. Usage Ledger

**Path:** `$PASEO_HOME/usage-ledger/{agentId}.json`

The usage ledger stores normalized token and cost contributions emitted by agent providers. It is independent from agent records and timeline history, so archived agents keep their historical usage and daemon restart can rebuild lifetime and today totals without live provider state.

Each file contains:

| Field           | Type                   | Description                                                                   |
| --------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `version`       | `1`                    | Store payload version                                                         |
| `records`       | `UsageLedgerRecord[]`  | Contribution records for one agent                                            |
| `snapshotBases` | `UsageSnapshotBasis[]` | Last accepted turn-scoped provider snapshot used to dedupe and compute deltas |

`UsageLedgerRecord` stores `agentId`, `provider`, `basisScope: "turn"`, `usageTurnKey`, optional `sessionId` / `workspaceId` / `model` / `turnId`, `cwd`, `sourceEventType`, `timestamp`, `basisKey`, raw `usage`, and normalized `contribution`.

`contribution` only accumulates `inputTokens`, `cachedInputTokens`, `outputTokens`, and `totalCostUsd`. Context-window fields remain in the raw usage snapshot when provided, but they are not included in contribution totals or record identity.

The ledger uses turn-scoped snapshot bases. `usage_updated` and `turn_completed` for the same turn share one `basisKey`, and identical final snapshots do not double-count. Provider snapshot regressions within the same turn are treated as stale events and do not write negative contribution or lower the stored basis.

Provider adapters must normalize native usage semantics into a monotonic, turn-scoped snapshot before emitting usage events. In particular, Codex app-server reports both a thread-cumulative `total` and a request-scoped `last`; its adapter derives thread-total deltas, accumulates them within the active Paseo turn, and uses `last` only as the safe baseline for the first observation or a native counter reset. Passing `last` through directly causes valid later requests to look stale, while passing the full thread `total` through would recount resumed history. A `usageTurnKey` must also remain unique across provider-session and daemon restarts because snapshot bases persist beyond either process.

Writes use `writeJsonFileAtomic`. Files are parsed with Zod at daemon bootstrap; corrupt or schema-invalid ledger files are logged and skipped instead of blocking agent lifecycle. There is no migration framework. Compatibility is maintained by accepting optional fields and keeping new persisted data isolated from the agent record schema.

---

## 3. Saved Prompt Library

**Path:** `$PASEO_HOME/prompt-library.json`

The daemon owns one saved Prompt library for the Host. Every browser, desktop app, mobile app, and
terminal connected to that Host reads and changes the same collection. Prompts are not scoped to a
project, workspace, or agent.

```typescript
{
  version: 1,
  items: Array<{
    id: string;
    title: string;
    content: string;
  }>
}
```

Writes are atomic and serialized. Skip malformed individual entries so one bad Prompt does not hide
the rest. Treat malformed JSON or a malformed root envelope as a load error; normal CRUD must not
overwrite it, while an explicit clear can recover the library.

`@paseo:prompt-library` is the legacy app-local AsyncStorage key. On the first library open, the app
asks before merging valid legacy entries into the current Host. Merge is idempotent by exact
normalized title and content, preserves Host order, and allocates a new ID when an imported ID
collides. Remove the legacy key only after the Host merge succeeds so a failed migration can be
retried without data loss.

---

## 4. Daemon Configuration

**Path:** `$PASEO_HOME/config.json`

Single file, validated with `PersistedConfigSchema`.

```
{
  version: 1,
  daemon: {
    listen: "127.0.0.1:6767",
    hostnames: true | string[],   // legacy alias `allowedHosts` is migrated on load
    trustedProxies: true | string[], // defaults to ["loopback"]; Express proxy names/CIDRs
    mcp: { enabled: boolean, injectIntoAgents: boolean },
    git: { maxProcessesPerSecond: number, maxProcessConcurrency: number },
    appendSystemPrompt: string,    // appended to supported provider system/developer prompts
    cors: { allowedOrigins: string[] },
    relay: { enabled: boolean, endpoint: string, publicEndpoint: string, useTls: boolean, publicUseTls: boolean }, // new homes materialize enabled: false
    auth: { password: string }    // bcrypt hash, optional
  },
  app: {
    baseUrl: string
  },
  worktrees?: {
    root?: string            // optional root for new worktrees; defaults to $PASEO_HOME/worktrees
    servicePorts?: {         // optional dynamic service port allocation policy
      range?: string         // inclusive range, e.g. "3000-4000"
      portScript?: string    // executable that receives service/workspace context and prints one TCP port
    }
  },
  providers: {
    openai: {
      apiKey?: string,
      baseUrl?: string,
      stt?: { apiKey?: string, baseUrl?: string },
      tts?: { apiKey?: string, baseUrl?: string }
    },
    local: { modelsDir: string }
  },
  agents: {
    // ProviderOverrideSchema; legacy entries with `command: { mode, ... }` are migrated to the
    // current shape on load via `migrateProviderSettings`. Custom provider IDs must declare
    // `extends` (one of the built-ins or `"acp"`) and `label`. See `provider-launch-config.ts`.
    providers: Record<providerId, ProviderOverride>,
    metadataGeneration: {
      providers: [{ provider, model?, thinkingOptionId? }]
    }
  },
  features: {
    dictation: { enabled, stt: { provider, model, language, confidenceThreshold } },
    voiceMode: { enabled, llm, stt: { provider, model, language }, turnDetection, tts: { provider, model, voice, speakerId, speed } }
  },
  log: {
    level, format,
    console: { level, format },
    file: { level, path, rotate: { maxSize, maxFiles } }
  }
}
```

All fields are optional with sensible defaults.

### Git process limits

Git process limits are global to one daemon. The start-rate limit defaults to `64` processes per
second, and the concurrency limit defaults to `8`:

```json
{
  "daemon": {
    "git": {
      "maxProcessesPerSecond": 64,
      "maxProcessConcurrency": 8
    }
  }
}
```

`maxProcessesPerSecond` limits Git process starts in any one-second interval. The allowance can
start as a burst; it does not wait for earlier processes to exit. `maxProcessConcurrency` limits
the number of Git processes that have started but not exited. Every Git command uses both limits,
including initial workspace reads, filesystem-triggered refreshes, background checks, and explicit
requests.

Environment variables override `config.json`:

| Environment variable                 | Setting                  |
| ------------------------------------ | ------------------------ |
| `PASEO_GIT_MAX_PROCESSES_PER_SECOND` | `maxProcessesPerSecond`  |
| `PASEO_GIT_MAX_PROCESS_CONCURRENCY`  | `maxProcessConcurrency`  |
| `PASEO_GIT_CONCURRENCY`              | Legacy concurrency alias |

`PASEO_GIT_MAX_PROCESS_CONCURRENCY` wins when it and the legacy alias are both set. Restart the
daemon after changing the file or environment. Run `paseo daemon restart` for a standalone daemon.
For a desktop-managed daemon, fully quit and reopen Paseo Desktop.

`agents.metadataGeneration.providers` controls the preferred structured-generation fallback order for daemon-side metadata tasks such as commit messages, PR text, branch names, and generated agent titles. Entries are tried first in the configured order, then Paseo falls through to dynamically discovered defaults and finally the current selection when available.

Local speech model ids are intentionally narrow: STT uses `parakeet-tdt-0.6b-v2-int8`, TTS uses `kokoro-en-v0_19`, and turn detection uses the bundled Silero VAD model.

Set these to select OpenAI instead of local speech:

| Env var                        | Applies to                      |
| ------------------------------ | ------------------------------- |
| `PASEO_VOICE_STT_PROVIDER`     | Voice mode STT provider         |
| `PASEO_DICTATION_STT_PROVIDER` | Composer dictation STT provider |
| `PASEO_VOICE_TTS_PROVIDER`     | Voice mode TTS provider         |

OpenAI speech can be configured under `providers.openai`. STT and TTS resolve independently, so they can point at different endpoints:

```json
{
  "providers": {
    "openai": {
      "stt": {
        "apiKey": "sk-...",
        "baseUrl": "https://stt.example.com/v1"
      },
      "tts": {
        "apiKey": "sk-...",
        "baseUrl": "https://api.openai.com/v1"
      }
    }
  }
}
```

`providers.openai.stt` is used for both composer dictation and voice mode speech-to-text; `providers.openai.tts` is used for voice mode text-to-speech. The equivalent env vars are `OPENAI_STT_API_KEY`/`OPENAI_STT_BASE_URL` and `OPENAI_TTS_API_KEY`/`OPENAI_TTS_BASE_URL`. Each feature falls back to `providers.openai.apiKey`/`providers.openai.baseUrl`, then `OPENAI_API_KEY`/`OPENAI_BASE_URL`, when its own fields are unset. These settings apply only to Paseo OpenAI speech features, not to Codex or other OpenAI-backed tools.

Paseo uses these paths under the configured OpenAI base URL:

- dictation STT: `/v1/audio/transcriptions`
- voice mode STT: `/v1/audio/transcriptions`
- voice mode TTS: `/v1/audio/speech`

---

## 5. Schedule

**Path:** `$PASEO_HOME/schedules/{id}.json`

One file per schedule. ID is 8 hex characters.

| Field       | Type                                  | Description                      |
| ----------- | ------------------------------------- | -------------------------------- |
| `id`        | `string`                              | 8-char hex ID                    |
| `name`      | `string?`                             | Human-readable name              |
| `prompt`    | `string`                              | The prompt to send               |
| `cadence`   | `ScheduleCadence`                     | Timing (see below)               |
| `target`    | `ScheduleTarget`                      | What to run (see below)          |
| `status`    | `"active" \| "paused" \| "completed"` | Current state                    |
| `createdAt` | `string` (ISO 8601)                   |                                  |
| `updatedAt` | `string` (ISO 8601)                   |                                  |
| `nextRunAt` | `string?` (ISO 8601)                  | Next scheduled execution         |
| `lastRunAt` | `string?` (ISO 8601)                  | Last execution time              |
| `pausedAt`  | `string?` (ISO 8601)                  | When paused                      |
| `expiresAt` | `string?` (ISO 8601)                  | Auto-expire time                 |
| `maxRuns`   | `number?`                             | Max executions before completing |
| `runs`      | `ScheduleRun[]`                       | Execution history                |

### Nested: ScheduleCadence (discriminated union on `type`)

- `{ type: "cron", expression: string, timezone?: string }` — canonical cadence for new writes; absent `timezone` means UTC
- `{ type: "every", everyMs: number }` — legacy rolling interval, still readable and executable during the compatibility window

### Nested: ScheduleTarget (discriminated union on `type`)

- `{ type: "agent", agentId: string }` — send to existing agent
- `{ type: "new-agent", config: { provider, cwd, modeId?, model?, thinkingOptionId?, title?, approvalPolicy?, sandboxMode?, networkAccess?, webSearch?, extra?, systemPrompt?, mcpServers? } }` — create a new agent

### Nested: ScheduleRun

| Field          | Type                                   | Description             |
| -------------- | -------------------------------------- | ----------------------- |
| `id`           | `string`                               | Run ID                  |
| `scheduledFor` | `string` (ISO 8601)                    | Intended execution time |
| `startedAt`    | `string` (ISO 8601)                    |                         |
| `endedAt`      | `string?` (ISO 8601)                   |                         |
| `status`       | `"running" \| "succeeded" \| "failed"` |                         |
| `agentId`      | `string?` (UUID)                       | Agent used for this run |
| `output`       | `string?`                              | Agent output text       |
| `error`        | `string?`                              | Error message if failed |

---

## 6. Chat

**Path:** `$PASEO_HOME/chat/rooms/{room-id}.json`, one file per room, each holding
`{ room, messages }`. Writes are serialized per room, so a busy room no longer
rewrites every other one and a damaged file costs one room instead of all of them.

### Migrating from the single-file store

`$PASEO_HOME/chat/rooms.json` was the whole store before 0.3.0. It is migrated
on first start, in an order that is load-bearing: write every room file, rename
the legacy file to `rooms.json.bak`, then write the `.migrated` marker.

Only the migration writes the new layout before that marker exists — ordinary
chat writes are refused until it lands — which is what makes recovery from an
interrupted run exact. While the legacy file is in place it is the only
authority, so every room file is rewritten from it: including files an earlier
attempt already produced, whose data may since have changed, and excluding rooms
it no longer lists, which are deleted. Skipping what is already there would lose
whatever a user said after downgrading to a daemon that still writes the legacy
layout. That cleanup is part of the migration, so failing to read the directory
aborts before the rename rather than committing a half-cleaned store.

A legacy file that cannot be read leaves the marker unwritten **and** the store
read-only. The marker means "the legacy file has been dealt with"; writing it
over a store nobody could read would put every conversation in it permanently
out of reach. Read-only is the other half — a room created before the file is
repaired would be erased by the rewrite that eventually migrates it.

A damaged legacy entry costs itself and nothing else: rooms and messages there
are validated one at a time. A damaged per-room file costs that room, since the
file is the unit.

A room id becomes a filename, so ids are restricted to one path segment and a
file whose id does not match its own name is skipped. Callers can choose ids —
a team room is named after its team — and that choice must not become a choice
of where on disk to write, or delete.

### ChatRoom

| Field         | Type                | Description                                            |
| ------------- | ------------------- | ------------------------------------------------------ |
| `id`          | `string` (UUID)     |                                                        |
| `name`        | `string`            | Unique room name (case-insensitive)                    |
| `purpose`     | `string?`           | Room description                                       |
| `createdAt`   | `string` (ISO 8601) |                                                        |
| `updatedAt`   | `string` (ISO 8601) | Updated on each new message                            |
| `ownerKind`   | `"team"?`           | Set when the room's lifetime belongs to something else |
| `ownerId`     | `string?`           | Id of that owner; both halves are set or neither is    |
| `displayName` | `string?`           | What a human reads; `name` stays the internal handle   |

An owned room is created under an id its owner allocated, so replaying a
creation plan finds the room instead of making a second one. Generic delete
refuses it — only the owner can discard it, and discarding one that is already
gone succeeds.

### ChatMessage

| Field              | Type                | Description                                       |
| ------------------ | ------------------- | ------------------------------------------------- |
| `id`               | `string` (UUID)     |                                                   |
| `roomId`           | `string`            | FK to ChatRoom.id                                 |
| `authorAgentId`    | `string`            | Author id; a client id when the author is a human |
| `body`             | `string`            | Message text (supports `@mentions`)               |
| `replyToMessageId` | `string?`           | FK to another ChatMessage.id                      |
| `mentionAgentIds`  | `string[]`          | Extracted `@mention` agent IDs                    |
| `createdAt`        | `string` (ISO 8601) |                                                   |
| `author`           | `ChatAuthor?`       | `{ kind: "agent" \| "human", id }`                |

`author` says which kind of id `authorAgentId` holds; both are written. Messages
stored before it exists keep it absent, and it stays absent — a human posting
back then had their client id written to `authorAgentId`, which reads exactly
like an agent id, so there is nothing to recover it from.

---

## 7. Team

**Path:** `$PASEO_HOME/teams/{teamId}.json`

The roster is the membership authority. Labels on the agents are an index into
it — `AgentManager.listAgents()` returns only loaded agents, so a label scan
after a restart would miss most of a team.

A team file is written before anything it describes exists. Creation produces a
chat room and one agent per member, none of which the store can roll back, so
the record carries the whole plan and a stage marker; every later step replays a
decision already on disk rather than making a fresh one. That is what lets the
reconciler pick up from any crash point.

Six fields never reach a client, and the projection that keeps them off the wire
is explicit rather than an omission list: `idempotencyKey`,
`requestFingerprint`, `creationPlan`, `creationStage`, `failedCleanupAt`,
`pendingRecruitments`. Use `toTeamSnapshot`; a field added to the record does
not leak by default.

A damaged team file costs that team and nothing else — teams are independent,
and refusing to load any of them because one is unreadable would strand every
other team's reconciliation. Unreadable is not the same as absent: nothing may
read a skipped file as "this team has no members".

`revision` increments on every write. Clients order `team.update` broadcasts by
it.

### Nested: TeamMemberEntry

| Field           | Type                            | Description                                         |
| --------------- | ------------------------------- | --------------------------------------------------- |
| `agentId`       | `string`                        | Allocated before the agent exists                   |
| `role`          | `string`                        | Display and prompt text; not unique, not an address |
| `joinedAt`      | `string` (ISO 8601)             |                                                     |
| `leftAt`        | `string \| null`                |                                                     |
| `state`         | `active \| removed \| archived` | `removed` is terminal                               |
| `removalReason` | see below                       | Set with `removed`                                  |

`removalReason` is one of `removed_by_user`, `hard_deleted`,
`unarchive_evicted`, `recruitment_failed`, `recruitment_canceled`. An
`archived` member can come back; a `removed` one cannot, and nothing on the
event path may resurrect it.

### Nested: RecruitmentIntent

Server-only, keyed by the reserved agent id under `pendingRecruitments`.
Complete enough to replay a recruitment after a crash at any step: provider,
settings, title, role, briefing, a deterministic `clientMessageId`, the
recruiter, the workspace, and a `stage` of `reserved | created`.

Cancellation is a separate optional `cancelling` boolean rather than another
`stage` value. This is a storage format: widening the enum would make a daemon
that predates it reject the whole team file, drop the team from its idempotency
index, and let a retry of the original request build a second one.

**Path:** `$PASEO_HOME/teams/inbox/{teamId}.inbox.json`

The task ledger: assignments, settled work the lead has not been told about,
and the batch currently out for delivery. An assignment carries its own prompt,
so a crash between recording and sending can resend it.

Every read throws when the file cannot be parsed. An unreadable ledger that
reported "no assignments" would be indistinguishable from an empty one, and the
write that followed would make it true.

Nothing is held between calls — every read goes to the file. `revision`
increments on each write and clients order `team.tasks.update` by it; a file
written before the field existed reads as 0, which is older than any write that
follows. Two server-only fields stay off the wire, and `toTeamTask` names what
it sends rather than what it withholds: `clientMessageId` and
`completionEventId`.

---

## 8. Loop

**Path:** `$PASEO_HOME/loops/loops.json`

Single file containing an array of all loop records. Writes are direct (not atomic) and serialized through an in-memory queue. On daemon startup any record with `status: "running"` is recovered as `"stopped"` with an interruption log entry.

| Field                   | Type                                                | Description                                |
| ----------------------- | --------------------------------------------------- | ------------------------------------------ |
| `id`                    | `string`                                            | 8-char UUID prefix                         |
| `name`                  | `string?`                                           | Human-readable name                        |
| `prompt`                | `string`                                            | Worker prompt                              |
| `cwd`                   | `string`                                            | Working directory                          |
| `provider`              | `string`                                            | Default provider                           |
| `model`                 | `string?`                                           | Default model                              |
| `modeId`                | `string?`                                           | Default mode ID                            |
| `workerProvider`        | `string?`                                           | Override provider for workers              |
| `workerModel`           | `string?`                                           | Override model for workers                 |
| `verifierProvider`      | `string?`                                           | Override provider for verifiers            |
| `verifierModel`         | `string?`                                           | Override model for verifiers               |
| `verifierModeId`        | `string?`                                           | Override mode ID for verifiers             |
| `verifyPrompt`          | `string?`                                           | LLM verification prompt                    |
| `verifyChecks`          | `string[]`                                          | Shell commands to run as checks            |
| `archive`               | `boolean`                                           | Whether to archive worker agents after use |
| `sleepMs`               | `number`                                            | Delay between iterations (ms)              |
| `maxIterations`         | `number?`                                           | Cap on iterations                          |
| `maxTimeMs`             | `number?`                                           | Total time budget (ms)                     |
| `status`                | `"running" \| "succeeded" \| "failed" \| "stopped"` |                                            |
| `createdAt`             | `string` (ISO 8601)                                 |                                            |
| `updatedAt`             | `string` (ISO 8601)                                 |                                            |
| `startedAt`             | `string` (ISO 8601)                                 |                                            |
| `completedAt`           | `string?` (ISO 8601)                                |                                            |
| `stopRequestedAt`       | `string?` (ISO 8601)                                |                                            |
| `iterations`            | `LoopIteration[]`                                   |                                            |
| `logs`                  | `LoopLogEntry[]`                                    |                                            |
| `nextLogSeq`            | `number`                                            | Monotonic log sequence counter             |
| `activeIteration`       | `number?`                                           | Currently executing iteration index        |
| `activeWorkerAgentId`   | `string?`                                           | Currently running worker agent             |
| `activeVerifierAgentId` | `string?`                                           | Currently running verifier agent           |

### Nested: LoopIteration

| Field               | Type                                                | Description              |
| ------------------- | --------------------------------------------------- | ------------------------ |
| `index`             | `number`                                            | 1-based iteration index  |
| `workerAgentId`     | `string?`                                           | Agent ID of the worker   |
| `workerStartedAt`   | `string` (ISO 8601)                                 |                          |
| `workerCompletedAt` | `string?` (ISO 8601)                                |                          |
| `verifierAgentId`   | `string?`                                           | Agent ID of the verifier |
| `status`            | `"running" \| "succeeded" \| "failed" \| "stopped"` |                          |
| `workerOutcome`     | `"completed" \| "failed" \| "canceled"?`            |                          |
| `failureReason`     | `string?`                                           |                          |
| `verifyChecks`      | `LoopVerifyCheckResult[]`                           | Shell check results      |
| `verifyPrompt`      | `LoopVerifyPromptResult?`                           | LLM verification result  |

### Nested: LoopLogEntry

| Field       | Type                                                 |
| ----------- | ---------------------------------------------------- |
| `seq`       | `number` (monotonic)                                 |
| `timestamp` | `string` (ISO 8601)                                  |
| `iteration` | `number?`                                            |
| `source`    | `"loop" \| "worker" \| "verifier" \| "verify-check"` |
| `level`     | `"info" \| "error"`                                  |
| `text`      | `string`                                             |

### Nested: LoopVerifyCheckResult

| Field         | Type                |
| ------------- | ------------------- |
| `command`     | `string`            |
| `exitCode`    | `number`            |
| `passed`      | `boolean`           |
| `stdout`      | `string`            |
| `stderr`      | `string`            |
| `startedAt`   | `string` (ISO 8601) |
| `completedAt` | `string` (ISO 8601) |

### Nested: LoopVerifyPromptResult

| Field             | Type                |
| ----------------- | ------------------- |
| `passed`          | `boolean`           |
| `reason`          | `string`            |
| `verifierAgentId` | `string?`           |
| `startedAt`       | `string` (ISO 8601) |
| `completedAt`     | `string` (ISO 8601) |

---

## 9. Project Registry

**Path:** `$PASEO_HOME/projects/projects.json`

Array of project records.

| Field                | Type                        | Description                                                                                                                                |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `projectId`          | `string`                    | Host-local primary key; new records use opaque `prj_<16 hex>` IDs                                                                          |
| `projectKey`         | `string \| null`            | Persisted opaque cross-host grouping key; reconciliation backfills absent values                                                           |
| `rootPath`           | `string`                    | Exact lexically normalized selected root; never realpathed                                                                                 |
| `kind`               | `"git" \| "non_git"`        | Mutable Git observation about `rootPath`, never a membership key                                                                           |
| `displayName`        | `string`                    | Selected-root basename, stable across remote and Git changes                                                                               |
| `customName`         | `string \| null`            | User-set override layered over `displayName`. Null means "use the derived name".                                                           |
| `customIconRevision` | `string \| null`            | Identifies the host-local custom icon stored under `projects/icons/`. Null means the icon is discovered by scanning the project directory. |
| `createdAt`          | `string` (ISO 8601)         |                                                                                                                                            |
| `updatedAt`          | `string` (ISO 8601)         |                                                                                                                                            |
| `archivedAt`         | `string \| null` (ISO 8601) | Soft-delete timestamp; required nullable                                                                                                   |

Uploading a file and pasting a website or image URL are two ways of _acquiring_ the same custom
icon. The client fetches URL imports and sends their bytes through the upload RPC. The daemon never
receives or fetches the URL; it validates the uploaded bytes, stores them, and records a new
`customIconRevision`. Going back to automatic deletes the stored image, as does removing the
project.

Active exact roots are idempotent using lexical platform-equivalence semantics. Existing legacy
remote-shaped and path-shaped IDs remain readable, including duplicate roots; reconciliation never
merges them, transfers names, archives them, or moves workspace foreign keys. An explicit
workspace `projectId` is authoritative when it names an active project, regardless of cwd
containment. Archived-only exact-root records are not resurrected by explicit add/open; a fresh
opaque project is allocated instead. Agent restore is separate and restores the agent's existing
workspace together with its owning project.

---

## 10. Workspace Registry

**Path:** `$PASEO_HOME/projects/workspaces.json`

Array of workspace records. A workspace is a specific working directory within a project.

| Field                          | Type                                            | Description                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceId`                  | `string`                                        | Opaque stable identifier (`wks_<hex>`), generated independently of the directory. MUST NOT be treated as a path; compare by exact equality. Use the `cwd` field for directory access.         |
| `projectId`                    | `string`                                        | FK to Project.projectId; the workspace's stable project membership                                                                                                                            |
| `cwd`                          | `string`                                        | Exact execution directory selected for agents, files, scripts, and setup                                                                                                                      |
| `kind`                         | `"local_checkout" \| "worktree" \| "directory"` | Mutable checkout classification                                                                                                                                                               |
| `displayName`                  | `string`                                        | The human name (the generated/derived title). Decoupled from `branch` by construction.                                                                                                        |
| `title`                        | `string \| null`                                | User-set name override layered over `displayName`. Null means "use `displayName`".                                                                                                            |
| `branch`                       | `string \| null`                                | The current Git branch for git-backed workspaces. Separate from `displayName`/`title`; a background branch refresh never rewrites the name.                                                   |
| `worktreeRoot`                 | `string \| null`                                | Backing checkout/worktree root. May differ from `cwd` for exact subprojects and remains persisted after the worktree is deleted so restore can reproduce the placement.                       |
| `baseBranch`                   | `string \| null`                                | Normalized branch the Paseo worktree was created from; null for directories, local checkouts, and checkout-branch worktrees                                                                   |
| `isPaseoOwnedWorktree`         | `boolean`                                       | Whether Paseo owns and may remove/recreate the backing `worktreeRoot`                                                                                                                         |
| `mainRepoRoot`                 | `string \| null`                                | Main repository root for worktree checkouts, independent of both exact `cwd` and backing `worktreeRoot`                                                                                       |
| `createdAt`                    | `string` (ISO 8601)                             |                                                                                                                                                                                               |
| `updatedAt`                    | `string` (ISO 8601)                             |                                                                                                                                                                                               |
| `archivedAt`                   | `string \| null` (ISO 8601)                     | Soft-delete; required nullable                                                                                                                                                                |
| `autoArchivedChangeRequestUrl` | `string \| null`                                | Change request whose merged state triggered auto-archive. Restore replaces it with the current merged change request, when present, so repeated snapshots cannot archive the workspace again. |
| `pinnedAt`                     | `string \| null` (ISO 8601)                     | Pinned-to-top-of-sidebar timestamp; null means "not pinned"                                                                                                                                   |

> **Opaque-ID invariant:** `workspaceId` is opaque identity, never a filesystem path. Filesystem and git operations take `cwd`/`workspaceDirectory` only — never the id. A compatibility-only first-materialization bootstrap still groups pre-registry agent records by path and Git remote so existing installs retain their legacy records. That grouping never runs against a live registry, and its keys are not runtime project or workspace identity.

`projectId` is still a real FK: workspace records should have a matching project record. Read-only
history surfaces tolerate transient orphaned workspaces by omitting those rows so one bad FK cannot
blank the whole History screen, but mutation paths should repair or remove the orphaned state rather
than treating it as valid.

---

## 11. Push Token Store

**Path:** `$PASEO_HOME/push-tokens.json`

```json
{
  "tokens": ["ExponentPushToken[...]", ...]
}
```

Simple set of Expo push notification tokens. Loaded with permissive parsing (filters non-string entries). Persisted with atomic temp-file rename.

---

## 12. Daemon meta files

These small files are not validated as full Zod schemas but are persisted under `$PASEO_HOME` for daemon identity and runtime coordination.

| Path                  | Format                                                         | Notes                                                                             |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `server-id`           | Plain text, e.g. `srv_<base64url>`                             | Stable per-`$PASEO_HOME` daemon ID. Overridable via `PASEO_SERVER_ID` env.        |
| `daemon-keypair.json` | `{ v: 2, publicKeyB64, secretKeyB64 }` (libsodium box keypair) | E2EE relay identity. Written with mode `0600`. Regenerated if file is unreadable. |
| `paseo.pid`           | JSON `{ pid, startedAt, ... }`                                 | PID lock; prevents two daemons sharing one `$PASEO_HOME`.                         |
| `daemon.log`          | Pino log output                                                | Default location; path/rotation configurable via `log.file` in `config.json`.     |

---

## Client-side stores (App)

These live in React Native `AsyncStorage` or browser `IndexedDB`, not on the daemon filesystem.

### Keying convention: directory-backed vs workspace-owned

Right-sidebar client state splits on whether it is determined by the directory or owned by the workspace (two workspaces can share one `cwd`). The split is enforced by the cache key, so changing a key changes the sharing semantics — see [architecture.md](architecture.md#right-sidebar-boundary-directory-backed-vs-workspace-owned) for the full table.

- **Directory-backed** (shared by same-`cwd` workspaces): keyed by `(serverId, cwd)`. Git status/diff, GitHub PR status, PR timeline, file preview content. These are TanStack Query caches, not persisted stores.
- **Workspace-owned** (independent per workspace): keyed by `workspaceId`, with `cwd` used only as a fallback when no `workspaceId` is present. Diff-line review drafts (`@paseo:review-draft-store`), file selection review comments (`@paseo:workspace-review-comments`), diff-mode overrides (in-memory), workspace composer attachments, and file-explorer nav/expand state. The `workspaceId` part of these keys is **opaque** — never parse it back into a path.

### Draft Store

**AsyncStorage key:** `paseo-drafts` (version 2)

```typescript
{
  drafts: Record<draftKey, {
    input: { text: string, images: AttachmentMetadata[] },
    lifecycle: "active" | "abandoned" | "sent",
    updatedAt: number,     // epoch ms
    version: number        // optimistic concurrency
  }>,
  createModalDraft: DraftRecord | null
}
```

### Attachment Store (Web)

**IndexedDB database:** `paseo-attachment-bytes`, object store: `attachments`

Stores binary attachment blobs keyed by attachment ID.

### AttachmentMetadata

| Field         | Type      | Description                    |
| ------------- | --------- | ------------------------------ |
| `id`          | `string`  | Unique attachment ID           |
| `mimeType`    | `string`  | MIME type                      |
| `storageType` | `string`  | Storage backend identifier     |
| `storageKey`  | `string`  | Key within the storage backend |
| `createdAt`   | `number`  | Epoch ms                       |
| `fileName`    | `string?` | Original filename              |
| `byteSize`    | `number?` | Size in bytes                  |
