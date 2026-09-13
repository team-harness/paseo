import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  FileBackedUsageLedger,
  type UsageLedgerEventInput,
  type UsageLedgerRecord,
} from "./index.js";
import { MODEL_PRICING_REVISION } from "../model-pricing/pricing.js";

const logger = createTestLogger();

test("backfills missing costs once, preserves provider prices and deduplicates after restart", async () => {
  await withLedger(async ({ ledger, paseoHome }) => {
    const first = {
      ...usageEvent({ usage: { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 } }),
      model: "gpt-6-astra",
    };
    const second = {
      ...first,
      usage: { inputTokens: 2000, cachedInputTokens: 800, outputTokens: 200 },
    };
    ledger.enqueueEvent(first);
    ledger.enqueueEvent(second);
    ledger.enqueueEvent({
      ...first,
      usageTurnKey: "priced",
      usage: { ...first.usage, totalCostUsd: 9 },
    });
    ledger.enqueueEvent({ ...first, usageTurnKey: "unknown", model: "unknown-model" });
    await ledger.flush();
    const reloaded = new FileBackedUsageLedger({ paseoHome, logger });
    await reloaded.initialize();
    expect((await reloaded.getTotals()).totalCostUsd).toBeCloseTo(9.0228);
    expect((await reloaded.getTotals()).unpricedRecords).toBe(1);
    const readRecords = async (): Promise<UsageLedgerRecord[]> =>
      JSON.parse(await readFile(path.join(paseoHome, "usage-ledger", "agent-1.json"), "utf8"))
        .records;
    const records = await readRecords();
    expect(
      records.filter((record) => record.costPricingRevision === MODEL_PRICING_REVISION),
    ).toHaveLength(2);
    reloaded.enqueueEvent(second);
    reloaded.enqueueEvent({
      ...second,
      usage: {
        inputTokens: 3000,
        cachedInputTokens: 1200,
        outputTokens: 300,
        totalCostUsd: 0.0342,
      },
    });
    expect((await reloaded.getTotals()).totalCostUsd).toBeCloseTo(9.0342);
    expect(await readRecords()).toHaveLength(5);
    const reopened = new FileBackedUsageLedger({ paseoHome, logger });
    await reopened.initialize();
    expect((await reopened.getTotals()).totalCostUsd).toBeCloseTo(9.0342);
    expect((await reopened.getTotals()).unpricedRecords).toBe(1);
  });
});

test("does not backfill incomplete token data or double charge partially priced turns", async () => {
  await withLedger(async ({ ledger, paseoHome }) => {
    ledger.enqueueEvent({ ...usageEvent({ usage: { inputTokens: 100 } }), model: "gpt-6-astra" });
    ledger.enqueueEvent({
      ...usageEvent({ usage: { inputTokens: 200, outputTokens: 20, totalCostUsd: 1 } }),
      model: "gpt-6-astra",
    });
    ledger.enqueueEvent({
      ...usageEvent({ usageTurnKey: "missing-output", usage: { inputTokens: 100 } }),
      model: "gpt-6-astra",
    });
    await ledger.flush();
    const reloaded = new FileBackedUsageLedger({ paseoHome, logger });
    await reloaded.initialize();
    expect((await reloaded.getTotals()).totalCostUsd).toBe(1);
    expect((await reloaded.getTotals()).unpricedRecords).toBe(2);
  });
});

async function withLedger<T>(
  testBody: (context: { ledger: FileBackedUsageLedger; paseoHome: string }) => Promise<T>,
): Promise<T> {
  const paseoHome = await mkdtemp(path.join(tmpdir(), "usage-ledger-test-"));
  const ledger = new FileBackedUsageLedger({ paseoHome, logger });
  try {
    await ledger.initialize();
    return await testBody({ ledger, paseoHome });
  } finally {
    await rm(paseoHome, { recursive: true, force: true });
  }
}

