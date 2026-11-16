/**
 * Closing the pool's idle connections: those idle past `pool.idleTimeoutMs`,
 * down to `pool.min`, as pg-pool's `idleTimeoutMillis` and `min` do on
 * PostgreSQL.
 *
 * mysql2's own idle closing cannot keep a minimum. It runs only while
 * `maxIdle` is below `connectionLimit` (mysql2 defaults `maxIdle` to the
 * limit, so by default it never runs and every idle connection stays open),
 * and once running it closes EVERY connection idle past `idleTimeout`, and
 * any idle beyond `maxIdle` within a second, timeout or not. Setting
 * `maxIdle` from `min` would therefore close the connections above `min`
 * almost as soon as they are idle, and close `min` itself after the timeout.
 *
 * So the adapter leaves mysql2's sweep off (`maxIdle` equal to the limit) and
 * runs this one instead. Like pg-pool, it never opens connections to reach
 * `min`: `min` is how many of the connections the pool has opened it keeps.
 *
 * It reads the callback pool's queues, as the pool statistics and the bounded
 * pool wait do, since mysql2 has no public API for them.
 *
 * @module idle-sweep
 */

/** A pooled connection, as far as closing an idle one needs it. */
interface IdleConnection {
  /** When it was last released to the pool, in ms since the epoch. */
  lastActiveTime: number;
  /** Closes it and takes it out of the pool's queues. */
  destroy(): void;
}

/**
 * The part of mysql2's callback pool the sweep reads. Declared here because
 * mysql2's typings do not publish these.
 */
export interface SweepablePool {
  /** Set once `end()` has been called. */
  _closed?: boolean;
  /** Every connection the pool holds, idle or checked out. */
  _allConnections?: { length: number };
  /**
   * The idle connections, least recently released first: a release pushes
   * onto the end and a checkout pops from it.
   */
  _freeConnections?: {
    length: number;
    get?(index: number): IdleConnection | undefined;
  };
}

/** What the sweep keeps and for how long. */
export interface IdleSweepOptions {
  /** Connections kept open however long they are idle. */
  min: number;
  /** How long a connection above `min` may stay idle; 0 keeps them all. */
  idleTimeoutMs: number;
}

/**
 * How often the sweep looks for connections past their timeout. One closes up
 * to this long after its timeout has passed, as with mysql2's own sweep.
 */
export const IDLE_SWEEP_INTERVAL_MS = 1000;

/** Closes the connections in `pool` idle past the timeout, oldest first, down to `min`. */
function closeIdle(pool: SweepablePool, options: IdleSweepOptions): void {
  const free = pool._freeConnections;
  const all = pool._allConnections;
  if (!free || !all || typeof free.get !== "function") return;
  const now = Date.now();
  while (free.length > 0 && all.length > options.min) {
    const oldest = free.get(0);
    if (!oldest || now - oldest.lastActiveTime <= options.idleTimeoutMs) {
      return;
    }
    const before = free.length;
    oldest.destroy();
    // A connection `destroy` did not take out of the queue would be met
    // again on every pass of this loop.
    if (free.length >= before) return;
  }
}

/**
 * Starts closing `pool`'s idle connections as `options` says, and returns
 * what stops it. An idle timeout of 0 or less keeps every idle connection
 * open, as pg-pool reads an `idleTimeoutMillis` of 0, and starts nothing.
 *
 * The timer never keeps the process alive by itself, and stops on its own
 * once the pool has ended.
 */
export function sweepIdleConnections(
  pool: SweepablePool,
  options: IdleSweepOptions
): () => void {
  if (!(options.idleTimeoutMs > 0)) return () => {};
  const timer = setInterval(() => {
    if (pool._closed) {
      clearInterval(timer);
      return;
    }
    closeIdle(pool, options);
  }, IDLE_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
