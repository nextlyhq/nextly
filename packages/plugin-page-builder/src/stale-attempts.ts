/**
 * The bounded loop every write made from a read runs when it is refused as
 * made from a replaced version: read again, make the change on what is
 * stored now, at most {@link STALE_WRITE_ATTEMPTS} times in all.
 *
 * Isomorphic on purpose. The server's routes recognise the refusal as a
 * `NextlyError` (`stale-retry`), the editor as the admin's transport error,
 * so each hands in its own recogniser and both run this one loop: one answer
 * to how many tries a write gets and which read each is made on.
 *
 * @module stale-attempts
 */

/**
 * How many times, in all, a write made from a read is tried before its
 * refusal as stale is the answer.
 */
export const STALE_WRITE_ATTEMPTS = 3;

/** How the loop is run beyond the read and the attempt. */
export interface StaleAttemptOptions<TRead> {
  /** Whether a failure is the refusal of a write made from a replaced version. */
  readonly isStale: (error: unknown) => boolean;
  /** A read already in hand, used for the first try instead of reading again. */
  readonly first?: { readonly read: TRead };
  /** Told of each stale refusal before the next read, the last one included. */
  readonly onStale?: (error: unknown) => void;
}

/**
 * Run `attempt` on a read, and on a fresh `read` each time it throws a stale
 * refusal, at most {@link STALE_WRITE_ATTEMPTS} times in all. `attempt` makes
 * its checks and its change on the read it is handed, so each try is judged
 * on what is stored then. After the last try the stale refusal is thrown: it
 * is true, the document kept changing. Any other failure is thrown at once,
 * since it may have committed or would fail the same way.
 */
export async function attemptUntilFresh<TRead, TResult>(
  read: () => Promise<TRead>,
  attempt: (read: TRead) => Promise<TResult>,
  options: StaleAttemptOptions<TRead>
): Promise<TResult> {
  let current = options.first === undefined ? await read() : options.first.read;
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt(current);
    } catch (error) {
      if (!options.isStale(error)) throw error;
      options.onStale?.(error);
      if (tried >= STALE_WRITE_ATTEMPTS) throw error;
      current = await read();
    }
  }
}
