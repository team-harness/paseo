import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
import { EMBEDDED_METHODOLOGIES } from "./catalog.generated.js";

const descriptors: MethodologyDescriptor[] = EMBEDDED_METHODOLOGIES.map(({ digest, bundle }) => ({
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
      writableWorkstreams: bundle.policy.review.writableWorkstreams,
      independentMeans: "different_from_subject_owner",
      unavailable: "review_gate_reviewer_unavailable_attention",
      unknownCapabilities: "review_gate_capability_unknown_attention",
      operatorWaiver: bundle.policy.review.operatorWaiver,
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
    audience,
  })),
}));

export class MethodologyCatalog {
  list(): MethodologyDescriptor[] {
    return structuredClone(descriptors);
  }
  get(ref: MethodologyDescriptor["ref"]): MethodologyDescriptor | null {
    const value = descriptors.find(
      (entry) =>
        entry.ref.bundleId === ref.bundleId &&
        entry.ref.version === ref.version &&
        entry.ref.digest === ref.digest,
    );
    return value ? structuredClone(value) : null;
  }
}
