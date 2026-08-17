import {
  type AddProjectFlowRequest,
  useAddProjectFlowStore,
} from "@/stores/add-project-flow-store";

export function useOpenAddProject(): (
  preferredHostId?: string,
  successIntent?: AddProjectFlowRequest["successIntent"],
) => void {
  return useAddProjectFlowStore((state) => state.open);
}
