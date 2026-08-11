import { describe, expect, test, vi } from "vitest";

import { createPersistedWorkspaceRecord } from "./workspace-registry.js";
import { recoverPendingWorkspaceArchives } from "./workspace-archive-recovery.js";

const timestamp = "2026-08-11T00:00:00.000Z";

function workspace(input: {
  workspaceId: string;
  archiveIntent?: { requestId: string; requestedAt: string } | null;
  archivedAt?: string | null;
}) {
  return createPersistedWorkspaceRecord({
    workspaceId: input.workspaceId,
    projectId: "project-1",
    cwd: `/tmp/${input.workspaceId}`,
    kind: "directory",
    displayName: input.workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    archiveIntent: input.archiveIntent ?? null,
    archivedAt: input.archivedAt ?? null,
  });
}

describe("recoverPendingWorkspaceArchives", () => {
  test("replays only nonterminal intents in stable workspace order", async () => {
    const archiveWorkspace = vi.fn(async () => undefined);

    await recoverPendingWorkspaceArchives({
      listWorkspaces: async () => [
        workspace({
          workspaceId: "workspace-b",
          archiveIntent: { requestId: "request-b", requestedAt: timestamp },
        }),
        workspace({ workspaceId: "workspace-live" }),
        workspace({
          workspaceId: "workspace-a",
          archiveIntent: { requestId: "request-a", requestedAt: timestamp },
        }),
        workspace({
          workspaceId: "workspace-archived",
          archiveIntent: { requestId: "request-archived", requestedAt: timestamp },
          archivedAt: timestamp,
        }),
      ],
      archiveWorkspace,
    });

    expect(archiveWorkspace.mock.calls).toEqual([
      ["workspace-a", "request-a"],
      ["workspace-b", "request-b"],
    ]);
  });

  test("attempts every pending intent before failing startup", async () => {
    const archiveWorkspace = vi.fn(async (workspaceId: string) => {
      if (workspaceId === "workspace-a") throw new Error("archive A failed");
    });

    await expect(
      recoverPendingWorkspaceArchives({
        listWorkspaces: async () => [
          workspace({
            workspaceId: "workspace-a",
            archiveIntent: { requestId: "request-a", requestedAt: timestamp },
          }),
          workspace({
            workspaceId: "workspace-b",
            archiveIntent: { requestId: "request-b", requestedAt: timestamp },
          }),
        ],
        archiveWorkspace,
      }),
    ).rejects.toThrow("Failed to recover pending workspace archives");
    expect(archiveWorkspace.mock.calls).toEqual([
      ["workspace-a", "request-a"],
      ["workspace-b", "request-b"],
    ]);
  });
});
