import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

import type {
  MissionAssignmentContract,
  MissionWorkstream,
  TeamMission,
  TeamV2,
} from "@getpaseo/protocol/team/v2-types";

import { metroTest as test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  process.cwd().endsWith("packages/app") ? "../.." : ".",
  "dogfood-output/agent-teams-v2-ui/screenshots",
);

const DESKTOP_VIEWPORT = { width: 1440, height: 960 };
const COMPACT_VIEWPORT = { width: 420, height: 900 };
const VALIDATION_WORKSTREAM_ID = "service-port-validation";
const TESTS_WORKSTREAM_ID = "focused-regression-tests";

interface TeamMissionsSeedClient extends SeedDaemonClient {
  listTeamProfiles(options?: { includeArchived?: boolean }): Promise<{
    teams: TeamV2[];
    error: string | null;
    errorCode: string | null;
  }>;
  listTeamMissions(options: { teamId: string; includeTerminal?: boolean }): Promise<{
    missions: TeamMission[];
    error: string | null;
    errorCode: string | null;
  }>;
  inspectTeamMission(options: { missionId: string }): Promise<{
    mission: TeamMission | null;
    error: string | null;
    errorCode: string | null;
  }>;
}

interface StoredMissionRecord {
  storageRevision: number;
  mission: unknown;
  [key: string]: unknown;
}

