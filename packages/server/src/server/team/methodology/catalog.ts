import { createHash } from "node:crypto";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type {
  MissionCapabilityFacts,
  MissionMethodologySnapshot,
  TeamMethodologyBinding,
} from "@getpaseo/protocol/team/v2-types";
import type { MethodologyBundleV1 } from "./bundle-decoder.js";
import { EMBEDDED_METHODOLOGIES } from "./catalog.generated.js";

export interface CompileMissionMethodologyInput {
  binding: TeamMethodologyBinding;
  teamRevision: number;
  roster: {
    rosterSnapshotRevision: number;
    leadMemberId: string;
    members: Array<{
      memberId: string;
      role: string;
      level: number;
      skillIds: string[];
      capabilityFacts: MissionCapabilityFacts;
    }>;
  };
  mission: {
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
  };
}

export class MethodologyCompileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MethodologyCompileError";
  }
}

const MAX_BUNDLE_BYTES = 1024 * 1024;
const MAX_PROMPT_SECTION_BYTES = 64 * 1024;
const MAX_PROMPT_SNAPSHOT_BYTES = 256 * 1024;

interface EmbeddedMethodologyEntry {
  ref: string;
  digest: string;
  bundle: MethodologyBundleV1;
}

function descriptorFor({ digest, bundle }: EmbeddedMethodologyEntry): MethodologyDescriptor {
  return {
    ref: { bundleId: bundle.identity.bundleId, version: bundle.identity.version, digest },
    name: bundle.identity.name,
    description: bundle.identity.description,
    license: bundle.identity.license,
    skills: bundle.skills.map(({ skillId, name, description }) => ({
      skillId,
      name,
      description,
    })),
    archetypes: bundle.archetypes.map(({ archetypeId, ...value }) => ({ archetypeId, ...value })),
    presets: bundle.presets.map(({ presetId, slots, ...value }) => ({
      presetId,
      ...value,
      slots: slots.map(({ slotId, ...slot }) => ({ slotId, ...slot })),
    })),
    policySummary: {
      review: {
        writableWorkstreams: bundle.policy.review.writableWorkstreams as
          | "lead_discretion"
          | "independent_required",
        independentMeans: "different_from_subject_owner",
        unavailable: "review_gate_reviewer_unavailable_attention",
        unknownCapabilities: "review_gate_capability_unknown_attention",
        operatorWaiver: bundle.policy.review.operatorWaiver as "allowed_with_reason" | "forbidden",
      },
      verification: {
        required: true,
        mutableScope: "read_only",
        reviewerSelection: "prefer_independent_record_exception",
        operatorWaiver: "forbidden",
      },
    },
    playbooks: bundle.playbooks.map(({ playbookId, name, description, audience }) => ({
      playbookId,
      name,
      description,
      audience: audience as Array<"lead" | "delivery" | "review" | "verification">,
    })),
  };
}

export class MethodologyCatalog {
  constructor(
    private readonly entries: readonly EmbeddedMethodologyEntry[] = EMBEDDED_METHODOLOGIES,
  ) {}

  list(): MethodologyDescriptor[] {
    return structuredClone(this.entries.map(descriptorFor));
  }
  get(ref: MethodologyDescriptor["ref"]): MethodologyDescriptor | null {
    const value = this.entries
      .map(descriptorFor)
      .find(
        (entry) =>
          entry.ref.bundleId === ref.bundleId &&
          entry.ref.version === ref.version &&
          entry.ref.digest === ref.digest,
      );
    return value ? structuredClone(value) : null;
  }

  compileMission(input: CompileMissionMethodologyInput): MissionMethodologySnapshot {
    const entry = this.entries.find(
      ({ bundle }) =>
        bundle.identity.bundleId === input.binding.ref.bundleId &&
        bundle.identity.version === input.binding.ref.version,
    );
    if (!entry) {
      throw new MethodologyCompileError(
        "methodology_not_found",
        `Methodology ${input.binding.ref.bundleId}@${input.binding.ref.version} was not found`,
      );
    }
    verifyBundle(entry, input.binding.ref.digest);
    validateBinding(entry.bundle, input);
    return compileSnapshot(entry.bundle, input);
  }
}

