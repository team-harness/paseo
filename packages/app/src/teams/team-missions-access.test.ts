import { describe, expect, it } from "vitest";

import { resolveTeamMissionsAccess } from "./team-missions-access";

describe("Team Missions capability access", () => {
  it("keeps server_info loading distinct from an unsupported host", () => {
    expect(resolveTeamMissionsAccess(null)).toBe("checking_host");
    expect(resolveTeamMissionsAccess(undefined)).toBe("checking_host");
    expect(resolveTeamMissionsAccess({ features: {} })).toBe("upgrade_required");
    expect(resolveTeamMissionsAccess({ features: { teamMissions: false } })).toBe(
      "upgrade_required",
    );
    expect(resolveTeamMissionsAccess({ features: { teamMissions: true } })).toBe("supported");
  });
});
