import type { SavedPrompt } from "@getpaseo/protocol/messages";

export {
  PROMPT_LIBRARY_CONTENT_MAX_LENGTH as SAVED_PROMPT_CONTENT_MAX_LENGTH,
  PROMPT_LIBRARY_TITLE_MAX_LENGTH as SAVED_PROMPT_TITLE_MAX_LENGTH,
} from "@getpaseo/protocol/messages";
export type { SavedPrompt, SavedPromptDraft } from "@getpaseo/protocol/messages";

export interface TextSelection {
  start: number;
  end: number;
}

export interface InsertSavedPromptInput {
  value: string;
  prompt: string;
  selection: TextSelection;
}

export interface InsertSavedPromptResult {
  value: string;
  selection: TextSelection;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

export function insertSavedPrompt(input: InsertSavedPromptInput): InsertSavedPromptResult {
  const first = clampIndex(input.selection.start, input.value.length);
  const second = clampIndex(input.selection.end, input.value.length);
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const value = `${input.value.slice(0, start)}${input.prompt}${input.value.slice(end)}`;
  const cursor = start + input.prompt.length;

  return {
    value,
    selection: { start: cursor, end: cursor },
  };
}

export function filterSavedPrompts(prompts: SavedPrompt[], query: string): SavedPrompt[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return prompts;

  return prompts.filter((prompt) =>
    `${prompt.title}\n${prompt.content}`.toLocaleLowerCase().includes(normalizedQuery),
  );
}
