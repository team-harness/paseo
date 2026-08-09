import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
export type ProjectStatusBadgeDotBucket = "failed" | "attention" | "running";

export type ProjectStatusBadgeContent =
  | { kind: "alert" }
  | { kind: "dot"; bucket: ProjectStatusBadgeDotBucket };

/**
 * What the project status badge should render for a project's aggregate bucket, or null when
 * no badge should show at all. Kept as plain data (no React) so it's testable without JSDOM
 * or component mounting — see docs/testing.md's two test categories.
 *
 * Running is represented by a dot data shape and upgraded to a StatusRing by the project badge.
 * Needs_input uses the alert glyph, and the quieter failed/attention buckets use colored dots.
 */
export function getProjectStatusBadgeContent(
  statusBucket: SidebarStateBucket | null,
): ProjectStatusBadgeContent | null {
  if (statusBucket === "needs_input") {
    return { kind: "alert" };
  }
  if (statusBucket === "failed" || statusBucket === "attention" || statusBucket === "running") {
    return { kind: "dot", bucket: statusBucket };
  }
  return null;
}
