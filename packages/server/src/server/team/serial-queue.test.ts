import { describe, expect, test } from "vitest";

import { createSerialQueue } from "./serial-queue.js";

describe("running queued work one at a time", () => {
  test("runs tasks in the order they were pushed", async () => {
    const order: string[] = [];
    const queue = createSerialQueue(() => {});

    // The first task takes longer than the second. Run concurrently they would
    // finish the other way round, which for a lifecycle event stream means an
    // archive landing after the unarchive that undid it.
    queue.push(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first");
    });
    queue.push(async () => {
      order.push("second");
    });
    await queue.drained();

    expect(order).toEqual(["first", "second"]);
  });

  test("does not make the pusher wait", async () => {
    let ran = false;
    const queue = createSerialQueue(() => {});

    queue.push(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ran = true;
    });

    // The emitter awaits its listeners, and the work queued here may need the
    // lock the emitting operation is holding. Returning at once is what breaks
    // that circle.
    expect(ran).toBe(false);
  });

  test("keeps going after a task fails, and reports it", async () => {
    const order: string[] = [];
    const errors: unknown[] = [];
    const queue = createSerialQueue((error) => errors.push(error));

    queue.push(async () => {
      throw new Error("first blew up");
    });
    queue.push(async () => {
      order.push("second");
    });
    await queue.drained();

    // There is no caller left to throw at, and one failed event must not stop
    // the ones behind it.
    expect(order).toEqual(["second"]);
    expect((errors[0] as Error).message).toBe("first blew up");
  });

  test("drains work queued while it was draining", async () => {
    const order: string[] = [];
    const queue = createSerialQueue(() => {});

    const pushNested = () =>
      queue.push(async () => {
        order.push("nested");
      });
    queue.push(async () => {
      order.push("first");
      pushNested();
    });
    await queue.drained();
    await queue.drained();

    expect(order).toEqual(["first", "nested"]);
  });
});
