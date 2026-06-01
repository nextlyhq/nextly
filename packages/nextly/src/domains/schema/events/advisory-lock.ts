/**
 * Cross-process schema lock (spec §4.6.2). Wraps a callback so only one
 * process mutates schema bookkeeping at a time.
 *
 * - PostgreSQL: pg_advisory_xact_lock(key) inside a transaction.
 * - MySQL: GET_LOCK(name, timeout) / RELEASE_LOCK(name).
 * - SQLite: single-writer already; run the callback directly. (Do NOT wrap in
 *   db.transaction with an async callback — the better-sqlite3 driver takes a
 *   synchronous transaction callback and will not await an async one.)
 *
 * `db` is typed `unknown` (the schema-domain layer does not leak dialect
 * Drizzle types); each branch casts to the minimal structural shape it needs.
 *
 * @module domains/schema/events/advisory-lock
 * @since v0.0.3-alpha (Plan B)
 */

import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors";

type Dialect = "postgresql" | "mysql" | "sqlite";

/** Stable key derived from a constant string for pg_advisory_lock. */
const LOCK_KEY = 0x6e78746c; // "nxtl"
const LOCK_NAME = "nextly_schema_lock";
const LOCK_TIMEOUT_SECONDS = 10;

export async function withSchemaLock<T>(
  db: unknown,
  dialect: Dialect,
  fn: () => Promise<T>
): Promise<T> {
  switch (dialect) {
    case "postgresql": {
      const pg = db as {
        transaction: (cb: (tx: unknown) => Promise<T>) => Promise<T>;
        execute: (q: unknown) => Promise<unknown>;
      };
      return pg.transaction(async () => {
        await pg.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
        return fn();
      });
    }
    case "mysql": {
      const my = db as { execute: (q: unknown) => Promise<unknown> };
      const rows = (await my.execute(
        sql`SELECT GET_LOCK(${LOCK_NAME}, ${LOCK_TIMEOUT_SECONDS}) AS locked`
      )) as Array<{ locked: number | null }>;
      const locked = rows[0]?.locked;
      if (!locked) {
        throw new NextlyError({
          code: "NEXTLY_UPGRADE_IN_PROGRESS",
          publicMessage:
            "Another schema operation holds the lock. Retry shortly.",
        });
      }
      try {
        return await fn();
      } finally {
        await my.execute(sql`SELECT RELEASE_LOCK(${LOCK_NAME})`);
      }
    }
    case "sqlite":
      return fn();
    default: {
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
