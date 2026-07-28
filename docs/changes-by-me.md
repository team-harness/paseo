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
contract, uploads it with a temporary single-object OSS URL, and copies the
read-only viewer link.

- Client boundary: `packages/app/src/chat-share/` owns the portable export and
  upload client. `AgentStreamView` only invokes those helpers and does not add a
  daemon RPC or persist share state.
- Contract: `chatviewer/schema/paseo-chat-history.v1.schema.json` is the
  standalone JSON schema. Exported data contains messages, tool calls, thoughts,
  todos, activity, and compaction records without Paseo runtime state.
- Independent deployment: `chatviewer/` owns the static viewer at
  `https://paseo-chat.bazhuayu.xyz`; `chatviewer/api/` owns the FC API at
  `https://paseo-chat-share.bazhuayu.xyz`.
- Deep links: every user message in the Viewer exposes a `#` action that copies
  a URL ending in `#message-<entry-id>`. Opening that URL loads the same
  history, scrolls to the message, and briefly highlights it. This is a Viewer
  behavior only; the export schema and FC upload/read APIs remain unchanged.
- Upload path: the FC API signs a five-minute `PUT` for a generated
  `history/YYYY-MM-DD/<uuid>.json` key. Long-lived OSS credentials remain FC
  environment variables only. The viewer reads through the API's key-restricted
  history endpoint, so it does not depend on OSS read CORS.
- Share scope: Share first snapshots the complete authoritative timeline, then
  offers every user message as a start point. Selecting one exports that
  message and every later entry, without changing the portable history schema
  or the upload API.
- Share URL: newly issued Viewer links carry only the generated `history/...`
  key; the Viewer resolves it through its fixed API origin. Existing links that
  carry the complete history-read URL remain supported.
- OSS CORS permits browser `PUT` with `content-type` for those temporary upload
  URLs. Keep this configuration in the independent deployment rather than the
  Paseo daemon or protocol.
