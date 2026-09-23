import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import source from "./source.json" with { type: "json" };
import { estimateModelCostUsd } from "./pricing.js";

test("ships the unmodified pinned upstream pricing snapshot", () => {
  const bytes = readFileSync(new URL("./model_prices_and_context_window.json", import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
  expect(source.source).toBe(
    `https://raw.githubusercontent.com/BerriAI/litellm/${source.revision}/model_prices_and_context_window.json`,
  );
});

test("prices GPT-6 using the bundled snapshot, separating cached input", () => {
  const cost = estimateModelCostUsd({
    modelId: "gpt-6-astra",
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 100,
  });
  expect(cost).toBeCloseTo(0.0114, 10);
  expect(
    estimateModelCostUsd({ modelId: "gpt-6-not-real", inputTokens: 1000, outputTokens: 100 }),
  ).toBeUndefined();
});

test("selects priority, flex and long-context rates per request", () => {
  const tokens = {
    modelId: "gpt-6-astra",
    inputTokens: 300_000,
    cachedInputTokens: 100_000,
    outputTokens: 1000,
  };
  expect(estimateModelCostUsd(tokens)).toBeCloseTo(4.275);
  expect(estimateModelCostUsd({ ...tokens, serviceTier: "priority" })).toBeCloseTo(8.55);
  expect(estimateModelCostUsd({ ...tokens, serviceTier: "flex" })).toBeCloseTo(2.1375);
  expect(estimateModelCostUsd({ ...tokens, requestInputTokens: 272_000 })).toBeCloseTo(2.15);
});

// OpenAI pricing, checked 2026-09-23: https://developers.openai.com/api/docs/pricing
test.each([
  { modelId: "gpt-6-sol", input: 2, cached: 0.2, created: 2.5, output: 10 },
  { modelId: "gpt-6-luna", input: 0.1, cached: 0.01, created: 0.125, output: 0.5 },
])("prices $modelId across token categories, tiers and the 272K boundary", (rates) => {
  for (const serviceTier of ["default", "priority", "flex"] as const) {
    const tierMultiplier = { default: 1, priority: 2, flex: 0.5 }[serviceTier];
    for (const requestInputTokens of [272_000, 272_001]) {
      const longContext = requestInputTokens > 272_000;
      const inputMultiplier = longContext ? 2 : 1;
      const outputMultiplier = longContext ? 1.5 : 1;
      const context = { modelId: rates.modelId, serviceTier, requestInputTokens };
      expect(estimateModelCostUsd({ ...context, inputTokens: 1000, outputTokens: 0 })).toBeCloseTo(
        (rates.input * inputMultiplier * tierMultiplier) / 1000,
        12,
      );
      expect(
        estimateModelCostUsd({
          ...context,
          inputTokens: 1000,
          cachedInputTokens: 1000,
          outputTokens: 0,
        }),
      ).toBeCloseTo((rates.cached * inputMultiplier * tierMultiplier) / 1000, 12);
      expect(
        estimateModelCostUsd({
          ...context,
          inputTokens: 1000,
          cacheCreationInputTokens: 1000,
          outputTokens: 0,
        }),
      ).toBeCloseTo((rates.created * inputMultiplier * tierMultiplier) / 1000, 12);
      expect(estimateModelCostUsd({ ...context, inputTokens: 0, outputTokens: 1000 })).toBeCloseTo(
        (rates.output * outputMultiplier * tierMultiplier) / 1000,
        12,
      );
    }
  }
});

test.each([
  { modelId: "gpt-6-sol", cost: 0.00238 },
  { modelId: "gpt-6-luna", cost: 0.000119 },
])("does not double-count cached reads or writes for $modelId", ({ modelId, cost }) => {
  expect(
    estimateModelCostUsd({
      modelId,
      inputTokens: 1000,
      cachedInputTokens: 400,
      cacheCreationInputTokens: 200,
      outputTokens: 100,
    }),
  ).toBeCloseTo(cost, 12);
});

test("does not guess providers, model aliases, missing tiers or invalid token counts", () => {
  const tokens = { modelId: "gpt-6-astra", inputTokens: 100, outputTokens: 20 };
  expect(estimateModelCostUsd({ ...tokens, provider: "anthropic" })).toBeUndefined();
  expect(estimateModelCostUsd({ ...tokens, modelId: "gpt-5.5-codex" })).toBeUndefined();
  expect(estimateModelCostUsd({ ...tokens, cachedInputTokens: 101 })).toBeUndefined();
  expect(estimateModelCostUsd({ ...tokens, outputTokens: Number.NaN })).toBeUndefined();
  expect(estimateModelCostUsd({ modelId: "gpt-6-astra", inputTokens: 100 })).toBeUndefined();
  expect(
    estimateModelCostUsd({
      ...tokens,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
      serviceTier: "flex",
    }),
  ).toBeUndefined();
  expect(estimateModelCostUsd({ ...tokens, inputTokens: 0, outputTokens: 0 })).toBe(0);
});
