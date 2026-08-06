import { describe, expect, it } from "vitest";
import { CLIENT_CAPS } from "./client-capabilities.js";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const teamSnapshot = {
  id: "team-1",
  name: "Disk usage",
  workspaceId: "wks_1",
  chatRoomId: "room-1",
  leadAgentId: "agent-lead",
  members: [
    {
      agentId: "agent-lead",
      role: "lead",
      joinedAt: "2026-08-06T10:00:00.000Z",
      leftAt: null,
      state: "active",
      removalReason: null,
    },
  ],
  lifecycle: "active",
  revision: 4,
  templateId: null,
  createdAt: "2026-08-06T10:00:00.000Z",
  updatedAt: "2026-08-06T10:05:00.000Z",
  archivedAt: null,
};

describe("team session messages", () => {
  it("accepts every team request on the inbound union", () => {
    const requests = [
      {
        type: "team.create.request",
        requestId: "req-1",
        idempotencyKey: "idem-1",
        name: "Disk usage",
        workspaceId: "wks_1",
        task: "Add a disk usage indicator",
        lead: { role: "lead", provider: "claude/claude-fable-5" },
        members: [{ role: "implementer", provider: "codex/gpt-5.6-sol" }],
      },
      { type: "team.list.request", requestId: "req-2", includeArchived: false },
      { type: "team.inspect.request", requestId: "req-3", teamId: "team-1" },
      { type: "team.archive.request", requestId: "req-4", teamId: "team-1" },
      {
        type: "team.member.remove.request",
        requestId: "req-5",
        teamId: "team-1",
        agentId: "agent-impl",
      },
    ];
    for (const request of requests) {
      expect(SessionInboundMessageSchema.safeParse(request).success).toBe(true);
    }
  });

  it("accepts every team response on the outbound union", () => {
    const responses = [
      {
        type: "team.create.response",
        payload: { requestId: "req-1", team: teamSnapshot, error: null, errorCode: null },
      },
      {
        type: "team.list.response",
        payload: { requestId: "req-2", teams: [teamSnapshot], error: null },
      },
      {
        type: "team.inspect.response",
        payload: { requestId: "req-3", team: teamSnapshot, error: null },
      },
      {
        type: "team.archive.response",
        payload: { requestId: "req-4", team: teamSnapshot, error: null },
      },
      {
        type: "team.member.remove.response",
        payload: { requestId: "req-5", team: teamSnapshot, error: null },
      },
    ];
    for (const response of responses) {
      expect(SessionOutboundMessageSchema.safeParse(response).success).toBe(true);
    }
  });

  it("accepts the team update broadcast carrying the snapshot revision", () => {
    const parsed = SessionOutboundMessageSchema.safeParse({
      type: "team.update",
      payload: { team: teamSnapshot },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("team capability gating", () => {
  it("advertises the teams feature on server info", () => {
    const payload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_test",
      features: { teams: true },
    });
    expect(payload.features?.teams).toBe(true);
  });

  it("accepts an older daemon that omits the teams feature", () => {
    const payload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_legacy",
      features: {},
    });
    expect(payload.features?.teams).toBeUndefined();
  });

  it("exposes a client capability so the daemon can gate team broadcasts per socket", () => {
    expect(CLIENT_CAPS.teams).toBe("teams");
  });
});
