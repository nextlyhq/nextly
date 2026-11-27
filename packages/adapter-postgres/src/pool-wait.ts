/**
 * The bounded wait for a pooled connection, reported as the adapters' own
 * "pool wait timeout" error.
 *
 * pg-pool already bounds the wait: a request that finds every connection in
 * use waits at most `connectionTimeoutMillis`, then is removed from the queue
 * and fails. It fails with a plain `Error` that has no code, though, so
 * nothing downstream could tell it from any other driver failure, and a
 * caller got an internal error for a database that was only busy. This gives
 * that one failure the code core answers with "database busy".
 *
 * Only the wait for a connection already in the pool: a new connection that
 * cannot be opened in time is pg-pool's other timeout ("Connection terminated
 * due to connection timeout"), a database that cannot be reached rather than
 * one that is busy, and stays as it was.
 */
import {
  type AdapterLogger,
  poolWaitTimedOut,
} from "@nextlyhq/adapter-drizzle/types";
import type { Pool, PoolClient } from "pg";

/**
 * pg-pool's message for a request that waited its bound in the queue. The
 * error carries nothing else to recognise it by; the pool-wait integration
 * test runs against the installed pg-pool, so a reworded message fails there.
 */
const QUEUE_WAIT_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

type ConnectCallback = (
  err: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void
) => void;

/**
 * The error a caller should see for one pg-pool raised: the queue wait
 * timeout is logged (`poolWaitTimedOut`) and given the adapters' own code.
 */
function translated(
  error: Error,
  boundMs: number,
  logger: AdapterLogger | undefined
): Error {
  if (error.message === QUEUE_WAIT_TIMEOUT_MESSAGE) {
    return poolWaitTimedOut(boundMs, { dialect: "PostgreSQL", logger }, error);
  }
  return error;
}

/**
 * Makes `pool` report a request that waited past `boundMs` for a connection
 * with the pool-wait timeout error, logged as a warning on `logger` (the
 * console when there is none), and returns it. `boundMs` is the pool's own
 * `connectionTimeoutMillis`, unset when the pool has none.
 *
 * Replaces the pool's own `connect`, which its `query` also goes through, so
 * every path to a connection reports the same way: the adapter's statements,
 * its transactions, and the Drizzle handle core services query through.
 */
export function reportPoolWaitTimeout(
  pool: Pool,
  boundMs: number | undefined,
  logger?: AdapterLogger
): Pool {
  const bound = boundMs ?? 0;
  const connect = pool.connect.bind(pool) as (
    callback?: ConnectCallback
  ) => Promise<PoolClient> | void;
  const bounded = (callback?: ConnectCallback) => {
    if (callback) {
      return connect((err, client, done) =>
        callback(err && translated(err, bound, logger), client, done)
      );
    }
    return (connect() as Promise<PoolClient>).catch((error: Error) => {
      throw translated(error, bound, logger);
    });
  };
  pool.connect = bounded as Pool["connect"];
  return pool;
}
