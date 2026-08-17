import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { WorkspaceScopeLeaseStore } from "./workspace-scope-lease-store.js";

const NOW = "2026-08-08T12:00:00.000Z";

describe("WorkspaceScopeLeaseStore", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "team-scope-leases-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  test("keeps overlapping scopes serialized across Teams and daemon restarts", async () => {
    const first = createStore(rootDirectory);
    const apiLease = await first.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    expect(apiLease).toMatchObject({
      assignmentId: "assignment-api",
      workspaceId: "workspace-api-view",
      state: "execution",
    });

    const restarted = createStore(rootDirectory);
    await expect(
      restarted.acquire({
        teamId: "team-review",
        missionId: "mission-review",
        workspaceId: "workspace-review-view",
        assignmentId: "assignment-review",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:01.000Z",
      }),
    ).resolves.toBeNull();

    if (!apiLease) throw new Error("Expected the first lease to be acquired");
    await restarted.release(apiLease);
    await expect(
      restarted.acquire({
        teamId: "team-review",
        missionId: "mission-review",
        workspaceId: "workspace-review-view",
        assignmentId: "assignment-review",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:01.000Z",
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-review" });
  });

  test("persists a report hold and its captured delta across daemon restarts", async () => {
    const first = createStore(rootDirectory);
    const lease = await first.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!lease) throw new Error("Expected the first lease to be acquired");

    const held = await first.transitionToReportHold({
      lease,
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
    });
    expect(held).toMatchObject({
      state: "report_hold",
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
      recoveryAttempts: 0,
    });

    await expect(
      first.transitionToReportHold({
        lease: { ...held, recoveryAttempts: 1 },
        transitionedAt: "2026-08-08T12:00:02.000Z",
        capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
      }),
    ).resolves.toMatchObject({ state: "report_hold", recoveryAttempts: 1 });

    const restarted = createStore(rootDirectory);
    await expect(
      restarted.transitionToReportHold({
        lease,
        transitionedAt: "2026-08-08T12:00:02.000Z",
        capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
      }),
    ).resolves.toMatchObject({ state: "report_hold", recoveryAttempts: 1 });
    await expect(
      restarted.acquire({
        teamId: "team-review",
        missionId: "mission-review",
        workspaceId: "workspace-review-view",
        assignmentId: "assignment-review",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:03.000Z",
      }),
    ).resolves.toBeNull();

    await restarted.releaseAssignment({
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
    });
    await expect(
      restarted.acquire({
        teamId: "team-review",
        missionId: "mission-review",
        workspaceId: "workspace-review-view",
        assignmentId: "assignment-review",
        scope: { kind: "paths", pathPrefixes: ["packages/server/src"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:03.000Z",
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-review" });
  });

  test("atomically transfers a report hold to its recovery Assignment across restarts", async () => {
    const first = createStore(rootDirectory);
    const source = await first.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!source) throw new Error("Expected the source lease to be acquired");

    const held = await first.transitionToReportHold({
      lease: source,
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [{ path: "packages/server/src/parser.ts", fingerprint: "sha256:parser" }],
    });
    await first.transitionToReportHold({
      lease: { ...held, recoveryAttempts: 2 },
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: held.capturedDelta,
    });

    await expect(
      first.acquire({
        teamId: "team-api",
        missionId: "mission-api",
        workspaceId: "workspace-api-view",
        assignmentId: "assignment-recovery",
        scope: { kind: "paths", pathPrefixes: ["packages/server"] },
        priority: 100,
        createdAt: "2026-08-08T12:00:03.000Z",
      }),
    ).resolves.toBeNull();

    const transfer = {
      leaseId: held.leaseId,
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      sourceAssignmentId: "assignment-api",
      replacementAssignmentId: "assignment-recovery",
    };
    const transferred = await first.transferReportHold(transfer);
    expect(transferred).toEqual({
      ...held,
      assignmentId: "assignment-recovery",
      recoveryAttempts: 2,
    });

    const restarted = createStore(rootDirectory);
    await expect(restarted.transferReportHold(transfer)).resolves.toEqual(transferred);
    const claimed = await restarted.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-recovery",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 100,
      createdAt: "2026-08-08T12:00:03.000Z",
    });
    expect(claimed).toEqual({
      ...transferred,
      state: "execution",
      transitionedAt: null,
      capturedDelta: [],
      recoveryAttempts: 0,
    });
    await expect(createStore(rootDirectory).transferReportHold(transfer)).resolves.toEqual(claimed);
    if (!claimed) throw new Error("Expected the replacement to claim its transferred hold");
    await restarted.release(claimed);
    await expect(createStore(rootDirectory).transferReportHold(transfer)).resolves.toEqual(claimed);
    await expect(
      restarted.acquire({
        teamId: "team-next",
        missionId: "mission-next",
        workspaceId: "workspace-next-view",
        assignmentId: "assignment-next",
        scope: { kind: "paths", pathPrefixes: ["packages/server"] },
        priority: 1,
        createdAt: "2026-08-08T12:00:04.000Z",
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-next" });
  });

  test("replays every report-hold transfer after A to B to C claims, releases, and restarts", async () => {
    const acquireInput = {
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      scope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    };
    const first = createStore(rootDirectory);
    const a = await first.acquire({ ...acquireInput, assignmentId: "assignment-a" });
    if (!a) throw new Error("Expected Assignment A to acquire the scope");
    const heldA = await first.transitionToReportHold({
      lease: a,
      transitionedAt: "2026-08-08T12:00:01.000Z",
      capturedDelta: [],
    });
    const transferAB = {
      leaseId: heldA.leaseId,
      teamId: acquireInput.teamId,
      missionId: acquireInput.missionId,
      workspaceId: acquireInput.workspaceId,
      sourceAssignmentId: "assignment-a",
      replacementAssignmentId: "assignment-b",
    };
    await first.transferReportHold(transferAB);

    const afterABRestart = createStore(rootDirectory);
    await expect(afterABRestart.transferReportHold(transferAB)).resolves.toMatchObject({
      assignmentId: "assignment-b",
      capturedDelta: [],
    });
    const b = await afterABRestart.acquire({ ...acquireInput, assignmentId: "assignment-b" });
    if (!b) throw new Error("Expected Assignment B to claim the transferred scope");
    await afterABRestart.transitionToReportHold({
      lease: b,
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [],
    });
    const transferBC = {
      ...transferAB,
      sourceAssignmentId: "assignment-b",
      replacementAssignmentId: "assignment-c",
    };
    await afterABRestart.transferReportHold(transferBC);

    const afterBCRestart = createStore(rootDirectory);
    await expect(afterBCRestart.transferReportHold(transferAB)).resolves.toMatchObject({
      assignmentId: "assignment-c",
    });
    await expect(afterBCRestart.transferReportHold(transferBC)).resolves.toMatchObject({
      assignmentId: "assignment-c",
    });
    await expect(afterBCRestart.transferReportHold(transferAB)).resolves.toMatchObject({
      assignmentId: "assignment-c",
    });

    const c = await afterBCRestart.acquire({ ...acquireInput, assignmentId: "assignment-c" });
    expect(c).toMatchObject({ assignmentId: "assignment-c", state: "execution" });
    if (!c) throw new Error("Expected Assignment C to claim the transferred scope");
    await afterBCRestart.release(c);

    const afterReleaseRestart = createStore(rootDirectory);
    await expect(afterReleaseRestart.transferReportHold(transferAB)).resolves.toMatchObject({
      assignmentId: "assignment-c",
      state: "execution",
    });
    await expect(afterReleaseRestart.transferReportHold(transferBC)).resolves.toMatchObject({
      assignmentId: "assignment-c",
      state: "execution",
    });
  });

  test("rejects transferring an execution lease as a report hold", async () => {
    const store = createStore(rootDirectory);
    const lease = await store.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!lease) throw new Error("Expected the source lease to be acquired");

    await expect(
      store.transferReportHold({
        leaseId: lease.leaseId,
        teamId: "team-api",
        missionId: "mission-api",
        workspaceId: "workspace-api-view",
        sourceAssignmentId: "assignment-api",
        replacementAssignmentId: "assignment-recovery",
      }),
    ).rejects.toThrow("Scope lease lease-1 is not a report hold");
  });

  test("rejects a report-hold transfer from the wrong source Assignment", async () => {
    const store = createStore(rootDirectory);
    const source = await store.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!source) throw new Error("Expected the source lease to be acquired");
    const held = await store.transitionToReportHold({
      lease: source,
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [],
    });

    await expect(
      store.transferReportHold({
        leaseId: held.leaseId,
        teamId: "team-api",
        missionId: "mission-api",
        workspaceId: "workspace-api-view",
        sourceAssignmentId: "assignment-other",
        replacementAssignmentId: "assignment-recovery",
      }),
    ).rejects.toThrow("Report hold lease-1 is not owned by Assignment assignment-other");
  });

  test.each([
    ["Team", { teamId: "team-other" }],
    ["Mission", { missionId: "mission-other" }],
    ["workspace", { workspaceId: "workspace-other-view" }],
  ])("rejects a report-hold transfer replay from a different %s", async (_label, override) => {
    const store = createStore(rootDirectory);
    const source = await store.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!source) throw new Error("Expected the source lease to be acquired");
    const held = await store.transitionToReportHold({
      lease: source,
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [],
    });
    const transfer = {
      leaseId: held.leaseId,
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      sourceAssignmentId: "assignment-api",
      replacementAssignmentId: "assignment-recovery",
    };
    await store.transferReportHold(transfer);

    await expect(
      createStore(rootDirectory).transferReportHold({ ...transfer, ...override }),
    ).rejects.toThrow("Report hold lease-1 belongs to a different Team Mission workspace");
  });

  test("classifies current, external, and unowned paths across workspace views", async () => {
    const store = createStore(rootDirectory);
    await store.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    await store.acquire({
      teamId: "team-app",
      missionId: "mission-app",
      workspaceId: "workspace-app-view",
      assignmentId: "assignment-app",
      scope: { kind: "paths", pathPrefixes: ["packages/app"] },
      priority: 10,
      createdAt: NOW,
    });

    await expect(
      store.classifyPathOwnership({
        workspaceId: "workspace-api-view",
        assignmentId: "assignment-api",
        path: "packages/server/api.ts",
        intervalStartedAt: NOW,
        intervalEndedAt: NOW,
      }),
    ).resolves.toBe("current");
    await expect(
      store.classifyPathOwnership({
        workspaceId: "workspace-api-view",
        assignmentId: "assignment-api",
        path: "packages/app/screen.tsx",
        intervalStartedAt: NOW,
        intervalEndedAt: NOW,
      }),
    ).resolves.toBe("external");
    await expect(
      store.classifyPathOwnership({
        workspaceId: "workspace-api-view",
        assignmentId: "assignment-api",
        path: "docs/notes.md",
        intervalStartedAt: NOW,
        intervalEndedAt: NOW,
      }),
    ).resolves.toBe("unowned");
  });

  test("keeps a released scope queryable as historical ownership during another Assignment capture", async () => {
    let now = NOW;
    const first = createStore(rootDirectory, () => now);
    const apiLease = await first.acquire({
      teamId: "team-api",
      missionId: "mission-api",
      workspaceId: "workspace-api-view",
      assignmentId: "assignment-api",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!apiLease) throw new Error("Expected the API lease to be acquired");

    now = "2026-08-08T12:00:01.000Z";
    await first.release(apiLease);

    now = "2026-08-08T12:00:02.000Z";
    const restarted = createStore(rootDirectory, () => now);
    const appLease = await restarted.acquire({
      teamId: "team-app",
      missionId: "mission-app",
      workspaceId: "workspace-app-view",
      assignmentId: "assignment-app",
      scope: { kind: "paths", pathPrefixes: ["packages/app"] },
      priority: 10,
      createdAt: "2026-08-08T12:00:01.000Z",
    });
    if (!appLease) throw new Error("Expected the App lease to be acquired");

    await expect(
      restarted.classifyPathOwnership({
        workspaceId: "workspace-app-view",
        assignmentId: "assignment-app",
        path: "packages/server/src/parser.ts",
        intervalStartedAt: "2026-08-08T11:59:59.000Z",
        intervalEndedAt: "2026-08-08T12:00:02.000Z",
      }),
    ).resolves.toBe("external");

    await expect(
      restarted.classifyPathOwnership({
        workspaceId: "workspace-app-view",
        assignmentId: "assignment-app",
        path: "packages/server/src/parser.ts",
        intervalStartedAt: "2026-08-08T12:00:01.001Z",
        intervalEndedAt: "2026-08-08T12:00:02.000Z",
      }),
    ).resolves.toBe("unowned");
  });

  test("preserves historical intervals and the stable queue while moving a lease to report hold", async () => {
    let now = NOW;
    const store = createStore(rootDirectory, () => now);
    const historical = await store.acquire({
      teamId: "team-history",
      missionId: "mission-history",
      workspaceId: "workspace-history-view",
      assignmentId: "assignment-history",
      scope: { kind: "paths", pathPrefixes: ["packages/history"] },
      priority: 1,
      createdAt: NOW,
    });
    const holder = await store.acquire({
      teamId: "team-holder",
      missionId: "mission-holder",
      workspaceId: "workspace-holder-view",
      assignmentId: "assignment-holder",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 1,
      createdAt: NOW,
    });
    const reportHold = await store.acquire({
      teamId: "team-report",
      missionId: "mission-report",
      workspaceId: "workspace-report-view",
      assignmentId: "assignment-report",
      scope: { kind: "paths", pathPrefixes: ["packages/app"] },
      priority: 1,
      createdAt: NOW,
    });
    if (!historical || !holder || !reportHold)
      throw new Error("Expected all leases to be acquired");

    await expect(
      store.acquire({
        teamId: "team-high",
        missionId: "mission-high",
        workspaceId: "workspace-high-view",
        assignmentId: "assignment-high",
        scope: { kind: "paths", pathPrefixes: ["packages/server"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:01.000Z",
      }),
    ).resolves.toBeNull();
    now = "2026-08-08T12:00:01.000Z";
    await store.release(historical);
    await store.transitionToReportHold({
      lease: reportHold,
      transitionedAt: now,
      capturedDelta: [],
    });
    await store.release(holder);

    await expect(
      store.classifyPathOwnership({
        workspaceId: "workspace-report-view",
        assignmentId: "assignment-report",
        path: "packages/history/result.ts",
        intervalStartedAt: "2026-08-08T11:59:59.000Z",
        intervalEndedAt: "2026-08-08T12:00:02.000Z",
      }),
    ).resolves.toBe("external");
    await expect(
      store.acquire({
        teamId: "team-low",
        missionId: "mission-low",
        workspaceId: "workspace-low-view",
        assignmentId: "assignment-low",
        scope: { kind: "paths", pathPrefixes: ["packages/server"] },
        priority: 10,
        createdAt: "2026-08-08T12:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  test("queues conflicting Assignments by priority, creation time, and assignment ID", async () => {
    const store = createStore(rootDirectory);
    const holder = await store.acquire({
      teamId: "team-holder",
      missionId: "mission-holder",
      workspaceId: "workspace-holder-view",
      assignmentId: "assignment-holder",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 1,
      createdAt: NOW,
    });
    if (!holder) throw new Error("Expected the holder lease to be acquired");

    const contenders = [
      {
        teamId: "team-later",
        missionId: "mission-later",
        workspaceId: "workspace-later-view",
        assignmentId: "assignment-later",
        scope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:03.000Z",
      },
      {
        teamId: "team-zeta",
        missionId: "mission-zeta",
        workspaceId: "workspace-zeta-view",
        assignmentId: "assignment-zeta",
        scope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:02.000Z",
      },
      {
        teamId: "team-alpha",
        missionId: "mission-alpha",
        workspaceId: "workspace-alpha-view",
        assignmentId: "assignment-alpha",
        scope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:02.000Z",
      },
      {
        teamId: "team-low",
        missionId: "mission-low",
        workspaceId: "workspace-low-view",
        assignmentId: "assignment-low",
        scope: { kind: "paths" as const, pathPrefixes: ["packages/server"] },
        priority: 10,
        createdAt: "2026-08-08T12:00:01.000Z",
      },
    ];

    for (const contender of contenders) {
      await expect(store.acquire(contender)).resolves.toBeNull();
    }

    await store.release(holder);
    for (const contender of contenders.slice(0, 2)) {
      await expect(store.acquire(contender)).resolves.toBeNull();
    }

    const alpha = await store.acquire(contenders[2]!);
    expect(alpha).toMatchObject({ assignmentId: "assignment-alpha" });
    if (!alpha) throw new Error("Expected the alpha lease to be acquired");

    await store.release(alpha);
    const zeta = await store.acquire(contenders[1]!);
    expect(zeta).toMatchObject({ assignmentId: "assignment-zeta" });
    if (!zeta) throw new Error("Expected the zeta lease to be acquired");

    await store.release(zeta);
    const later = await store.acquire(contenders[0]!);
    expect(later).toMatchObject({ assignmentId: "assignment-later" });
    if (!later) throw new Error("Expected the later lease to be acquired");

    await store.release(later);
    await expect(store.acquire(contenders[3]!)).resolves.toMatchObject({
      assignmentId: "assignment-low",
    });
  });

  test("releases terminal Mission execution, report-hold, and queued attention leases persistently and idempotently", async () => {
    const first = createStore(rootDirectory);
    const execution = await first.acquire({
      teamId: "team-terminal",
      missionId: "mission-terminal",
      workspaceId: "workspace-terminal-view",
      assignmentId: "assignment-execution",
      scope: { kind: "paths", pathPrefixes: ["packages/server"] },
      priority: 10,
      createdAt: NOW,
    });
    const reportHold = await first.acquire({
      teamId: "team-terminal",
      missionId: "mission-terminal",
      workspaceId: "workspace-terminal-view",
      assignmentId: "assignment-report-hold",
      scope: { kind: "paths", pathPrefixes: ["packages/app"] },
      priority: 10,
      createdAt: NOW,
    });
    if (!execution || !reportHold)
      throw new Error("Expected terminal Mission leases to be acquired");

    await first.transitionToReportHold({
      lease: reportHold,
      transitionedAt: "2026-08-08T12:00:02.000Z",
      capturedDelta: [],
    });

    const blocker = await first.acquire({
      teamId: "team-blocker",
      missionId: "mission-blocker",
      workspaceId: "workspace-blocker-view",
      assignmentId: "assignment-blocker",
      scope: { kind: "paths", pathPrefixes: ["packages/desktop"] },
      priority: 1,
      createdAt: NOW,
    });
    if (!blocker) throw new Error("Expected the blocker lease to be acquired");
    await expect(
      first.acquire({
        teamId: "team-terminal",
        missionId: "mission-terminal",
        workspaceId: "workspace-terminal-view",
        assignmentId: "assignment-attention",
        scope: { kind: "paths", pathPrefixes: ["packages/desktop"] },
        priority: 20,
        createdAt: "2026-08-08T12:00:02.000Z",
      }),
    ).resolves.toBeNull();

    await first.releaseMission({ missionId: "mission-terminal" });
    await expect(first.releaseMission({ missionId: "mission-terminal" })).resolves.toBeUndefined();
    await first.release(blocker);

    const restarted = createStore(rootDirectory);
    await expect(
      restarted.acquire({
        teamId: "team-successor",
        missionId: "mission-successor",
        workspaceId: "workspace-successor-view",
        assignmentId: "assignment-successor-server",
        scope: { kind: "paths", pathPrefixes: ["packages/server"] },
        priority: 10,
        createdAt: "2026-08-08T12:00:03.000Z",
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-successor-server" });
    await expect(
      restarted.acquire({
        teamId: "team-successor",
        missionId: "mission-successor",
        workspaceId: "workspace-successor-view",
        assignmentId: "assignment-successor-app",
        scope: { kind: "paths", pathPrefixes: ["packages/app"] },
        priority: 10,
        createdAt: "2026-08-08T12:00:03.000Z",
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-successor-app" });
    await expect(
      restarted.acquire({
        teamId: "team-successor",
        missionId: "mission-successor",
        workspaceId: "workspace-successor-view",
        assignmentId: "assignment-successor-desktop",
        scope: { kind: "paths", pathPrefixes: ["packages/desktop"] },
        priority: 10,
        createdAt: "2026-08-08T12:00:03.000Z",
      }),
    ).resolves.toMatchObject({ assignmentId: "assignment-successor-desktop" });
  });
});

function createStore(directory: string, now: () => string = () => NOW) {
  return new WorkspaceScopeLeaseStore({
    filePath: join(directory, "scope-leases.json"),
    resolveWorkspaceIdentity: async () => "/workspaces/shared",
    clock: { now },
    ids: { next: () => "lease-1" },
  });
}
