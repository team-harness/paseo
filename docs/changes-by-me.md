# Changes by Me

This file records fork-specific changes that intentionally build on upstream
Paseo behavior. Keep entries narrow and point to upstream-owned abstractions so
future upstream syncs have a clear integration boundary.

## Saved Prompt Library

The composer exposes a client-local library for reusable prompts without adding
a daemon protocol or host-owned persistence.

- UI boundary: `packages/app/src/prompt-library/` owns search, CRUD, recovery,
  and the adaptive sheet. Composer integration only inserts the selected prompt
  at the current text selection and restores focus; it never sends
  automatically.
- Persistence: AsyncStorage key `@paseo:prompt-library` is global to one app
  installation, so prompts are shared across hosts, projects, workspaces, and
  agents on that client. Browser profiles, desktop, and mobile keep independent
  collections.
- Data safety: malformed individual records are skipped, while malformed JSON
  or root envelopes block normal writes. Recovery requires an explicit
  destructive reset. All reads and mutations use one serialized service queue.
- Upstream sync: if upstream adds an equivalent prompt library, adopt its UI,
  data model, and persistence boundary and migrate this local collection once.
  Do not keep two toolbar entries or parallel stores. Preserve exact selection
  insertion and no-auto-send behavior.

## Status Bar Workspace Pins

The status bar uses the upstream sidebar workspace pin model as its only
user-facing pin source.

- Authority: the daemon-owned workspace `pinnedAt` field and the
  `workspace.pin.set.request` RPC exposed by `DaemonClient.setWorkspacePinned`.
- UI data: `useSidebarWorkspacesList`, `usePinnedSidebarKeys`, and
  `splitPinnedSidebarGroups` provide the same pinned workspace set and ordering
  as the sidebar. `useSidebarWorkspaceEntries` and
  `SidebarWorkspaceRowContent` provide the same title, state, branch, and
  project metadata as the sidebar's pinned rows.
- Interaction: session and history rows reuse
  `useSidebarWorkspacePinController`, so they share the sidebar's workspace
  identity, duplicate-click guard, mutation path, and error feedback.
- Capability: status bar pin controls follow the upstream
  `server_info.features.workspacePinning` gate. Sessions without a live
  workspace are not pinnable because they cannot appear in the sidebar's
  pinned section.

The older status-summary `pinnedSessions` payload and `setStatusSessionPin`
client method were removed. Existing status-session pin files are no longer
read or migrated; workspace `pinnedAt` is the only Pin persistence model.

When syncing upstream sidebar pin changes, update the status bar only through
these existing sidebar hooks and the workspace pin controller. Do not introduce
a status-bar-specific persistence store or RPC.

## Read-only Chat Sharing

Completed assistant turns expose a share action next to copy and fork. It exports
the complete current stream as the versioned `threadshare-history@v1` JSON
contract and uploads it to a user-owned sharing service.

- Client boundary: `packages/app/src/chat-share/` owns the portable export and
  upload client. `AgentStreamView` only invokes those helpers and does not add a
  daemon RPC or persist share state.
- Configuration: the host defaults to the shared Threadshare deployment at
  `https://cloud-thread.team-harness.com` when `daemon.chatShare.baseUrl` is
  absent and exposes the resolved public base URL through the optional
  `server_info.chatShare` field. An explicit config value overrides that hosted
  default. `server_info.features.chatShare` gates clients on old daemons. The
  client sends one JSON `POST` to `/api/v1/shares`; it has no cloud-vendor URL
  or credential.
- Contract: `https://github.com/team-harness/threadshare` owns the standalone
  JSON schema. Exported data contains messages, tool calls, thoughts, todos,
  activity, and compaction records without Paseo runtime state. New producers
  emit `threadshare-history@v1`; the Threadshare API accepts the former Paseo v1
  shape only as an input migration path.
- Export safety: before upload, Paseo redacts credentials from the conversation
  title, every visible text entry, and recursive tool data. Stringified JSON is
  parsed and edited structurally so nested secrets are removed without corrupting
  JSON or changing numeric literals. Token usage, authentication metadata, and
  explanatory authentication prose remain visible.
- Agent tooling: the standalone CLI is distributed as the public npm package
  `@team-harness/threadshare`. Its bundled `skills/threadshare` Skill documents
  safe sharing from local Codex, Codex Cloud (`CODEX_HOME`), and Claude sessions;
  the CLI uses `https://cloud-thread.team-harness.com` unless `--url` or
  `THREADSHARE_URL` overrides it.
- Independent deployment: Threadshare is a separate Vite template with one
  portable API contract and provider-specific storage adapters. It supports Void
  file-based routes with Void Object Storage, Cloudflare Workers Assets with
  R2, and Alibaba Cloud Function Compute with a private OSS bucket. All expose
  the same-origin `POST /api/v1/shares` / `GET /api/v1/shares/:id` routes. Its
  deployment URL is intentionally chosen by the user, not hard-coded in Paseo.
- Deep links: every user message in the Viewer exposes a `#` action that copies
  a URL ending in `#message-<entry-id>`. Opening that URL loads the same
  history, scrolls to the message, and briefly highlights it. This is a Viewer
  behavior only; the export schema remains unchanged.
- Assistant messages expose an icon-only Copy action with a tooltip. It writes
  original exported Markdown to the clipboard without flattening rendered tables,
  code blocks, or links.
- Upload path: both adapters accept a bounded JSON request, run the same strict
  portable-schema validation, allocate a UUID, and store only
  `shares/<uuid>.json`. The viewer reads through its same-origin API and never
  sees an object-store endpoint or credential.
- Share scope: Share first snapshots the complete authoritative timeline, then
  offers every user message as a start point. Selecting one exports that
  message and every later entry, without changing the portable history schema
  or the upload API.
- Upload size: histories at or below Threadshare's 5 MiB request limit are sent
  unchanged. Larger histories keep every non-tool entry intact, merge repeated
  updates for each tool call into its final status, retain request parameters,
  and discard recognized tool results and error details. Unknown future tool
  detail types remain intact because their request and result fields cannot be
  classified safely. If that projection still exceeds 5 MiB, the client stops
  before `fetch` and asks the user to choose a later start message.
- Share URL: newly issued Viewer links carry only the generated UUID as
  `?id=<uuid>`. The Void template deliberately has no dependency on the former
  fork-specific `?history=` URL, FC API, OSS bucket, Licell, or `bazhuayu.xyz`.
