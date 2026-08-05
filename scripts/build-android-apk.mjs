#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const APP_DIR = path.join(REPO_ROOT, "packages", "app");
const ANDROID_DIR = path.join(APP_DIR, "android");
const SECRETS_DIR = path.join(APP_DIR, ".secrets");
const SIGNING_CONFIG_PATH = path.join(SECRETS_DIR, "android-release-signing.json");
const DEFAULT_KEYSTORE_PATH = path.join(SECRETS_DIR, "paseo-fork-release.jks");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "artifacts", "android");
const GRADLE_INIT_SCRIPT = path.join(SCRIPT_DIR, "android-local-maven.init.gradle");
const DEFAULT_LOCAL_MAVEN_MIRROR = path.join(os.homedir(), ".cache", "paseo", "android-maven");
const EXPECTED_PACKAGE_ID = "com.teamharness.paseo";
const KEY_ALIAS = "paseo-fork-release";
const ANDROID_PLATFORM_VERSION = "36";
const ANDROID_BUILD_TOOLS_VERSION = "36.0.0";
const ANDROID_NDK_VERSION = "27.1.12297006";
const ANDROID_CMAKE_VERSION = "3.22.1";
const GRADLE_HTTP_ARGS = [
  "-Dorg.gradle.internal.http.connectionTimeout=30000",
  "-Dorg.gradle.internal.http.socketTimeout=120000",
];

function parseArgs(argv) {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let offline = false;
  let reuseNativeProject = false;
  let ignoreUntracked = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir requires a path");
      outputDir = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (arg === "--offline") {
      offline = true;
      continue;
    }
    if (arg === "--reuse-native-project") {
      reuseNativeProject = true;
      continue;
    }
    if (arg === "--ignore-untracked") {
      ignoreUntracked = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run build:android-apk -- [--offline] [--reuse-native-project] [--ignore-untracked] [--output-dir <path>]",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { ignoreUntracked, offline, outputDir, reuseNativeProject };
}

function run(command, args, options = {}) {
  const { errorLabel, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
      shell: false,
      ...spawnOptions,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command failed with exit code ${code}: ${errorLabel ?? `${command} ${args.join(" ")}`}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

function runWithInput(command, args, input, options = {}) {
  const { quietStdout = false, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["pipe", quietStdout ? "ignore" : "inherit", "inherit"],
      shell: false,
      ...spawnOptions,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
    child.stdin.end(input);
  });
}

async function capture(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: REPO_ROOT,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return stdout.trim();
}

function mergeNoProxy(current) {
  const entries = new Set(
    `${current ?? ""},localhost,127.0.0.1,.local`
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return [...entries].join(",");
}

async function resolveProxy() {
  const configured = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (configured) {
    const url = new URL(configured);
    return { host: url.hostname, port: url.port || "80", url: configured };
  }

  if (process.platform !== "darwin") return undefined;

  let output;
  try {
    output = await capture("scutil", ["--proxy"]);
  } catch {
    return undefined;
  }

  const enabled = /^\s*HTTPSEnable\s*:\s*1\s*$/m.test(output);
  const host = output.match(/^\s*HTTPSProxy\s*:\s*(\S+)\s*$/m)?.[1];
  const port = output.match(/^\s*HTTPSPort\s*:\s*(\d+)\s*$/m)?.[1];
  if (!enabled || !host || !port) return undefined;

  return { host, port, url: `http://${host}:${port}` };
}

function applyProxyToEnv(env, proxy) {
  if (!proxy) return;
  env.HTTP_PROXY ??= proxy.url;
  env.HTTPS_PROXY ??= proxy.url;
  env.http_proxy ??= proxy.url;
  env.https_proxy ??= proxy.url;
  env.NO_PROXY = mergeNoProxy(env.NO_PROXY ?? env.no_proxy);
  env.no_proxy = env.NO_PROXY;

  const gradleProxy = [
    `-Dhttp.proxyHost=${proxy.host}`,
    `-Dhttp.proxyPort=${proxy.port}`,
    `-Dhttps.proxyHost=${proxy.host}`,
    `-Dhttps.proxyPort=${proxy.port}`,
    "-Dhttp.nonProxyHosts=localhost|127.*|[::1]|*.local",
    ...GRADLE_HTTP_ARGS,
  ].join(" ");
  env.GRADLE_OPTS = [env.GRADLE_OPTS, gradleProxy].filter(Boolean).join(" ");
}

async function readToolVersions() {
  const contents = await readFile(path.join(REPO_ROOT, ".tool-versions"), "utf8");
  const versions = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const [tool, version] = line.trim().split(/\s+/, 2);
    if (tool && version) versions.set(tool, version);
  }
  return versions;
}

async function findSdkManager(androidHome, androidSdkVersion) {
  const candidates = [
    path.join(androidHome, "cmdline-tools", androidSdkVersion, "bin", "sdkmanager"),
    path.join(androidHome, "cmdline-tools", "latest", "bin", "sdkmanager"),
    path.join(androidHome, "cmdline-tools", "bin", "sdkmanager"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next layout used by the Android command-line tools package.
    }
  }
  throw new Error(`sdkmanager was not found under ${androidHome}`);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function tryCapture(command, args, options = {}) {
  try {
    return await capture(command, args, options);
  } catch {
    return undefined;
  }
}

async function resolveJavaHome(javaVersion, env) {
  const candidates = [];
  if (env.JAVA_HOME) candidates.push(env.JAVA_HOME);

  const miseJavaHome = await tryCapture("mise", ["where", `java@${javaVersion}`], { env });
  if (miseJavaHome) candidates.push(miseJavaHome);

  if (process.platform === "darwin") {
    const systemJavaHome = await tryCapture("/usr/libexec/java_home", ["-v", javaVersion], { env });
    if (systemJavaHome) candidates.push(systemJavaHome);

    const brewPrefix = await tryCapture("brew", ["--prefix", `openjdk@${javaVersion}`], { env });
    if (brewPrefix)
      candidates.push(path.join(brewPrefix, "libexec", "openjdk.jdk", "Contents", "Home"));
  }

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "bin", "java"))) return candidate;
  }

  console.log(`Installing Java ${javaVersion} through mise...`);
  await run("mise", ["install", `java@${javaVersion}`], { env });
  return capture("mise", ["where", `java@${javaVersion}`], { env });
}

