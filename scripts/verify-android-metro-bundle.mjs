import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const metro = require("metro");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const APP_DIR = path.join(REPO_ROOT, "packages", "app");
const ENTRY_FILE = path.join(APP_DIR, "test-fixtures", "jsonc-parser-entry.js");
const EXPECTED_JSONC_MODULES = [
  "lib/esm/main.js",
  "lib/esm/impl/format.js",
  "lib/esm/impl/edit.js",
  "lib/esm/impl/scanner.js",
  "lib/esm/impl/parser.js",
];

export async function verifyAndroidMetroBundle() {
  const config = require(path.join(APP_DIR, "metro.config.cjs"));
  config.maxWorkers = 1;

  const graph = await metro.buildGraph(config, {
    entries: [ENTRY_FILE],
    customResolverOptions: {},
    customTransformOptions: {},
    dev: false,
    minify: false,
    platform: "android",
    type: "module",
  });
  const jsoncModules = [...graph.dependencies.keys()]
    .filter((filePath) => filePath.includes(`${path.sep}jsonc-parser${path.sep}`))
    .map((filePath) => filePath.split(path.sep).join("/"));

  const umdModule = jsoncModules.find((filePath) => filePath.includes("/lib/umd/"));
  if (umdModule) {
    throw new Error(
      `Android Metro graph contains the unsupported jsonc-parser UMD entry: ${umdModule}`,
    );
  }

  for (const expectedModule of EXPECTED_JSONC_MODULES) {
    if (!jsoncModules.some((filePath) => filePath.endsWith(`/jsonc-parser/${expectedModule}`))) {
      throw new Error(`Android Metro graph is missing jsonc-parser/${expectedModule}`);
    }
  }

  return jsoncModules;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyAndroidMetroBundle()
    .then((modules) => {
      console.log(`Android Metro graph includes ${modules.length} jsonc-parser ESM modules.`);
      return modules;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
