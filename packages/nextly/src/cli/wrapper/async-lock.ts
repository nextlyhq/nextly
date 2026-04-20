// What: minimal async mutex for serializing schema-change operations.
// Why: if the user saves the config twice in 200ms, or saves config at the
// same instant that the admin UI posts a UI-first apply, we must not run
// two DDL operations in parallel. Even with the debouncer on code-first,
// a UI-first apply landing during a code-first prompt window would race.
// This lock queues operations and runs them strictly in the order acquired.

export interface AsyncLock {
  acquire<T>(fn: () => Promise<T>): Promise<T>;
}

export function createAsyncLock(): AsyncLock {
  // The tail of the queue. Each acquire chains onto this promise so the next
  // caller waits for the previous to settle before running its fn.
  let tail: Promise<unknown> = Promise.resolve();

  return {
    acquire<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(() => fn());
      // Swallow rejections on the shared tail so a failed caller does not
      // poison the queue for subsequent callers. Each caller still sees the
      // rejection via `run`.
      tail = run.catch(() => {});
      return run;
    },
  };
}
