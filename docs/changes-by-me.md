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
  as the sidebar.
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
