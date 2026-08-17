import type { Logger } from "pino";

import type { MissionCapabilityFacts } from "@getpaseo/protocol/team/v2-types";

import type { ProviderDefinition } from "../../../agent/provider-registry.js";
import type { ProviderCapabilityResolver } from "../../application/ports.js";

export type ProviderCapabilityRegistry = Readonly<
  Record<string, Pick<ProviderDefinition, "enabled" | "createClient"> | undefined>
>;

interface PaseoProviderCapabilityResolverOptions {
  registry: ProviderCapabilityRegistry;
  toolIds: readonly string[];
  logger: Logger;
}

export class PaseoProviderCapabilityResolver implements ProviderCapabilityResolver {
  private readonly registry: ProviderCapabilityRegistry;
  private readonly logger: Logger;

  constructor(options: PaseoProviderCapabilityResolverOptions) {
    this.registry = options.registry;
    this.logger = options.logger;
  }

  async resolve(
    executionProfile: Parameters<ProviderCapabilityResolver["resolve"]>[0],
  ): Promise<MissionCapabilityFacts> {
    const definition = this.registry[executionProfile.provider];
    if (!definition) {
      return {
        kind: "unknown",
        providerId: executionProfile.provider,
        reason: "provider_declaration_unavailable",
      };
    }

    // Registry construction owns provider configuration. Reading the client's
    // declared flags is local and does not authenticate or start a session.
    const capabilities = definition.createClient(this.logger).capabilities;
    const capabilityIds = Object.entries(capabilities)
      .filter(([, enabled]) => enabled === true)
      .map(([capability]) => camelCaseToKebabCase(capability));
    const supportsStructuredTools =
      capabilities.supportsNativePaseoTools === true || capabilities.supportsMcpServers === true;
    if (supportsStructuredTools) capabilityIds.push("structured-tools");

    return { kind: "known", capabilityIds: [...new Set(capabilityIds)].toSorted() };
  }
}

function camelCaseToKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
