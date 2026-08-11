import { describe, expect, test } from "vitest";

import {
  TeamOperationCoordinator,
  type TeamOperationPermit,
} from "./team-operation-coordinator.js";

describe("TeamOperationCoordinator", () => {
  test("allows a nested operation for the same Team without releasing the outer lock", async () => {
    const coordinator = new TeamOperationCoordinator();
    const events: string[] = [];
    const recordInner = async () => {
      events.push("inner");
    };
    const runOuter = async (permit: TeamOperationPermit) => {
      events.push("outer:start");
      await coordinator.serialize("team-1", recordInner, permit);
      events.push("outer:end");
    };

    await coordinator.serialize("team-1", runOuter);

    expect(events).toEqual(["outer:start", "inner", "outer:end"]);
  });

  test("keeps an unrelated caller queued until the reentrant operation finishes", async () => {
    const coordinator = new TeamOperationCoordinator();
    const events: string[] = [];
    let releaseOuter: (() => void) | null = null;
    const outerGate = new Promise<void>((resolve) => {
      releaseOuter = resolve;
    });
    let outerEntered: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      outerEntered = resolve;
    });
    const recordInner = async () => {
      events.push("inner");
    };
    const runOuter = async (permit: TeamOperationPermit) => {
      events.push("outer:start");
      outerEntered?.();
      await coordinator.serialize("team-1", recordInner, permit);
      await outerGate;
      events.push("outer:end");
    };

    const outer = coordinator.serialize("team-1", runOuter);
    await entered;
    const queued = coordinator.serialize("team-1", async () => {
      events.push("queued");
    });

    await Promise.resolve();
    expect(events).toEqual(["outer:start", "inner"]);
    releaseOuter?.();
    await Promise.all([outer, queued]);
    expect(events).toEqual(["outer:start", "inner", "outer:end", "queued"]);
  });

  test("queues a detached operation created inside the current Team operation", async () => {
    const coordinator = new TeamOperationCoordinator();
    const events: string[] = [];
    let releaseOuter: (() => void) | null = null;
    const outerGate = new Promise<void>((resolve) => {
      releaseOuter = resolve;
    });
    let detached: Promise<void> | null = null;
    const recordDetached = async () => {
      events.push("detached");
    };
    const startDetached = () => coordinator.serialize("team-1", recordDetached);

    const outer = coordinator.serialize("team-1", async () => {
      events.push("outer:start");
      detached = Promise.resolve().then(startDetached);
      await Promise.resolve();
      expect(events).toEqual(["outer:start"]);
      await outerGate;
      events.push("outer:end");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["outer:start"]);
    releaseOuter?.();
    await outer;
    await detached;
    expect(events).toEqual(["outer:start", "outer:end", "detached"]);
  });
});
