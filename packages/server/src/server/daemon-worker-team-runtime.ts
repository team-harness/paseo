import type { TeamMissionsRuntimeOptions } from "./team/team-runtime.js";
import { resolvePaseoNodeEnv } from "./paseo-env.js";

const TEAM_MISSIONS_RUNTIME_ENV = "PASEO_TEAM_MISSIONS_RUNTIME";

export function resolveDaemonWorkerTeamMissionsRuntime(
  env: NodeJS.ProcessEnv,
): TeamMissionsRuntimeOptions | undefined {
  const nodeEnv = resolvePaseoNodeEnv(env);
  if (nodeEnv !== "development" && nodeEnv !== "test") return { enabled: true };
  return env[TEAM_MISSIONS_RUNTIME_ENV] === "1" ? { enabled: true } : undefined;
}
