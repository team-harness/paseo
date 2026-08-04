import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  PROMPT_LIBRARY_CONTENT_MAX_LENGTH,
  PROMPT_LIBRARY_TITLE_MAX_LENGTH,
  SavedPromptSchema,
  type SavedPrompt,
  type SavedPromptDraft,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

const PERSISTED_VERSION = 1;

const PersistedPromptLibrarySchema = z.object({
  version: z.literal(PERSISTED_VERSION),
  items: z.array(z.unknown()),
});

export interface PromptLibrarySnapshot {
  items: SavedPrompt[];
}

export interface PromptLibraryMergeResult extends PromptLibrarySnapshot {
  addedCount: number;
  skippedCount: number;
}

interface PromptLibraryStoreOptions {
  createId?: () => string;
}

export class PromptLibraryCorruptDataError extends Error {
  constructor() {
    super("Saved prompt library data is corrupted.");
    this.name = "PromptLibraryCorruptDataError";
  }
}

export class PromptLibraryNotFoundError extends Error {
  constructor(id: string) {
    super(`Saved prompt not found: ${id}`);
    this.name = "PromptLibraryNotFoundError";
  }
}

export class PromptLibraryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptLibraryValidationError";
  }
}

function normalizeDraft(draft: SavedPromptDraft): SavedPromptDraft {
  const title = draft.title.trim();
  if (!title) {
    throw new PromptLibraryValidationError("Saved prompt title is required.");
  }
  if (title.length > PROMPT_LIBRARY_TITLE_MAX_LENGTH) {
    throw new PromptLibraryValidationError("Saved prompt title is too long.");
  }
  if (!draft.content.trim()) {
    throw new PromptLibraryValidationError("Saved prompt content is required.");
  }
  if (draft.content.length > PROMPT_LIBRARY_CONTENT_MAX_LENGTH) {
    throw new PromptLibraryValidationError("Saved prompt content is too long.");
  }
  return { title, content: draft.content };
}

function normalizeImportedPrompt(prompt: SavedPrompt): SavedPrompt {
  const id = prompt.id.trim();
  if (!id) {
    throw new PromptLibraryValidationError("Saved prompt ID is required.");
  }
  return { id, ...normalizeDraft(prompt) };
}

function promptIdentity(prompt: Pick<SavedPrompt, "title" | "content">): string {
  return JSON.stringify([prompt.title, prompt.content]);
}

function normalizePersistedItems(candidates: unknown[]): SavedPrompt[] {
  const ids = new Set<string>();
  const items: SavedPrompt[] = [];
  for (const candidate of candidates) {
    const parsed = SavedPromptSchema.safeParse(candidate);
    if (!parsed.success) {
      continue;
    }
    try {
      const prompt = normalizeImportedPrompt(parsed.data);
      if (ids.has(prompt.id)) {
        continue;
      }
      ids.add(prompt.id);
      items.push(prompt);
    } catch {
      continue;
    }
  }
  return items;
}

export class PromptLibraryStore {
  private readonly createId: () => string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    options: PromptLibraryStoreOptions = {},
  ) {
    this.createId = options.createId ?? (() => `prompt_${randomUUID()}`);
  }

  list(): Promise<SavedPrompt[]> {
    return this.enqueue(() => this.read());
  }

  create(draft: SavedPromptDraft): Promise<PromptLibrarySnapshot> {
    const normalized = normalizeDraft(draft);
    return this.mutate((items) => {
      const id = this.allocateId(new Set(items.map((item) => item.id)));
      return [{ id, ...normalized }, ...items];
    });
  }

  update(id: string, draft: SavedPromptDraft): Promise<PromptLibrarySnapshot> {
    const normalized = normalizeDraft(draft);
    return this.mutate((items) => {
      if (!items.some((item) => item.id === id)) {
        throw new PromptLibraryNotFoundError(id);
      }
      return items.map((item) => (item.id === id ? { id, ...normalized } : item));
    });
  }

  remove(id: string): Promise<PromptLibrarySnapshot> {
    return this.mutate((items) => {
      if (!items.some((item) => item.id === id)) {
        throw new PromptLibraryNotFoundError(id);
      }
      return items.filter((item) => item.id !== id);
    });
  }

  clear(): Promise<PromptLibrarySnapshot> {
    return this.enqueue(async () => {
      const items: SavedPrompt[] = [];
      await this.write(items);
      return { items };
    });
  }

  merge(importedItems: readonly SavedPrompt[]): Promise<PromptLibraryMergeResult> {
    const normalizedImports = importedItems.map(normalizeImportedPrompt);
    return this.enqueue(async () => {
      const items = await this.read();
      const ids = new Set(items.map((item) => item.id));
      const identities = new Set(items.map(promptIdentity));
      let addedCount = 0;
      let skippedCount = 0;

      for (const imported of normalizedImports) {
        const identity = promptIdentity(imported);
        if (identities.has(identity)) {
          skippedCount += 1;
          continue;
        }
        const id = ids.has(imported.id) ? this.allocateId(ids) : imported.id;
        const next = { ...imported, id };
        items.push(next);
        ids.add(id);
        identities.add(identity);
        addedCount += 1;
      }

      if (addedCount > 0) {
        await this.write(items);
      }
      return { items, addedCount, skippedCount };
    });
  }

  private mutate(update: (items: SavedPrompt[]) => SavedPrompt[]): Promise<PromptLibrarySnapshot> {
    return this.enqueue(async () => {
      const items = update(await this.read());
      await this.write(items);
      return { items };
    });
  }

  private async read(): Promise<SavedPrompt[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new PromptLibraryCorruptDataError();
    }
    const parsed = PersistedPromptLibrarySchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new PromptLibraryCorruptDataError();
    }
    return normalizePersistedItems(parsed.data.items);
  }

  private async write(items: SavedPrompt[]): Promise<void> {
    await writeJsonFileAtomic(this.filePath, { version: PERSISTED_VERSION, items });
  }

  private allocateId(existingIds: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.createId().trim();
      if (id && !existingIds.has(id)) {
        return id;
      }
    }
    throw new Error("Unable to allocate a unique saved prompt ID.");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
