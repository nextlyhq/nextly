/**
 * The connection a try's watch asks on.
 *
 * The watch must ask on another connection than the session it watches, which is busy running the
 * statement. The adapter's pool gives it one while the pool can spare one. A pool of one cannot:
 * the watched transaction or session holds its only connection for the whole try, so every ask
 * through the pool would wait behind it and the watch would see nothing until the try had ended,
 * leaving only the database's per-lock timeout to bound a try that waits for several locks in
 * turn. On such a pool the watch opens one connection of its own beside the pool, as the schema
 * lock's renewals do, and closes it when it stops.
 *
 * @module domains/schema/busy-table/watch-connection
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
} from "@nextlyhq/adapter-drizzle/types";
import type { SQL } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";

/** What `pg_stat_activity` names the watch's own connection, so an operator can tell what it is. */
export const WATCH_APPLICATION_NAME = "nextly busy-table watch";

/** The default pool sizes of node-postgres and mysql2, used where a pool does not state one. */
const PG_DEFAULT_POOL_MAX = 10;
const MYSQL_DEFAULT_CONNECTION_LIMIT = 10;

/** Where the watch's asks go, and how it is let go. */
export interface WatchConnection {
  /** Runs one statement and returns its rows. */
  query<T>(statement: SQL): Promise<T[]>;
  /** Closes a connection of the watch's own; nothing for the pool. Never throws. */
  close(): Promise<void>;
}

/** node-postgres's pool, as far as a connection beside it needs. */
interface PgPoolLike {
  options?: { max?: number };
  Client?: new (options: unknown) => {
    connect(): Promise<void>;
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
    end(): Promise<void>;
    on(event: "error", listener: (error: unknown) => void): unknown;
  };
}

/** mysql2's pool, as far as its size needs. */
interface MysqlPoolLike {
  config?: { connectionLimit?: number };
}

/**
 * The driver's pool behind the adapter: node-postgres's or mysql2's. Undefined where the adapter
 * has none to show (not connected, or a stand-in), and the pool is then taken at its default size.
 */
function driverPool(adapter: DrizzleAdapter): unknown {
  try {
    return adapter.getDrizzle<{ $client?: unknown }>().$client;
  } catch {
    return undefined;
  }
}

/**
 * Whether the adapter's pool can spare a connection beside the one the watched try holds: two or
 * more. A pool whose size cannot be read is taken at its driver's default, as the driver does.
 */
export function poolCanSpareOne(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): boolean {
  const pool = driverPool(adapter);
  if (dialect === "postgresql") {
    return (
      ((pool as PgPoolLike | undefined)?.options?.max ?? PG_DEFAULT_POOL_MAX) >=
      2
    );
  }
  if (dialect === "mysql") {
    return (
      ((pool as MysqlPoolLike | undefined)?.config?.connectionLimit ??
        MYSQL_DEFAULT_CONNECTION_LIMIT) >= 2
    );
  }
  // SQLite's watch asks nothing.
  return true;
}

/** The adapter's own pool, used where it can spare a connection. */
function poolConnection(adapter: DrizzleAdapter): WatchConnection {
  return {
    query: <T>(statement: SQL) => adapter.queryStatement<T>(statement),
    close: () => Promise.resolve(),
  };
}

/**
 * The connection the watch asks on: the adapter's pool where it can spare a connection, else one
 * of the watch's own. Where that connection cannot be opened (a refused login, a driver this does
 * not know) the pool is used, as before: the try's per-lock timeout still bounds each wait.
 *
 * Opened from the watch's own loop, which started before the try's transaction opened, so the
 * MySQL session it opens is never refused as one asked for inside a transaction.
 */
export async function openWatchConnection(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<WatchConnection> {
  const pool = poolConnection(adapter);
  if (poolCanSpareOne(adapter, dialect)) return pool;
  try {
    if (dialect === "postgresql") {
      return (await openPostgresWatch(driverPool(adapter), pool)) ?? pool;
    }
    if (dialect === "mysql") return (await openMysqlWatch(adapter)) ?? pool;
  } catch {
    // Falls through to the pool, which still answers once the try lets its connection go.
  }
  return pool;
}

/**
 * A PostgreSQL connection beside the pool, made with the pool's own client class and options so
 * it connects exactly as the pool's connections do, under a name of its own.
 */
async function openPostgresWatch(
  client: unknown,
  pool: WatchConnection
): Promise<WatchConnection | undefined> {
  const pgPool = client as PgPoolLike | undefined;
  if (pgPool?.Client === undefined) return undefined;
  const connection = new pgPool.Client({
    ...pgPool.options,
    application_name: WATCH_APPLICATION_NAME,
  });
  // A connection that drops between asks is reported as an event rather than through a query.
  // Unheard, that event would end the process; heard, the connection is given up and the asks go
  // back through the pool.
  let broken = false;
  connection.on("error", () => {
    broken = true;
  });
  await connection.connect();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const compiler = new PgDialect();
  let closed: Promise<void> | undefined;
  return {
    query: async <T>(statement: SQL): Promise<T[]> => {
      if (broken) return pool.query<T>(statement);
      const compiled = compiler.sqlToQuery(statement);
      return (await connection.query(compiled.sql, compiled.params))
        .rows as T[];
    },
    // Once only, and never failing: a broken connection's end has nothing left to close.
    close: () => {
      closed ??= connection.end().catch(() => undefined);
      return closed;
    },
  };
}

/**
 * A MySQL connection beside the pool: the adapter's `withSession`, which on MySQL opens a
 * connection of its own outside the pool, with the adapter's own settings, and closes it when its
 * work ends. The work here lasts until the watch closes it. Undefined where the session could not
 * be opened, and the watch falls back to the pool.
 */
async function openMysqlWatch(
  adapter: DrizzleAdapter
): Promise<WatchConnection | undefined> {
  const { MySqlDialect } = await import("drizzle-orm/mysql-core");
  const compiler = new MySqlDialect();
  let release: () => void = () => undefined;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let opened: (session: StatementSession | undefined) => void = () => undefined;
  const ready = new Promise<StatementSession | undefined>(resolve => {
    opened = resolve;
  });
  // The session's whole life: opened, handed to the watch, held until `close`. One that ends
  // without having opened, refused or failed, hands over nothing; a later `opened` is ignored.
  const ended = adapter
    .withSession(async session => {
      opened(session);
      await released;
    })
    .catch(() => undefined)
    .finally(() => opened(undefined));
  const session = await ready;
  if (session === undefined) return undefined;
  return {
    query: <T>(statement: SQL) => {
      const compiled = compiler.sqlToQuery(statement);
      return session.execute<T>(compiled.sql, compiled.params as SqlParam[]);
    },
    close: async () => {
      release();
      await ended;
    },
  };
}
