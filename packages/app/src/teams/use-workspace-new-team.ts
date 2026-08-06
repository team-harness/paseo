import { useCallback, useState } from "react";

import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

import { useTeamsSupported } from "./use-teams";

export interface WorkspaceNewTeam {
  /** False on a daemon without teams, where the entry is hidden entirely. */
  supported: boolean;
  visible: boolean;
  /** Where the daemon resolves providers from; empty when the workspace has no directory. */
  cwd: string;
  open: () => void;
  close: () => void;
  onCreated: (teamId: string) => void;
}

/**
 * The workspace's New Team entry: whether to offer it, and what happens after.
 *
 * A hook rather than four more locals in the workspace screen, which is a large
 * upstream file this fork tries not to widen.
 */
export function useWorkspaceNewTeam(input: {
  serverId: string;
  persistenceKey: string | null;
  workspaceDirectory: string | null | undefined;
  routeFocused: boolean;
  openWorkspaceTabFocused: (workspaceKey: string, target: WorkspaceTabTarget) => string | null;
}): WorkspaceNewTeam {
  // Gated once on the daemon's answer rather than failing on submit, per
  // docs/protocol-compatibility.md.
  const supported = useTeamsSupported(input.serverId);
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  const { persistenceKey, openWorkspaceTabFocused } = input;
  const onCreated = useCallback(
    (teamId: string) => {
      setVisible(false);
      // Straight onto the team that was just made. Closing back to the
      // workspace and leaving the user to find it is how six agents start
      // working unnoticed.
      if (persistenceKey) openWorkspaceTabFocused(persistenceKey, { kind: "team", teamId });
    },
    [openWorkspaceTabFocused, persistenceKey],
  );

  return {
    supported,
    visible: visible && input.routeFocused,
    cwd: input.workspaceDirectory ?? "",
    open,
    close,
    onCreated,
  };
}
