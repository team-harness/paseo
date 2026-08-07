import type { AgentPermissionAction, AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

export interface PermissionActionLabels {
  deny: string;
  accept: string;
  implement: string;
}

/**
 * The buttons a permission request can actually be answered with.
 *
 * Providers mostly do not send `actions` — Claude attaches them to plan
 * requests and to nothing else — so a surface that rendered only what the
 * request carried would draw an ordinary tool permission with no way to answer
 * it. When the request does carry actions, those win: they are the provider's
 * own question, and an invented accept/deny pair answers an N-way choice with
 * option one and resolves a bespoke id as cancelled.
 */
export function resolvePermissionActions(
  request: Pick<AgentPermissionRequest, "kind" | "actions">,
  labels: PermissionActionLabels,
): AgentPermissionAction[] {
  // A question is answered by typing. Two buttons under a prompt that wants
  // prose is worse than none.
  if (request.kind === "question") return [];

  if (Array.isArray(request.actions) && request.actions.length > 0) return request.actions;

  return [
    { id: "reject", label: labels.deny, behavior: "deny", variant: "danger", intent: "dismiss" },
    {
      id: "accept",
      label: request.kind === "plan" ? labels.implement : labels.accept,
      behavior: "allow",
      variant: "primary",
    },
  ];
}
