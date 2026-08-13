import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import {
  MethodologyIdentifierSchema,
  MethodologyVersionSchema,
} from "@getpaseo/protocol/team/v2-rpc-schemas";

export interface MethodologyBundleV1 {
  schemaVersion: 1;
  identity: {
    bundleId: string;
    version: string;
    name: string;
    description: string;
    homepage: string | null;
    license: string;
  };
  skills: Array<{ skillId: string; name: string; description: string | null }>;
  archetypes: Array<{
    archetypeId: string;
    name: string;
    description: string;
    maxMembers: number | null;
    playbookIds: string[];
    suggestedLevel: number;
    suggestedSkillIds: string[];
  }>;
  playbooks: Array<{
    playbookId: string;
    name: string;
    description: string;
    audience: string[];
    promptAssetIds: string[];
    [key: string]: unknown;
  }>;
  promptAssets: Array<{ assetId: string; order: number; content: string; [key: string]: unknown }>;
  presets: Array<{
    presetId: string;
    name: string;
    description: string;
    leadSlotId: string;
    skillIds: string[];
    slots: Array<{
      slotId: string;
      archetypeId: string;
      suggestedLevel: number;
      suggestedRole: string;
      suggestedSkillIds: string[];
    }>;
    [key: string]: unknown;
  }>;
  policy: {
    planning: { specificationPlaybook: string };
    review: {
      operatorWaiver: string;
      unavailable: string;
      unknownCapabilities: string;
      writableWorkstreams: string;
    };
    verification: { operatorWaiver: string; required: boolean };
  };
}

export class MethodologyBundleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@team-harness/methodologies/package.json")),
);
const schema = JSON.parse(
  readFileSync(resolve(packageRoot, "schema/methodology-bundle-v1.json"), "utf8"),
);
const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
  compile<T>(schema: unknown): ((value: unknown) => value is T) & { errors?: ErrorObject[] | null };
};
const validate = new AjvConstructor({ allErrors: true, strict: true }).compile<MethodologyBundleV1>(
  schema,
);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function schemaErrorCode(error: ErrorObject | null): string {
  if (!error) return "bundle_invalid_value";
  if (error.keyword === "additionalProperties") return "bundle_unknown_field";
  if (error.keyword === "required") return "bundle_missing_field";
  if (error.keyword === "type") return "bundle_invalid_type";
  if (error.keyword === "maxLength") return "bundle_size_exceeded";
  return "bundle_invalid_value";
}

