import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";

export type ProjectStatusBadgeDotBucket = "failed" | "attention";

export type ProjectStatusBadgeContent =
  | { kind: "loader" }
  | { kind: "alert" }
  | { kind: "dot"; bucket: ProjectStatusBadgeDotBucket };

/**
 * What the project status badge should render for a project's aggregate bucket, or null when
 * no badge should show at all. Kept as plain data (no React) so it's testable without JSDOM
 * or component mounting — see docs/testing.md's two test categories.
 *
 * Running uses the synchronized loader, needs_input uses the alert glyph, and the quieter
 * failed/attention buckets use colored dots. The moving loader keeps active work visibly
 * distinct from the static completed state even at sidebar density.
 */
export function getProjectStatusBadgeContent(
  statusBucket: SidebarStateBucket | null,
): ProjectStatusBadgeContent | null {
  if (shouldRenderSyncedStatusLoader({ bucket: statusBucket })) {
    return { kind: "loader" };
  }
  if (statusBucket === "needs_input") {
    return { kind: "alert" };
  }
  if (statusBucket === "failed" || statusBucket === "attention") {
    return { kind: "dot", bucket: statusBucket };
  }
  return null;
}
