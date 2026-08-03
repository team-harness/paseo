import { describe, expect, it } from "vitest";
import {
  PROMPT_LIBRARY_STORAGE_KEY,
  PromptLibraryCorruptStorageError,
  type PromptLibraryStorage,
  loadSavedPrompts,
} from "./storage";
import { PromptLibraryService, PromptLibraryValidationError } from "./service";

class MemoryStorage implements PromptLibraryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe("loadSavedPrompts", () => {
  it("keeps valid unique prompts when other stored entries are malformed", async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      PROMPT_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        items: [
          { id: "one", title: "  Review  ", content: "Review the diff" },
          { id: "broken", title: "", content: "Missing a title" },
          { id: "one", title: "Duplicate", content: "Ignore me" },
          null,
        ],
      }),
    );

    await expect(loadSavedPrompts(storage)).resolves.toEqual([
      { id: "one", title: "Review", content: "Review the diff" },
    ]);
  });

  it("rejects malformed JSON instead of treating it as an empty library", async () => {
    const storage = new MemoryStorage();
    storage.values.set(PROMPT_LIBRARY_STORAGE_KEY, "not-json");

    await expect(loadSavedPrompts(storage)).rejects.toBeInstanceOf(
      PromptLibraryCorruptStorageError,
    );
  });

  it("rejects a malformed root envelope while still tolerating bad individual entries", async () => {
    const storage = new MemoryStorage();
    storage.values.set(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify({ prompts: [] }));

    await expect(loadSavedPrompts(storage)).rejects.toBeInstanceOf(
      PromptLibraryCorruptStorageError,
    );
  });
});

describe("PromptLibraryService", () => {
  it("serializes concurrent creates so neither prompt is overwritten", async () => {
    const storage = new MemoryStorage();
    const ids = ["first", "second"];
    const service = new PromptLibraryService(storage, {
      createId: () => ids.shift() ?? "unexpected",
    });

    await Promise.all([
      service.create({ title: "First", content: "One" }),
      service.create({ title: "Second", content: "Two" }),
    ]);

    await expect(service.list()).resolves.toEqual([
      { id: "second", title: "Second", content: "Two" },
      { id: "first", title: "First", content: "One" },
    ]);
  });

  it("serializes a pending list before a create", async () => {
    let releaseFirstRead: () => void = () => undefined;
    let markFirstReadStarted: () => void = () => undefined;
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = () => resolve();
    });
    const firstReadReleased = new Promise<void>((resolve) => {
      releaseFirstRead = () => resolve();
    });
    class DelayedReadStorage extends MemoryStorage {
      readCount = 0;

      override async getItem(key: string): Promise<string | null> {
        this.readCount += 1;
        if (this.readCount === 1) {
          const snapshot = await super.getItem(key);
          markFirstReadStarted();
          await firstReadReleased;
          return snapshot;
        }
        return super.getItem(key);
      }
    }

    const storage = new DelayedReadStorage();
    const service = new PromptLibraryService(storage, { createId: () => "created" });
    const pendingList = service.list();
    await firstReadStarted;
    const pendingCreate = service.create({ title: "Created", content: "Body" });

    await Promise.resolve();
    await Promise.resolve();
    expect(storage.readCount).toBe(1);

    releaseFirstRead();
    await expect(pendingList).resolves.toEqual([]);
    await expect(pendingCreate).resolves.toEqual([
      { id: "created", title: "Created", content: "Body" },
    ]);
    await expect(service.list()).resolves.toEqual([
      { id: "created", title: "Created", content: "Body" },
    ]);
  });

  it("does not overwrite corrupt data until the user explicitly resets it", async () => {
    const storage = new MemoryStorage();
    const corruptValue = "not-json";
    storage.values.set(PROMPT_LIBRARY_STORAGE_KEY, corruptValue);
    const service = new PromptLibraryService(storage, { createId: () => "created" });

    await expect(service.create({ title: "Created", content: "Body" })).rejects.toBeInstanceOf(
      PromptLibraryCorruptStorageError,
    );
    expect(storage.values.get(PROMPT_LIBRARY_STORAGE_KEY)).toBe(corruptValue);

    await expect(service.reset()).resolves.toEqual([]);
    await expect(service.list()).resolves.toEqual([]);
    expect(storage.values.get(PROMPT_LIBRARY_STORAGE_KEY)).toBe(JSON.stringify({ items: [] }));
  });

  it("updates and removes prompts while preserving exact body whitespace", async () => {
    const storage = new MemoryStorage();
    const service = new PromptLibraryService(storage, { createId: () => "prompt-id" });
    await service.create({ title: " Draft ", content: "  keep indentation\n" });

    await service.update("prompt-id", {
      title: " Updated ",
      content: "\n  code block\n",
    });
    await expect(service.list()).resolves.toEqual([
      { id: "prompt-id", title: "Updated", content: "\n  code block\n" },
    ]);

    await service.remove("prompt-id");
    await expect(service.list()).resolves.toEqual([]);
  });

  it("rejects blank prompt content with a stable validation code", async () => {
    const service = new PromptLibraryService(new MemoryStorage(), {
      createId: () => "prompt-id",
    });

    await expect(service.create({ title: "Empty", content: "   " })).rejects.toEqual(
      expect.objectContaining<Partial<PromptLibraryValidationError>>({
        code: "content_required",
      }),
    );
  });
});
