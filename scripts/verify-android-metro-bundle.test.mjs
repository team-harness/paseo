import assert from "node:assert/strict";
import test from "node:test";

import { verifyAndroidMetroBundle } from "./verify-android-metro-bundle.mjs";

test("Android Metro bundles jsonc-parser through its static ESM graph", async () => {
  const modules = await verifyAndroidMetroBundle();

  assert.ok(modules.some((filePath) => filePath.endsWith("/jsonc-parser/lib/esm/impl/format.js")));
});
