import type {
  MissionAttentionItem,
  MissionAttentionResolution,
  MissionWorkstream,
  TeamMission,
} from "@getpaseo/protocol/team/v2-types";
import { selectOpenWorkstreamAttentionAttributions } from "@getpaseo/protocol/team/attention-blocking";

type SuspendableMissionStatus = "planning" | "active" | "verifying";
type WorkstreamAttentionItem = Extract<
  MissionAttentionItem,
  {
    kind:
      | "review_gate_reviewer_unavailable"
      | "review_gate_capability_unknown"
      | "final_verifier_unavailable"
      | "final_verifier_capability_unknown";
  }
>;

export type MissionAttentionTransition =
  | { kind: "raise"; item: MissionAttentionItem }
  | {
      kind: "resolve";
      attentionId: string;
      resolution: MissionAttentionResolution;
    };

export class FinalVerificationWaiverRejectedError extends Error {
  readonly name = "FinalVerificationWaiverRejectedError";

  constructor(
    readonly missionId: string,
    readonly attentionId: string,
  ) {
    super(`Final verification Attention ${attentionId} cannot be waived`);
  }
}

export function applyMissionAttentionTransition(
  mission: TeamMission,
  transition: MissionAttentionTransition,
): TeamMission {
  const previousOpenWorkstreamIds = selectAttentionBlockedWorkstreamIds(mission);
  const attentionItems =
    transition.kind === "raise"
      ? raiseAttention(mission, transition.item)
      : resolveAttention(mission, transition.attentionId, transition.resolution);
  const missionState = deriveMissionState(mission, attentionItems);
  const next = { ...mission, ...missionState, attentionItems };
  return {
    ...next,
    workstreams: deriveWorkstreamStates(next, previousOpenWorkstreamIds),
  };
}

function raiseAttention(mission: TeamMission, item: MissionAttentionItem): MissionAttentionItem[] {
  if (mission.attentionItems.some((current) => current.attentionId === item.attentionId)) {
    return mission.attentionItems;
  }
  if (isWorkstreamAttentionItem(item)) {
    return [...mission.attentionItems, { ...item, priorMissionStatus: null }];
  }
  const suspendedStatus = suspendableMissionStatus(mission);
  if (suspendedStatus === null) return mission.attentionItems;
  return [...mission.attentionItems, { ...item, priorMissionStatus: suspendedStatus }];
}

function isWorkstreamAttentionItem(item: MissionAttentionItem): item is WorkstreamAttentionItem {
  return (
    item.kind === "review_gate_reviewer_unavailable" ||
    item.kind === "review_gate_capability_unknown" ||
    item.kind === "final_verifier_unavailable" ||
    item.kind === "final_verifier_capability_unknown"
  );
}

function resolveAttention(
  mission: TeamMission,
  attentionId: string,
  resolution: MissionAttentionResolution,
): MissionAttentionItem[] {
  if (resolution.kind === "waive_review") {
    const target = mission.attentionItems.find((item) => item.attentionId === attentionId);
    if (
      target?.kind === "final_verifier_unavailable" ||
      target?.kind === "final_verifier_capability_unknown"
    ) {
      throw new FinalVerificationWaiverRejectedError(mission.id, attentionId);
    }
  }
  return mission.attentionItems.map((item) =>
    item.attentionId === attentionId && item.status === "open"
      ? ({ ...item, status: "resolved" as const, resolution } as MissionAttentionItem)
      : item,
  );
}

function deriveMissionState(
  mission: TeamMission,
  attentionItems: ReadonlyArray<MissionAttentionItem>,
): Pick<TeamMission, "status" | "suspendedStatus"> {
  const hasOpenMissionAttention = attentionItems.some(
    (item) => item.status === "open" && item.scope.kind === "mission",
  );
  if (hasOpenMissionAttention) {
    const suspendedStatus = suspendableMissionStatus(mission);
    return suspendedStatus === null
      ? { status: mission.status, suspendedStatus: mission.suspendedStatus }
      : { status: "needs_attention", suspendedStatus };
  }
  if (mission.status === "needs_attention" && mission.suspendedStatus !== null) {
    return { status: mission.suspendedStatus, suspendedStatus: null };
  }
  return { status: mission.status, suspendedStatus: mission.suspendedStatus };
}

function deriveWorkstreamStates(
  mission: TeamMission,
  previouslyAttentionBlockedIds: ReadonlySet<string>,
): MissionWorkstream[] {
  const blockedIds = selectAttentionBlockedWorkstreamIds(mission);
  const byId = new Map(
    mission.workstreams.map((workstream) => [workstream.workstreamId, workstream]),
  );
  return mission.workstreams.map((workstream) => {
    if (blockedIds.has(workstream.workstreamId)) {
      return workstream.status === "accepted" || workstream.status === "canceled"
        ? workstream
        : { ...workstream, status: "blocked" };
    }
    if (!previouslyAttentionBlockedIds.has(workstream.workstreamId)) return workstream;
    if (workstream.status !== "blocked") return workstream;
    if (
      workstream.reviewGate.kind === "required" &&
      workstream.reviewGate.outcome.kind === "pending"
    ) {
      return { ...workstream, status: "review" };
    }
    const dependenciesAccepted = workstream.dependencyWorkstreamIds.every(
      (dependencyId) => byId.get(dependencyId)?.status === "accepted",
    );
    return { ...workstream, status: dependenciesAccepted ? "ready" : "planned" };
  });
}

export function selectAttentionBlockedWorkstreamIds(mission: TeamMission): Set<string> {
  return new Set(
    selectOpenWorkstreamAttentionAttributions(mission).map(
      (attribution) => attribution.targetWorkstreamId,
    ),
  );
}

function suspendableMissionStatus(mission: TeamMission): SuspendableMissionStatus | null {
  const status = mission.status === "needs_attention" ? mission.suspendedStatus : mission.status;
  return status === "planning" || status === "active" || status === "verifying" ? status : null;
}
