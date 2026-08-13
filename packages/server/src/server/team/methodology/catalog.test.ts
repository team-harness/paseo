import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EMBEDDED_METHODOLOGIES } from "./catalog.generated";
import { MethodologyCatalog, MethodologyCompileError } from "./catalog";

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

  it("compiles deterministic ordered Mission snapshots from structural facts", () => {
    const catalog = new MethodologyCatalog();
    const input = {
      binding: {
        ref: standardRef,
        presetId: "lean-delivery",
        memberArchetypeBindings: [
          { memberId: "member-lead", archetypeId: "lead" },
          { memberId: "member-builder", archetypeId: "builder" },
        ],
        skillBindings: [{ teamSkillId: "typescript", methodologySkillId: null }],
      },
      teamRevision: 7,
      roster: {
        rosterSnapshotRevision: 1,
        leadMemberId: "member-lead",
        members: [
          {
            memberId: "member-lead",
            role: "Lead",
            level: 5,
            skillIds: ["typescript"],
            capabilityFacts: { kind: "known" as const, capabilityIds: ["structured-tools"] },
          },
          {
            memberId: "member-builder",
            role: "Builder",
            level: 3,
            skillIds: ["typescript"],
            capabilityFacts: { kind: "known" as const, capabilityIds: ["structured-tools"] },
          },
        ],
      },
      mission: {
        objective: "Ship the compiler",
        constraints: ["Keep the contract deterministic"],
        acceptanceCriteria: ["The digest is stable"],
      },
    };

    const first = catalog.compileMission(input);
    const replay = catalog.compileMission(structuredClone(input));

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      revision: 1,
      ref: standardRef,
      compilerVersion: 1,
      teamRevision: 7,
      rosterSnapshotRevision: 1,
      hardPolicyDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      promptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      compiledDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(first.promptSections.map((section) => section.sectionId)).toEqual([
      "mission-startup:lead:startup:startup-charter",
      "planning-loop:lead:planning:planning-specification",
      "planning-loop:delivery:planning:planning-specification",
      "planning-loop:lead:planning:planning-decomposition",
      "planning-loop:delivery:planning:planning-decomposition",
      "assignment-handoff:lead:assignment:assignment-contract",
      "assignment-handoff:delivery:assignment:assignment-contract",
      "review-loop:lead:review:review-scope",
      "review-loop:review:review:review-scope",
      "completion-gate:lead:completion:verification-gate",
      "completion-gate:delivery:completion:verification-gate",
      "completion-gate:verification:completion:verification-gate",
      "completion-gate:lead:completion:evidence-reporting",
      "completion-gate:delivery:completion:evidence-reporting",
      "completion-gate:verification:completion:evidence-reporting",
    ]);

    const changedFacts = structuredClone(input);
    changedFacts.roster.members[1]!.capabilityFacts.capabilityIds.push("review");
    expect(catalog.compileMission(changedFacts).compiledDigest).not.toBe(first.compiledDigest);

    const nonStructuralInputs = structuredClone(input) as typeof input & {
      workspaceId: string;
      workspacePath: string;
      compiledAt: string;
      runtimeAgentId: string;
      providerAvailable: boolean;
      executionProfileSource: { profileId: string };
    };
    Object.assign(nonStructuralInputs, {
      workspaceId: "workspace-b",
      workspacePath: "/tmp/workspace-b",
      compiledAt: "2030-01-01T00:00:00.000Z",
      runtimeAgentId: "agent-runtime-b",
      providerAvailable: false,
      executionProfileSource: { profileId: "profile-b" },
    });
    expect(catalog.compileMission(nonStructuralInputs)).toEqual(first);
  });

  it("distinguishes an exact-ref digest mismatch before compiling", () => {
    const catalog = new MethodologyCatalog();
    const descriptor = catalog.list()[0]!;
    expect(() =>
      catalog.compileMission({
        binding: {
          ref: { ...descriptor.ref, digest: `sha256:${"0".repeat(64)}` },
          presetId: null,
          memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: null }],
          skillBindings: [],
        },
        teamRevision: 1,
        roster: {
          rosterSnapshotRevision: 1,
          leadMemberId: "member-lead",
          members: [
            {
              memberId: "member-lead",
              role: "Lead",
              level: 5,
              skillIds: [],
              capabilityFacts: { kind: "known", capabilityIds: ["structured-tools"] },
            },
          ],
        },
        mission: { objective: "Compile", constraints: [], acceptanceCriteria: ["Compiled"] },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MethodologyCompileError>>({
        code: "methodology_digest_mismatch",
      }),
    );
  });

  it("fails closed when Lead structural capabilities are unknown or unsatisfied", () => {
    const catalog = new MethodologyCatalog();
    const base = {
      binding: {
        ref: standardRef,
        presetId: null,
        memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "lead" }],
        skillBindings: [] as Array<{ teamSkillId: string; methodologySkillId: string | null }>,
      },
      teamRevision: 1,
      roster: {
        rosterSnapshotRevision: 1,
        leadMemberId: "member-lead",
        members: [
          {
            memberId: "member-lead",
            role: "Lead",
            level: 5,
            skillIds: [] as string[],
            capabilityFacts: {
              kind: "unknown" as const,
              providerId: "codex",
              reason: "provider_declaration_unavailable" as const,
            },
          },
        ],
      },
      mission: { objective: "Compile", constraints: [], acceptanceCriteria: ["Compiled"] },
    };
    expect(() => catalog.compileMission(base)).toThrowError(
      expect.objectContaining<Partial<MethodologyCompileError>>({
        code: "methodology_capability_unknown",
      }),
    );

    const unsatisfied = structuredClone(base);
    unsatisfied.roster.members[0]!.capabilityFacts = {
      kind: "known",
      capabilityIds: [],
    };
    expect(() => catalog.compileMission(unsatisfied)).toThrowError(
      expect.objectContaining<Partial<MethodologyCompileError>>({
        code: "methodology_capability_unsatisfied",
      }),
    );
  });

  it("classifies unsupported schemas and oversized bundles before digest comparison", () => {
    const schemaUnsupported = structuredClone(EMBEDDED_METHODOLOGIES[0]);
    Object.assign(schemaUnsupported.bundle, { schemaVersion: 2 });
    expect(() =>
      new MethodologyCatalog([schemaUnsupported as never]).compileMission(
        compileInput(schemaUnsupported.digest),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<MethodologyCompileError>>({
        code: "methodology_schema_unsupported",
      }),
    );

    const oversized = structuredClone(EMBEDDED_METHODOLOGIES[0]) as unknown as {
      ref: string;
      digest: string;
      bundle: (typeof EMBEDDED_METHODOLOGIES)[0]["bundle"] & { oversized?: string };
    };
    oversized.bundle.oversized = "x".repeat(1024 * 1024);
    expect(() =>
      new MethodologyCatalog([oversized]).compileMission(compileInput(oversized.digest)),
    ).toThrowError(
      expect.objectContaining<Partial<MethodologyCompileError>>({ code: "methodology_invalid" }),
    );
  });

  it("enforces the 64 KiB rendered prompt budget for each audience", () => {
    const entry = structuredClone(EMBEDDED_METHODOLOGIES[0]);
    for (const asset of entry.bundle.promptAssets) {
      if (asset.assetId === "startup-charter" || asset.assetId === "planning-specification") {
        asset.content = "x".repeat(40 * 1024);
      }
    }
    entry.digest = digest(entry.bundle);

    expect(() =>
      new MethodologyCatalog([entry]).compileMission(compileInput(entry.digest)),
    ).toThrowError(
      expect.objectContaining<Partial<MethodologyCompileError>>({
        code: "methodology_prompt_budget_exceeded",
        message: expect.stringContaining("audience lead"),
      }),
    );
  });
});

function compileInput(digestValue: string) {
  return {
    binding: {
      ref: { bundleId: "paseo/standard", version: "1", digest: digestValue },
      presetId: null,
      memberArchetypeBindings: [{ memberId: "member-lead", archetypeId: "lead" }],
      skillBindings: [] as Array<{ teamSkillId: string; methodologySkillId: string | null }>,
    },
    teamRevision: 1,
    roster: {
      rosterSnapshotRevision: 1,
      leadMemberId: "member-lead",
      members: [
        {
          memberId: "member-lead",
          role: "Lead",
          level: 5,
          skillIds: [] as string[],
          capabilityFacts: { kind: "known" as const, capabilityIds: ["structured-tools"] },
        },
      ],
    },
    mission: { objective: "Compile", constraints: [], acceptanceCriteria: ["Compiled"] },
  };
}

function digest(value: unknown): string {
  const canonical = (current: unknown): string => {
    if (Array.isArray(current)) return `[${current.map(canonical).join(",")}]`;
    if (current && typeof current === "object") {
      return `{${Object.entries(current)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
        .join(",")}}`;
    }
    return JSON.stringify(current);
  };
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
