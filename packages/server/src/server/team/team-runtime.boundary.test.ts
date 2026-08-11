import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const TEAM_ROOT = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_IMPORTS = [
  "agent-manager",
  "agent-storage",
  "chat-service",
  "provider-registry",
  "workspace-registry",
  "session",
  "websocket-server",
];

describe("Team v2 feature capsule boundaries", () => {
  test("all domain and application sources avoid Paseo core imports", async () => {
    const files = [
      ...(await listProductionTypescriptFiles(resolve(TEAM_ROOT, "domain"))),
      ...(await listProductionTypescriptFiles(resolve(TEAM_ROOT, "application"))),
    ];
    const violations: string[] = [];
    for (const filePath of files) {
      const imports = await readImports(filePath);
      for (const specifier of imports.filter(isForbiddenImport)) {
        violations.push(`${relative(TEAM_ROOT, filePath)} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("Paseo core imports Team internals only through the runtime facade", async () => {
    const coreFiles = [
      resolve(TEAM_ROOT, "../bootstrap.ts"),
      resolve(TEAM_ROOT, "../session.ts"),
      resolve(TEAM_ROOT, "../websocket-server.ts"),
    ];
    const violations: string[] = [];
    for (const filePath of coreFiles) {
      for (const specifier of await readImports(filePath)) {
        if (!specifier?.startsWith("./team/") && !specifier?.startsWith("../team/")) continue;
        if (specifier === "./team/team-runtime.js") continue;
        violations.push(`${relative(resolve(TEAM_ROOT, ".."), filePath)} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("starts recovery after MCP injection is ready and before Team capability exposure", async () => {
    const source = await readFile(resolve(TEAM_ROOT, "../bootstrap.ts"), "utf8");
    const installRuntime = source.indexOf("const teamRuntime = await installPaseoTeamRuntime(");
    const installToolCatalog = source.indexOf(
      "agentManager.setPaseoToolCatalogFactory(createAgentToolCatalog)",
    );
    const injectMcpBaseUrl = source.indexOf("agentManager.setMcpBaseUrl(agentMcpBaseUrl)");
    const startRuntime = source.indexOf("await teamRuntime.start()");
    const exposeTeamCapability = source.indexOf("wsServer = new VoiceAssistantWebSocketServer(");

    expect(
      [
        installRuntime,
        installToolCatalog,
        injectMcpBaseUrl,
        startRuntime,
        exposeTeamCapability,
      ].every((index) => index > 0),
    ).toBe(true);
    expect(installRuntime).toBeLessThan(installToolCatalog);
    expect(installToolCatalog).toBeLessThan(injectMcpBaseUrl);
    expect(injectMcpBaseUrl).toBeLessThan(startRuntime);
    expect(startRuntime).toBeLessThan(exposeTeamCapability);
  });
});

async function listProductionTypescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listProductionTypescriptFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function readImports(filePath: string): Promise<Array<string | undefined>> {
  const source = await readFile(filePath, "utf8");
  return Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);
}

function isForbiddenImport(specifier: string | undefined): boolean {
  return FORBIDDEN_IMPORTS.some((forbidden) => specifier?.includes(forbidden));
}
