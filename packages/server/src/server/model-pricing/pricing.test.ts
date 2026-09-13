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
