import type { DaemonServerInfo } from "@/stores/session-store";

import type { TeamMissionsAccess } from "./mission-start-form-model";

export function resolveTeamMissionsAccess(
  serverInfo: Pick<DaemonServerInfo, "features"> | null | undefined,
): TeamMissionsAccess {
  if (serverInfo == null) return "checking_host";
  return serverInfo.features?.teamMissions === true ? "supported" : "upgrade_required";
}