function usageEvent(input: {
  agentId?: string;
  provider?: string;
  usageTurnKey?: string;
  sourceEventType?: "usage_updated" | "turn_completed";
  usage?: UsageLedgerEventInput["usage"];
  observedAt?: string;
  workspaceId?: string | null;
}): UsageLedgerEventInput {
  return {
    agentId: input.agentId ?? "agent-1",
    provider: input.provider ?? "codex",
    usageTurnKey: input.usageTurnKey ?? "turn-1",
    sessionId: "session-1",
    workspaceId: input.workspaceId ?? "workspace-1",
    cwd: "/repo",
    model: "gpt-5",
    turnId: input.usageTurnKey ?? "turn-1",
    sourceEventType: input.sourceEventType ?? "usage_updated",
    usage: input.usage ?? { inputTokens: 10, outputTokens: 2 },
    observedAt: new Date(input.observedAt ?? "2026-07-06T08:00:00.000Z"),
  };
}

test("returns empty lifetime and today totals for a new ledger", async () => {
  await withLedger(async ({ ledger }) => {
    await expect(ledger.getTotals()).resolves.toEqual({});
    await expect(ledger.getTodayTotals(new Date("2026-07-06T12:00:00.000Z"))).resolves.toEqual({});
  });
});

test("adds positive deltas within one turn and deduplicates identical final snapshots across event types", async () => {
  await withLedger(async ({ ledger }) => {
    ledger.enqueueEvent(usageEvent({ usage: { inputTokens: 10, outputTokens: 2 } }));
    ledger.enqueueEvent(usageEvent({ usage: { inputTokens: 18, outputTokens: 5 } }));
    ledger.enqueueEvent(
      usageEvent({
        sourceEventType: "turn_completed",
        usage: { inputTokens: 18, outputTokens: 5 },
      }),
    );

    await expect(ledger.getTotals()).resolves.toEqual({
      inputTokens: 18,
      outputTokens: 5,
      unpricedRecords: 2,
    });
  });
});

test("uses turn keys to keep reset snapshots from separate provider turns independent", async () => {
  await withLedger(async ({ ledger }) => {
    ledger.enqueueEvent(
      usageEvent({ provider: "claude", usageTurnKey: "turn-1", usage: { inputTokens: 100 } }),
    );
    ledger.enqueueEvent(
      usageEvent({ provider: "claude", usageTurnKey: "turn-2", usage: { inputTokens: 4 } }),
    );
    ledger.enqueueEvent(
      usageEvent({ provider: "opencode", usageTurnKey: "turn-1", usage: { outputTokens: 7 } }),
    );

    await expect(ledger.getTotals()).resolves.toEqual({
      inputTokens: 104,
      outputTokens: 7,
      unpricedRecords: 3,
    });
  });
});

test("deduplicates cumulative provider cost snapshots while keeping token turns independent", async () => {
  await withLedger(async ({ ledger }) => {
    ledger.enqueueEvent(
      usageEvent({
        provider: "claude",
        usageTurnKey: "turn-1",
        usage: { inputTokens: 100, totalCostUsd: 10 },
        observedAt: "2026-07-06T08:00:00.000Z",
      }),
    );
    ledger.enqueueEvent(
      usageEvent({
        provider: "claude",
        usageTurnKey: "turn-2",
        usage: { inputTokens: 4, totalCostUsd: 15 },
        observedAt: "2026-07-06T09:00:00.000Z",
      }),
    );
    ledger.enqueueEvent(
      usageEvent({
        provider: "claude",
        usageTurnKey: "turn-3",
        usage: { inputTokens: 6, totalCostUsd: 2 },
        observedAt: "2026-07-06T10:00:00.000Z",
      }),
    );

    await expect(ledger.getTotals()).resolves.toEqual({
      inputTokens: 110,
      totalCostUsd: 17,
    });
  });
});

test("uses pre-window cumulative provider cost as the baseline for today totals", async () => {
  await withLedger(async ({ ledger }) => {
    ledger.enqueueEvent(
      usageEvent({
        provider: "claude",
        usageTurnKey: "turn-1",
        usage: { inputTokens: 100, totalCostUsd: 10 },
        observedAt: "2026-07-05T15:00:00.000Z",
      }),
    );
    ledger.enqueueEvent(
      usageEvent({
        provider: "claude",
        usageTurnKey: "turn-2",
        usage: { inputTokens: 4, totalCostUsd: 15 },
        observedAt: "2026-07-06T09:00:00.000Z",
      }),
    );
    ledger.enqueueEvent(
      usageEvent({
        provider: "claude",
        usageTurnKey: "turn-3",
        usage: { inputTokens: 6, totalCostUsd: 18 },
        observedAt: "2026-07-06T10:00:00.000Z",
      }),
    );

    await expect(ledger.getTodayTotals(new Date("2026-07-06T12:00:00.000Z"))).resolves.toEqual({
      inputTokens: 10,
      totalCostUsd: 8,
    });
  });
});

