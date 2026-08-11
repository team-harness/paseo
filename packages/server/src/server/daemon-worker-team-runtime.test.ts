import { describe, expect, test } from "vitest";

import { resolveDaemonWorkerTeamMissionsRuntime } from "./daemon-worker-team-runtime.js";

describe("daemon worker Team Missions runtime gate", () => {
  test("enables the runtime by default for production daemons", () => {
    expect(resolveDaemonWorkerTeamMissionsRuntime({ PASEO_NODE_ENV: "production" })).toEqual({
      enabled: true,
    });
    expect(resolveDaemonWorkerTeamMissionsRuntime({})).toEqual({ enabled: true });
  });

  test("keeps the runtime disabled unless a test or development daemon opts in", () => {
    expect(
      resolveDaemonWorkerTeamMissionsRuntime({ PASEO_NODE_ENV: "development" }),
    ).toBeUndefined();
    expect(resolveDaemonWorkerTeamMissionsRuntime({ PASEO_NODE_ENV: "test" })).toBeUndefined();
  });

  test.each(["development", "test"] as const)(
    "enables the runtime when a %s daemon explicitly opts in",
    (paseoNodeEnv) => {
      expect(
        resolveDaemonWorkerTeamMissionsRuntime({
          PASEO_NODE_ENV: paseoNodeEnv,
          PASEO_TEAM_MISSIONS_RUNTIME: "1",
        }),
      ).toEqual({ enabled: true });
    },
  );

  test("does not treat other flag values as opt-in", () => {
    expect(
      resolveDaemonWorkerTeamMissionsRuntime({
        PASEO_NODE_ENV: "development",
        PASEO_TEAM_MISSIONS_RUNTIME: "true",
      }),
    ).toBeUndefined();
    expect(
      resolveDaemonWorkerTeamMissionsRuntime({
        PASEO_NODE_ENV: "development",
        PASEO_TEAM_MISSIONS_RUNTIME: "0",
      }),
    ).toBeUndefined();
  });
});
