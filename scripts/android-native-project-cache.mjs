import { createHash } from "node:crypto";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_FILENAME = ".paseo-native-project-cache.json";
const CACHE_SCHEMA_VERSION = 1;
// Increment after changing generated-project patching or the fingerprint contract.
const FINGERPRINT_VERSION = 1;
const REQUIRED_ANDROID_PROJECT_FILES = ["gradlew", "settings.gradle", "app/build.gradle"];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizePaths(value, repoRoot) {
  if (Array.isArray(value)) return value.map((entry) => normalizePaths(entry, repoRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizePaths(entry, repoRoot)]),
    );
  }
  if (typeof value !== "string") return value;

  const normalizedRoot = path.resolve(repoRoot);
  return value.split(normalizedRoot).join("<repo>");
}

async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function collectConfigFileDigests({ appDir, expoConfig, repoRoot }) {
  const candidates = new Set();

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
      return;
    }
    if (typeof value !== "string") return;
    if (path.isAbsolute(value)) candidates.add(path.normalize(value));
    else if (value.startsWith("./") || value.startsWith("../")) {
      candidates.add(path.resolve(appDir, value));
    }
  }

  const publicExpoConfig = { ...expoConfig };
  delete publicExpoConfig._internal;
  visit(publicExpoConfig);
  const digests = {};
  for (const candidate of [...candidates].sort()) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      const key = normalizePaths(candidate, repoRoot);
      digests[key] = await sha256File(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return digests;
}

async function collectTreeDigests(rootDir, repoRoot) {
  const digests = {};

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) {
        digests[normalizePaths(entryPath, repoRoot)] = await sha256File(entryPath);
      }
    }
  }

  await visit(rootDir);
  return digests;
}

async function collectReactNativePackageVersions(reactNativeConfig, repoRoot) {
  const packageRoots = new Set([reactNativeConfig.reactNativePath]);
  for (const dependency of Object.values(reactNativeConfig.dependencies ?? {})) {
    if (dependency?.root) packageRoots.add(dependency.root);
  }

  const versions = {};
  for (const packageRoot of [...packageRoots].filter(Boolean).sort()) {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      );
      versions[normalizePaths(packageRoot, repoRoot)] = {
        name: packageJson.name,
        version: packageJson.version,
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return versions;
}

export async function createNativeProjectFingerprint({
  appDir,
  expoConfig,
  expoModulesConfig,
  nativeGeneratorVersions = {},
  reactNativeConfig,
  repoRoot,
}) {
  const reactNativeDependencyConfig = { ...reactNativeConfig };
  delete reactNativeDependencyConfig.project;
  const [configFiles, customPlugins, reactNativePackageVersions] = await Promise.all([
    collectConfigFileDigests({ appDir, expoConfig, repoRoot }),
    collectTreeDigests(path.join(appDir, "plugins"), repoRoot),
    collectReactNativePackageVersions(reactNativeConfig, repoRoot),
  ]);
  const inputs = normalizePaths(
    {
      configFiles,
      customPlugins,
      expoConfig,
      expoModulesConfig,
      fingerprintVersion: FINGERPRINT_VERSION,
      nativeGeneratorVersions,
      reactNativeConfig: reactNativeDependencyConfig,
      reactNativePackageVersions,
    },
    repoRoot,
  );
  return createHash("sha256").update(stableJson(inputs)).digest("hex");
}

export async function getNativeProjectCacheStatus({ androidDir, fingerprint }) {
  for (const relativePath of REQUIRED_ANDROID_PROJECT_FILES) {
    try {
      if (!(await stat(path.join(androidDir, relativePath))).isFile()) {
        return { hit: false, reason: "generated Android project is incomplete" };
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return { hit: false, reason: "generated Android project is incomplete" };
      }
      throw error;
    }
  }

  let metadata;
  try {
    metadata = JSON.parse(await readFile(path.join(androidDir, CACHE_FILENAME), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { hit: false, reason: "cache metadata is missing" };
    if (error instanceof SyntaxError) return { hit: false, reason: "cache metadata is invalid" };
    throw error;
  }
  if (
    metadata?.schemaVersion !== CACHE_SCHEMA_VERSION ||
    typeof metadata.fingerprint !== "string"
  ) {
    return { hit: false, reason: "cache metadata is invalid" };
  }
  if (metadata.fingerprint !== fingerprint) {
    return { hit: false, reason: "native inputs changed" };
  }
  return { hit: true, reason: "native inputs match" };
}

export async function writeNativeProjectCache({ androidDir, fingerprint }) {
  const cachePath = path.join(androidDir, CACHE_FILENAME);
  const temporaryPath = `${cachePath}.tmp-${process.pid}`;
  const metadata = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    fingerprint,
    generatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await rename(temporaryPath, cachePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
