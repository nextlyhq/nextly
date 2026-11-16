/**
 * The mysql2 pool as `@vercel/functions`' `attachDatabasePool` is handed it.
 *
 * `attachDatabasePool` recognises a pool by its shape, and neither of mysql2's
 * own objects gives it what it needs:
 *
 * - the promise pool `createPool` returns has no `config`, so it is refused
 *   ("Unsupported database pool type");
 * - the callback pool under it is taken for a `mysql` pool, whose idle timeout
 *   is read from `config.connectionConfig.idleTimeout`. mysql2 keeps that
 *   setting on the pool's own config instead, so the read finds nothing and
 *   falls back to 60 seconds: every release would keep the instance alive for
 *   a minute rather than for the pool's idle timeout.
 *
 * So it is handed the shape its types publish for a mysql2 pool: a
 * `config.idleTimeout` and an `on` for the pool's `release` events, which are
 * the callback pool's, where mysql2 emits them.
 *
 * @module vercel-pool
 */
import { IDLE_SWEEP_INTERVAL_MS } from "./idle-sweep";

/** The part of mysql2's callback pool the view forwards to. */
export interface ReleasingPool {
  on(event: "release", listener: (...args: unknown[]) => void): unknown;
}

/** What `attachDatabasePool` reads of a mysql2 pool. */
export interface VercelPoolView {
  config: { idleTimeout: number };
  on(event: "release", listener: (...args: unknown[]) => void): void;
}

/**
 * `pool` as `attachDatabasePool` reads a mysql2 pool, with the idle timeout it
 * was built with: the function instance then stays alive until the adapter's
 * idle sweep has closed the connections a request left idle. The sweep closes
 * one up to `IDLE_SWEEP_INTERVAL_MS` after its timeout has passed, so the
 * instance is kept alive for that long as well.
 */
export function vercelPoolView(
  pool: ReleasingPool,
  idleTimeoutMs: number
): VercelPoolView {
  return {
    config: { idleTimeout: idleTimeoutMs + IDLE_SWEEP_INTERVAL_MS },
    on: (event, listener) => {
      pool.on(event, listener);
    },
  };
}
