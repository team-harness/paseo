import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { SavedPrompt, SavedPromptDraft } from "./model";
import { PromptLibraryService, type PromptLibraryMergeResult } from "./service";
import {
  asyncStoragePromptLibrary,
  loadLegacySavedPrompts,
  removeLegacySavedPrompts,
} from "./storage";

export const promptLibraryQueryKey = (serverId: string) => ["prompt-library", serverId] as const;

export type LegacyPromptMigrationState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "available"; items: SavedPrompt[] }
  | { status: "error"; error: unknown };

export interface UsePromptLibraryReturn {
  prompts: SavedPrompt[];
  isLoading: boolean;
  error: unknown;
  isConnected: boolean;
  isSupported: boolean;
  legacyMigration: LegacyPromptMigrationState;
  createPrompt: (draft: SavedPromptDraft) => Promise<void>;
  updatePrompt: (id: string, draft: SavedPromptDraft) => Promise<void>;
  removePrompt: (id: string) => Promise<void>;
  resetPrompts: () => Promise<void>;
  migrateLegacyPrompts: () => Promise<PromptLibraryMergeResult>;
  discardLegacyPrompts: () => Promise<void>;
  reload: () => Promise<void>;
}

export function usePromptLibrary(serverId: string): UsePromptLibraryReturn {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(promptLibrary): added in v0.2.6, remove gate after 2027-02-04.
  const isSupported = useHostFeature(serverId, "promptLibrary");
  const service = useMemo(() => (client ? new PromptLibraryService(client) : null), [client]);
  const queryKey = useMemo(() => promptLibraryQueryKey(serverId), [serverId]);
  const [legacyMigration, setLegacyMigration] = useState<LegacyPromptMigrationState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void loadLegacySavedPrompts(asyncStoragePromptLibrary).then(
      (items) => {
        if (!cancelled) {
          setLegacyMigration(items?.length ? { status: "available", items } : { status: "none" });
        }
        return undefined;
      },
      (error: unknown) => {
        if (!cancelled) setLegacyMigration({ status: "error", error });
        return undefined;
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const query = useFetchQuery({
    queryKey,
    queryFn: async () => {
      if (!service) throw new Error("Host client is unavailable.");
      return await service.list();
    },
    enabled: Boolean(service) && isConnected && isSupported,
    dataShape: "list",
    staleTimeMs: 0,
    gcTime: Infinity,
  });

  const applyMutation = useCallback(
    async (mutation: () => Promise<SavedPrompt[]>) => {
      const next = await mutation();
      queryClient.setQueryData<SavedPrompt[]>(queryKey, next);
    },
    [queryClient, queryKey],
  );

  const createPrompt = useCallback(
    async (draft: SavedPromptDraft) => {
      if (!service) throw new Error("Host client is unavailable.");
      await applyMutation(() => service.create(draft));
    },
    [applyMutation, service],
  );

  const updatePrompt = useCallback(
    async (id: string, draft: SavedPromptDraft) => {
      if (!service) throw new Error("Host client is unavailable.");
      await applyMutation(() => service.update(id, draft));
    },
    [applyMutation, service],
  );

  const removePrompt = useCallback(
    async (id: string) => {
      if (!service) throw new Error("Host client is unavailable.");
      await applyMutation(() => service.remove(id));
    },
    [applyMutation, service],
  );

  const resetPrompts = useCallback(async () => {
    if (!service) throw new Error("Host client is unavailable.");
    await applyMutation(() => service.reset());
  }, [applyMutation, service]);

  const migrateLegacyPrompts = useCallback(async (): Promise<PromptLibraryMergeResult> => {
    if (!service) throw new Error("Host client is unavailable.");
    if (legacyMigration.status !== "available") {
      throw new Error("No legacy saved prompts are available to migrate.");
    }
    const result = await service.merge(legacyMigration.items);
    queryClient.setQueryData<SavedPrompt[]>(queryKey, result.items);
    await removeLegacySavedPrompts(asyncStoragePromptLibrary);
    setLegacyMigration({ status: "none" });
    return result;
  }, [legacyMigration, queryClient, queryKey, service]);

  const discardLegacyPrompts = useCallback(async (): Promise<void> => {
    await removeLegacySavedPrompts(asyncStoragePromptLibrary);
    setLegacyMigration({ status: "none" });
  }, []);

  const refetch = query.refetch;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    prompts: query.data ?? [],
    isLoading: isConnected && isSupported && query.isPending,
    error: query.error ?? null,
    isConnected,
    isSupported,
    legacyMigration,
    createPrompt,
    updatePrompt,
    removePrompt,
    resetPrompts,
    migrateLegacyPrompts,
    discardLegacyPrompts,
    reload,
  };
}
