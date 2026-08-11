import { describe, expect, it, vi } from "vitest";
import type { WorkspaceReviewSummaryEntry } from "./workspace-comments";
import {
  beginReviewDeliveryInState,
  collectPendingReviewEntries,
  finishReviewDeliveryInState,
  normalizeReviewDeliveryState,
  recordReviewDeliveryInState,
  submitReviewMessageViaComposer,
  type ReviewDeliveryState,
} from "./delivery";

function entry(overrides: {
  id: string;
  updatedAt?: string;
  ownerKey?: string;
}): WorkspaceReviewSummaryEntry {
  const updatedAt = overrides.updatedAt ?? "2026-08-08T08:00:00.000Z";
  return {
    kind: "selection",
    ownerKey: overrides.ownerKey ?? "workspace-key",
    comment: {
      id: overrides.id,
      filePath: "README.md",
      source: "preview",
      quote: "Selected text",
      lineStart: null,
      lineEnd: null,
      body: `Comment ${overrides.id}`,
      createdAt: "2026-08-08T07:00:00.000Z",
      updatedAt,
    },
  };
}

function emptyState(): ReviewDeliveryState {
  return { sessionsByWorkspace: {}, operationsByWorkspace: {} };
}

describe("review delivery", () => {
  it.each([
    { sendBehavior: "interrupt" as const, isAgentRunning: true },
    { sendBehavior: "queue" as const, isAgentRunning: false },
  ])(
    "submits through Composer for $sendBehavior behavior when running=$isAgentRunning",
    async ({ sendBehavior, isAgentRunning }) => {
      const queueMessage = vi.fn();
      const submitMessage = vi.fn(async () => undefined);

      await expect(
        submitReviewMessageViaComposer({
          message: "Review comments",
          sendBehavior,
          isAgentRunning,
          queueMessage,
          submitMessage,
        }),
      ).resolves.toBe("submitted");

      expect(submitMessage).toHaveBeenCalledWith("Review comments");
      expect(queueMessage).not.toHaveBeenCalled();
    },
  );

  it("uses the Composer queue policy while the associated agent is running", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => undefined);

    await expect(
      submitReviewMessageViaComposer({
        message: "Review comments",
        sendBehavior: "queue",
        isAgentRunning: true,
        queueMessage,
        submitMessage,
      }),
    ).resolves.toBe("queued");

    expect(queueMessage).toHaveBeenCalledWith("Review comments");
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it("locks the workspace review session to the first agent", () => {
    const first = recordReviewDeliveryInState(emptyState(), {
      workspaceKey: "workspace-key",
      agentId: "agent-1",
      entries: [entry({ id: "comment-1" })],
      deliveredAt: "2026-08-08T08:01:00.000Z",
    });
    const switched = recordReviewDeliveryInState(first, {
      workspaceKey: "workspace-key",
      agentId: "agent-2",
      entries: [entry({ id: "comment-2" })],
      deliveredAt: "2026-08-08T08:02:00.000Z",
    });

    expect(switched).toBe(first);
    expect(switched.sessionsByWorkspace["workspace-key"]?.agentId).toBe("agent-1");
  });

  it("allows only one delivery operation per workspace", () => {
    const first = beginReviewDeliveryInState(emptyState(), {
      workspaceKey: "workspace-key",
      operationId: "operation-1",
      agentId: "agent-1",
    });
    const second = beginReviewDeliveryInState(first.state, {
      workspaceKey: "workspace-key",
      operationId: "operation-2",
      agentId: "agent-2",
    });

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.state.operationsByWorkspace["workspace-key"]?.operationId).toBe("operation-1");
  });

  it("finishes only the operation that owns the workspace reservation", () => {
    const started = beginReviewDeliveryInState(emptyState(), {
      workspaceKey: "workspace-key",
      operationId: "operation-1",
      agentId: "agent-1",
    }).state;
    const stale = finishReviewDeliveryInState(started, {
      workspaceKey: "workspace-key",
      operationId: "operation-2",
      agentId: "agent-2",
      entries: [entry({ id: "comment-1" })],
      deliveredAt: "2026-08-08T08:01:00.000Z",
    });
    const finished = finishReviewDeliveryInState(stale, {
      workspaceKey: "workspace-key",
      operationId: "operation-1",
      agentId: "agent-1",
      entries: [entry({ id: "comment-1" })],
      deliveredAt: "2026-08-08T08:02:00.000Z",
    });

    expect(stale).toBe(started);
    expect(finished.operationsByWorkspace).toEqual({});
    expect(finished.sessionsByWorkspace["workspace-key"]?.agentId).toBe("agent-1");
  });

  it("rejects a stale picker after another agent becomes associated", () => {
    const associated = recordReviewDeliveryInState(emptyState(), {
      workspaceKey: "workspace-key",
      agentId: "agent-1",
      entries: [entry({ id: "comment-1" })],
      deliveredAt: "2026-08-08T08:01:00.000Z",
    });
    const result = beginReviewDeliveryInState(associated, {
      workspaceKey: "workspace-key",
      operationId: "operation-2",
      agentId: "agent-2",
    });

    expect(result.started).toBe(false);
    expect(result.state).toBe(associated);
  });

  it("sends only new or edited comment revisions", () => {
    const original = entry({ id: "comment-1" });
    const state = recordReviewDeliveryInState(emptyState(), {
      workspaceKey: "workspace-key",
      agentId: "agent-1",
      entries: [original],
      deliveredAt: "2026-08-08T08:01:00.000Z",
    });
    const session = state.sessionsByWorkspace["workspace-key"]!;
    const edited = entry({ id: "comment-1", updatedAt: "2026-08-08T08:03:00.000Z" });
    const added = entry({ id: "comment-2" });

    expect(
      collectPendingReviewEntries([original, edited, added], session.deliveredRevisions),
    ).toEqual([edited, added]);
  });

  it("drops invalid persisted sessions without affecting valid sessions", () => {
    expect(
      normalizeReviewDeliveryState({
        sessionsByWorkspace: {
          valid: {
            agentId: "agent-1",
            deliveredRevisions: { "selection:owner:comment": "revision" },
            createdAt: "created",
            updatedAt: "updated",
          },
          invalid: { agentId: "", deliveredRevisions: [] },
        },
      }),
    ).toEqual({
      sessionsByWorkspace: {
        valid: {
          agentId: "agent-1",
          deliveredRevisions: { "selection:owner:comment": "revision" },
          createdAt: "created",
          updatedAt: "updated",
        },
      },
      operationsByWorkspace: {},
    });
  });
});
