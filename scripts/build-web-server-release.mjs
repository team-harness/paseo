#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "artifacts", "releases");
const RELEASE_WORKSPACES = ["highlight", "relay", "protocol", "client", "server", "cli"];

function parseArgs(argv) {
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir requires a path");
      outputDir = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run build:web-server-release -- [--output-dir <path>]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outputDir };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

function createInstallScript() {
  return `#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 and npm are required." >&2
  exit 1
fi

node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$node_major" -ne 22 ]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$script_dir/verify.mjs"
set -- "$script_dir"/paseo-packs/*.tgz
npm install --global "$@"

global_prefix=$(npm prefix --global)
if [ -x "$global_prefix/bin/paseo" ]; then
  "$global_prefix/bin/paseo" --version
elif command -v paseo >/dev/null 2>&1; then
  paseo --version
fi

echo "Installation complete. Restart the daemon only after running agents have finished:"
echo "  paseo daemon restart --web-ui"
`;
}

function createPowerShellInstallScript() {
  return `$ErrorActionPreference = "Stop"

$nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
if ($LASTEXITCODE -ne 0 -or $nodeMajor -ne 22) {
  throw "Node.js 22 and npm are required."
}

& node (Join-Path $PSScriptRoot "verify.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$packageFiles = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "paseo-packs") -Filter "*.tgz" | Sort-Object Name)
if ($packageFiles.Count -ne ${RELEASE_WORKSPACES.length}) {
  throw "Expected ${RELEASE_WORKSPACES.length} package archives, found $($packageFiles.Count)."
}
$packagePaths = @($packageFiles | ForEach-Object { $_.FullName })
& npm install --global @packagePaths
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$globalPrefix = (& npm prefix --global).Trim()
$paseoCommand = Join-Path $globalPrefix "paseo.cmd"
if (Test-Path -LiteralPath $paseoCommand) {
  & $paseoCommand --version
} elseif (Get-Command paseo -ErrorAction SilentlyContinue) {
  & paseo --version
}

Write-Host "Installation complete. Restart the daemon only after running agents have finished:"
Write-Host "  paseo daemon restart --web-ui"
`;
}

function createVerifierScript() {
  return `import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

for (const entry of manifest.packages) {
  const filePath = path.join(root, entry.file);
  const info = await stat(filePath);
  const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
  if (info.size !== entry.bytes || digest !== entry.sha256) {
    throw new Error(\`Package verification failed: \${entry.file}\`);
  }
}

console.log(\`Verified \${manifest.packages.length} Paseo packages for v\${manifest.version}.\`);
`;
}

function createReadme({ version, commit, archiveName }) {
  return `# Paseo Web + Server ${version}

Commit: \`${commit}\`

This archive installs the fork's CLI, server, protocol, client, relay, and syntax-highlighting packages together. The server package embeds the matching browser Web UI.

This is not the Linux x64 Electron desktop tarball published by the upstream GitHub release. It contains architecture-neutral npm package archives; npm installs external and native dependencies for the target computer during installation.

## Requirements

- Node.js 22 and npm.
- Network access to the configured npm registry for external dependencies.
- A supported macOS, Linux, or Windows host. Native dependencies must support that host.

## Install or upgrade

macOS/Linux:

\`\`\`bash
./install.sh
\`\`\`

Windows PowerShell:

\`\`\`powershell
.\\install.ps1
\`\`\`

The installer verifies all included fork packages and installs them in one npm command, matching the upstream Docker release mechanism. It does not restart Paseo.

## Use in the existing Docker build

Put \`${archiveName}\` in the Docker build context, then replace the Git checkout, \`npm ci\`, and six \`npm pack\` commands with this stage:

\`\`\`dockerfile
FROM node:22-bookworm-slim AS paseo-pack

ARG PASEO_BUNDLE=${archiveName}
ADD \${PASEO_BUNDLE} /tmp/paseo-release/
RUN node /tmp/paseo-release/verify.mjs

# Keep the existing runtime stage. Its package installation remains:
# COPY --from=paseo-pack /tmp/paseo-release/paseo-packs /tmp/paseo-packs
# RUN npm install -g /tmp/paseo-packs/*.tgz
\`\`\`

The archive's \`paseo-packs/\` directory contains the same six workspace archives produced by the official Docker build, in the same dependency order. The runtime image still installs external and native dependencies for its own architecture.

After all running agents have finished, enable the bundled Web UI while restarting:

\`\`\`bash
paseo daemon restart --web-ui
\`\`\`

If no daemon is running:

\`\`\`bash
paseo daemon start --web-ui
\`\`\`

Open \`http://localhost:6767/\`. Set a password and use TLS before exposing the daemon outside a trusted machine or private network.
`;
}

