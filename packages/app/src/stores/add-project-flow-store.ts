import { create } from "zustand";

export interface AddProjectFlowRequest {
  id: number;
  preferredHostId?: string;
  successIntent?: { kind: "host_teams"; serverId: string };
}

interface AddProjectFlowStoreState {
  request: AddProjectFlowRequest | null;
  open: (preferredHostId?: string, successIntent?: AddProjectFlowRequest["successIntent"]) => void;
  close: () => void;
}

let nextRequestId = 1;

export const useAddProjectFlowStore = create<AddProjectFlowStoreState>((set) => ({
  request: null,
  open: (preferredHostId, successIntent) => {
    set({
      request: {
        id: nextRequestId++,
        ...(preferredHostId ? { preferredHostId } : {}),
        ...(successIntent ? { successIntent } : {}),
      },
    });
  },
  close: () => set({ request: null }),
}));
