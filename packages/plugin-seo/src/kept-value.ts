/**
 * A value read from the database once and kept in this process, for the
 * Proxy's handlers: they run on every page request, so none of them may wait
 * on the database for each one.
 *
 * The first `get` waits for the read; after that the kept value answers at
 * once. Once it is older than `refreshMs` it is read again in the background,
 * the old value answering until the new one arrives, so a change made on
 * another server reaches this one within about that time. `forget` drops it,
 * so the next `get` waits for a fresh read: what this process's own writes
 * call once they have committed, so a change made here applies at once.
 *
 * @module kept-value
 */

/** A value kept in this process, read again as described above. */
export interface KeptValue<T> {
  /** The kept value, read first where there is none. */
  get(): Promise<T>;
  /** Drop the kept value, so the next `get` reads it again. */
  forget(): void;
}

/** A read under way, and the generation of the value it was started for. */
interface Reading<T> {
  generation: number;
  value: Promise<T>;
}

/**
 * Keep what `read` answers, read again in the background once it is older
 * than `refreshMs`. `now` is the clock, replaced by tests.
 */
export function keptValue<T>(
  read: () => Promise<T>,
  refreshMs: number,
  now: () => number = Date.now
): KeptValue<T> {
  // Bumped by `forget`, so a read started before it is never kept after it.
  let generation = 0;
  let kept: { value: T; at: number } | undefined;
  let reading: Reading<T> | undefined;

  /** Read once for the current generation, sharing a read already under way. */
  function readNow(): Promise<T> {
    if (reading !== undefined && reading.generation === generation) {
      return reading.value;
    }
    const started: Reading<T> = { generation, value: read() };
    reading = started;
    started.value.then(
      value => {
        if (started.generation === generation) kept = { value, at: now() };
      },
      () => undefined
    );
    // Cleared whether it answers or fails, so a failed read is tried again.
    void started.value
      .finally(() => {
        if (reading === started) reading = undefined;
      })
      .catch(() => undefined);
    return started.value;
  }

  return {
    async get() {
      const current = kept;
      if (current === undefined) return readNow();
      if (now() - current.at > refreshMs && reading === undefined) {
        // Read again without making this request wait. A read that fails
        // keeps the old value, and is tried again after another interval.
        readNow().catch(() => {
          if (kept === current) kept = { value: current.value, at: now() };
        });
      }
      return current.value;
    },
    forget() {
      generation += 1;
      kept = undefined;
    },
  };
}
