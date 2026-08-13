import { describe, expect, it } from "vitest";

import { DaemonTeamAgentProfileMaterializer } from "./team-agent-profile-materializer.js";

const member = {
  clientMemberKey: "member",
  role: "Engineer",
  level: 4,
  skillIds: ["typescript"],
  executionProfileSelection: { kind: "agent_profile" as const, profileId: "profile-1" },
};

describe("Team Agent Profile materialization", () => {
  it("digests only canonical runtime fields while preserving array order", async () => {
    const first = await materialize({
      id: "profile-1",
      name: "First name",
      icon: "spark",
      color: "blue",
      notes: "Excluded",
      provider: "codex",
      featureValues: { z: [1, 2], nested: { beta: true, alpha: false } },
      passthrough: "excluded",
    });
    const metadataChanged = await materialize({
      id: "profile-1",
      name: "Renamed",
      icon: "other",
      color: "red",
      notes: "Changed",
      provider: "codex",
      featureValues: { nested: { alpha: false, beta: true }, z: [1, 2] },
      passthrough: { changed: true },
    });
    const arrayChanged = await materialize({
      id: "profile-1",
      name: "Renamed",
      provider: "codex",
      featureValues: { nested: { alpha: false, beta: true }, z: [2, 1] },
    });

    expect(first.executionProfile).toEqual({
      provider: "codex",
      model: null,
      modeId: null,
      thinkingOptionId: null,
      featureValues: { z: [1, 2], nested: { beta: true, alpha: false } },
    });
    expect(first.executionProfileSource?.appliedDigest).toBe(
      metadataChanged.executionProfileSource?.appliedDigest,
    );
    expect(first.executionProfileSource?.appliedDigest).toBe(
      "sha256:d2065d727305f4bddb305b5ec55ec26e68d484ccf032b3bef7d83dee41d145fa",
    );
    expect(arrayChanged.executionProfileSource?.appliedDigest).not.toBe(
      first.executionProfileSource?.appliedDigest,
    );
  });
});

async function materialize(profile: Record<string, unknown>) {
  const materializer = new DaemonTeamAgentProfileMaterializer({
    readSnapshot: () => [profile as never],
  });
  return (await materializer.materialize([member]))[0]!;
}
