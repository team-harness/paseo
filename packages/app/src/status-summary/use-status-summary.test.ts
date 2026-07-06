import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { HostStatusSummaryPayload } from "@getpaseo/protocol/messages";
import {
  STATUS_SUMMARY_STALE_TIME_MS,
  buildStatusSummaryQueryState,
  canFetchStatusSummary,
  refreshStatusSummary,
  shouldRefreshStatusSummary,
  statusSummaryQueryKey,
  type StatusSummaryClient,
} from "./query-core";

function summary(): HostStatusSummaryPayload {
  return {
    generatedAt: "2026-07-06T04:00:00.000Z",
    usage: {
      lifetime: { totalTokens: 10 },
      today: {
        totalTokens: 5,
        windowStart: "2026-07-06T00:00:00.000Z",
        windowEnd: "2026-07-06T04:00:00.000Z",
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

function client(
  payloads: HostStatusSummaryPayload | HostStatusSummaryPayload[] = summary(),
): StatusSummaryClient & {
  calls: number;
} {
  const queue = Array.isArray(payloads) ? [...payloads] : [payloads];
  return {
    calls: 0,
    async getStatusSummary() {
      this.calls += 1;
      const payload = queue.shift() ?? summary();
      return {
        requestId: "status-summary-request",
        summary: payload,
      };
    },
  };
}

describe("status summary query helpers", () => {
  it("uses a serverId-scoped query key", () => {
    expect(statusSummaryQueryKey("server-1")).toEqual(["statusSummary", "server-1"]);
    expect(statusSummaryQueryKey(null)).toEqual(["statusSummary", ""]);
  });

  it("enables fetch only when host, client, connection, and capability are all present", () => {
    const readyClient = client();
    expect(
      canFetchStatusSummary({
        serverId: "server-1",
        client: readyClient,
        isConnected: true,
        supportsStatusSummary: true,
      }),
    ).toBe(true);
    expect(
      canFetchStatusSummary({
        serverId: "",
        client: readyClient,
        isConnected: true,
        supportsStatusSummary: true,
      }),
    ).toBe(false);
    expect(
      canFetchStatusSummary({
        serverId: "server-1",
        client: readyClient,
        isConnected: false,
        supportsStatusSummary: true,
      }),
    ).toBe(false);
    expect(
      canFetchStatusSummary({
        serverId: "server-1",
        client: readyClient,
        isConnected: true,
        supportsStatusSummary: false,
      }),
    ).toBe(false);
  });

  it("returns unsupported instead of fetching when the daemon lacks the capability", () => {
    const readyClient = client();
    const previousSummary = summary();
    const input = {
      serverId: "server-1",
      client: readyClient,
      isConnected: true,
      supportsStatusSummary: false,
    };

    expect(shouldRefreshStatusSummary(input)).toBe(false);
    expect(
      buildStatusSummaryQueryState({
        ...input,
        data: previousSummary,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
      }),
    ).toEqual({ kind: "disabled", reason: "unsupported", previousSummary });
    expect(readyClient.calls).toBe(0);
  });

  it("preserves previous summary while offline", () => {
    const previousSummary = summary();

    expect(
      buildStatusSummaryQueryState({
        serverId: "server-1",
        client: client(),
        isConnected: false,
        supportsStatusSummary: true,
        data: previousSummary,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
      }),
    ).toEqual({ kind: "disabled", reason: "offline", previousSummary });
  });

  it("treats pushed data as ready even if the previous query fetch failed", () => {
    const pushedSummary = summary();

    expect(
      buildStatusSummaryQueryState({
        serverId: "server-1",
        client: client(),
        isConnected: true,
        supportsStatusSummary: true,
        data: pushedSummary,
        isLoading: false,
        isFetching: false,
        isError: true,
        error: new Error("get failed"),
      }),
    ).toEqual({
      kind: "ready",
      summary: pushedSummary,
      isRefreshing: false,
    });
  });

  it("fetches and caches a summary without requiring an active observer", async () => {
    const queryClient = new QueryClient();
    const readyClient = client();

    await expect(
      refreshStatusSummary({
        queryClient,
        serverId: "server-1",
        client: readyClient,
      }),
    ).resolves.toEqual(summary());

    expect(readyClient.calls).toBe(1);
    expect(queryClient.getQueryData(statusSummaryQueryKey("server-1"))).toEqual(summary());
    expect(queryClient.getQueryState(statusSummaryQueryKey("server-1"))?.isInvalidated).toBe(false);
  });

  it("explicit refresh refetches even when cached data is otherwise fresh forever", async () => {
    const queryClient = new QueryClient();
    const first = summary();
    const second = {
      ...summary(),
      generatedAt: "2026-07-06T04:05:00.000Z",
    };
    const readyClient = client([first, second]);

    await refreshStatusSummary({ queryClient, serverId: "server-1", client: readyClient });
    await refreshStatusSummary({ queryClient, serverId: "server-1", client: readyClient });

    expect(readyClient.calls).toBe(2);
    expect(queryClient.getQueryData(statusSummaryQueryKey("server-1"))).toEqual(second);
  });

  it("uses explicit infinite stale time for status summary freshness", () => {
    expect(STATUS_SUMMARY_STALE_TIME_MS).toBe(Infinity);
  });
});
