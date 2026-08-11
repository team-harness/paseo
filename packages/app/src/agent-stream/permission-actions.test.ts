import { describe, expect, it } from "vitest";

import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

import { resolvePermissionActions } from "./permission-actions";

const LABELS = { deny: "Deny", accept: "Accept", implement: "Implement" };

function request(overrides: Partial<AgentPermissionRequest> = {}): AgentPermissionRequest {
  return { id: "req-1", provider: "claude", name: "Bash", kind: "tool", ...overrides };
}

describe("what a permission request can be answered with", () => {
  it("uses the request's own actions when it has them", () => {
    const actions = [
      { id: "allow-once", label: "Allow once", behavior: "allow" as const },
      { id: "stop", label: "Stop", behavior: "deny" as const },
    ];

    expect(resolvePermissionActions(request({ actions }), LABELS)).toEqual(actions);
  });

  it("falls back to accept and deny when the provider sends none", () => {
    // Most providers do not send `actions` at all — Claude only does for plan
    // requests. A surface that rendered only `request.actions` would draw a
    // request with no way to answer it.
    const resolved = resolvePermissionActions(request(), LABELS);

    expect(resolved.map((action) => action.behavior)).toEqual(["deny", "allow"]);
    expect(resolved.map((action) => action.id)).toEqual(["reject", "accept"]);
  });

  it("treats an empty action list as no actions at all", () => {
    expect(resolvePermissionActions(request({ actions: [] }), LABELS)).toHaveLength(2);
  });

  it("offers to implement a plan rather than to accept it", () => {
    const resolved = resolvePermissionActions(request({ kind: "plan" }), LABELS);

    expect(resolved.at(-1)?.label).toBe("Implement");
  });

  it("answers a question with nothing", () => {
    // A question is answered by typing, not by pressing allow. Inventing a
    // pair here would put two buttons under a prompt that wants prose.
    expect(resolvePermissionActions(request({ kind: "question" }), LABELS)).toEqual([]);
  });
});
