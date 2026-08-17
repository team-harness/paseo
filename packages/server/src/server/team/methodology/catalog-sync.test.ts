import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { syncMethodologyCatalog } from "./catalog-sync.js";

const preserveSource = async (_fileName: string, source: string) => source;

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@team-harness/methodologies/package.json")),
);

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "paseo-methodologies-"));
  await cp(packageRoot, root, { recursive: true });
  return root;
}

it("syncs only the two allowlisted exact bundles and is clean on the second run", async () => {
  const source = await fixture();
  const output = resolve(
    await mkdtemp(resolve(tmpdir(), "paseo-catalog-")),
    "catalog.generated.ts",
  );
  expect(await syncMethodologyCatalog({ source, output, formatSource: preserveSource })).toBe(
    "changed",
  );
  expect(await syncMethodologyCatalog({ source, output, formatSource: preserveSource })).toBe(
    "clean",
  );
  expect(await readFile(output, "utf8")).toContain("sha256:d5001287");
  expect(await readFile(output, "utf8")).toContain("sha256:5c86942a");
});

it.each([
  ["extra bundle", async (root: string) => writeFile(resolve(root, "bundles/extra.json"), "{}")],
  [
    "digest mismatch",
    async (root: string) => writeFile(resolve(root, "bundles/paseo/standard-1.json"), "{}"),
  ],
  [
    "duplicate exact ref",
    async (root: string) => {
      const manifestPath = resolve(root, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.bundles.push({ ...manifest.bundles[0], digest: `sha256:${"0".repeat(64)}` });
      await writeFile(manifestPath, JSON.stringify(manifest));
    },
  ],
])("fails closed on %s", async (_name, mutate) => {
  const source = await fixture();
  await mutate(source);
  await expect(
    syncMethodologyCatalog({
      source,
      output: resolve(source, "out.ts"),
      formatSource: preserveSource,
    }),
  ).rejects.toThrow();
});
