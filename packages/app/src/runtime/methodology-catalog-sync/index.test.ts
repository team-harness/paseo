import { expect, it, vi } from "vitest";
import { MethodologyCatalogSync, type MethodologyCatalogReplica } from ".";

it("fails independently while retaining the previous catalog and retries", async () => {
  const commits: MethodologyCatalogReplica[] = [];
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      methodologies: [{ ref: { bundleId: "paseo/standard" } }],
      error: null,
    })
    .mockRejectedValueOnce(new Error("offline catalog"))
    .mockResolvedValueOnce({
      methodologies: [{ ref: { bundleId: "portable/software-delivery" } }],
      error: null,
    });
  const sync = new MethodologyCatalogSync((value) => commits.push(value));
  sync.connectionChanged({
    client: { listTeamMethodologies: list } as never,
    status: "online",
    source: { clientGeneration: 1, connectionEpoch: 1 },
    supported: true,
  });
  await vi.waitFor(() => expect(commits.at(-1)?.status).toBe("ready"));
  sync.refresh();
  await vi.waitFor(() => expect(commits.at(-1)?.status).toBe("failed"));
  expect(commits.at(-1)?.methodologies).toHaveLength(1);
  sync.refresh();
  await vi.waitFor(() =>
    expect(commits.at(-1)?.methodologies[0]?.ref.bundleId).toBe("portable/software-delivery"),
  );
});

it("does not rehydrate an unchanged physical source", async () => {
  const list = vi.fn().mockResolvedValue({ methodologies: [], error: null });
  const sync = new MethodologyCatalogSync(() => undefined);
  const connection = {
    client: { listTeamMethodologies: list } as never,
    status: "online" as const,
    source: { clientGeneration: 1, connectionEpoch: 1 },
    supported: true,
  };
  sync.connectionChanged(connection);
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  sync.connectionChanged(connection);
  await Promise.resolve();
  expect(list).toHaveBeenCalledTimes(1);
});