function scanJson(text: string): void {
  const objectKeys: Array<Set<string>> = [];
  let index = 0;
  let expectingKey = false;
  const skipSpace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const string = (): string => {
    const start = index++;
    let escaped = false;
    while (index < text.length) {
      const char = text[index++];
      if (char === '"' && !escaped) return JSON.parse(text.slice(start, index)) as string;
      escaped = char === "\\" ? !escaped : false;
    }
    throw new MethodologyBundleError("bundle_invalid_json", "Unterminated JSON string");
  };
  while (index < text.length) {
    skipSpace();
    const char = text[index];
    if (char === "{") {
      objectKeys.push(new Set());
      expectingKey = true;
      index += 1;
    } else if (char === "}") {
      objectKeys.pop();
      expectingKey = false;
      index += 1;
    } else if (char === '"') {
      const value = string();
      skipSpace();
      if (expectingKey && text[index] === ":") {
        const keys = objectKeys.at(-1);
        if (keys?.has(value)) {
          throw new MethodologyBundleError("bundle_duplicate_field", `Duplicate field ${value}`);
        }
        keys?.add(value);
        expectingKey = false;
      }
    } else if (char === ",") {
      expectingKey = objectKeys.length > 0;
      index += 1;
    } else if (char && /[-0-9]/.test(char)) {
      const literal = text
        .slice(index)
        .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)?.[0];
      if (!literal) throw new MethodologyBundleError("bundle_invalid_json", "Invalid number");
      if (/[.eE]/.test(literal)) {
        throw new MethodologyBundleError("bundle_invalid_type", `Non-integer literal ${literal}`);
      }
      if (!Number.isSafeInteger(Number(literal))) {
        throw new MethodologyBundleError("bundle_invalid_value", `Unsafe integer ${literal}`);
      }
      index += literal.length;
    } else {
      index += 1;
    }
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compare<T extends string | number>(left: T, right: T): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeBundle(bundle: MethodologyBundleV1): MethodologyBundleV1 {
  const audienceOrder = new Map([
    ["lead", 0],
    ["delivery", 1],
    ["review", 2],
    ["verification", 3],
  ]);
  const sorted = <T>(values: T[], key: (value: T) => string | number): T[] =>
    [...values].sort((left, right) => compare(key(left), key(right)));
  return {
    ...bundle,
    skills: sorted(bundle.skills, (value) => value.skillId),
    archetypes: sorted(bundle.archetypes, (value) => value.archetypeId).map((value) =>
      Object.assign({}, value, {
        playbookIds: [...value.playbookIds].sort(),
        suggestedSkillIds: [...value.suggestedSkillIds].sort(),
      }),
    ),
    playbooks: sorted(bundle.playbooks, (value) => value.playbookId).map((value) =>
      Object.assign({}, value, {
        audience: Array.isArray(value.audience)
          ? sorted(value.audience as string[], (audience) => audienceOrder.get(audience) ?? 99)
          : value.audience,
        promptAssetIds: [...value.promptAssetIds].sort(),
      }),
    ),
    promptAssets: sorted(bundle.promptAssets, (value) => value.order),
    presets: sorted(bundle.presets, (value) => value.presetId).map((value) =>
      Object.assign({}, value, {
        skillIds: [...value.skillIds].sort(),
        slots: sorted(value.slots, (slot) => slot.slotId).map((slot) =>
          Object.assign({}, slot, {
            suggestedSkillIds: [...slot.suggestedSkillIds].sort(),
          }),
        ),
      }),
    ),
  };
}

function hasInsignificantWhitespace(text: string): boolean {
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (char === '"' && !escaped) inString = false;
      escaped = char === "\\" ? !escaped : false;
    } else if (char === '"') inString = true;
    else if (/\s/.test(char)) return true;
  }
  return false;
}

function assertUnique(values: string[], code = "bundle_duplicate_id"): void {
  if (new Set(values).size !== values.length)
    throw new MethodologyBundleError(code, "Duplicate value");
}

