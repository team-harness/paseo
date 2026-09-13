import { z } from "zod";
import snapshot from "./model_prices_and_context_window.json" with { type: "json" };
import source from "./source.json" with { type: "json" };

export const MODEL_PRICING_REVISION = source.revision;
const catalogue = z.record(z.string(), z.record(z.string(), z.unknown())).parse(snapshot);

export interface ModelCostInput {
  modelId: string | null | undefined;
  provider?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  serviceTier?: "default" | "priority" | "flex";
  requestInputTokens?: number;
}

export function estimateModelCostUsd(input: ModelCostInput): number | undefined {
  const modelId = input.modelId?.trim();
  if (!modelId) return undefined;
  const provider = input.provider ?? "openai";
  const pricing = catalogue[`${provider}/${modelId}`] ?? catalogue[modelId];
  if (!pricing || pricing.litellm_provider !== provider || pricing.mode !== "chat")
    return undefined;
  const counts = normalizeCounts(input);
  if (!counts) return undefined;
  const { cached, created, context, inputTokens, outputTokens } = counts;
  const tier =
    input.serviceTier === undefined || input.serviceTier === "default"
      ? ""
      : `_${input.serviceTier}`;
  const rates = [
    [inputTokens - cached - created, "input_cost_per_token"],
    [cached, "cache_read_input_token_cost"],
    [outputTokens, "output_cost_per_token"],
    [created, "cache_creation_input_token_cost"],
  ] as const;
  let cost = 0;
  for (const [count, field] of rates) {
    if (count === 0) continue;
    const rate = resolveRate(pricing, field, tier, context);
    if (rate === undefined) return undefined;
    cost += count * rate;
  }
  return Number.isFinite(cost) ? Number(cost.toFixed(12)) : undefined;
}

function normalizeCounts(input: ModelCostInput) {
  if (input.inputTokens === undefined || input.outputTokens === undefined) return undefined;
  const cached = input.cachedInputTokens ?? 0;
  const created = input.cacheCreationInputTokens ?? 0;
  const context = input.requestInputTokens ?? input.inputTokens;
  const counts = [input.inputTokens, cached, input.outputTokens, created, context];
  if (counts.some((count) => !Number.isFinite(count) || count < 0)) return undefined;
  if (cached + created > input.inputTokens) return undefined;
  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cached,
    created,
    context,
  };
}

function resolveRate(
  pricing: Record<string, unknown>,
  field: string,
  tier: string,
  context: number,
): number | undefined {
  let suffix = "";
  let highestThreshold = 0;
  for (const key of Object.keys(pricing)) {
    if (!key.startsWith(`${field}_above_`)) continue;
    const match = /^_above_(\d+)(k|m)?_tokens$/.exec(key.slice(field.length));
    if (!match) continue;
    const multiplier = match[2] === "m" ? 1_000_000 : 1;
    const threshold = Number(match[1]) * (match[2] === "k" ? 1000 : multiplier);
    if (context > threshold && threshold > highestThreshold) {
      highestThreshold = threshold;
      suffix = match[0];
    }
  }
  // Never substitute standard prices for an unsupported paid service tier.
  const rate = pricing[`${field}${suffix}${tier}`];
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}
