import { describe, expect, it } from "vitest";

import { ServerInfoStatusPayloadSchema } from "./messages.js";

describe("server info feature compatibility", () => {
  it("accepts the current Agent workspace inheritance capability", () => {
    const payload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_test",
      features: { agentWorkspaceInheritance: true },
    });

    expect(payload.features?.agentWorkspaceInheritance).toBe(true);
  });

  it("accepts an older daemon that omits the capability", () => {
    const payload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_legacy",
      features: {},
    });

    expect(payload.features?.agentWorkspaceInheritance).toBeUndefined();
  });
});