async function resolveAndroidHome(androidSdkVersion, env) {
  if (env.ANDROID_HOME) {
    try {
      await findSdkManager(env.ANDROID_HOME, androidSdkVersion);
      return env.ANDROID_HOME;
    } catch {
      // Continue through the managed installation candidates.
    }
  }

  const miseAndroidHome = await tryCapture("mise", ["where", `android-sdk@${androidSdkVersion}`], {
    env,
  });
  if (miseAndroidHome) {
    try {
      await findSdkManager(miseAndroidHome, androidSdkVersion);
      return miseAndroidHome;
    } catch {
      // Reinstall an incomplete command-line tools download.
    }
  }

  console.log(`Installing Android SDK command-line tools ${androidSdkVersion} through mise...`);
  await run("mise", ["install", `android-sdk@${androidSdkVersion}`], { env });
  return capture("mise", ["where", `android-sdk@${androidSdkVersion}`], { env });
}

async function prepareToolchain(env, proxy) {
  const versions = await readToolVersions();
  const javaVersion = versions.get("java");
  const androidSdkVersion = versions.get("android-sdk");
  if (!javaVersion || !androidSdkVersion) {
    throw new Error(".tool-versions must define java and android-sdk");
  }

  console.log("Preparing Java and Android SDK...");
  const javaHome = await resolveJavaHome(javaVersion, env);
  env.JAVA_HOME = javaHome;
  env.PATH = [path.join(javaHome, "bin"), env.PATH].filter(Boolean).join(path.delimiter);
  const androidHome = await resolveAndroidHome(androidSdkVersion, env);
  const sdkManager = await findSdkManager(androidHome, androidSdkVersion);

  env.ANDROID_HOME = androidHome;
  env.ANDROID_SDK_ROOT = androidHome;
  env.PATH = [
    path.join(javaHome, "bin"),
    path.dirname(sdkManager),
    path.join(androidHome, "platform-tools"),
    env.PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);

  const sdkProxyArgs = proxy
    ? [`--proxy=http`, `--proxy_host=${proxy.host}`, `--proxy_port=${proxy.port}`]
    : [];
  const sdkRootArg = `--sdk_root=${androidHome}`;
  const requiredPackages = [
    {
      id: "platform-tools",
      marker: path.join(androidHome, "platform-tools", "source.properties"),
    },
    {
      id: `platforms;android-${ANDROID_PLATFORM_VERSION}`,
      marker: path.join(
        androidHome,
        "platforms",
        `android-${ANDROID_PLATFORM_VERSION}`,
        "source.properties",
      ),
    },
    {
      id: `build-tools;${ANDROID_BUILD_TOOLS_VERSION}`,
      marker: path.join(
        androidHome,
        "build-tools",
        ANDROID_BUILD_TOOLS_VERSION,
        "source.properties",
      ),
    },
    {
      id: `ndk;${ANDROID_NDK_VERSION}`,
      marker: path.join(androidHome, "ndk", ANDROID_NDK_VERSION, "source.properties"),
    },
    {
      id: `cmake;${ANDROID_CMAKE_VERSION}`,
      marker: path.join(androidHome, "cmake", ANDROID_CMAKE_VERSION, "bin", "cmake"),
    },
  ];
  const missingPackages = [];
  for (const sdkPackage of requiredPackages) {
    if (!(await pathExists(sdkPackage.marker))) missingPackages.push(sdkPackage.id);
  }

  if (missingPackages.length > 0) {
    console.log(`Installing Android SDK packages: ${missingPackages.join(", ")}`);
    await runWithInput(sdkManager, [sdkRootArg, ...sdkProxyArgs, "--licenses"], "y\n".repeat(100), {
      env,
      quietStdout: true,
    });
    await run(sdkManager, [sdkRootArg, ...sdkProxyArgs, ...missingPackages], { env });
  } else {
    console.log("Required Android SDK packages are already installed.");
  }

  return { androidHome, javaHome };
}