interface StoredTeamProfileRecord {
  storageRevision: number;
  profile: unknown;
  [key: string]: unknown;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function seedMissionSnapshot(
  paseoHome: string,
  missionId: string,
  update: (mission: TeamMission) => TeamMission,
): Promise<TeamMission> {
  const filePath = path.join(paseoHome, "team-missions", "missions", `${missionId}.json`);
  const record = JSON.parse(await readFile(filePath, "utf8")) as StoredMissionRecord;
  if (!Number.isInteger(record.storageRevision)) {
    throw new Error(`Mission ${missionId} has no storage revision`);
  }
  const mission = record.mission as TeamMission;
  const nextMission = update(structuredClone(mission));
  await writeJsonAtomic(filePath, {
    ...record,
    storageRevision: record.storageRevision + 1,
    mission: nextMission,
  });
  return nextMission;
}

async function clearActiveMissionSnapshot(paseoHome: string, teamId: string): Promise<TeamV2> {
  const filePath = path.join(paseoHome, "team-missions", "profiles", `${teamId}.json`);
  const record = JSON.parse(await readFile(filePath, "utf8")) as StoredTeamProfileRecord;
  if (!Number.isInteger(record.storageRevision)) {
    throw new Error(`Team ${teamId} has no storage revision`);
  }
  const profile = record.profile as TeamV2;
  const nextProfile: TeamV2 = {
    ...profile,
    activeMissionId: null,
    revision: profile.revision + 1,
    updatedAt: timestampAfter(profile.updatedAt, 60_000),
  };
  await writeJsonAtomic(filePath, {
    ...record,
    storageRevision: record.storageRevision + 1,
    profile: nextProfile,
  });
  return nextProfile;
}

function timestampAfter(timestamp: string, offsetMs: number): string {
  return new Date(Date.parse(timestamp) + offsetMs).toISOString();
}

function matchExplanation(
  team: TeamV2,
  owner: TeamV2["members"][number],
): MissionWorkstream["ownerMatchExplanation"] {
  return {
    recommendedMemberId: owner.memberId,
    requiredSkillIds: owner.skillIds,
    preferredSkillIds: [],
    matchedPreferredSkillIds: [],
    requiredRuntimeCapabilityIds: [],
    minimumLevel: owner.level,
    selectedLevel: owner.level,
    eligibleMemberIds: team.members.map((member) => member.memberId),
    excludedMemberIds: [],
    previousMemberId: null,
    candidateOpenAssignments: team.members.map((member) => ({
      memberId: member.memberId,
      openAssignments: 0,
    })),
    continuedPreviousMember: false,
    openAssignments: 0,
    rosterIndex: team.members.findIndex((member) => member.memberId === owner.memberId),
  };
}

function buildParallelSnapshot(mission: TeamMission, team: TeamV2): TeamMission {
  const [validationOwner, testsOwner] = team.members;
  if (!validationOwner || !testsOwner) {
    throw new Error(`Team ${team.id} needs two members for parallel UI evidence`);
  }
  const now = timestampAfter(mission.updatedAt, 60_000);
  const definitions = [
    {
      workstreamId: VALIDATION_WORKSTREAM_ID,
      title: "Duplicate port validation",
      objective: "Reject duplicate service ports before the daemon starts",
      deliverables: ["Service configuration validation"],
      acceptanceCriteria: ["Duplicate ports return an actionable validation error"],
      mutableScope: {
        kind: "paths" as const,
        pathPrefixes: ["packages/server/src/services"],
      },
      owner: validationOwner,
    },
    {
      workstreamId: TESTS_WORKSTREAM_ID,
      title: "Focused regression tests",
      objective: "Cover duplicate and unique service-port configurations",
      deliverables: ["Deterministic daemon configuration tests"],
      acceptanceCriteria: ["Focused duplicate-port tests pass"],
      mutableScope: {
        kind: "paths" as const,
        pathPrefixes: ["packages/server/src/config-tests"],
      },
      owner: testsOwner,
    },
  ];
  const workstreams: MissionWorkstream[] = definitions.map((definition) => ({
    workstreamId: definition.workstreamId,
    kind: "delivery",
    title: definition.title,
    objective: definition.objective,
    deliverables: definition.deliverables,
    acceptanceCriteria: definition.acceptanceCriteria,
    requiredSkillIds: definition.owner.skillIds,
    preferredSkillIds: [],
    requiredRuntimeCapabilityIds: [],
    minimumLevel: definition.owner.level,
    planRevision: 1,
    rosterSnapshotRevision: mission.activeRosterSnapshotRevision,
    dependencyWorkstreamIds: [],
    mutableScope: definition.mutableScope,
    ownerMemberId: definition.owner.memberId,
    ownerMatchExplanation: matchExplanation(team, definition.owner),
    ownerOverrideReason: null,
    reviewPolicy: "none",
    reviewerRequirements: null,
    reviewerMemberId: null,
    reviewerMatchExplanation: null,
    reviewerOverrideReason: null,
    status: "active",
  }));
  const participantsByMemberId = new Map(
    mission.participants.map((participant) => [participant.memberId, participant]),
  );
  const participants = [validationOwner, testsOwner].map(
    (member) =>
      participantsByMemberId.get(member.memberId) ?? {
        memberId: member.memberId,
        agentId: `agent-evidence-${member.memberId}`,
        bindingEpoch: 1,
        joinedAt: now,
        archivedAt: null,
      },
  );
  const participantAgentId = new Map(
    participants.map((participant) => [participant.memberId, participant.agentId]),
  );
  const assignments: MissionAssignmentContract[] = definitions.map((definition, index) => ({
    assignmentId: `assignment-${definition.workstreamId}`,
    revision: 1,
    kind: "delivery",
    subjectAssignmentIds: [],
    missionId: mission.id,
    workstreamId: definition.workstreamId,
    assigneeMemberId: definition.owner.memberId,
    runtimeAgentId: participantAgentId.get(definition.owner.memberId) ?? null,
    bindingEpoch: 1,
    objective: definition.objective,
    inputRefs: [],
    deliverables: definition.deliverables,
    acceptanceCriteria: definition.acceptanceCriteria,
    mutableScope: definition.mutableScope,
    dependencyAssignmentIds: [],
    priority: index + 1,
    planRevision: 1,
    rosterSnapshotRevision: mission.activeRosterSnapshotRevision,
    supersededBy: null,
    terminationReason: null,
    scopeLease: null,
    workspaceBaseline: null,
    report: null,
    dispatchState: "dispatched",
    semanticState: "running",
    attempt: 1,
    acceptedTurnId: `turn-${definition.workstreamId}`,
    createdAt: now,
    dispatchedAt: now,
    settledAt: null,
  }));

  return {
    ...mission,
    status: "active",
    suspendedStatus: null,
    participants,
    planRevision: 1,
    revision: mission.revision + 1,
    workstreams,
    workstreamPlanSnapshots: [
      {
        planRevision: 1,
        workstreams: workstreams.map((workstream) =>
          Object.assign({}, workstream, { status: "ready" as const }),
        ),
        createdAt: now,
      },
    ],
    assignments,
    attentionItems: [],
    updatedAt: now,
    completedAt: null,
  };
}

function completedReport(
  assignment: MissionAssignmentContract,
): NonNullable<MissionAssignmentContract["report"]> {
  return {
    status: "completed",
    verdict: null,
    summary: `${assignment.objective} completed with focused coverage`,
    artifactPaths:
      assignment.mutableScope.kind === "paths" ? assignment.mutableScope.pathPrefixes : [],
    tests: [{ command: "npx vitest run focused-config.test.ts --bail=1", passed: true }],
    decisions: [],
    handoffs: [],
  };
}

function buildBlockedSnapshot(mission: TeamMission): TeamMission {
  const now = timestampAfter(mission.updatedAt, 60_000);
  const blockedAssignmentId = `assignment-${VALIDATION_WORKSTREAM_ID}`;
  return {
    ...mission,
    status: "needs_attention",
    suspendedStatus: "active",
    revision: mission.revision + 1,
    workstreams: mission.workstreams.map((workstream) => ({
      ...workstream,
      status: workstream.workstreamId === VALIDATION_WORKSTREAM_ID ? "blocked" : "accepted",
    })),
    assignments: mission.assignments.map((assignment) =>
      assignment.assignmentId === blockedAssignmentId
        ? {
            ...assignment,
            revision: assignment.revision + 1,
            terminationReason: "participant_unavailable",
            report: {
              status: "blocked" as const,
              summary: "Validation work paused when the assigned Participant became unavailable",
              blockers: ["The Participant session ended before the validation result was reported"],
              artifactPaths: [],
              tests: [],
              decisions: [],
              handoffs: [],
            },
            dispatchState: "settled" as const,
            semanticState: "blocked" as const,
            settledAt: now,
          }
        : {
            ...assignment,
            revision: assignment.revision + 1,
            report: completedReport(assignment),
            dispatchState: "settled" as const,
            semanticState: "completed" as const,
            settledAt: now,
          },
    ),
    attentionItems: [
      {
        attentionId: "attention-participant-unavailable",
        kind: "participant_unavailable",
        status: "open",
        priorMissionStatus: "active",
        assignmentId: blockedAssignmentId,
        summary: "Duplicate port validation is blocked because its Participant is unavailable",
        pathEvidence: [],
        createdAt: now,
        resolution: null,
      },
    ],
    updatedAt: now,
  };
}

function buildCompletedSnapshot(mission: TeamMission): TeamMission {
  const now = timestampAfter(mission.updatedAt, 60_000);
  return {
    ...mission,
    status: "completed",
    suspendedStatus: null,
    revision: mission.revision + 1,
    participants: mission.participants.map((participant) => ({
      ...participant,
      archivedAt: now,
    })),
    workstreams: mission.workstreams.map((workstream) => ({
      ...workstream,
      status: "accepted",
    })),
    assignments: mission.assignments.map((assignment) => ({
      ...assignment,
      revision: assignment.revision + 1,
      terminationReason: null,
      report: completedReport(assignment),
      dispatchState: "settled",
      semanticState: "completed",
      settledAt: now,
    })),
    attentionItems: [],
    updatedAt: now,
    completedAt: now,
  };
}

async function reloadTeamPanel(page: Page, serverId: string, teamId: string): Promise<void> {
  const teamUrl = new URL(
    `/h/${encodeURIComponent(serverId)}/team/${encodeURIComponent(teamId)}`,
    page.url(),
  );
  await page.goto(teamUrl.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("team-room-settings")).toBeVisible();
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function configureMember(page: Page, index: number, role: string): Promise<void> {
  const member = page.getByTestId(`team-profile-member-${index}`);
  await member.getByTestId(`team-profile-member-${index}-role`).fill(role);
  await member.getByTestId(/team-profile-member-\d+-skill-/).click();
  await member.getByTestId("combined-model-selector").click();
  await page.getByTestId("model-provider-mock").click();
  await page.getByRole("button", { name: /^Five minute stream/ }).click();
}

async function openSettingsPage(
  page: Page,
  target: "members" | "mission" | "plan" | "attention",
): Promise<void> {
  await page.getByTestId("team-room-settings").click();
  await expect(page.getByTestId("team-settings-navigation")).toBeVisible();
  await page.getByTestId(`team-settings-nav-${target}`).click();
}

test("Team v2 creation, Mission chat, settings, and responsive evidence", async ({ page }) => {
  test.setTimeout(300_000);
  const serverId = `srv_team_v2_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId, {
    environment: { NODE_ENV: "development", PASEO_NODE_INSPECT: "0" },
    mcpInjectIntoAgents: true,
    startupTimeoutMs: 60_000,
    teamMissionsRuntime: true,
  });
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({ repoPrefix: "team-v2-ui-", port: daemon.port });
    const client = workspace.client as TeamMissionsSeedClient;
    const activeAgentsBefore = (await client.fetchAgents({ scope: "active" })).entries.length;
    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${daemon.port}`,
      nowIso: new Date().toISOString(),
    });
    await page.route(/:6767\b/, (route) => route.abort());
    await page.routeWebSocket(/:6767\b/, async (webSocket) => {
      await webSocket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
    });
    await page.addInitScript(
      ({ seededHost, preferences }) => {
        localStorage.setItem("@paseo:e2e", "1");
        localStorage.setItem("@paseo:daemon-registry", JSON.stringify([seededHost]));
        localStorage.setItem("@paseo:create-agent-preferences", JSON.stringify(preferences));
      },
      { seededHost: host, preferences: buildCreateAgentPreferences(serverId) },
    );

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoAppShell(page);
    await page.locator('[data-testid^="sidebar-workspace-row-"]').first().click();

    const inlineAdd = page.getByTestId("workspace-new-agent-tab-inline");
    await inlineAdd.click();
    await expect(page.getByTestId("workspace-new-tab-inline-team")).toBeVisible();
    await page.getByTestId("workspace-new-tab-inline-team").click();
    await expect(page.getByTestId("team-profile-form-sheet")).toBeVisible();

    await page.getByTestId("team-profile-name").fill("Release engineering");
    await page.getByTestId("team-profile-skill-0-name").fill("TypeScript delivery");
    await page
      .getByTestId("team-profile-skill-0-description")
      .fill("Implement and review production TypeScript changes");
    await configureMember(page, 0, "Senior software engineer");
    await page.getByTestId("team-profile-add-member").click();
    await configureMember(page, 1, "Senior software engineer");
    await expect(page.getByTestId("team-profile-submit")).toBeEnabled();
    await page.getByTestId("team-profile-name").scrollIntoViewIfNeeded();
    await shoot(page, "01-desktop-create-team");
    await page.getByTestId("team-profile-submit").click();

    await expect(page.getByTestId("team-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("team-room-no-mission")).toBeVisible();
    const profiles = await client.listTeamProfiles();
    expect(profiles.error).toBeNull();
    const team = profiles.teams.find((candidate) => candidate.name === "Release engineering");
    expect(team).toBeDefined();
    expect(team?.members.map((member) => member.role)).toEqual([
      "Senior software engineer",
      "Senior software engineer",
    ]);
    expect(new Set(team?.members.map((member) => member.mentionHandle)).size).toBe(2);
    expect((await client.fetchAgents({ scope: "active" })).entries).toHaveLength(
      activeAgentsBefore,
    );
    await shoot(page, "02-desktop-empty-team");

    await openSettingsPage(page, "members");
    for (const member of team?.members ?? []) {
      await expect(page.getByTestId(`team-member-${member.memberId}`)).toContainText(
        `@${member.mentionHandle}`,
      );
    }
    await shoot(page, "03-desktop-members-settings");
    await page.keyboard.press("Escape");

    await page.getByTestId("team-room-start-mission").click();
    await expect(page.getByTestId("mission-start-sheet")).toBeVisible();
    await page
      .getByTestId("mission-start-objective")
      .fill("Add duplicate service-port validation with focused tests and review");
    await page
      .getByTestId("mission-start-acceptance-0")
      .fill("Duplicate ports are rejected and focused tests pass");
    await shoot(page, "04-desktop-start-mission");
    await page.getByTestId("mission-start-submit").click();

    await expect(page.getByTestId("mission-start-sheet")).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const listedMissions = await client.listTeamMissions({ teamId: team!.id });
        return listedMissions.missions.some(
          (candidate) =>
            candidate.objective ===
            "Add duplicate service-port validation with focused tests and review",
        );
      })
      .toBe(true);
    const listedMissions = await client.listTeamMissions({ teamId: team!.id });
    expect(listedMissions.error).toBeNull();
    const mission = listedMissions.missions.find(
      (candidate) =>
        candidate.objective ===
        "Add duplicate service-port validation with focused tests and review",
    );
    expect(mission).toBeDefined();
    expect(mission?.status).toBe("planning");

    const leadParticipant = mission?.participants.find(
      (participant) => participant.memberId === team?.leadMemberId,
    );
    expect(leadParticipant).toBeDefined();
    const posted = await client.postTeamMissionMessage({
      missionId: mission!.id,
      body: `@${leadParticipant!.agentId} please publish the Mission plan`,
    });
    expect(posted.error).toBeNull();
    const message = page.getByTestId(`team-room-message-${posted.message!.id}`);
    await expect(message).toContainText(`@${team!.members[0]!.mentionHandle}`);
    await expect(message).not.toContainText(leadParticipant!.agentId);
    await expect(page.getByTestId(`team-room-message-${posted.message!.id}-author`)).toHaveText(
      "You",
    );
    await shoot(page, "05-desktop-mission-chat");

    await openSettingsPage(page, "plan");
    await expect(page.getByTestId("team-settings-page-plan-empty")).toBeVisible();
    await shoot(page, "06-desktop-mission-planning");
    await page.keyboard.press("Escape");

    await page.setViewportSize(COMPACT_VIEWPORT);
    await page.getByTestId("team-room-settings").click();
    await expect(page.getByTestId("team-settings-navigation")).toBeVisible();
    await shoot(page, "07-compact-settings-navigation");
    await page.getByTestId("team-settings-nav-members").click();
    await shoot(page, "08-compact-members");

    // These schema-valid persisted snapshots exercise the UI's authoritative daemon read path.
    // Scheduler parallelism and recovery behavior are proved by the dedicated real-daemon E2E.
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const parallel = await seedMissionSnapshot(daemon.paseoHome, mission!.id, (current) =>
      buildParallelSnapshot(current, team!),
    );
    const inspectedParallel = await client.inspectTeamMission({ missionId: parallel.id });
    expect(inspectedParallel).toMatchObject({
      mission: parallel,
      error: null,
      errorCode: null,
    });
    expect(
      inspectedParallel.mission?.assignments.filter(
        (assignment) => assignment.semanticState === "running",
      ),
    ).toHaveLength(2);
    await reloadTeamPanel(page, serverId, team!.id);
    await openSettingsPage(page, "plan");
    const validationCard = page.getByTestId(`team-workstream-${VALIDATION_WORKSTREAM_ID}`);
    const testsCard = page.getByTestId(`team-workstream-${TESTS_WORKSTREAM_ID}`);
    await expect(validationCard).toContainText("Running");
    await expect(testsCard).toContainText("Running");
    await shoot(page, "09-desktop-parallel-running");
    await page.keyboard.press("Escape");

    const blocked = await seedMissionSnapshot(daemon.paseoHome, mission!.id, buildBlockedSnapshot);
    const inspectedBlocked = await client.inspectTeamMission({ missionId: blocked.id });
    expect(inspectedBlocked).toMatchObject({
      mission: blocked,
      error: null,
      errorCode: null,
    });
    expect(inspectedBlocked.mission).toMatchObject({
      status: "needs_attention",
      suspendedStatus: "active",
      attentionItems: [{ status: "open", kind: "participant_unavailable" }],
    });
    await reloadTeamPanel(page, serverId, team!.id);
    await openSettingsPage(page, "mission");
    const missionPage = page.getByTestId("team-settings-page-mission");
    await expect(missionPage.getByText("Needs attention", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("team-mission-history")).toContainText("No previous Missions");
    await shoot(page, "10-desktop-needs-attention-mission");
    await page.keyboard.press("Escape");

    await openSettingsPage(page, "plan");
    await expect(validationCard).toContainText("Blocked");
    await expect(testsCard).toContainText("Completed");
    await shoot(page, "11-desktop-blocked-plan");
    await page.keyboard.press("Escape");

    await openSettingsPage(page, "attention");
    await expect(page.getByTestId("team-settings-page-attention")).toContainText(
      "Duplicate port validation is blocked because its Participant is unavailable",
    );
    await expect(
      page.getByTestId("team-attention-attention-participant-unavailable-open-lead"),
    ).toBeVisible();
    await expect(
      page.getByTestId("team-attention-attention-participant-unavailable-replan"),
    ).toHaveCount(0);
    await shoot(page, "12-desktop-open-attention");
    await page.keyboard.press("Escape");

    const completed = await seedMissionSnapshot(
      daemon.paseoHome,
      mission!.id,
      buildCompletedSnapshot,
    );
    const completedTeam = await clearActiveMissionSnapshot(daemon.paseoHome, team!.id);
    const inspectedCompleted = await client.inspectTeamMission({ missionId: completed.id });
    expect(inspectedCompleted).toMatchObject({
      mission: completed,
      error: null,
      errorCode: null,
    });
    expect(inspectedCompleted.mission).toMatchObject({
      status: "completed",
      suspendedStatus: null,
      completedAt: completed.completedAt,
    });
    expect(
      inspectedCompleted.mission?.assignments.every(
        (assignment) => assignment.semanticState === "completed",
      ),
    ).toBe(true);
    const completedProfiles = await client.listTeamProfiles();
    expect(completedProfiles.teams.find((candidate) => candidate.id === completedTeam.id)).toEqual(
      completedTeam,
    );
    await reloadTeamPanel(page, serverId, team!.id);
    await expect(page.getByTestId("team-room-no-mission")).toBeVisible();
    await openSettingsPage(page, "mission");
    const completedHistory = page.getByTestId(`team-mission-history-${completed.id}`);
    await expect(completedHistory).toBeVisible();
    await completedHistory.click();
    await expect(page.getByTestId("team-settings-sheet")).toBeHidden();
    await openSettingsPage(page, "mission");
    await expect(
      page
        .getByTestId("team-settings-page-mission")
        .getByText("Completed", { exact: true })
        .first(),
    ).toBeVisible();
    await shoot(page, "13-desktop-completed-mission");
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});
