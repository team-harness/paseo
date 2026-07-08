import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "./agent/agent-sdk-types.js";
import {
  HostStatusSummaryPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  serializeAgentStreamEvent,
} from "./messages.js";

describe("serializeAgentStreamEvent", () => {
  test("accepts status summary pinned sessions and session pin mutation messages", () => {
    const summary = HostStatusSummaryPayloadSchema.parse({
      generatedAt: "2026-07-08T00:00:00.000Z",
      usage: {
        lifetime: { totalTokens: 0 },
        today: {
          totalTokens: 0,
          windowStart: "2026-07-08T00:00:00.000Z",
          windowEnd: "2026-07-08T00:00:00.000Z",
        },
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
      pinnedSessions: [
        {
          agentId: "agent-1",
          workspaceId: "workspace-1",
          title: "Pinned work",
          provider: "codex",
          updatedAt: "2026-07-08T00:00:00.000Z",
          pinnedAt: "2026-07-08T00:00:01.000Z",
        },
      ],
    });

    expect(summary.pinnedSessions?.[0]?.agentId).toBe("agent-1");

    expect(
      SessionInboundMessageSchema.parse({
        type: "status.session_pins.set.request",
        requestId: "req-pin",
        agentId: "agent-1",
        pinned: true,
        workspaceId: "workspace-1",
        title: "Pinned work",
        provider: "codex",
        updatedAt: "2026-07-08T00:00:00.000Z",
      }),
    ).toMatchObject({
      type: "status.session_pins.set.request",
      agentId: "agent-1",
      pinned: true,
    });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "status.session_pins.set.response",
        payload: {
          requestId: "req-pin",
          pinnedSessions: summary.pinnedSessions,
        },
      }),
    ).toMatchObject({
      type: "status.session_pins.set.response",
      payload: {
        requestId: "req-pin",
      },
    });
  });

  test("accepts create_agent_request env records", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-env",
      config: {
        provider: "codex",
        cwd: "/tmp",
      },
      env: {
        CHUNK14_PROBE: "expected",
      },
      attachments: [],
    });

    expect(parsed).toMatchObject({
      type: "create_agent_request",
      env: {
        CHUNK14_PROBE: "expected",
      },
    });
  });

  test("rejects non-string create_agent_request env values", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "create_agent_request",
      requestId: "req-env",
      config: {
        provider: "codex",
        cwd: "/tmp",
      },
      env: {
        CHUNK14_PROBE: 14,
      },
      attachments: [],
    });

    expect(parsed.success).toBe(false);
  });

  test("preserves user_message text as-is", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "claude",
      item: {
        type: "user_message",
        text: "<paseo-instructions>\nX\n</paseo-instructions>\n\nHello",
        messageId: "m1",
      },
    };

    const serialized = serializeAgentStreamEvent(event);
    expect(serialized).not.toBeNull();
    if (!serialized || serialized.type !== "timeline" || serialized.item.type !== "user_message") {
      throw new Error("Expected timeline.user_message event");
    }
    expect(serialized.item.text).toBe(event.item.text);
    expect(serialized.item.messageId).toBe("m1");
  });

  test("passes canonical tool_call payloads through unchanged", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_1",
        name: "shell",
        status: "running",
        detail: {
          type: "shell",
          command: "pwd",
        },
        error: null,
      },
    };

    const serialized = serializeAgentStreamEvent(event);
    expect(serialized).not.toBeNull();
    if (!serialized || serialized.type !== "timeline" || serialized.item.type !== "tool_call") {
      throw new Error("Expected timeline.tool_call event");
    }
    expect(serialized.item.status).toBe("running");
    expect(serialized.item.error).toBeNull();
  });

  test("passes unknown-detail tool_call payloads through unchanged", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_unknown",
        name: "paseo_voice.speak",
        status: "completed",
        detail: {
          type: "unknown",
          input: { text: "hello" },
          output: { ok: true },
        },
        error: null,
      },
    };

    const serialized = serializeAgentStreamEvent(event);
    expect(serialized).not.toBeNull();
    if (!serialized || serialized.type !== "timeline" || serialized.item.type !== "tool_call") {
      throw new Error("Expected timeline.tool_call event");
    }
    expect(serialized.item.detail).toEqual({
      type: "unknown",
      input: { text: "hello" },
      output: { ok: true },
    });
  });

  test("drops invalid legacy tool_call items", () => {
    const event = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_legacy",
        name: "shell",
        status: "inProgress",
        detail: {
          type: "unknown",
          input: { command: "pwd" },
          output: null,
        },
      },
    } satisfies unknown;

    const serialized = serializeAgentStreamEvent(event as AgentStreamEvent);
    expect(serialized).toBeNull();
  });

  test("drops internal session config drift events from websocket payloads", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "mode_changed",
        provider: "codex",
        currentModeId: "build",
        availableModes: [{ id: "build", label: "Build" }],
      },
      {
        type: "model_changed",
        provider: "codex",
        runtimeInfo: { provider: "codex", sessionId: "session-1", model: "gpt-5.4" },
      },
      {
        type: "thinking_option_changed",
        provider: "codex",
        thinkingOptionId: "high",
      },
    ];

    expect(events.map((event) => serializeAgentStreamEvent(event))).toEqual([null, null, null]);
  });
});
