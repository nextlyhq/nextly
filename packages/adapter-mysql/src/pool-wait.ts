/**
 * The bounded wait for a pooled connection.
 *
 * mysql2 has no such bound. A request that finds every connection in use is
 * queued until one is released, however long that takes, so a database that
 * stays busy holds every request behind it indefinitely. This bounds the wait
 * the way pg-pool's `connectionTimeoutMillis` does: past the bound, the
 * request fails with the adapters' own pool-wait timeout error, which core
 * answers with "database busy".
 *
 * Only the wait in the queue: a request that opens a new connection is bounded
 * by mysql2's `connectTimeout` instead, set from the same setting, and a
 * connection that cannot be opened is a database that cannot be reached
 * rather than one that is busy.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";

/** A connection the pool hands out, as far as the bound needs one. */
interface QueuedConnection {
  release(): void;
}

type GetConnectionCallback = (
  err: Error | null,
  connection?: QueuedConnection
) => void;

/**
 * The part of mysql2's callback pool the bound uses. Declared here because
 * mysql2's mixin typings drop the EventEmitter methods its pool has.
 */
export interface QueueingPool {
  getConnection(callback: GetConnectionCallback): void;
  once(event: "enqueue", listener: () => void): unknown;
  removeListener(event: "enqueue", listener: () => void): unknown;
}

/**
 * Makes `pool` fail a request that has waited `boundMs` in its queue for a
 * connection, and returns it. A bound of 0 leaves the wait unbounded, as
 * pg-pool reads a `connectionTimeoutMillis` of 0.
 *
 * Replaces the pool's own `getConnection`, which its `query` and `execute`
 * go through, so every path to a connection is bounded: the adapter's
 * statements, its transactions, and the Drizzle handle core services query
 * through.
 *
 * mysql2 keeps a timed-out request in its queue, so the connection it is
 * eventually handed is released straight back rather than held by a request
 * that has already failed.
 */
export function boundPoolWait<P extends QueueingPool>(
  pool: P,
  boundMs: number
): P {
  if (boundMs <= 0) return pool;
  const getConnection = pool.getConnection.bind(pool);
  const bounded = (callback: GetConnectionCallback) => {
    let answered = false;
    // Set only once the request has queued; read by the answer that ends it.
    const wait: { timer?: ReturnType<typeof setTimeout> } = {};
    // mysql2 emits `enqueue` synchronously, inside this call, exactly when
    // the request joins the queue rather than taking or opening a connection.
    let queued = false;
    const onEnqueue = () => (queued = true);
    pool.once("enqueue", onEnqueue);
    getConnection((err, connection) => {
      if (answered) {
        connection?.release();
        return;
      }
      answered = true;
      clearTimeout(wait.timer);
      callback(err, connection);
    });
    pool.removeListener("enqueue", onEnqueue);
    if (!queued || answered) return;
    wait.timer = setTimeout(() => {
      answered = true;
      callback(poolWaitTimeoutError(boundMs));
    }, boundMs);
  };
  pool.getConnection = bounded;
  return pool;
}
