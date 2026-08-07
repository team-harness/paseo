import { describe, expect, it } from "vitest";
import {
  StoredTeamSchema,
  TeamMemberEntrySchema,
  TeamSnapshotSchema,
  toTeamSnapshot,
} from "./types.js";

const memberEntry = {
  agentId: "agent-impl",
  role: "implementer",
  joinedAt: "2026-08-06T10:00:00.000Z",
  leftAt: null,
  state: "active" as const,
  removalReason: null,
};

const storedTeam = {
  id: "team-1",
  name: "Disk usage",
  workspaceId: "wks_1",
  chatRoomId: "room-1",
  leadAgentId: "agent-lead",
  members: [{ ...memberEntry, agentId: "agent-lead", role: "lead" }, memberEntry],
  lifecycle: "active" as const,
  revision: 3,
  idempotencyKey: "idem-1",
  requestFingerprint: "sha256-abc",
  creationPlan: null,
  creationStage: null,
  templateId: "lead-implementer-reviewer",
  createdAt: "2026-08-06T10:00:00.000Z",
  updatedAt: "2026-08-06T10:05:00.000Z",
  archivedAt: null,
  failedCleanupAt: null,
  pendingRecruitments: null,
};

describe("team member entry", () => {
  it("round-trips an active member", () => {
    expect(TeamMemberEntrySchema.parse(memberEntry)).toEqual(memberEntry);
  });

  it("round-trips every removal reason", () => {
    for (const removalReason of [
      "removed_by_user",
      "hard_deleted",
      "unarchive_evicted",
      "recruitment_failed",
      "recruitment_canceled",
    ] as const) {
      const removed = {
        ...memberEntry,
        state: "removed" as const,
        leftAt: "2026-08-06T11:00:00.000Z",
        removalReason,
      };
      expect(TeamMemberEntrySchema.parse(removed)).toEqual(removed);
    }
  });

  it("rejects an unknown removal reason", () => {
    expect(
      TeamMemberEntrySchema.safeParse({ ...memberEntry, removalReason: "vanished" }).success,
    ).toBe(false);
  });
});

describe("stored team", () => {
  it("round-trips an active team", () => {
    expect(StoredTeamSchema.parse(storedTeam)).toEqual(storedTeam);
  });

  it("round-trips a creating team carrying its creation plan", () => {
    const creating = {
      ...storedTeam,
      lifecycle: "creating" as const,
      creationStage: "room_created" as const,
      creationPlan: {
        task: "Add a disk usage indicator",
        room: { roomId: "room-1", internalName: "team-team-1" },
        members: [
          {
            agentId: "agent-lead",
            isLead: true,
            role: "lead",
            title: null,
            provider: "claude/claude-fable-5",
            settings: { modeId: "default" },
            briefing: null,
          },
          {
            agentId: "agent-impl",
            isLead: false,
            role: "implementer",
            title: "Disk usage: implementer",
            provider: "codex/gpt-5.6-sol",
            settings: null,
            briefing: "Focus on the server side.",
          },
        ],
      },
    };
    expect(StoredTeamSchema.parse(creating)).toEqual(creating);
  });

  it("round-trips pending recruitment intents keyed by agent id", () => {
    const recruiting = {
      ...storedTeam,
      pendingRecruitments: {
        "agent-reviewer": {
          provider: "codex/gpt-5.6-terra",
          settings: null,
          title: null,
          teamRole: "reviewer",
          initialPrompt: "Review the disk usage diff.",
          clientMessageId: "team-team-1-recruit-agent-reviewer",
          recruiterAgentId: "agent-lead",
          workspaceId: "wks_1",
          stage: "reserved" as const,
        },
      },
    };
    expect(StoredTeamSchema.parse(recruiting)).toEqual(recruiting);
  });
});

describe("team snapshot", () => {
  // DEC-2/DEC-13: these live only on the daemon. Leaking any of them onto the wire
  // would publish idempotency keys, request fingerprints and unsent prompts.
  const SERVER_ONLY_FIELDS = new Set([
    "idempotencyKey",
    "requestFingerprint",
    "creationPlan",
    "creationStage",
    "failedCleanupAt",
    "pendingRecruitments",
  ]);

  it("omits every server-only field", () => {
    const wireFields = Object.keys(TeamSnapshotSchema.shape);
    expect(wireFields.filter((field) => SERVER_ONLY_FIELDS.has(field))).toEqual([]);
  });

  it("carries every field the client needs", () => {
    expect(Object.keys(TeamSnapshotSchema.shape).sort()).toEqual(
      [
        "archivedAt",
        "chatRoomId",
        "createdAt",
        "id",
        "leadAgentId",
        "lifecycle",
        "members",
        "name",
        "revision",
        "templateId",
        "updatedAt",
        "workspaceId",
      ].sort(),
    );
  });

  it("projects a stored team by dropping server-only fields", () => {
    expect(toTeamSnapshot(StoredTeamSchema.parse(storedTeam))).toEqual({
      id: "team-1",
      name: "Disk usage",
      workspaceId: "wks_1",
      chatRoomId: "room-1",
      leadAgentId: "agent-lead",
      members: [{ ...memberEntry, agentId: "agent-lead", role: "lead" }, memberEntry],
      lifecycle: "active",
      revision: 3,
      templateId: "lead-implementer-reviewer",
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-06T10:05:00.000Z",
      archivedAt: null,
    });
  });

  it("projects a creating team without leaking its creation plan", () => {
    const snapshot = toTeamSnapshot(
      StoredTeamSchema.parse({
        ...storedTeam,
        lifecycle: "creating",
        creationStage: "allocated",
        creationPlan: {
          task: "secret task",
          room: { roomId: "room-1", internalName: "team-team-1" },
          members: [],
        },
        pendingRecruitments: {
          "agent-x": {
            provider: "codex/gpt-5.6-sol",
            settings: null,
            title: null,
            teamRole: "reviewer",
            initialPrompt: "secret prompt",
            clientMessageId: "team-team-1-recruit-agent-x",
            recruiterAgentId: "agent-lead",
            workspaceId: "wks_1",
            stage: "reserved",
          },
        },
      }),
    );
    expect(TeamSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });
});
