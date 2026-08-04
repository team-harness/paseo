import { describe, expect, it, vi } from "vitest";
import type { SavedPrompt, SavedPromptDraft } from "./model";
import {
  PromptLibraryCorruptDataError,
  PromptLibraryService,
  PromptLibraryValidationError,
  type PromptLibraryClient,
} from "./service";
import {
  PROMPT_LIBRARY_STORAGE_KEY,
  LegacyPromptLibraryCorruptStorageError,
  type PromptLibraryStorage,
  loadLegacySavedPrompts,
  removeLegacySavedPrompts,
} from "./storage";

class MemoryStorage implements PromptLibraryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createPromptLibraryClient(
  overrides: Partial<PromptLibraryClient> = {},
): PromptLibraryClient {
  const empty = async () => ({ items: [] as SavedPrompt[] });
  return {
    listSavedPrompts: empty,
    createSavedPrompt: empty,
    updateSavedPrompt: empty,
    deleteSavedPrompt: empty,
    clearSavedPrompts: empty,
    mergeSavedPrompts: async () => ({ items: [], addedCount: 0, skippedCount: 0 }),
    ...overrides,
  };
}

describe("legacy saved prompt storage", () => {
  it("distinguishes an absent legacy library from an empty one", async () => {
    const storage = new MemoryStorage();

    await expect(loadLegacySavedPrompts(storage)).resolves.toBeNull();

    storage.values.set(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify({ items: [] }));
    await expect(loadLegacySavedPrompts(storage)).resolves.toEqual([]);
  });

  it("keeps valid unique prompts when other legacy entries are malformed", async () => {
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

    await expect(loadLegacySavedPrompts(storage)).resolves.toEqual([
      { id: "one", title: "Review", content: "Review the diff" },
    ]);
  });

  it("preserves malformed legacy data until migration recovery is explicit", async () => {
    const storage = new MemoryStorage();
    storage.values.set(PROMPT_LIBRARY_STORAGE_KEY, "not-json");

    await expect(loadLegacySavedPrompts(storage)).rejects.toBeInstanceOf(
      LegacyPromptLibraryCorruptStorageError,
    );
    expect(storage.values.get(PROMPT_LIBRARY_STORAGE_KEY)).toBe("not-json");
  });

  it("removes the legacy key only when requested", async () => {
    const storage = new MemoryStorage();
    storage.values.set(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify({ items: [] }));

    await removeLegacySavedPrompts(storage);

    expect(storage.values.has(PROMPT_LIBRARY_STORAGE_KEY)).toBe(false);
  });
});

describe("PromptLibraryService", () => {
  it("normalizes a draft before sending it to the Host and preserves body whitespace", async () => {
    const createSavedPrompt = vi.fn(async (draft: SavedPromptDraft) => ({
      items: [{ id: "created", ...draft }],
    }));
    const service = new PromptLibraryService(createPromptLibraryClient({ createSavedPrompt }));

    await expect(
      service.create({ title: "  Review  ", content: "\n  keep indentation\n" }),
    ).resolves.toEqual([{ id: "created", title: "Review", content: "\n  keep indentation\n" }]);
    expect(createSavedPrompt).toHaveBeenCalledWith({
      title: "Review",
      content: "\n  keep indentation\n",
    });
  });

  it("rejects invalid drafts before sending them to the Host", async () => {
    const createSavedPrompt = vi.fn(async () => ({ items: [] as SavedPrompt[] }));
    const service = new PromptLibraryService(createPromptLibraryClient({ createSavedPrompt }));

    await expect(service.create({ title: "Empty", content: "   " })).rejects.toEqual(
      expect.objectContaining<Partial<PromptLibraryValidationError>>({
        code: "content_required",
      }),
    );
    expect(createSavedPrompt).not.toHaveBeenCalled();
  });

  it("delegates merge and returns the Host's idempotency counts", async () => {
    const imported: SavedPrompt[] = [{ id: "legacy", title: "Review", content: "Review it" }];
    const mergeSavedPrompts = vi.fn(async () => ({
      items: imported,
      addedCount: 1,
      skippedCount: 0,
    }));
    const service = new PromptLibraryService(createPromptLibraryClient({ mergeSavedPrompts }));

    await expect(service.merge(imported)).resolves.toEqual({
      items: imported,
      addedCount: 1,
      skippedCount: 0,
    });
    expect(mergeSavedPrompts).toHaveBeenCalledWith(imported);
  });

  it("maps a corrupt Host library to a stable UI error", async () => {
    const service = new PromptLibraryService(
      createPromptLibraryClient({
        listSavedPrompts: async () => {
          throw new Error(
            "Saved prompt library data is corrupted. requestType=prompt.library.list.request",
          );
        },
      }),
    );

    await expect(service.list()).rejects.toBeInstanceOf(PromptLibraryCorruptDataError);
  });
});
