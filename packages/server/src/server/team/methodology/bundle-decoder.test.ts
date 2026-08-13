import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeMethodologyBundle, type MethodologyBundleV1 } from "./bundle-decoder.js";

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@team-harness/methodologies/package.json")),
);

interface ValidCase {
  inputText?: string;
  inputBase64?: string;
  digest: string;
}
interface InvalidCase {
  inputText?: string;
  inputBase64?: string;
  digest?: string;
  expectedDigest?: string;
  errorCode: string;
}

async function loadCase<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(packageRoot, "conformance", path), "utf8")) as T;
}

function caseBytes(testCase: ValidCase | InvalidCase): Buffer {
  return testCase.inputBase64
    ? Buffer.from(testCase.inputBase64, "base64")
    : Buffer.from(testCase.inputText ?? "", "utf8");
}

describe("decodeMethodologyBundle", () => {
  it("passes the published shared conformance corpus", async () => {
    const index = JSON.parse(
      await readFile(resolve(packageRoot, "conformance/index.json"), "utf8"),
    ) as { valid: string[]; invalid: string[] };

    for (const path of index.valid) {
      const testCase = await loadCase<ValidCase>(path);
      try {
        expect(decodeMethodologyBundle(caseBytes(testCase), testCase.digest).digest, path).toBe(
          testCase.digest,
        );
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
    for (const path of index.invalid) {
      const testCase = await loadCase<InvalidCase>(path);
      expect(
        () =>
          decodeMethodologyBundle(caseBytes(testCase), testCase.expectedDigest ?? testCase.digest),
        path,
      ).toThrowError(expect.objectContaining({ code: testCase.errorCode }));
    }
  });

  it.each([
    [
      "CRLF prompt content",
      (bundle: MethodologyBundleV1) => (bundle.promptAssets[0]!.content = "line\r\nnext"),
      "bundle_unsafe_text",
    ],
    [
      "invalid identifier in a reference array",
      (bundle: MethodologyBundleV1) => (bundle.archetypes[0]!.playbookIds[0] = "review\nloop"),
      "bundle_invalid_value",
    ],
  ])("rejects %s", async (_name, mutate, errorCode) => {
    const bytes = await readFile(resolve(packageRoot, "bundles/paseo/standard-1.json"));
    const bundle = JSON.parse(bytes.toString("utf8")) as MethodologyBundleV1;
    mutate(bundle);
    expect(() => decodeMethodologyBundle(Buffer.from(JSON.stringify(bundle)))).toThrowError(
      expect.objectContaining({ code: errorCode }),
    );
  });
});
