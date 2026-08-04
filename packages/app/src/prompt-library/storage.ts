import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import {
  SAVED_PROMPT_CONTENT_MAX_LENGTH,
  SAVED_PROMPT_TITLE_MAX_LENGTH,
  type SavedPrompt,
} from "./model";

export const PROMPT_LIBRARY_STORAGE_KEY = "@paseo:prompt-library";

export interface PromptLibraryStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

export class LegacyPromptLibraryCorruptStorageError extends Error {
  constructor() {
    super("Legacy saved prompt library data is corrupted.");
    this.name = "LegacyPromptLibraryCorruptStorageError";
  }
}

const savedPromptSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(SAVED_PROMPT_TITLE_MAX_LENGTH),
  content: z
    .string()
    .max(SAVED_PROMPT_CONTENT_MAX_LENGTH)
    .refine((content) => content.trim().length > 0),
});

const promptLibraryEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
});

export const asyncStoragePromptLibrary: PromptLibraryStorage = AsyncStorage;

export function normalizeSavedPrompts(value: unknown): SavedPrompt[] {
  const envelope = promptLibraryEnvelopeSchema.safeParse(value);
  if (!envelope.success) throw new LegacyPromptLibraryCorruptStorageError();

  const ids = new Set<string>();
  const prompts: SavedPrompt[] = [];
  for (const candidate of envelope.data.items) {
    const parsed = savedPromptSchema.safeParse(candidate);
    if (!parsed.success || ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    prompts.push(parsed.data);
  }
  return prompts;
}

export async function loadLegacySavedPrompts(
  storage: PromptLibraryStorage,
): Promise<SavedPrompt[] | null> {
  const stored = await storage.getItem(PROMPT_LIBRARY_STORAGE_KEY);
  if (stored === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new LegacyPromptLibraryCorruptStorageError();
  }
  return normalizeSavedPrompts(parsed);
}

export async function removeLegacySavedPrompts(storage: PromptLibraryStorage): Promise<void> {
  await storage.removeItem(PROMPT_LIBRARY_STORAGE_KEY);
}
