import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  PromptLibraryCorruptDataError,
  PromptLibraryNotFoundError,
  PromptLibraryStore,
} from "./store.js";

describe("PromptLibraryStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "prompt-library-store-"));
    filePath = join(tempDir, "prompt-library.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("persists serialized create, update, delete, and clear mutations", async () => {
    const ids = ["prompt-one", "prompt-two"];
    const store = new PromptLibraryStore(filePath, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const [first, second] = await Promise.all([
      store.create({ title: " First ", content: "One" }),
      store.create({ title: "Second", content: "Two" }),
    ]);
    expect(first.items).toHaveLength(1);
    expect(second.items).toEqual([
      { id: "prompt-two", title: "Second", content: "Two" },
      { id: "prompt-one", title: "First", content: "One" },
    ]);

    await store.update("prompt-one", { title: "Updated", content: "  exact body\n" });
    await store.remove("prompt-two");
    await expect(new PromptLibraryStore(filePath).list()).resolves.toEqual([
      { id: "prompt-one", title: "Updated", content: "  exact body\n" },
    ]);

    await store.clear();
    await expect(new PromptLibraryStore(filePath).list()).resolves.toEqual([]);
    await expect(readFile(filePath, "utf8")).resolves.toContain('"version": 1');
  });

  test("merges legacy prompts idempotently without replacing host prompts", async () => {
    const generatedIds = ["host-id", "collision-import"];
    const store = new PromptLibraryStore(filePath, {
      createId: () => generatedIds.shift() ?? "unexpected",
    });
    await store.create({ title: "Host prompt", content: "Keep host content" });

    const legacy = [
      { id: "legacy-duplicate", title: "Host prompt", content: "Keep host content" },
      { id: "host-id", title: "Local collision", content: "Keep local content" },
      { id: "legacy-unique", title: "Legacy prompt", content: "Legacy content" },
    ];
    const firstMerge = await store.merge(legacy);
    expect(firstMerge).toEqual({
      items: [
        { id: "host-id", title: "Host prompt", content: "Keep host content" },
        { id: "collision-import", title: "Local collision", content: "Keep local content" },
        { id: "legacy-unique", title: "Legacy prompt", content: "Legacy content" },
      ],
      addedCount: 2,
      skippedCount: 1,
    });

    await expect(store.merge(legacy)).resolves.toEqual({
      items: firstMerge.items,
      addedCount: 0,
      skippedCount: 3,
    });
  });

  test("preserves corrupt data until an explicit clear", async () => {
    await writeFile(filePath, "not-json", "utf8");
    const store = new PromptLibraryStore(filePath);

    await expect(store.list()).rejects.toBeInstanceOf(PromptLibraryCorruptDataError);
    await expect(store.create({ title: "New", content: "Body" })).rejects.toBeInstanceOf(
      PromptLibraryCorruptDataError,
    );
    await expect(readFile(filePath, "utf8")).resolves.toBe("not-json");

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  test("rejects updates and deletes for unknown prompt IDs", async () => {
    const store = new PromptLibraryStore(filePath);

    await expect(
      store.update("missing", { title: "Missing", content: "Body" }),
    ).rejects.toBeInstanceOf(PromptLibraryNotFoundError);
    await expect(store.remove("missing")).rejects.toBeInstanceOf(PromptLibraryNotFoundError);
  });
});
