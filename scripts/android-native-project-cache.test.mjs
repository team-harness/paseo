import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createNativeProjectFingerprint,
  getNativeProjectCacheStatus,
  writeNativeProjectCache,
} from "./android-native-project-cache.mjs";

async function createFixture(prefix) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const appDir = path.join(repoRoot, "packages", "app");
  const nativePackageRoot = path.join(repoRoot, "node_modules", "native-package");

  await Promise.all([
    mkdir(path.join(appDir, "assets"), { recursive: true }),
    mkdir(path.join(appDir, "plugins"), { recursive: true }),
    mkdir(path.join(appDir, "src"), { recursive: true }),
    mkdir(nativePackageRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(appDir, "app.config.js"), "export default {}\n"),
    writeFile(path.join(appDir, "package.json"), '{"dependencies":{"js-only":"1.0.0"}}\n'),
    writeFile(path.join(appDir, "assets", "icon.png"), "icon-v1"),
    writeFile(path.join(appDir, "plugins", "with-native.js"), "module.exports = value => value;\n"),
    writeFile(path.join(appDir, "src", "screen.tsx"), "export const screen = 1;\n"),
    writeFile(
      path.join(nativePackageRoot, "package.json"),
      '{"name":"native-package","version":"1.0.0"}\n',
    ),
  ]);

  return { appDir, nativePackageRoot, repoRoot };
}

function createSnapshots({ appDir, nativePackageRoot, repoRoot }) {
  return {
    expoConfig: {
      _internal: {
        dynamicConfigPath: path.join(appDir, "app.config.js"),
        packageJsonPath: path.join(appDir, "package.json"),
      },
      android: { package: "com.teamharness.paseo" },
      icon: "./assets/icon.png",
      plugins: ["expo-router"],
    },
    expoModulesConfig: {
      modules: [{ packageName: "expo", packageVersion: "54.0.33" }],
    },
    reactNativeConfig: {
      dependencies: {
        "native-package": {
          name: "native-package",
          platforms: { android: { sourceDir: path.join(nativePackageRoot, "android") } },
          root: nativePackageRoot,
        },
      },
      reactNativePath: path.join(repoRoot, "node_modules", "react-native"),
      root: appDir,
    },
  };
}

test("native project fingerprint follows native inputs, not checkout path or app source", async () => {
  const first = await createFixture("paseo-native-cache-a-");
  const second = await createFixture("paseo-native-cache-b-");

  try {
    const firstFingerprint = await createNativeProjectFingerprint({
      ...first,
      ...createSnapshots(first),
    });
    const secondFingerprint = await createNativeProjectFingerprint({
      ...second,
      ...createSnapshots(second),
    });
    assert.equal(firstFingerprint, secondFingerprint);

    await writeFile(path.join(first.appDir, "src", "screen.tsx"), "export const screen = 2;\n");
    await writeFile(
      path.join(first.appDir, "package.json"),
      '{"dependencies":{"js-only":"2.0.0"}}\n',
    );
    assert.equal(
      await createNativeProjectFingerprint({ ...first, ...createSnapshots(first) }),
      firstFingerprint,
    );

    const snapshotsWithGeneratedProject = createSnapshots(first);
    snapshotsWithGeneratedProject.reactNativeConfig.project = {
      android: { sourceDir: path.join(first.appDir, "android") },
    };
    assert.equal(
      await createNativeProjectFingerprint({ ...first, ...snapshotsWithGeneratedProject }),
      firstFingerprint,
    );

    assert.notEqual(
      await createNativeProjectFingerprint({
        ...first,
        ...createSnapshots(first),
        nativeGeneratorVersions: { "@expo/cli": "next" },
      }),
      firstFingerprint,
    );

    await writeFile(path.join(first.appDir, "assets", "icon.png"), "icon-v2");
    assert.notEqual(
      await createNativeProjectFingerprint({ ...first, ...createSnapshots(first) }),
      firstFingerprint,
    );

    await writeFile(
      path.join(first.nativePackageRoot, "package.json"),
      '{"name":"native-package","version":"2.0.0"}\n',
    );
    assert.notEqual(
      await createNativeProjectFingerprint({ ...first, ...createSnapshots(first) }),
      firstFingerprint,
    );

    await writeFile(
      path.join(second.appDir, "plugins", "with-native.js"),
      "module.exports = value => ({ ...value, changed: true });\n",
    );
    assert.notEqual(
      await createNativeProjectFingerprint({ ...second, ...createSnapshots(second) }),
      firstFingerprint,
    );
  } finally {
    await Promise.all([
      rm(first.repoRoot, { force: true, recursive: true }),
      rm(second.repoRoot, { force: true, recursive: true }),
    ]);
  }
});

test("native project cache requires matching metadata and a complete generated project", async () => {
  const androidDir = await mkdtemp(path.join(os.tmpdir(), "paseo-android-project-"));
  const fingerprint = "a".repeat(64);

  try {
    await mkdir(path.join(androidDir, "app"), { recursive: true });
    await Promise.all([
      writeFile(path.join(androidDir, "gradlew"), "#!/bin/sh\n"),
      writeFile(path.join(androidDir, "settings.gradle"), "pluginManagement {}\n"),
      writeFile(path.join(androidDir, "app", "build.gradle"), "android {}\n"),
    ]);

    assert.deepEqual(await getNativeProjectCacheStatus({ androidDir, fingerprint }), {
      hit: false,
      reason: "cache metadata is missing",
    });

    await writeNativeProjectCache({ androidDir, fingerprint });
    assert.deepEqual(await getNativeProjectCacheStatus({ androidDir, fingerprint }), {
      hit: true,
      reason: "native inputs match",
    });
    assert.deepEqual(
      await getNativeProjectCacheStatus({ androidDir, fingerprint: "b".repeat(64) }),
      { hit: false, reason: "native inputs changed" },
    );

    await unlink(path.join(androidDir, "gradlew"));
    assert.deepEqual(await getNativeProjectCacheStatus({ androidDir, fingerprint }), {
      hit: false,
      reason: "generated Android project is incomplete",
    });
  } finally {
    await rm(androidDir, { force: true, recursive: true });
  }
});
