import {
  TeamExecutionProfileSchema,
  type TeamExecutionProfile,
  type TeamMemberProfile,
} from "./v2-types.js";

/**
 * The Agent Profile facts a Team Member can be materialized from. Presentation
 * fields (name, icon, color, notes) and provider passthrough are deliberately
 * absent: editing them must not move a Member off `current`.
 */
export interface AgentProfileExecutionFacts {
  id: string;
  provider: string;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown> | null;
}

export type TeamMemberExecutionSourceStatus =
  | { kind: "inline" }
  | { kind: "current"; profileId: string }
  | { kind: "update_available"; profileId: string }
  | { kind: "missing"; profileId: string }
  | { kind: "ambiguous"; profileId: string };

/**
 * The single V1 materialization rule. The daemon commits with it, the app and
 * the CLI preview with it, so a preview can never disagree with the commit.
 */
export function normalizeAgentProfileExecutionProfile(
  entry: AgentProfileExecutionFacts,
): TeamExecutionProfile | null {
  const parsed = TeamExecutionProfileSchema.safeParse({
    provider: entry.provider,
    model: entry.model ?? null,
    modeId: entry.modeId ?? null,
    thinkingOptionId: entry.thinkingOptionId ?? null,
    featureValues: entry.featureValues ?? {},
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Compares the stored Member snapshot against the current catalog. Clients read
 * the status instead of computing digests; an entry that no longer materializes
 * reads as `update_available` because committing it is what surfaces
 * `team_agent_profile_invalid`.
 */
export function selectTeamMemberExecutionSourceStatus(
  member: TeamMemberProfile,
  profiles: readonly AgentProfileExecutionFacts[],
): TeamMemberExecutionSourceStatus {
  const source = member.executionProfileSource;
  if (!source) return { kind: "inline" };
  const profileId = source.profileId;
  const matches = profiles.filter((profile) => profile.id === profileId);
  if (matches.length === 0) return { kind: "missing", profileId };
  if (matches.length > 1) return { kind: "ambiguous", profileId };
  const next = normalizeAgentProfileExecutionProfile(matches[0]!);
  if (!next) return { kind: "update_available", profileId };
  return isSameExecutionProfile(next, member.executionProfile)
    ? { kind: "current", profileId }
    : { kind: "update_available", profileId };
}

function isSameExecutionProfile(left: TeamExecutionProfile, right: TeamExecutionProfile): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** Key-sorted, array-order-preserving JSON — the shape the daemon digests. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
