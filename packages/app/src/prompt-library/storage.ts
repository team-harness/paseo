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
  setItem(key: string, value: string): Promise<void>;
}

export class PromptLibraryCorruptStorageError extends Error {
  constructor() {
    super("Saved prompt library data is corrupted.");
    this.name = "PromptLibraryCorruptStorageError";
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
  if (!envelope.success) throw new PromptLibraryCorruptStorageError();

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

export async function loadSavedPrompts(storage: PromptLibraryStorage): Promise<SavedPrompt[]> {
  const stored = await storage.getItem(PROMPT_LIBRARY_STORAGE_KEY);
  if (stored === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new PromptLibraryCorruptStorageError();
  }
  return normalizeSavedPrompts(parsed);
}

export async function saveSavedPrompts(
  storage: PromptLibraryStorage,
  prompts: SavedPrompt[],
): Promise<void> {
  await storage.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify({ items: prompts }));
}
