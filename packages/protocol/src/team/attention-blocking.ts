import type { MissionAttentionItem, TeamMission } from "./v2-types.js";

export interface WorkstreamAttentionAttribution {
  readonly attentionId: string;
  readonly kind: MissionAttentionItem["kind"];
  readonly summary: string;
  readonly sourceWorkstreamId: string;
  readonly targetWorkstreamId: string;
  readonly direct: boolean;
}

export function selectOpenWorkstreamAttentionAttributions(
  mission: Pick<TeamMission, "workstreams" | "attentionItems">,
): WorkstreamAttentionAttribution[] {
  const attributions: WorkstreamAttentionAttribution[] = [];
  for (const item of mission.attentionItems) {
    if (item.status !== "open" || item.scope.kind !== "workstream") continue;
    const sourceWorkstreamId = item.scope.workstreamId;
    const affectedIds = new Set([sourceWorkstreamId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const workstream of mission.workstreams) {
        if (
          !affectedIds.has(workstream.workstreamId) &&
          workstream.dependencyWorkstreamIds.some((dependencyId) => affectedIds.has(dependencyId))
        ) {
          affectedIds.add(workstream.workstreamId);
          changed = true;
        }
      }
    }
    for (const workstream of mission.workstreams) {
      if (!affectedIds.has(workstream.workstreamId)) continue;
      attributions.push({
        attentionId: item.attentionId,
        kind: item.kind,
        summary: item.summary,
        sourceWorkstreamId,
        targetWorkstreamId: workstream.workstreamId,
        direct: workstream.workstreamId === sourceWorkstreamId,
      });
    }
  }
  return attributions;
}
