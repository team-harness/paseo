import type { StoredTeam, TeamCreationPlan } from "@getpaseo/protocol/team/types";

type PlanMember = TeamCreationPlan["members"][number];

interface BriefingInput {
  team: StoredTeam;
  plan: TeamCreationPlan;
  member: PlanMember;
}

/**
 * What each agent is told when the team starts.
 *
 * A briefing is the only thing an agent gets before it has to act, so it says
 * who else is here, where the conversation happens, and what the agent's own
 * part is. The room id is spelled out because the chat tools take it directly.
 *
 * A caller-supplied briefing is appended rather than substituted: it adds
 * context the daemon does not have, but the roster and the room are facts the
 * agent cannot work without.
 */
export function buildLeadBriefing(input: BriefingInput): string {
  const others = input.plan.members.filter((member) => !member.isLead);
  const lines = [
    `You are the lead of the team "${input.team.name}".`,
    "",
    "Task:",
    input.plan.task,
    "",
    others.length > 0
      ? `Your team: ${others.map((member) => `${member.role} (${member.agentId})`).join(", ")}.`
      : "You have no members yet. Recruit the ones you need.",
    `Team room: ${input.team.chatRoomId}. Everything the team says to each other goes there.`,
    "",
    "Assign work with the assign_task tool. A member that is busy stays busy —",
    "the assignment waits for it rather than interrupting, and you are told when",
    "it finishes.",
  ];
  return appendCallerBriefing(lines, input.member.briefing);
}

export function buildMemberBriefing(input: BriefingInput): string {
  const lead = input.plan.members.find((member) => member.isLead);
  const lines = [
    `You are the "${input.member.role}" of the team "${input.team.name}".`,
    "",
    "The team's task:",
    input.plan.task,
    "",
    lead ? `Your lead is ${lead.agentId}; it assigns your work.` : "",
    `Team room: ${input.team.chatRoomId}. Post there to reach the rest of the team,`,
    "and mention an agent by id when you need it specifically.",
    "",
    "Wait for an assignment before starting on the task.",
  ].filter((line) => line !== "");
  return appendCallerBriefing(lines, input.member.briefing);
}

/**
 * What the lead is told when work it assigned finishes.
 *
 * `unknown` is spelled out rather than smoothed over: the daemon genuinely does
 * not know how that turn ended, and the lead's move is to ask, not to assume.
 * A delivery can be resent after a crash, so it also says that seeing one twice
 * means nothing new happened.
 */
export function buildCompletionDelivery(
  completions: Array<{ assigneeAgentId: string; prompt: string; outcome: string }>,
): string {
  const lines = ["Work you assigned has finished.", ""];
  for (const completion of completions) {
    lines.push(
      completion.outcome === "unknown"
        ? `- ${completion.assigneeAgentId}: "${completion.prompt}" — outcome unknown. Ask it what happened.`
        : `- ${completion.assigneeAgentId}: "${completion.prompt}" — ${completion.outcome}.`,
    );
  }
  lines.push("", "If you have seen this before, nothing new has happened since.");
  return lines.join("\n");
}

function appendCallerBriefing(lines: string[], briefing: string | null): string {
  if (!briefing || briefing.trim().length === 0) {
    return lines.join("\n");
  }
  return [...lines, "", briefing.trim()].join("\n");
}
