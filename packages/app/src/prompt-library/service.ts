import {
  SAVED_PROMPT_CONTENT_MAX_LENGTH,
  SAVED_PROMPT_TITLE_MAX_LENGTH,
  type SavedPrompt,
  type SavedPromptDraft,
} from "./model";
import { loadSavedPrompts, saveSavedPrompts, type PromptLibraryStorage } from "./storage";

export type PromptLibraryValidationCode =
  | "title_required"
  | "title_too_long"
  | "content_required"
  | "content_too_long";

export class PromptLibraryValidationError extends Error {
  constructor(public readonly code: PromptLibraryValidationCode) {
    super(code);
    this.name = "PromptLibraryValidationError";
  }
}

export class PromptLibraryNotFoundError extends Error {
  constructor(id: string) {
    super(`Saved prompt not found: ${id}`);
    this.name = "PromptLibraryNotFoundError";
  }
}

interface PromptLibraryServiceOptions {
  createId?: () => string;
}

function normalizeDraft(draft: SavedPromptDraft): SavedPromptDraft {
  const title = draft.title.trim();
  if (!title) throw new PromptLibraryValidationError("title_required");
  if (title.length > SAVED_PROMPT_TITLE_MAX_LENGTH) {
    throw new PromptLibraryValidationError("title_too_long");
  }
  if (!draft.content.trim()) throw new PromptLibraryValidationError("content_required");
  if (draft.content.length > SAVED_PROMPT_CONTENT_MAX_LENGTH) {
    throw new PromptLibraryValidationError("content_too_long");
  }
  return { title, content: draft.content };
}

function createDefaultId(): string {
  return `prompt_${globalThis.crypto.randomUUID()}`;
}

export class PromptLibraryService {
  private readonly createId: () => string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: PromptLibraryStorage,
    options: PromptLibraryServiceOptions = {},
  ) {
    this.createId = options.createId ?? createDefaultId;
  }

  list(): Promise<SavedPrompt[]> {
    return this.enqueue(() => loadSavedPrompts(this.storage));
  }

  async create(draft: SavedPromptDraft): Promise<SavedPrompt[]> {
    const normalized = normalizeDraft(draft);
    const prompt: SavedPrompt = {
      id: this.createId(),
      ...normalized,
    };
    return await this.mutate((current) => [prompt, ...current]);
  }

  async update(id: string, draft: SavedPromptDraft): Promise<SavedPrompt[]> {
    const normalized = normalizeDraft(draft);
    return await this.mutate((current) => {
      if (!current.some((prompt) => prompt.id === id)) {
        throw new PromptLibraryNotFoundError(id);
      }
      return current.map((prompt) => (prompt.id === id ? { id, ...normalized } : prompt));
    });
  }

  async remove(id: string): Promise<SavedPrompt[]> {
    return await this.mutate((current) => {
      if (!current.some((prompt) => prompt.id === id)) {
        throw new PromptLibraryNotFoundError(id);
      }
      return current.filter((prompt) => prompt.id !== id);
    });
  }

  reset(): Promise<SavedPrompt[]> {
    return this.enqueue(async () => {
      const next: SavedPrompt[] = [];
      await saveSavedPrompts(this.storage, next);
      return next;
    });
  }

  private mutate(update: (current: SavedPrompt[]) => SavedPrompt[]): Promise<SavedPrompt[]> {
    return this.enqueue(async () => {
      const current = await loadSavedPrompts(this.storage);
      const next = update(current);
      await saveSavedPrompts(this.storage, next);
      return next;
    });
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
