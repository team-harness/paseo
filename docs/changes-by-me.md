# Changes by Me

This file records fork-specific changes that intentionally build on upstream
Paseo behavior. Keep entries narrow and point to upstream-owned abstractions so
future upstream syncs have a clear integration boundary.

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
the complete current stream as the versioned `paseo-chat-history@v1` JSON
contract and uploads it to a user-owned sharing service.

- Client boundary: `packages/app/src/chat-share/` owns the portable export and
  upload client. `AgentStreamView` only invokes those helpers and does not add a
  daemon RPC or persist share state.
- Configuration: the host defaults to
  `https://paseo-share.team-harness.com` when `daemon.chatShare.baseUrl` is
  absent and exposes the resolved public base URL through the optional
  `server_info.chatShare` field. An explicit config value overrides that hosted
  default. `server_info.features.chatShare` gates clients on old daemons. The
  client sends one JSON `POST` to `/api/v1/shares`; it has no cloud-vendor URL
  or credential.
- Contract: `chatviewer/schema/paseo-chat-history.v1.schema.json` is the
  standalone JSON schema. Exported data contains messages, tool calls, thoughts,
  todos, activity, and compaction records without Paseo runtime state.
- Independent deployment: `chatviewer/` is a Vite template with one portable
  API contract and provider-specific storage adapters. It supports Void
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
- Share URL: newly issued Viewer links carry only the generated UUID as
  `?id=<uuid>`. The Void template deliberately has no dependency on the former
  fork-specific `?history=` URL, FC API, OSS bucket, Licell, or `bazhuayu.xyz`.
