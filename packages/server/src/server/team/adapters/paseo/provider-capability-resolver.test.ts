import { describe, expect, test } from "vitest";

import type { AgentClient, AgentCapabilityFlags } from "../../../agent/agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import {
  PaseoProviderCapabilityResolver,
  type ProviderCapabilityRegistry,
} from "./provider-capability-resolver.js";

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsNativePaseoTools: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

describe("PaseoProviderCapabilityResolver", () => {
  test("projects enabled registry and adapter-manifest facts without auth probing", async () => {
    const registry = {
      codex: {
        enabled: true,
        createClient: () => clientWithCapabilities("codex", CAPABILITIES),
      },
    } satisfies ProviderCapabilityRegistry;
    const resolver = new PaseoProviderCapabilityResolver({
      registry,
      toolIds: ["team_status", "team_message"],
      logger: createTestLogger(),
    });

    await expect(
      resolver.resolve({
        provider: "codex",
        model: "gpt-5.6-sol",
        modeId: "auto-review",
        thinkingOptionId: "high",
        featureValues: {},
      }),
    ).resolves.toEqual({
      providerAvailable: true,
      toolIds: ["team_message", "team_status"],
      capabilityIds: [
        "structured-tools",
        "supports-dynamic-modes",
        "supports-native-paseo-tools",
        "supports-reasoning-stream",
        "supports-session-persistence",
        "supports-streaming",
        "supports-tool-invocations",
      ],
    });
  });

  test.each([
    ["missing", {}],
    [
      "disabled",
      {
        disabled: {
          enabled: false,
          createClient: () => clientWithCapabilities("disabled", CAPABILITIES),
        },
      },
    ],
  ] as const)(
    "reports %s providers unavailable without creating a runtime",
    async (provider, registry) => {
      const resolver = new PaseoProviderCapabilityResolver({
        registry,
        toolIds: ["team_status"],
        logger: createTestLogger(),
      });

      await expect(
        resolver.resolve({
          provider,
          model: null,
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        }),
      ).resolves.toEqual({ providerAvailable: false, toolIds: [], capabilityIds: [] });
    },
  );
});

function clientWithCapabilities(provider: string, capabilities: AgentCapabilityFlags): AgentClient {
  return {
    provider,
    capabilities,
    createSession: async () => {
      throw new Error("not used by capability projection");
    },
    resumeSession: async () => {
      throw new Error("not used by capability projection");
    },
    fetchCatalog: async () => ({ models: [], modes: [] }),
  };
}
