import { expect, it } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";
import { ExactMethodologyRefSchema, MethodologyDescriptorSchema } from "./team/v2-rpc-schemas.js";

it("parses methodology list/get RPCs and the optional feature flag", () => {
  expect(
    SessionInboundMessageSchema.parse({ type: "team.methodology.list.request", requestId: "list" })
      .type,
  ).toBe("team.methodology.list.request");
  expect(
    SessionInboundMessageSchema.parse({
      type: "team.methodology.get.request",
      requestId: "get",
      ref: {
        bundleId: "paseo/standard",
        version: "1",
        digest: "sha256:d5001287a60f868bcef21ecd3c4debb5a5237db002c5b9d0f7b0b78e98969697",
      },
    }).type,
  ).toBe("team.methodology.get.request");
  expect(
    SessionOutboundMessageSchema.parse({
      type: "team.methodology.list.response",
      payload: { requestId: "list", methodologies: [], error: null, errorCode: null },
    }).type,
  ).toBe("team.methodology.list.response");
  expect(
    SessionOutboundMessageSchema.parse({
      type: "team.methodology.get.response",
      payload: { requestId: "get", methodology: null, error: null, errorCode: null },
    }).type,
  ).toBe("team.methodology.get.response");
  expect(
    ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "host",
      features: { teamMethodologies: true },
    }).features?.teamMethodologies,
  ).toBe(true);
  expect(
    ServerInfoStatusPayloadSchema.parse({ status: "server_info", serverId: "old", features: {} })
      .features?.teamMethodologies,
  ).toBeUndefined();
});

it("rejects invalid methodology identities and descriptor closed values", () => {
  expect(
    ExactMethodologyRefSchema.safeParse({
      bundleId: "paseo/standard",
      version: "01",
      digest: `sha256:${"0".repeat(64)}`,
    }).success,
  ).toBe(false);
  const descriptor = {
    ref: { bundleId: "paseo/standard", version: "1", digest: `sha256:${"0".repeat(64)}` },
    name: "Standard",
    description: "Standard methodology",
    license: "MIT-0",
    presets: [],
    archetypes: [],
    skills: [],
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
    playbooks: [],
  };
  expect(MethodologyDescriptorSchema.safeParse(descriptor).success).toBe(true);
  expect(
    MethodologyDescriptorSchema.safeParse({
      ...descriptor,
      presets: [
        {
          presetId: "default",
          name: "Default",
          description: "Default preset",
          leadSlotId: "Not Valid",
          skillIds: [],
          slots: [],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    MethodologyDescriptorSchema.safeParse({
      ...descriptor,
      archetypes: [
        {
          archetypeId: "builder",
          name: "Builder",
          description: "Builds",
          maxMembers: null,
          playbookIds: [],
          suggestedLevel: 0,
          suggestedSkillIds: [],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    MethodologyDescriptorSchema.safeParse({
      ...descriptor,
      playbooks: [
        { playbookId: "review", name: "Review", description: "Review", audience: ["owner"] },
      ],
    }).success,
  ).toBe(false);
  expect(
    MethodologyDescriptorSchema.safeParse({
      ...descriptor,
      policySummary: {
        ...descriptor.policySummary,
        review: { ...descriptor.policySummary.review, unavailable: "skip" },
      },
    }).success,
  ).toBe(false);
});
