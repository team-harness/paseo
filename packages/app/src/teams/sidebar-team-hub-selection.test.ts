import { describe, expect, it } from "vitest";
import { selectSidebarTeamHubServerId } from "./sidebar-team-hub-selection";

const supported = {
  teamMissions: true,
  globalTeamProfiles: true,
  teamMethodologies: true,
};

describe("selectSidebarTeamHubServerId", () => {
  it("returns the active workspace physical server when all Team V1 capabilities are present", () => {
    expect(selectSidebarTeamHubServerId({ serverId: "host-a" }, supported)).toBe("host-a");
  });

  it.each(["teamMissions", "globalTeamProfiles", "teamMethodologies"] as const)(
    "hides the entry when %s is absent",
    (capability) => {
      expect(
        selectSidebarTeamHubServerId({ serverId: "host-a" }, { ...supported, [capability]: false }),
      ).toBeNull();
    },
  );

  it("does not substitute another host when there is no active workspace selection", () => {
    expect(selectSidebarTeamHubServerId(null, supported)).toBeNull();
  });

  it("keeps the entry on the current host-owned Team Hub route", () => {
    expect(selectSidebarTeamHubServerId(null, supported, "host-a")).toBe("host-a");
  });
});
