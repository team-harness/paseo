import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  beginReviewDeliveryInState,
  finishReviewDeliveryInState,
  normalizeReviewDeliveryState,
  releaseReviewDeliveryInState,
  type ReviewDeliverySession,
  type ReviewDeliveryState,
} from "./delivery";
import type { WorkspaceReviewSummaryEntry } from "./workspace-comments";

const STORE_VERSION = 1;

interface ReviewDeliveryActions {
  beginDelivery(input: {
    workspaceKey: string;
    operationId: string;
    agentId: string | null;
  }): boolean;
  finishDelivery(input: {
    workspaceKey: string;
    operationId: string;
    agentId: string;
    entries: readonly WorkspaceReviewSummaryEntry[];
  }): void;
  releaseDelivery(input: { workspaceKey: string; operationId: string }): void;
}

type ReviewDeliveryStore = ReviewDeliveryState & ReviewDeliveryActions;

export const useReviewDeliveryStore = create<ReviewDeliveryStore>()(
  persist(
    (set) => ({
      sessionsByWorkspace: {},
      operationsByWorkspace: {},
      beginDelivery: (input) => {
        let started = false;
        set((state) => {
          const result = beginReviewDeliveryInState(state, input);
          started = result.started;
          return result.state;
        });
        return started;
      },
      finishDelivery: (input) =>
        set((state) =>
          finishReviewDeliveryInState(state, {
            ...input,
            deliveredAt: new Date().toISOString(),
          }),
        ),
      releaseDelivery: (input) => set((state) => releaseReviewDeliveryInState(state, input)),
    }),
    {
      name: "@paseo:review-delivery-sessions",
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ sessionsByWorkspace: state.sessionsByWorkspace }),
      migrate: async (state) => normalizeReviewDeliveryState(state),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeReviewDeliveryState(persistedState),
      }),
    },
  ),
);

export function useReviewDeliverySession(workspaceKey: string): ReviewDeliverySession | null {
  return useReviewDeliveryStore((state) => state.sessionsByWorkspace[workspaceKey] ?? null);
}

export function useReviewDeliveryInFlight(workspaceKey: string): boolean {
  return useReviewDeliveryStore((state) => Boolean(state.operationsByWorkspace[workspaceKey]));
}