function validateSemantics(bundle: MethodologyBundleV1): void {
  const identifiers = [
    bundle.identity.bundleId,
    ...bundle.skills.map((value) => value.skillId),
    ...bundle.archetypes.map((value) => value.archetypeId),
    ...bundle.playbooks.map((value) => value.playbookId),
    ...bundle.promptAssets.map((value) => value.assetId),
    ...bundle.presets.flatMap((value) => [
      value.presetId,
      value.leadSlotId,
      ...value.slots.map((slot) => slot.slotId),
    ]),
    ...bundle.archetypes.flatMap((value) => [...value.playbookIds, ...value.suggestedSkillIds]),
    ...bundle.playbooks.flatMap((value) => value.promptAssetIds),
    ...bundle.presets.flatMap((value) => [
      ...value.skillIds,
      ...value.slots.flatMap((slot) => [slot.archetypeId, ...slot.suggestedSkillIds]),
    ]),
  ];
  if (
    identifiers.some((identifier) => !MethodologyIdentifierSchema.safeParse(identifier).success) ||
    !MethodologyVersionSchema.safeParse(bundle.identity.version).success
  ) {
    throw new MethodologyBundleError("bundle_invalid_value", "Invalid methodology identifier");
  }
  assertUnique(bundle.skills.map((value) => value.skillId));
  assertUnique(bundle.archetypes.map((value) => value.archetypeId));
  assertUnique(bundle.playbooks.map((value) => value.playbookId));
  assertUnique(bundle.promptAssets.map((value) => value.assetId));
  assertUnique(bundle.presets.map((value) => value.presetId));
  assertUnique(
    bundle.promptAssets.map((value) => String(value.order)),
    "bundle_invalid_value",
  );

  const skills = new Set(bundle.skills.map((value) => value.skillId));
  const archetypes = new Set(bundle.archetypes.map((value) => value.archetypeId));
  const playbooks = new Set(bundle.playbooks.map((value) => value.playbookId));
  const assets = new Set(bundle.promptAssets.map((value) => value.assetId));
  const referencedAssets = new Set(bundle.playbooks.flatMap((value) => value.promptAssetIds));
  const references = [
    ...bundle.archetypes.flatMap((value) =>
      value.suggestedSkillIds.map((id) => [skills, id] as const),
    ),
    ...bundle.archetypes.flatMap((value) =>
      value.playbookIds.map((id) => [playbooks, id] as const),
    ),
    ...bundle.playbooks.flatMap((value) => value.promptAssetIds.map((id) => [assets, id] as const)),
    ...bundle.presets.flatMap((value) => value.skillIds.map((id) => [skills, id] as const)),
    ...bundle.presets.flatMap((value) =>
      value.slots.flatMap((slot) => [
        [archetypes, slot.archetypeId] as const,
        ...slot.suggestedSkillIds.map((id) => [skills, id] as const),
      ]),
    ),
  ];
  if (references.some(([set, id]) => !set.has(id))) {
    throw new MethodologyBundleError("bundle_unresolved_reference", "Unresolved reference");
  }
  if (bundle.promptAssets.some((asset) => !referencedAssets.has(asset.assetId))) {
    throw new MethodologyBundleError("bundle_unreferenced_entity", "Unreferenced prompt asset");
  }
  const unsafePrompt = /\{\{|\}\}|\b(?:paseo|claude|codex|github)\b/i;
  const singleLineKeys = new Set([
    "bundleId",
    "version",
    "name",
    "description",
    "homepage",
    "license",
    "skillId",
    "archetypeId",
    "playbookId",
    "assetId",
    "presetId",
    "slotId",
  ]);
  const walk = (value: unknown, key = ""): void => {
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > 4096) {
      throw new MethodologyBundleError("bundle_size_exceeded", `Text exceeds byte limit at ${key}`);
    }
    if (
      typeof value === "string" &&
      ([...value].some((character) => {
        const code = character.charCodeAt(0);
        return (
          code <= 8 ||
          code === 13 ||
          code === 11 ||
          code === 12 ||
          (code >= 14 && code <= 31) ||
          code === 127 ||
          code === 160
        );
      }) ||
        (key === "content" && unsafePrompt.test(value)) ||
        (singleLineKeys.has(key) && /[\r\n]/.test(value)))
    ) {
      throw new MethodologyBundleError("bundle_unsafe_text", `Unsafe text at ${key}`);
    }
    if (Array.isArray(value)) value.forEach((child) => walk(child, key));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
  };
  walk(bundle);
}

export function decodeMethodologyBundle(
  bytes: Uint8Array,
  expectedDigest?: string,
): MethodologyBundleV1 & { digest: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new MethodologyBundleError("bundle_invalid_json", "Bundle must not start with a BOM");
  }
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new MethodologyBundleError("bundle_invalid_json", "Bundle is not valid UTF-8");
  }
  scanJson(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MethodologyBundleError("bundle_invalid_json", "Bundle is not valid JSON");
  }
  if (!validate(value)) {
    const error = validate.errors?.[0] ?? null;
    throw new MethodologyBundleError(schemaErrorCode(error), error?.message ?? "Invalid bundle");
  }
  const bundle = value as MethodologyBundleV1;
  validateSemantics(bundle);
  if (hasInsignificantWhitespace(text)) {
    throw new MethodologyBundleError("bundle_not_canonical", "Bundle is not canonical JSON");
  }
  const normalized = normalizeBundle(bundle);
  const digest = `sha256:${createHash("sha256").update(canonicalize(normalized)).digest("hex")}`;
  if (expectedDigest !== undefined && digest !== expectedDigest) {
    throw new MethodologyBundleError(
      "bundle_digest_mismatch",
      `Expected ${expectedDigest}, got ${digest}`,
    );
  }
  return Object.assign(normalized, { digest });
}
