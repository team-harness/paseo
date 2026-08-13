import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "oxfmt";
import { syncMethodologyCatalog } from "../src/server/team/methodology/catalog-sync.js";

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@team-harness/methodologies/package.json")),
);
const output = resolve(import.meta.dirname, "../src/server/team/methodology/catalog.generated.ts");
const result = await syncMethodologyCatalog({
  source: packageRoot,
  output,
  formatSource: async (fileName, source) => {
    const formatted = await format(fileName, source);
    if (formatted.errors.length > 0) throw new Error("Generated methodology catalog is invalid");
    return formatted.code;
  },
});
console.log(`Methodology catalog sync: ${result}`);
