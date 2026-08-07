export const CLIENT_CAPS = {
  // COMPAT(selectiveAgentTimeline): added in v0.1.106. Capable clients receive
  // agent streams only for their explicit viewed set. Remove after 2027-01-12
  // once the supported client floor is >= v0.1.106.
  selectiveAgentTimeline: "selective_agent_timeline",
  reasoningMergeEnum: "reasoning_merge_enum",
  // COMPAT(customModeIcons): added in v0.1.84. Old clients pin AgentModeIcon to
  // a closed enum and crash rendering unknown values; daemon downgrades icons
  // outside the legacy set to "ShieldCheck" when this cap is absent. Drop the
  // gate when floor >= v0.1.84.
  customModeIcons: "custom_mode_icons",
  // COMPAT(terminalReflowableSnapshot): added in v0.1.88. The daemon attaches
  // per-row soft-wrap flags (gridWrapped/scrollbackWrapped) to terminal snapshots
  // only when the client advertises this, so restored content can reflow on resize.
  // Old clients use a strict TerminalState schema and would reject the extra fields.
  // Drop the gate (always send the flags) when floor >= v0.1.88.
  terminalReflowableSnapshot: "terminal_reflowable_snapshot",
  // COMPAT(providerSubagents): added in v0.1.107. The daemon emits provider-owned
  // child descriptors and timelines only to clients that understand the new messages.
  providerSubagents: "provider_subagents",
  // COMPAT(projectUpdates): added in v0.1.109, remove gate after 2027-01-15.
  projectUpdates: "project_updates",
  // COMPAT(compactProviderSnapshots): added in v0.2.X. Capable clients receive
  // provider catalogs with shared thinking sets and may revalidate by content hash.
  // Remove the legacy snapshot encoding after 2027-02-04.
  compactProviderSnapshots: "compact_provider_snapshots",
  browserHost: "browser_host",
  // COMPAT(teams): added in v0.3.0, remove after 2027-02-06 once the client floor
  // is >= v0.3.0. One logical session can hold several physical sockets, so team
  // broadcasts are gated per socket with supportsForSource; an older socket on
  // the same session must not receive `team.update`.
  teams: "teams",
  // COMPAT(chatRoomSubscriptions): added in v0.3.0, remove after 2027-02-06 once
  // the client floor is >= v0.3.0. Gated per socket like teams; separate because
  // live room streaming is useful without teams.
  chatRoomSubscriptions: "chat_room_subscriptions",
  // COMPAT(teamTasks): added in v0.3.0-beta.3, remove after 2027-02-06 once the
  // client floor is >= v0.3.0. Separate from teams because the beta clients that
  // already advertise teams have no `team.tasks.update` branch to parse into.
  teamTasks: "team_tasks",
} as const;

export type ClientCapability = (typeof CLIENT_CAPS)[keyof typeof CLIENT_CAPS];
