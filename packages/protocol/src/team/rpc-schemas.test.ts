import { describe, expect, it } from "vitest";
import {
  TEAM_ERROR_CODES,
  TeamArchiveRequestSchema,
  TeamArchiveResponseSchema,
  TeamCreateRequestSchema,
  TeamCreateResponseSchema,
  TeamInspectRequestSchema,
  TeamInspectResponseSchema,
  TeamListRequestSchema,
  TeamListResponseSchema,
  TeamMemberRemoveRequestSchema,
  TeamMemberRemoveResponseSchema,
} from "./rpc-schemas.js";

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
      state: "active" as const,
      removalReason: null,
    },
  ],
  lifecycle: "active" as const,
  revision: 1,
  templateId: null,
  createdAt: "2026-08-06T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
  archivedAt: null,
};

describe("team.create.request", () => {
  it("round-trips a full cross-provider team", () => {
    const request = {
      type: "team.create.request" as const,
      requestId: "req-1",
      idempotencyKey: "idem-1",
      name: "Disk usage",
      workspaceId: "wks_1",
      task: "Add a disk usage indicator",
      lead: {
        role: "lead",
        title: "Disk usage: lead",
        provider: "claude/claude-fable-5",
        settings: { modeId: "default", thinkingOptionId: "high" },
        briefing: "Coordinate the work.",
      },
      members: [
        {
          role: "implementer",
          provider: "codex/gpt-5.6-sol",
          settings: { features: { fast_mode: true } },
        },
        { role: "reviewer", provider: "codex/gpt-5.6-terra" },
      ],
      templateId: "lead-implementer-reviewer",
    };
    expect(TeamCreateRequestSchema.parse(request)).toEqual(request);
  });

  it("accepts an empty member list so the lead can recruit its own team", () => {
    const request = {
      type: "team.create.request" as const,
      requestId: "req-1",
      idempotencyKey: "idem-1",
      name: "Solo lead",
      workspaceId: "wks_1",
      task: "Figure out what this team needs",
      lead: { role: "lead", provider: "claude/claude-fable-5" },
      members: [],
    };
    expect(TeamCreateRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects more than eight non-lead members", () => {
    const member = { role: "worker", provider: "codex/gpt-5.6-sol" };
    const base = {
      type: "team.create.request" as const,
      requestId: "req-1",
      idempotencyKey: "idem-1",
      name: "Too big",
      workspaceId: "wks_1",
      task: "Do everything",
      lead: { role: "lead", provider: "claude/claude-fable-5" },
    };
    expect(
      TeamCreateRequestSchema.safeParse({ ...base, members: Array(8).fill(member) }).success,
    ).toBe(true);
    expect(
      TeamCreateRequestSchema.safeParse({ ...base, members: Array(9).fill(member) }).success,
    ).toBe(false);
  });

  it("rejects an empty or over-long team name", () => {
    const base = {
      type: "team.create.request" as const,
      requestId: "req-1",
      idempotencyKey: "idem-1",
      workspaceId: "wks_1",
      task: "Do the thing",
      lead: { role: "lead", provider: "claude/claude-fable-5" },
      members: [],
    };
    expect(TeamCreateRequestSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(TeamCreateRequestSchema.safeParse({ ...base, name: "a".repeat(60) }).success).toBe(true);
    expect(TeamCreateRequestSchema.safeParse({ ...base, name: "a".repeat(61) }).success).toBe(
      false,
    );
  });

  it("rejects an empty role", () => {
    expect(
      TeamCreateRequestSchema.safeParse({
        type: "team.create.request",
        requestId: "req-1",
        idempotencyKey: "idem-1",
        name: "Team",
        workspaceId: "wks_1",
        task: "Do the thing",
        lead: { role: "", provider: "claude/claude-fable-5" },
        members: [],
      }).success,
    ).toBe(false);
  });
});

describe("team.create.response", () => {
  it("round-trips a created team", () => {
    const response = {
      type: "team.create.response" as const,
      payload: {
        requestId: "req-1",
        team: teamSnapshot,
        error: null,
        errorCode: null,
      },
    };
    expect(TeamCreateResponseSchema.parse(response)).toEqual(response);
  });

  it("carries a machine-readable idempotency conflict", () => {
    const response = {
      type: "team.create.response" as const,
      payload: {
        requestId: "req-1",
        team: null,
        error: "This idempotency key was used with a different request.",
        errorCode: TEAM_ERROR_CODES.idempotencyConflict,
      },
    };
    expect(TeamCreateResponseSchema.parse(response)).toEqual(response);
    expect(TEAM_ERROR_CODES.idempotencyConflict).toBe("idempotency_conflict");
  });
});

describe("team list, inspect, archive and member removal", () => {
  it("round-trips a list request that hides archived teams", () => {
    const request = {
      type: "team.list.request" as const,
      requestId: "req-1",
      includeArchived: false,
    };
    expect(TeamListRequestSchema.parse(request)).toEqual(request);
  });

  it("round-trips a list request without the archived flag", () => {
    const request = { type: "team.list.request" as const, requestId: "req-1" };
    expect(TeamListRequestSchema.parse(request)).toEqual(request);
  });

  it("round-trips a list response", () => {
    const response = {
      type: "team.list.response" as const,
      payload: { requestId: "req-1", teams: [teamSnapshot], error: null },
    };
    expect(TeamListResponseSchema.parse(response)).toEqual(response);
  });

  it("round-trips inspect", () => {
    const request = { type: "team.inspect.request" as const, requestId: "req-1", teamId: "team-1" };
    expect(TeamInspectRequestSchema.parse(request)).toEqual(request);
    const response = {
      type: "team.inspect.response" as const,
      payload: { requestId: "req-1", team: teamSnapshot, error: null },
    };
    expect(TeamInspectResponseSchema.parse(response)).toEqual(response);
  });

  it("round-trips archive", () => {
    const request = { type: "team.archive.request" as const, requestId: "req-1", teamId: "team-1" };
    expect(TeamArchiveRequestSchema.parse(request)).toEqual(request);
    const response = {
      type: "team.archive.response" as const,
      payload: { requestId: "req-1", team: teamSnapshot, error: null },
    };
    expect(TeamArchiveResponseSchema.parse(response)).toEqual(response);
  });

  it("round-trips member removal", () => {
    const request = {
      type: "team.member.remove.request" as const,
      requestId: "req-1",
      teamId: "team-1",
      agentId: "agent-impl",
    };
    expect(TeamMemberRemoveRequestSchema.parse(request)).toEqual(request);
    const response = {
      type: "team.member.remove.response" as const,
      payload: { requestId: "req-1", team: teamSnapshot, error: null },
    };
    expect(TeamMemberRemoveResponseSchema.parse(response)).toEqual(response);
  });
});
