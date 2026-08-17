import type { DaemonServerInfo } from "@/stores/session-store";

import type { TeamMissionsAccess } from "./mission-start-form-model";

export function resolveTeamMissionsAccess(
  serverInfo: Pick<DaemonServerInfo, "features"> | null | undefined,
): TeamMissionsAccess {
  if (serverInfo == null) return "checking_host";
  const features = serverInfo.features;
  return features?.teamMissions === true &&
    features.globalTeamProfiles === true &&
    features.teamMethodologies === true
    ? "supported"
    : "upgrade_required";
}
