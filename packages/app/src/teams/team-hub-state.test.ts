import { expect, it } from "vitest";
import {
  resolveTeamHubConnectionStatus,
  resolveTeamHubCreateEnabled,
  resolveTeamHubState,
} from "./team-hub-state";

const base = {
  connectionStatus: "online" as const,
  features: { teamMissions: true, globalTeamProfiles: true, teamMethodologies: true },
  teamStatus: "ready" as const,
  catalogStatus: "ready" as const,
};
it.each([
  [{ ...base, connectionStatus: "offline" as const }, { kind: "waitingForHost" }],
  [{ ...base, features: null }, { kind: "loading" }],
  [
    { ...base, features: { teamMissions: true, globalTeamProfiles: true } },
    { kind: "unsupported" },
  ],
  [base, { kind: "supported", teamFailed: false, catalogFailed: false }],
  [
    { ...base, teamStatus: "failed" as const },
    { kind: "supported", teamFailed: true, catalogFailed: false },
  ],
  [
    { ...base, catalogStatus: "failed" as const },
    { kind: "supported", teamFailed: false, catalogFailed: true },
  ],
])("resolves the physical-source Team Hub state", (input, expected) =>
  expect(resolveTeamHubState(input)).toEqual(expected),
);

it("disables Team creation when either independent replica failed", () => {
  expect(
    resolveTeamHubCreateEnabled({ hasLiveWorkspace: true, teamFailed: true, catalogFailed: false }),
  ).toBe(false);
  expect(
    resolveTeamHubCreateEnabled({ hasLiveWorkspace: true, teamFailed: false, catalogFailed: true }),
  ).toBe(false);
  expect(
    resolveTeamHubCreateEnabled({
      hasLiveWorkspace: true,
      teamFailed: false,
      catalogFailed: false,
    }),
  ).toBe(true);
});

it("keeps a disconnected host waiting even when its last server info remains", () => {
  expect(resolveTeamHubConnectionStatus("offline", true)).toBe("offline");
  expect(resolveTeamHubConnectionStatus("idle", true)).toBe("idle");
});
