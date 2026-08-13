import { describe, expect, it } from "vitest";
import { MethodologyCatalog } from "./catalog";

const standardRef = {
  bundleId: "paseo/standard",
  version: "1",
  digest: "sha256:d5001287a60f868bcef21ecd3c4debb5a5237db002c5b9d0f7b0b78e98969697",
};

describe("MethodologyCatalog", () => {
  it("returns the safe full descriptor for an exact ref", () => {
    const methodology = new MethodologyCatalog().get(standardRef);
    expect(methodology).toMatchObject({
      ref: standardRef,
      presets: expect.arrayContaining([
        expect.objectContaining({ presetId: expect.any(String), slots: expect.any(Array) }),
      ]),
      archetypes: expect.arrayContaining([
        expect.objectContaining({ archetypeId: expect.any(String) }),
      ]),
      skills: expect.arrayContaining([expect.objectContaining({ skillId: expect.any(String) })]),
      policySummary: {
        review: {
          writableWorkstreams: "lead_discretion",
          independentMeans: "different_from_subject_owner",
          unavailable: "review_gate_reviewer_unavailable_attention",
          unknownCapabilities: "review_gate_capability_unknown_attention",
          operatorWaiver: "allowed_with_reason",
        },
        verification: {
          required: true,
          mutableScope: "read_only",
          reviewerSelection: "prefer_independent_record_exception",
          operatorWaiver: "forbidden",
        },
      },
      playbooks: expect.arrayContaining([
        expect.objectContaining({ playbookId: expect.any(String) }),
      ]),
    });
    expect(JSON.stringify(methodology)).not.toMatch(
      /promptAssets|promptAssetIds|installPath|providerMap/,
    );
  });

  it("returns deeply isolated descriptors", () => {
    const catalog = new MethodologyCatalog();
    const first = catalog.list()[0]!;
    first.presets[0]!.slots[0]!.suggestedSkillIds.push("polluted");
    first.policySummary.review.writableWorkstreams = "independent_required";
    first.playbooks[0]!.audience.push("polluted");

    const next = catalog.get(first.ref)!;
    expect(next.presets[0]!.slots[0]!.suggestedSkillIds).not.toContain("polluted");
    expect(next.policySummary.review.writableWorkstreams).toBe("lead_discretion");
    expect(next.playbooks[0]!.audience).not.toContain("polluted");
  });

  it("preserves the two compiled review workstream policies", () => {
    expect(
      new MethodologyCatalog().list().map((item) => item.policySummary.review.writableWorkstreams),
    ).toEqual(["lead_discretion", "independent_required"]);
  });

  it("fails closed when the digest does not match", () => {
    expect(
      new MethodologyCatalog().get({
        ...standardRef,
        digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    ).toBeNull();
  });
});
