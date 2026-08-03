import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type { SavedPrompt, SavedPromptDraft } from "./model";
import { PromptLibraryService } from "./service";
import { asyncStoragePromptLibrary } from "./storage";

export const PROMPT_LIBRARY_QUERY_KEY = ["prompt-library"] as const;

const promptLibraryService = new PromptLibraryService(asyncStoragePromptLibrary);

export interface UsePromptLibraryReturn {
  prompts: SavedPrompt[];
  isLoading: boolean;
  error: unknown;
  createPrompt: (draft: SavedPromptDraft) => Promise<void>;
  updatePrompt: (id: string, draft: SavedPromptDraft) => Promise<void>;
  removePrompt: (id: string) => Promise<void>;
  resetPrompts: () => Promise<void>;
  reload: () => Promise<void>;
}

export function usePromptLibrary(): UsePromptLibraryReturn {
  const queryClient = useQueryClient();
  const query = useFetchQuery({
    queryKey: PROMPT_LIBRARY_QUERY_KEY,
    queryFn: () => promptLibraryService.list(),
    dataShape: "list",
    staleTimeMs: 5 * 60 * 1000,
    gcTime: Infinity,
  });

  const applyMutation = useCallback(
    async (mutation: () => Promise<SavedPrompt[]>) => {
      const next = await mutation();
      queryClient.setQueryData<SavedPrompt[]>(PROMPT_LIBRARY_QUERY_KEY, next);
    },
    [queryClient],
  );

  const createPrompt = useCallback(
    async (draft: SavedPromptDraft) => {
      await applyMutation(() => promptLibraryService.create(draft));
    },
    [applyMutation],
  );

  const updatePrompt = useCallback(
    async (id: string, draft: SavedPromptDraft) => {
      await applyMutation(() => promptLibraryService.update(id, draft));
    },
    [applyMutation],
  );

  const removePrompt = useCallback(
    async (id: string) => {
      await applyMutation(() => promptLibraryService.remove(id));
    },
    [applyMutation],
  );

  const resetPrompts = useCallback(async () => {
    await applyMutation(() => promptLibraryService.reset());
  }, [applyMutation]);

  const refetch = query.refetch;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    prompts: query.data ?? [],
    isLoading: query.isPending,
    error: query.error ?? null,
    createPrompt,
    updatePrompt,
    removePrompt,
    resetPrompts,
    reload,
  };
}
