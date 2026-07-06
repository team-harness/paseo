import * as vitestSetup from "../../vitest.setup";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";
import { applyStatusSummaryUpdate, type StatusSummaryUpdatedMessage } from "./push";
import { statusSummaryQueryKey } from "./query-core";

void vitestSetup;

function summary(generatedAt: string): HostStatusSummaryPayload {
  return {
    generatedAt,
    usage: {
      lifetime: { totalTokens: 10 },
      today: {
        totalTokens: 5,
        windowStart: "2026-07-06T00:00:00.000Z",
        windowEnd: generatedAt,
      },
      byProvider: [],
      byModel: [],
    },
    activity: {
      runningAgents: [],
      needsAttentionAgents: [],
      recentlyCompletedAgents: [],
      counts: {
        running: 0,
        needsAttention: 0,
        idle: 0,
        error: 0,
      },
    },
  };
}

function update(generatedAt: string): StatusSummaryUpdatedMessage {
  return {
    type: "status.summary.updated",
    payload: summary(generatedAt),
  };
}

describe("applyStatusSummaryUpdate", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("replaces the matching server status summary cache with the full snapshot", () => {
    queryClient.setQueryData(
      statusSummaryQueryKey("server-1"),
      summary("2026-07-06T03:00:00.000Z"),
    );

    applyStatusSummaryUpdate({
      serverId: "server-1",
      queryClient,
      message: update("2026-07-06T04:00:00.000Z"),
    });

    expect(queryClient.getQueryData(statusSummaryQueryKey("server-1"))).toEqual(
      summary("2026-07-06T04:00:00.000Z"),
    );
  });

  it("does not touch sibling server caches", () => {
    const siblingSummary = summary("2026-07-06T02:00:00.000Z");
    queryClient.setQueryData(statusSummaryQueryKey("server-2"), siblingSummary);

    applyStatusSummaryUpdate({
      serverId: "server-1",
      queryClient,
      message: update("2026-07-06T04:00:00.000Z"),
    });

    expect(queryClient.getQueryData(statusSummaryQueryKey("server-1"))).toEqual(
      summary("2026-07-06T04:00:00.000Z"),
    );
    expect(queryClient.getQueryData(statusSummaryQueryKey("server-2"))).toBe(siblingSummary);
  });
});
