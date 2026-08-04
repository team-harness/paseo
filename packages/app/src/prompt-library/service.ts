import {
  SAVED_PROMPT_CONTENT_MAX_LENGTH,
  SAVED_PROMPT_TITLE_MAX_LENGTH,
  type SavedPrompt,
  type SavedPromptDraft,
} from "./model";

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

export class PromptLibraryCorruptDataError extends Error {
  constructor() {
    super("Saved prompt library data is corrupted.");
    this.name = "PromptLibraryCorruptDataError";
  }
}

export interface PromptLibraryMergeResult {
  items: SavedPrompt[];
  addedCount: number;
  skippedCount: number;
}

export interface PromptLibraryClient {
  listSavedPrompts(): Promise<{ items: SavedPrompt[] }>;
  createSavedPrompt(draft: SavedPromptDraft): Promise<{ items: SavedPrompt[] }>;
  updateSavedPrompt(id: string, draft: SavedPromptDraft): Promise<{ items: SavedPrompt[] }>;
  deleteSavedPrompt(id: string): Promise<{ items: SavedPrompt[] }>;
  clearSavedPrompts(): Promise<{ items: SavedPrompt[] }>;
  mergeSavedPrompts(items: readonly SavedPrompt[]): Promise<PromptLibraryMergeResult>;
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

function mapPromptLibraryError(error: unknown): never {
  if (error instanceof Error && error.message.includes("Saved prompt library data is corrupted.")) {
    throw new PromptLibraryCorruptDataError();
  }
  throw error;
}

export class PromptLibraryService {
  constructor(private readonly client: PromptLibraryClient) {}

  async list(): Promise<SavedPrompt[]> {
    try {
      return (await this.client.listSavedPrompts()).items;
    } catch (error) {
      mapPromptLibraryError(error);
    }
  }

  async create(draft: SavedPromptDraft): Promise<SavedPrompt[]> {
    const normalized = normalizeDraft(draft);
    try {
      return (await this.client.createSavedPrompt(normalized)).items;
    } catch (error) {
      mapPromptLibraryError(error);
    }
  }

  async update(id: string, draft: SavedPromptDraft): Promise<SavedPrompt[]> {
    const normalized = normalizeDraft(draft);
    try {
      return (await this.client.updateSavedPrompt(id, normalized)).items;
    } catch (error) {
      mapPromptLibraryError(error);
    }
  }

  async remove(id: string): Promise<SavedPrompt[]> {
    try {
      return (await this.client.deleteSavedPrompt(id)).items;
    } catch (error) {
      mapPromptLibraryError(error);
    }
  }

  async reset(): Promise<SavedPrompt[]> {
    try {
      return (await this.client.clearSavedPrompts()).items;
    } catch (error) {
      mapPromptLibraryError(error);
    }
  }

  async merge(items: readonly SavedPrompt[]): Promise<PromptLibraryMergeResult> {
    try {
      return await this.client.mergeSavedPrompts(items);
    } catch (error) {
      mapPromptLibraryError(error);
    }
  }
}
