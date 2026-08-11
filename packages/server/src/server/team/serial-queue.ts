/**
 * Runs tasks one at a time, in the order they were handed over, without making
 * the caller wait for any of them.
 *
 * For a subscriber to an event stream whose emitter awaits its listeners: the
 * listener has to return immediately, or the operation that fired the event
 * waits on work that may need the lock that operation is holding. But the
 * events still have to be handled in order — archive then unarchive is a member
 * that is back, and handling them concurrently ends wherever the reads happen
 * to finish.
 */
export interface SerialQueue {
  /** Queues a task. Returns immediately; failures go to `onError`. */
  push(task: () => Promise<void>): void;
  /** Resolves once everything queued so far has run. */
  drained(): Promise<void>;
}

/**
 * Chains one task behind another, keeping the chain alive whatever the task
 * does. Swallowed on purpose: one task that fails must not stop the ones behind
 * it, and there is no caller left to tell.
 */
async function runAfter(
  previous: Promise<void>,
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  await previous;
  try {
    await task();
  } catch (error) {
    onError(error);
  }
}

export function createSerialQueue(onError: (error: unknown) => void): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(task) {
      tail = runAfter(tail, task, onError);
    },
    drained() {
      return tail;
    },
  };
}