async function main() {
  const { outputDir } = parseArgs(process.argv.slice(2));
  const rootPackage = await readJson(path.join(REPO_ROOT, "package.json"));
  const version = rootPackage.version;
  const packageMetadata = [];

  for (const workspace of RELEASE_WORKSPACES) {
    const packageJson = await readJson(path.join(REPO_ROOT, "packages", workspace, "package.json"));
    if (packageJson.version !== version) {
      throw new Error(`${packageJson.name} is ${packageJson.version}; expected ${version}`);
    }
    packageMetadata.push({ workspace, name: packageJson.name, version: packageJson.version });
  }

  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
  const commit = stdout.trim();
  const shortCommit = commit.slice(0, 10);
  const artifactBase = `Paseo-${version}-web-server-${shortCommit}`;
  const archiveName = `${artifactBase}.tar.gz`;
  const archivePath = path.join(outputDir, archiveName);

  if (await stat(archivePath).catch(() => null)) {
    throw new Error(`Refusing to overwrite existing artifact: ${archivePath}`);
  }

  await mkdir(outputDir, { recursive: true });
  const tempRoot = await mkdtemp(path.join(tmpdir(), "paseo-web-server-release-"));

  try {
    const bundleRoot = path.join(tempRoot, artifactBase);
    const packagesDir = path.join(bundleRoot, "paseo-packs");
    await mkdir(packagesDir, { recursive: true });

    for (const entry of packageMetadata) {
      const before = new Set(await readdir(packagesDir));
      await run("npm", [
        "pack",
        `--workspace=@getpaseo/${entry.workspace}`,
        "--pack-destination",
        packagesDir,
      ]);
      const created = (await readdir(packagesDir)).filter(
        (file) => file.endsWith(".tgz") && !before.has(file),
      );
      if (created.length !== 1) {
        throw new Error(`Expected one archive for ${entry.name}; created ${created.length}`);
      }
      entry.file = path.posix.join("paseo-packs", created[0]);
    }

    for (const entry of packageMetadata) {
      const filePath = path.join(bundleRoot, entry.file);
      const info = await stat(filePath);
      entry.bytes = info.size;
      entry.sha256 = await sha256(filePath);
    }

    const manifest = {
      format: "paseo-web-server-release@1",
      version,
      commit,
      createdAt: new Date().toISOString(),
      installModel: "target-architecture npm install",
      packages: packageMetadata,
      webUi: {
        embeddedIn: "@getpaseo/server",
        enableCommand: "paseo daemon restart --web-ui",
      },
    };

    const serverPackage = packageMetadata.find((entry) => entry.workspace === "server");
    if (!serverPackage) throw new Error("Server package metadata is missing");
    const { stdout: serverEntries } = await execFileAsync(
      "tar",
      ["-tzf", path.join(bundleRoot, serverPackage.file)],
      { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
    );
    if (!serverEntries.split("\n").includes("package/dist/server/web-ui/index.html")) {
      throw new Error("Server package does not contain the embedded Web UI");
    }

    await writeFile(
      path.join(bundleRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await writeFile(
      path.join(bundleRoot, "README.md"),
      createReadme({ version, commit, archiveName }),
    );
    await writeFile(path.join(bundleRoot, "paseo-source-revision"), `${commit}\n`);
    await writeFile(path.join(bundleRoot, "verify.mjs"), createVerifierScript());
    await writeFile(path.join(bundleRoot, "install.sh"), createInstallScript());
    await chmod(path.join(bundleRoot, "install.sh"), 0o755);
    await writeFile(path.join(bundleRoot, "install.ps1"), createPowerShellInstallScript());
    await writeFile(
      path.join(bundleRoot, "SHA256SUMS"),
      `${packageMetadata.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n")}\n`,
    );

    const bundleEntries = (await readdir(bundleRoot)).sort();
    await run("tar", ["-czf", archivePath, "-C", bundleRoot, ...bundleEntries], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });

    const archiveInfo = await stat(archivePath);
    console.log(
      JSON.stringify(
        {
          archivePath,
          version,
          commit,
          bytes: archiveInfo.size,
          sha256: await sha256(archivePath),
          packages: packageMetadata.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