function verifyBundle(entry: EmbeddedMethodologyEntry, expectedDigest: string): void {
  if ((entry.bundle as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new MethodologyCompileError(
      "methodology_schema_unsupported",
      `Methodology ${entry.bundle.identity.bundleId}@${entry.bundle.identity.version} uses an unsupported schema`,
    );
  }
  const canonicalBundle = canonicalJson(entry.bundle);
  const bundleBytes = Buffer.byteLength(canonicalBundle, "utf8");
  if (bundleBytes > MAX_BUNDLE_BYTES) {
    throw new MethodologyCompileError(
      "methodology_invalid",
      `Methodology bundle is ${bundleBytes} bytes; limit is ${MAX_BUNDLE_BYTES}`,
    );
  }
  const actualDigest = digestCanonicalValue(entry.bundle);
  if (entry.digest !== actualDigest || expectedDigest !== actualDigest) {
    throw new MethodologyCompileError(
      "methodology_digest_mismatch",
      `Methodology ${entry.bundle.identity.bundleId}@${entry.bundle.identity.version} digest does not match its exact ref`,
    );
  }
}

function compileSnapshot(
  bundle: MethodologyBundleV1,
  input: CompileMissionMethodologyInput,
): MissionMethodologySnapshot {
  const hardPolicy = {
    review: {
      writableWorkstreams: bundle.policy.review.writableWorkstreams as
        | "lead_discretion"
        | "independent_required",
      independentMeans: "different_from_subject_owner" as const,
      unavailable: "review_gate_reviewer_unavailable_attention" as const,
      unknownCapabilities: "review_gate_capability_unknown_attention" as const,
      operatorWaiver: bundle.policy.review.operatorWaiver as "allowed_with_reason" | "forbidden",
    },
    verification: {
      required: true as const,
      mutableScope: "read_only" as const,
      reviewerSelection: "prefer_independent_record_exception" as const,
      operatorWaiver: "forbidden" as const,
    },
  };
  const assets = new Map(bundle.promptAssets.map((asset) => [asset.assetId, asset]));
  const selectedPlaybookIds = new Set<string>();
  const archetypes = new Map(
    bundle.archetypes.map((archetype) => [archetype.archetypeId, archetype]),
  );
  for (const binding of input.binding.memberArchetypeBindings) {
    if (binding.archetypeId === null) continue;
    for (const playbookId of archetypes.get(binding.archetypeId)?.playbookIds ?? []) {
      selectedPlaybookIds.add(playbookId);
    }
  }
  const audienceOrder = new Map([
    ["lead", 0],
    ["delivery", 1],
    ["review", 2],
    ["verification", 3],
  ]);
  const promptSections = bundle.playbooks
    .filter((playbook) => selectedPlaybookIds.has(playbook.playbookId))
    .flatMap((playbook) =>
      playbook.promptAssetIds.flatMap((assetId) => {
        const asset = assets.get(assetId);
        if (!asset) return [];
        return playbook.audience.map((audience) => ({
          sectionId: `${playbook.playbookId}:${audience}:${String(playbook.phase)}:${asset.assetId}`,
          audience: audience as "lead" | "delivery" | "review" | "verification",
          phase: playbook.phase as "startup" | "planning" | "assignment" | "review" | "completion",
          content: asset.content,
          contentDigest: digestCanonicalValue(asset.content),
          order: asset.order,
        }));
      }),
    )
    .toSorted(
      (left, right) =>
        left.order - right.order ||
        (audienceOrder.get(left.audience) ?? 99) - (audienceOrder.get(right.audience) ?? 99) ||
        left.sectionId.localeCompare(right.sectionId),
    )
    .map(({ order: _order, ...section }) => section);
  enforcePromptBudgets(promptSections);
  const hardPolicyDigest = digestCanonicalValue(hardPolicy);
  const promptDigest = digestCanonicalValue(promptSections);
  const deterministicInput = {
    revision: 1 as const,
    ref: input.binding.ref,
    compilerVersion: 1 as const,
    teamRevision: input.teamRevision,
    rosterSnapshotRevision: input.roster.rosterSnapshotRevision,
    binding: normalizeBinding(input.binding),
    roster: normalizeRoster(input.roster),
    mission: input.mission,
    hardPolicy,
    promptSections,
    hardPolicyDigest,
    promptDigest,
  };
  return {
    revision: deterministicInput.revision,
    ref: structuredClone(deterministicInput.ref),
    compilerVersion: deterministicInput.compilerVersion,
    teamRevision: deterministicInput.teamRevision,
    rosterSnapshotRevision: deterministicInput.rosterSnapshotRevision,
    hardPolicy,
    promptSections,
    hardPolicyDigest,
    promptDigest,
    compiledDigest: digestCanonicalValue(deterministicInput),
  };
}

function validateBinding(bundle: MethodologyBundleV1, input: CompileMissionMethodologyInput): void {
  const memberIds = new Set(input.roster.members.map((member) => member.memberId));
  const boundMemberIds = input.binding.memberArchetypeBindings.map((binding) => binding.memberId);
  const archetypeIds = new Set(bundle.archetypes.map((archetype) => archetype.archetypeId));
  const methodologySkillIds = new Set(bundle.skills.map((skill) => skill.skillId));
  const rosterSkillIds = new Set(input.roster.members.flatMap((member) => member.skillIds));
  const boundSkillIds = input.binding.skillBindings.map((binding) => binding.teamSkillId);
  const presetIds = new Set(bundle.presets.map((preset) => preset.presetId));
  if (
    new Set(boundMemberIds).size !== memberIds.size ||
    boundMemberIds.some((memberId) => !memberIds.has(memberId)) ||
    input.binding.memberArchetypeBindings.some(
      (binding) => binding.archetypeId !== null && !archetypeIds.has(binding.archetypeId),
    ) ||
    (input.binding.presetId !== null && !presetIds.has(input.binding.presetId)) ||
    new Set(boundSkillIds).size !== boundSkillIds.length ||
    [...rosterSkillIds].some((skillId) => !boundSkillIds.includes(skillId)) ||
    input.binding.skillBindings.some(
      (binding) =>
        binding.methodologySkillId !== null && !methodologySkillIds.has(binding.methodologySkillId),
    ) ||
    !memberIds.has(input.roster.leadMemberId)
  ) {
    throw new MethodologyCompileError(
      "methodology_binding_invalid",
      "Methodology binding does not match the frozen Mission roster",
    );
  }
  const lead = input.roster.members.find(
    (member) => member.memberId === input.roster.leadMemberId,
  )!;
  if (lead.capabilityFacts.kind === "unknown") {
    throw new MethodologyCompileError(
      "methodology_capability_unknown",
      `Lead ${lead.memberId} capability facts are unavailable from provider ${lead.capabilityFacts.providerId}`,
    );
  }
  if (!lead.capabilityFacts.capabilityIds.includes("structured-tools")) {
    throw new MethodologyCompileError(
      "methodology_capability_unsatisfied",
      `Lead ${lead.memberId} does not declare structured-tools`,
    );
  }
}

function enforcePromptBudgets(promptSections: MissionMethodologySnapshot["promptSections"]): void {
  let totalBytes = 0;
  const audienceBytes = new Map<string, number>();
  for (const section of promptSections) {
    const sectionBytes = Buffer.byteLength(section.content, "utf8");
    if (sectionBytes > MAX_PROMPT_SECTION_BYTES) {
      throw new MethodologyCompileError(
        "methodology_prompt_budget_exceeded",
        `Prompt section ${section.sectionId} is ${sectionBytes} bytes; limit is ${MAX_PROMPT_SECTION_BYTES}`,
      );
    }
    totalBytes += sectionBytes;
    const renderedAudienceBytes = (audienceBytes.get(section.audience) ?? 0) + sectionBytes;
    audienceBytes.set(section.audience, renderedAudienceBytes);
    if (renderedAudienceBytes > MAX_PROMPT_SECTION_BYTES) {
      throw new MethodologyCompileError(
        "methodology_prompt_budget_exceeded",
        `Methodology prompt audience ${section.audience} is ${renderedAudienceBytes} bytes; limit is ${MAX_PROMPT_SECTION_BYTES}`,
      );
    }
  }
  if (totalBytes > MAX_PROMPT_SNAPSHOT_BYTES) {
    throw new MethodologyCompileError(
      "methodology_prompt_budget_exceeded",
      `Methodology prompt snapshot is ${totalBytes} bytes; limit is ${MAX_PROMPT_SNAPSHOT_BYTES}`,
    );
  }
}

function normalizeBinding(binding: TeamMethodologyBinding): TeamMethodologyBinding {
  return {
    ref: structuredClone(binding.ref),
    presetId: binding.presetId,
    memberArchetypeBindings: [...binding.memberArchetypeBindings].toSorted((left, right) =>
      compare(left.memberId, right.memberId),
    ),
    skillBindings: [...binding.skillBindings].toSorted((left, right) =>
      compare(left.teamSkillId, right.teamSkillId),
    ),
  };
}

function normalizeRoster(input: CompileMissionMethodologyInput["roster"]) {
  return {
    rosterSnapshotRevision: input.rosterSnapshotRevision,
    leadMemberId: input.leadMemberId,
    members: [...input.members]
      .toSorted((left, right) => compare(left.memberId, right.memberId))
      .map((member) => ({
        memberId: member.memberId,
        role: member.role,
        level: member.level,
        skillIds: [...member.skillIds].toSorted(),
        capabilityFacts:
          member.capabilityFacts.kind === "known"
            ? {
                kind: "known" as const,
                capabilityIds: [...member.capabilityFacts.capabilityIds].toSorted(),
              }
            : structuredClone(member.capabilityFacts),
      })),
  };
}

function digestCanonicalValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => compare(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
