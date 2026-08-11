import path from "node:path";
import { describe, expect, test } from "vitest";

import { WorkspaceLifecycleCoordinator } from "./workspace-lifecycle-coordinator.js";

describe("WorkspaceLifecycleCoordinator", () => {
  test("lets a winning start finish before archive preparation runs", async () => {
    const coordinator = new WorkspaceLifecycleCoordinator();
    const events: string[] = [];
    let releaseStart!: () => void;
    let markStartEntered!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const startEntered = new Promise<void>((resolve) => {
      markStartEntered = resolve;
    });
    const start = coordinator.serialize(["workspace-b"], async () => {
      events.push("start-entered");
      markStartEntered();
      await startGate;
      events.push("start-finished");
    });
    await startEntered;
    const unregister = coordinator.registerArchivePreparation(async (workspaceId) => {
      events.push(`prepare:${workspaceId}`);
    });
    const archive = coordinator.serialize(["workspace-b"], async () => {
      await coordinator.prepareForArchive("workspace-b");
      events.push("archive-finished");
    });

    expect(events).toEqual(["start-entered"]);
    releaseStart();
    await Promise.all([start, archive]);
    unregister();

    expect(events).toEqual([
      "start-entered",
      "start-finished",
      "prepare:workspace-b",
      "archive-finished",
    ]);
  });

  test("acquires multiple workspace fences in stable order", async () => {
    const coordinator = new WorkspaceLifecycleCoordinator();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const first = coordinator.serialize(["workspace-a", "workspace-b"], async () => {
      events.push("first-entered");
      markFirstEntered();
      await firstGate;
    });
    await firstEntered;
    const second = coordinator.serialize(["workspace-b", "workspace-a"], async () => {
      events.push("second-entered");
    });

    expect(events).toEqual(["first-entered"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-entered", "second-entered"]);
  });

  test("serializes filesystem-equivalent backing directory spellings", async () => {
    const coordinator = new WorkspaceLifecycleCoordinator();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const canonical = path.join(process.cwd(), "backing-directory-fence");
    const equivalent = path.join(canonical, "..", path.basename(canonical));
    const first = coordinator.serializeBackingDirectories([equivalent], async () => {
      events.push("first-entered");
      markFirstEntered();
      await firstGate;
    });
    await firstEntered;
    const second = coordinator.serializeBackingDirectories([canonical], async () => {
      events.push("second-entered");
    });

    expect(events).toEqual(["first-entered"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-entered", "second-entered"]);
  });
});
