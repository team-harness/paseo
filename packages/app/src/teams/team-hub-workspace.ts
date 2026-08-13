import type { WorkspaceDescriptor } from "@/stores/session-store";

export function selectTeamHubWorkspace(
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>,
): WorkspaceDescriptor | null {
  return (
    [...workspaces.values()]
      .filter((workspace) => workspace.archivingAt === null)
      .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null
  );
}
