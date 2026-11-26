/**
 * Holding a table a migration drops from before the ids of its documents are read until the drop has
 * run, where the unit's own transaction does not: on MySQL, whose schema statements commit the
 * transaction they run in, and in a unit run outside one. So no document another instance stores,
 * or deletes, falls between the two (`retired-documents.ts`).
 *
 * PostgreSQL and SQLite run the capture and the drop in one short transaction. MySQL locks the
 * tables the statement drops, and no other, with `LOCK TABLES`: the drop waits for them anyway, and
 * a lock on a table every save reads would queue each of those behind the wait for it. A session
 * that holds it may read nothing else, so what is captured is stored on a connection of its own,
 * opened beside the pool, which the unit may hold the only connection of.
 *
 * @module domains/schema/migrate/retirement-hold
 */
import { AsyncResource } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
  SupportedDialect,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

import { causeChain } from "../busy-table/ended-waiting";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";

/** The connection a unit's statements run on. */
export interface UnitConnection {
  /** The handle its checkpoints read and write through. */
  db: unknown;
  /** Sends a statement as text, marked as the unit's own. */
  send: (statement: string) => Promise<unknown>;
  /**
   * Told as the statement the tables are held for is sent, or what holds them for it, which commits
   * what the unit's transaction holds as that statement does: a try that ends waiting from then on
   * starts again at the statement, and one that ends before it starts where it would have.
   */
  sending: () => void;
  /** Waits until no cancel the try's watch decided is still to land. */
  idle: () => Promise<void>;
}

/** What runs while the tables are held. */
export type HeldWork = (held: {
  /** Where what is captured is stored. */
  store: unknown;
  /** The handle the tables are read through. */
  read: unknown;
  /** Sends a statement on the connection that holds them. */
  send: (statement: string) => Promise<unknown>;
}) => Promise<void>;

/** Holds tables for a unit's drop of them. */
export interface TableHold {
  /**
   * Runs `work` with `tables` held, each a table that is there. Where they cannot be held, `work`
   * does not run, and the reason is answered.
   */
  holding(
    on: UnitConnection,
    tables: readonly string[],
    work: HeldWork
  ): Promise<string | undefined>;
}

/** MySQL's errors for an account that may not lock the tables. */
const MYSQL_MAY_NOT_LOCK = new Set([1044, 1142]);

/**
 * The hold for a unit on `adapter`. Made before the unit's transaction opens: a session of its own
 * is refused to a flow that is inside one, and what is stored on it is not that transaction's.
 */
export function tableHold(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): TableHold {
  if (dialect === "sqlite") return sqliteHold(adapter);
  if (dialect === "postgresql") return { holding: holdOnPostgres };
  const outside = new AsyncResource("nextly retirement capture");
  let mayLock: Promise<boolean> | undefined;
  return {
    async holding(on, tables, work) {
      mayLock ??= accountMayLock(on.db).catch(() => false);
      if (!(await mayLock)) {
        return "this account has no LOCK TABLES privilege of its own";
      }
      // A connection of its own, beside the pool, for what is captured (`withSession` on MySQL).
      let opened = false;
      try {
        return await outside.runInAsyncScope(() =>
          adapter.withSession(session => {
            opened = true;
            return holdOnMysql(on, tables, handleOn(session), work);
          })
        );
      } catch (error) {
        if (opened) throw error;
        return "no connection could be opened beside the run's own";
      }
    },
  };
}

