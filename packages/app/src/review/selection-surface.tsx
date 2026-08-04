import type { ReactNode } from "react";
import type { ReviewTextSelection } from "./workspace-comments";

export interface ReviewSelectionSurfaceProps {
  children: ReactNode;
  filePath: string;
  onComment: (selection: ReviewTextSelection, body: string) => void;
}

// React Native does not expose a portable selected range for rendered Text.
// The native surface intentionally preserves the platform selection/copy menu.
export function ReviewSelectionSurface({ children }: ReviewSelectionSurfaceProps) {
  return children;
}