test("drops stale snapshots without writing negative contribution or lowering the basis", async () => {
  await withLedger(async ({ ledger }) => {
    ledger.enqueueEvent(usageEvent({ usage: { inputTokens: 30, outputTokens: 10 } }));
    ledger.enqueueEvent(usageEvent({ usage: { inputTokens: 20, outputTokens: 10 } }));
    ledger.enqueueEvent(usageEvent({ usage: { inputTokens: 35, outputTokens: 12 } }));

    await expect(ledger.getTotals()).resolves.toEqual({
      inputTokens: 35,
      outputTokens: 12,
      unpricedRecords: 2,
    });
  });
});

test("persists records and snapshot bases under PASEO_HOME and reloads totals", async () => {
  await withLedger(async ({ ledger, paseoHome }) => {
    ledger.enqueueEvent(
      usageEvent({
        usage: {
          inputTokens: 20,
          cachedInputTokens: 5,
          outputTokens: 6,
          totalCostUsd: 0.02,
          contextWindowUsedTokens: 200,
        },
      }),
    );
    await ledger.flush();

    const reloaded = new FileBackedUsageLedger({ paseoHome, logger });
    await reloaded.initialize();

    await expect(reloaded.getTotals()).resolves.toEqual({
      inputTokens: 20,
      cachedInputTokens: 5,
      outputTokens: 6,
      totalCostUsd: 0.02,
    });
    const persisted = JSON.parse(
      await readFile(path.join(paseoHome, "usage-ledger", "agent-1.json"), "utf8"),
    ) as {
      records: Array<{ usage: Record<string, unknown>; contribution: Record<string, unknown> }>;
    };
    expect(persisted.records[0]?.usage.contextWindowUsedTokens).toBe(200);
    expect(persisted.records[0]?.contribution).not.toHaveProperty("contextWindowUsedTokens");
  });
});

test("filters today totals by daemon local day and preserves lifetime across days", async () => {
  await withLedger(async ({ ledger }) => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const today = new Date(now);
    today.setHours(9, 0, 0, 0);
    ledger.enqueueEvent(
      usageEvent({
        usageTurnKey: "turn-1",
        usage: { inputTokens: 10 },
        observedAt: yesterday.toISOString(),
      }),
    );
    ledger.enqueueEvent(
      usageEvent({
        usageTurnKey: "turn-2",
        usage: { inputTokens: 7 },
        observedAt: today.toISOString(),
      }),
    );

    await expect(ledger.getTotals()).resolves.toEqual({ inputTokens: 17, unpricedRecords: 2 });
    await expect(ledger.getTodayTotals(now)).resolves.toEqual({
      inputTokens: 7,
      unpricedRecords: 1,
    });
  });
});

test("skips corrupt persisted files without blocking healthy ledger data", async () => {
  await withLedger(async ({ ledger, paseoHome }) => {
    ledger.enqueueEvent(usageEvent({ agentId: "agent-good", usage: { inputTokens: 12 } }));
    await ledger.flush();
    await writeFile(path.join(paseoHome, "usage-ledger", "agent-bad.json"), "{not json", "utf8");

    const reloaded = new FileBackedUsageLedger({ paseoHome, logger });
    await reloaded.initialize();

    await expect(reloaded.getTotals()).resolves.toEqual({ inputTokens: 12, unpricedRecords: 1 });
  });
});

test("deleteAgentUsage removes one agent ledger without affecting archived history for other agents", async () => {
  await withLedger(async ({ ledger, paseoHome }) => {
    ledger.enqueueEvent(usageEvent({ agentId: "archived-agent", usage: { inputTokens: 8 } }));
    ledger.enqueueEvent(usageEvent({ agentId: "deleted-agent", usage: { inputTokens: 3 } }));
    await ledger.flush();

    await ledger.deleteAgentUsage("deleted-agent");

    await expect(ledger.getTotals()).resolves.toEqual({ inputTokens: 8, unpricedRecords: 1 });
    await expect(
      readFile(path.join(paseoHome, "usage-ledger", "deleted-agent.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
