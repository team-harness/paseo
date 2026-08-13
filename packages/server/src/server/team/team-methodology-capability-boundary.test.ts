import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Team Methodology capability projection", () => {
  it("advertises the complete Team V1 set from one ready runtime source", () => {
    const source = readFileSync(new URL("../websocket-server.ts", import.meta.url), "utf8");
    expect(source).toContain("...this.teamRuntime?.serverFeatures()");
    expect(source).toContain("teamRuntime: this.teamRuntime?.sessionDeps() ?? null");
    expect(source).toContain("TeamRuntimeHostBoundary");
    expect(source).not.toContain('import type { TeamRuntime } from "./team/team-runtime.js"');
    expect(source).not.toContain("...(this.teamRuntime ?");
  });

  it("injects the live runtime only after startup reconciliation completes", () => {
    const source = readFileSync(new URL("../bootstrap.ts", import.meta.url), "utf8");
    const ready = source.indexOf("await teamRuntime.start()");
    const server = source.indexOf("wsServer = new VoiceAssistantWebSocketServer(");
    const liveRuntime = source.indexOf("              teamRuntime,", server);
    expect(ready).toBeGreaterThan(0);
    expect(ready).toBeLessThan(server);
    expect(liveRuntime).toBeGreaterThan(server);
    expect(source.slice(server, liveRuntime + 40)).not.toContain("teamRuntime.sessionDeps()");
  });
});