async function loadOrCreateSigning(javaHome, env) {
  await mkdir(SECRETS_DIR, { recursive: true, mode: 0o700 });

  let config;
  try {
    config = JSON.parse(await readFile(SIGNING_CONFIG_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (config) {
    const keystorePath = path.resolve(APP_DIR, config.keystorePath);
    await access(keystorePath);
    return { ...config, keystorePath };
  }

  try {
    await access(DEFAULT_KEYSTORE_PATH);
    throw new Error(
      `${DEFAULT_KEYSTORE_PATH} exists without ${SIGNING_CONFIG_PATH}; refusing to replace it`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  console.log("Creating the persistent local Android release keystore...");
  const password = randomBytes(32).toString("base64url");
  const keytool = path.join(javaHome, "bin", "keytool");
  await run(
    keytool,
    [
      "-genkeypair",
      "-v",
      "-storetype",
      "PKCS12",
      "-keystore",
      DEFAULT_KEYSTORE_PATH,
      "-alias",
      KEY_ALIAS,
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-storepass",
      password,
      "-keypass",
      password,
      "-dname",
      "CN=Paseo Local Android Release, OU=Team Harness, O=Team Harness, C=CN",
      "-noprompt",
    ],
    { env, errorLabel: "keytool -genkeypair" },
  );

  config = {
    keystorePath: path.relative(APP_DIR, DEFAULT_KEYSTORE_PATH),
    keystorePassword: password,
    keyAlias: KEY_ALIAS,
    keyPassword: password,
  };
  await writeFile(SIGNING_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(DEFAULT_KEYSTORE_PATH, 0o600);
  console.log(
    `Signing files created under ${path.relative(REPO_ROOT, SECRETS_DIR)}; back them up.`,
  );
  return { ...config, keystorePath: DEFAULT_KEYSTORE_PATH };
}

async function patchReleaseSigning() {
  const buildGradlePath = path.join(ANDROID_DIR, "app", "build.gradle");
  let contents = await readFile(buildGradlePath, "utf8");
  const signingAnchor = "    signingConfigs {\n        debug {";
  if (!contents.includes(signingAnchor)) {
    throw new Error("Could not locate the generated Android signingConfigs block");
  }

  contents = contents.replace(
    signingAnchor,
    `    signingConfigs {
        release {
            def paseoKeystorePath = System.getenv("PASEO_ANDROID_KEYSTORE_PATH")
            def paseoKeystorePassword = System.getenv("PASEO_ANDROID_KEYSTORE_PASSWORD")
            def paseoKeyAlias = System.getenv("PASEO_ANDROID_KEY_ALIAS")
            def paseoKeyPassword = System.getenv("PASEO_ANDROID_KEY_PASSWORD")
            if (!paseoKeystorePath || !paseoKeystorePassword || !paseoKeyAlias || !paseoKeyPassword) {
                throw new GradleException("Missing Paseo Android release signing environment")
            }
            storeFile file(paseoKeystorePath)
            storePassword paseoKeystorePassword
            keyAlias paseoKeyAlias
            keyPassword paseoKeyPassword
        }
        debug {`,
  );

  const buildTypesIndex = contents.indexOf("    buildTypes {");
  const releaseIndex = contents.indexOf("        release {", buildTypesIndex);
  const signingIndex = contents.indexOf("signingConfig signingConfigs.debug", releaseIndex);
  if (buildTypesIndex < 0 || releaseIndex < 0 || signingIndex < 0) {
    throw new Error("Could not locate the generated Android release build type");
  }
  contents = `${contents.slice(0, signingIndex)}signingConfig signingConfigs.release${contents.slice(
    signingIndex + "signingConfig signingConfigs.debug".length,
  )}`;
  await writeFile(buildGradlePath, contents);
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function main() {
  const { ignoreUntracked, offline, outputDir, reuseNativeProject } = parseArgs(
    process.argv.slice(2),
  );
  const env = { ...process.env };
  const proxy = await resolveProxy();
  applyProxyToEnv(env, proxy);
  if (proxy) console.log(`Using proxy ${proxy.host}:${proxy.port} for downloads.`);

  const { androidHome, javaHome } = await prepareToolchain(env, proxy);
  const signing = await loadOrCreateSigning(javaHome, env);

  env.APP_VARIANT = "production";
  env.CI = "1";
  env.NODE_ENV = "production";
  env.PASEO_ANDROID_KEYSTORE_PATH = signing.keystorePath;
  env.PASEO_ANDROID_KEYSTORE_PASSWORD = signing.keystorePassword;
  env.PASEO_ANDROID_KEY_ALIAS = signing.keyAlias;
  env.PASEO_ANDROID_KEY_PASSWORD = signing.keyPassword;

  if (reuseNativeProject) {
    await access(path.join(ANDROID_DIR, "gradlew"));
    console.log("Reusing the existing generated Android project.");
  } else {
    console.log("Building app workspace dependencies...");
    await run("npm", ["run", "build:app-deps"], { env });

    console.log("Generating the Android project...");
    await run(
      path.join(REPO_ROOT, "node_modules", ".bin", "expo"),
      ["prebuild", "--platform", "android", "--clean"],
      { cwd: APP_DIR, env },
    );
    await patchReleaseSigning();
  }

  console.log("Building the signed release APK...");
  const localMavenMirror = env.PASEO_ANDROID_MAVEN_MIRROR ?? DEFAULT_LOCAL_MAVEN_MIRROR;
  const localMavenArgs = (await pathExists(localMavenMirror))
    ? ["--init-script", GRADLE_INIT_SCRIPT, `-Dpaseo.android.mavenMirror=${localMavenMirror}`]
    : [];
  if (localMavenArgs.length > 0) {
    console.log(`Using local Maven cache ${localMavenMirror}.`);
  }
  const proxyGradleArgs = proxy
    ? [
        `-Dhttp.proxyHost=${proxy.host}`,
        `-Dhttp.proxyPort=${proxy.port}`,
        `-Dhttps.proxyHost=${proxy.host}`,
        `-Dhttps.proxyPort=${proxy.port}`,
      ]
    : [];
  await run(
    path.join(ANDROID_DIR, "gradlew"),
    [
      ":app:assembleRelease",
      "-x",
      "lint",
      "-x",
      "lintVitalAnalyzeRelease",
      "-x",
      "lintVitalRelease",
      "-x",
      "generateReleaseLintModel",
      "-x",
      "generateReleaseLintVitalModel",
      "--no-daemon",
      "--max-workers=1",
      "-Dorg.gradle.parallel=false",
      ...(offline ? ["--offline"] : []),
      ...localMavenArgs,
      `-Dpaseo.android.ndkVersion=${ANDROID_NDK_VERSION}`,
      ...GRADLE_HTTP_ARGS,
      ...proxyGradleArgs,
    ],
    { cwd: ANDROID_DIR, env },
  );

  const sourceApk = path.join(
    ANDROID_DIR,
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk",
  );
  await access(sourceApk);

  const packageJson = JSON.parse(await readFile(path.join(APP_DIR, "package.json"), "utf8"));
  const commit = await capture("git", ["rev-parse", "--short=10", "HEAD"], { env });
  const statusArgs = ["status", "--porcelain"];
  if (ignoreUntracked) statusArgs.push("--untracked-files=no");
  const dirty = (await capture("git", statusArgs, { env })) ? "-dirty" : "";
  const filename = `Paseo-${packageJson.version}-${commit}${dirty}-android.apk`;
  const outputPath = path.join(outputDir, filename);
  await mkdir(outputDir, { recursive: true });
  await copyFile(sourceApk, outputPath);

  const aapt = path.join(androidHome, "build-tools", ANDROID_BUILD_TOOLS_VERSION, "aapt");
  const badging = await capture(aapt, ["dump", "badging", outputPath], { env });
  if (!badging.includes(`package: name='${EXPECTED_PACKAGE_ID}'`)) {
    throw new Error(`Built APK does not use ${EXPECTED_PACKAGE_ID}`);
  }

  const apkSigner = path.join(androidHome, "build-tools", ANDROID_BUILD_TOOLS_VERSION, "apksigner");
  await run(apkSigner, ["verify", "--verbose", "--print-certs", outputPath], { env });
  const digest = await sha256(outputPath);
  await writeFile(`${outputPath}.sha256`, `${digest}  ${filename}\n`);

  console.log(`\nAPK: ${outputPath}`);
  console.log(`Package: ${EXPECTED_PACKAGE_ID}`);
  console.log(`SHA-256: ${digest}`);
  console.log(`Host: ${os.hostname()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