/** The tables locked by name for `work`, and let go however it ends. */
async function holdOnMysql(
  on: UnitConnection,
  tables: readonly string[],
  store: unknown,
  work: HeldWork
): Promise<string | undefined> {
  on.sending();
  const locks = tables.map(table => `${quoteIdent(table, "mysql")} WRITE`);
  try {
    await on.send(`LOCK TABLES ${locks.join(", ")}`);
  } catch (error) {
    if (
      causeChain(error).some(
        ({ errno }) =>
          typeof errno === "number" && MYSQL_MAY_NOT_LOCK.has(errno)
      )
    ) {
      return "the database refused this account the lock";
    }
    throw error;
  }
  // Let go on the connection that holds them, before a pool hands it to other work: a cancel still
  // to land lands first, and never ends this instead.
  const letGo = async (): Promise<void> => {
    await on.idle();
    await on.send("UNLOCK TABLES");
  };
  try {
    await work({ store, read: on.db, send: on.send });
  } catch (error) {
    await letGo().catch(() => undefined);
    throw error;
  }
  await letGo();
  return undefined;
}

/** The capture and the drop in one transaction on the unit's own session. */
async function holdOnPostgres(
  on: UnitConnection,
  tables: readonly string[],
  work: HeldWork
): Promise<string | undefined> {
  on.sending();
  await on.send("BEGIN");
  try {
    for (const table of tables) {
      await on.send(
        `LOCK TABLE ${quoteIdent(table, "postgresql")} IN ACCESS EXCLUSIVE MODE`
      );
    }
    await work({ store: on.db, read: on.db, send: on.send });
    await assertSchemaLockHeld();
  } catch (error) {
    await on.idle();
    await on.send("ROLLBACK").catch(() => undefined);
    throw error;
  }
  await on.send("COMMIT");
  return undefined;
}

/** The capture and the drop in one transaction, SQLite's one writer. */
function sqliteHold(adapter: DrizzleAdapter): TableHold {
  return {
    async holding(on, _tables, work) {
      on.sending();
      await adapter.transaction(async tx => {
        const db = tx.getDrizzle();
        await work({
          store: db,
          read: db,
          send: statement => tx.execute(statement),
        });
        await assertSchemaLockHeld();
      });
      return undefined;
    },
  };
}

/** A MySQL session as a handle to read and write through. */
function handleOn(session: StatementSession): { execute(query: SQL): unknown } {
  const compiler = new MySqlDialect();
  return {
    execute: async (query: SQL) => {
      const { sql: text, params } = compiler.sqlToQuery(query);
      return [await session.execute(text, params as SqlParam[]), []];
    },
  };
}

/**
 * Whether a grant of the account's own lets it lock a table of the database the connection is on.
 * Asked before any lock: a refused one commits the open transaction. A privilege held only through
 * a role is not seen.
 */
async function accountMayLock(db: unknown): Promise<boolean> {
  const [current] = await querySqlRows<{ name: unknown }>(
    db,
    "mysql",
    sql.raw("SELECT DATABASE() AS name")
  );
  const rows = await querySqlRows<Record<string, unknown>>(
    db,
    "mysql",
    sql.raw("SHOW GRANTS")
  );
  return grantsLock(
    rows.map(row => String(Object.values(row)[0])),
    String(current?.name)
  );
}

/** Whether `grants`, as `SHOW GRANTS` words them, let the account lock a table of `database`. */
export function grantsLock(
  grants: readonly string[],
  database: string
): boolean {
  return grants.some(grant => {
    const read = /^GRANT (.+?) ON (?:\*|([`"])(.+?)\2)\.\* TO /i.exec(grant);
    if (read === null) return false;
    const [, privileges, , pattern] = read;
    if (!/\b(ALL PRIVILEGES|LOCK TABLES)\b/i.test(privileges)) return false;
    return pattern === undefined || namesDatabase(pattern, database);
  });
}

/** Whether a grant's database pattern names `database`: `%` and `_` are wildcards unless escaped. */
function namesDatabase(pattern: string, database: string): boolean {
  const source = pattern.replace(
    /\\([%_])|([%_])|([\\.*+?^${}()|[\]])/g,
    (_all, escaped?: string, wildcard?: string, special?: string) => {
      if (escaped !== undefined) return escaped;
      if (wildcard !== undefined) return wildcard === "%" ? ".*" : ".";
      return `\\${String(special)}`;
    }
  );
  return new RegExp(`^${source}$`, "i").test(database);
}
