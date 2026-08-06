const DEFAULT_MARGIN = 8;
const DEFAULT_GAP = 8;

export interface SelectionActionPlacementInput {
  anchorX: number;
  anchorY: number;
  actionWidth: number;
  actionHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
  gap?: number;
}

export interface SelectionActionPlacement {
  left: number;
  top: number;
  placement: "above" | "below";
}

export function resolveSelectionActionPlacement({
  anchorX,
  anchorY,
  actionWidth,
  actionHeight,
  viewportWidth,
  viewportHeight,
  margin = DEFAULT_MARGIN,
  gap = DEFAULT_GAP,
}: SelectionActionPlacementInput): SelectionActionPlacement {
  const maxLeft = Math.max(margin, viewportWidth - margin - actionWidth);
  const left = clamp(anchorX - actionWidth / 2, margin, maxLeft);
  const belowTop = anchorY + gap;
  const fitsBelow = belowTop + actionHeight <= viewportHeight - margin;
  const top = fitsBelow
    ? belowTop
    : clamp(anchorY - gap - actionHeight, margin, Math.max(margin, viewportHeight - margin));

  return {
    left,
    top,
    placement: fitsBelow ? "below" : "above",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
