import { createHash } from "node:crypto";

import type { TeamProfileCreateMemberInput } from "@getpaseo/protocol/team/v2-rpc-schemas";
import {
  TeamExecutionProfileSchema,
  type TeamExecutionProfile,
  type TeamExecutionProfileSource,
} from "@getpaseo/protocol/team/v2-types";

import { TeamApplicationError } from "./errors.js";

export interface TeamAgentProfileCatalogEntry {
  id: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export interface TeamAgentProfileCatalogPort {
  readSnapshot(): readonly TeamAgentProfileCatalogEntry[];
}

export interface MaterializedTeamMemberExecution {
  clientMemberKey: string;
  executionProfile: TeamExecutionProfile;
  executionProfileSource?: TeamExecutionProfileSource;
}

export interface TeamAgentProfileMaterializer {
  materialize(
    members: readonly TeamProfileCreateMemberInput[],
  ): Promise<MaterializedTeamMemberExecution[]>;
}

export class DaemonTeamAgentProfileMaterializer implements TeamAgentProfileMaterializer {
  constructor(private readonly catalog: TeamAgentProfileCatalogPort) {}

  async materialize(
    members: readonly TeamProfileCreateMemberInput[],
  ): Promise<MaterializedTeamMemberExecution[]> {
    const needsCatalog = members.some(
      (member) => member.executionProfileSelection.kind === "agent_profile",
    );
    const profiles = needsCatalog ? this.catalog.readSnapshot() : [];

    return members.map((member) => {
      const selection = member.executionProfileSelection;
      if (selection.kind === "inline") {
        return {
          clientMemberKey: member.clientMemberKey,
          executionProfile: structuredClone(selection.executionProfile),
        };
      }

      const matches = profiles.filter((profile) => profile.id === selection.profileId);
      if (matches.length === 0) {
        throw new TeamApplicationError(
          "team_agent_profile_not_found",
          `Agent Profile ${selection.profileId} does not exist`,
        );
      }
      if (matches.length > 1) {
        throw new TeamApplicationError(
          "team_agent_profile_ambiguous",
          `Agent Profile id ${selection.profileId} is duplicated`,
        );
      }

      const profile = matches[0]!;
      const parsed = TeamExecutionProfileSchema.safeParse({
        provider: profile.provider,
        model: profile.model ?? null,
        modeId: profile.modeId ?? null,
        thinkingOptionId: profile.thinkingOptionId ?? null,
        featureValues: profile.featureValues ?? {},
      });
      if (!parsed.success) {
        throw new TeamApplicationError(
          "team_agent_profile_invalid",
          `Agent Profile ${selection.profileId} cannot be used by a Team Member`,
        );
      }
      const executionProfile = parsed.data;
      return {
        clientMemberKey: member.clientMemberKey,
        executionProfile,
        executionProfileSource: {
          kind: "agent_profile" as const,
          profileId: selection.profileId,
          resolverVersion: 1 as const,
          appliedDigest: digestExecutionProfile(executionProfile),
        },
      };
    });
  }
}

function digestExecutionProfile(executionProfile: TeamExecutionProfile): `sha256:${string}` {
  const canonical = JSON.stringify(sortJson(executionProfile));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => compareCanonicalKeys(left, right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
