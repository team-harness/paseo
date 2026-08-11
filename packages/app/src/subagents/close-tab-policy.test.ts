import { describe, expect, it } from "vitest";

import { TEAM_ID_LABEL } from "@getpaseo/protocol/agent-labels";

import { closesWithoutArchiving, resolveCloseAgentTabPolicy } from "./close-tab-policy";

describe("resolveCloseAgentTabPolicy", () => {
  it("archives ordinary root agents when their tab closes", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null, labels: {} })).toEqual({
      kind: "archive-on-close",
    });
  });

  it("keeps delegated Agent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent", labels: {} })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps every Team participant tab close layout-only", () => {
    expect(
      resolveCloseAgentTabPolicy({
        parentAgentId: null,
        labels: { [TEAM_ID_LABEL]: "team-a" },
      }),
    ).toEqual({ kind: "layout-only" });
  });

  it("keeps close layout-only while a restored Agent tab is still hydrating", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "layout-only" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "layout-only" });
  });

  it("reports whether close is a lifecycle action", () => {
    expect(closesWithoutArchiving({ kind: "archive-on-close" })).toBe(false);
    expect(closesWithoutArchiving({ kind: "layout-only" })).toBe(true);
  });
});
