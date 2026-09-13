import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

function download(url) {
  return execFileSync(
    "curl",
    ["--fail", "--silent", "--show-error", "--location", "--max-time", "60", url],
    { maxBuffer: 20 * 1024 * 1024 },
  );
}

const revision =
  process.argv[2] ??
  JSON.parse(download("https://api.github.com/repos/BerriAI/litellm/commits/main").toString()).sha;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Expected a full LiteLLM commit SHA");
const source = `https://raw.githubusercontent.com/BerriAI/litellm/${revision}/model_prices_and_context_window.json`;
const bytes = download(source);
const prices = JSON.parse(bytes.toString());
if (!prices["gpt-6-astra"] || Object.keys(prices).length < 1000)
  throw new Error("Incomplete pricing catalogue");
for (const [model, entry] of Object.entries(prices)) {
  if (model === "sample_spec") continue;
  for (const [field, value] of Object.entries(entry)) {
    if (
      !/^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)/.test(
        field,
      )
    )
      continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new Error(`Invalid rate: ${model}.${field}`);
  }
}
const directory = new URL("../packages/server/src/server/model-pricing/", import.meta.url);
const license = download(`https://raw.githubusercontent.com/BerriAI/litellm/${revision}/LICENSE`);
await mkdir(directory, { recursive: true });
await writeFile(new URL("model_prices_and_context_window.json", directory), bytes);
await writeFile(
  new URL("source.json", directory),
  `${JSON.stringify({ source, revision, sha256: createHash("sha256").update(bytes).digest("hex"), updatedAt: new Date().toISOString() }, null, 2)}\n`,
);
await writeFile(new URL("LICENSE.litellm", directory), license);
console.log(`Updated ${Object.keys(prices).length} model entries from ${revision}`);
