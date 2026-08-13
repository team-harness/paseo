import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { selectTeamHubWorkspace } from "./team-hub-workspace";

function workspace(id: string, archivingAt: string | null = null): WorkspaceDescriptor {
  return { id, archivingAt, workspaceDirectory: `/tmp/${id}` } as WorkspaceDescriptor;
}

describe("selectTeamHubWorkspace", () => {
  it("selects the first stable live workspace for Team creation", () => {
    const selected = selectTeamHubWorkspace(
      new Map([
        ["z", workspace("z")],
        ["archived", workspace("a", "2026-08-13T00:00:00.000Z")],
        ["b", workspace("b")],
      ]),
    );
    expect(selected?.id).toBe("b");
  });

  it("disables Team creation when no live workspace exists", () => {
    expect(
      selectTeamHubWorkspace(new Map([["archived", workspace("a", "2026-08-13T00:00:00.000Z")]])),
    ).toBeNull();
  });
});
