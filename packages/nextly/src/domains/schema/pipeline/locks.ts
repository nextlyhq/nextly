/**
 * Cross-process schema lock (spec §4.6.2). One key, shared by `nextly migrate`
 * and `nextly upgrade`. `db` is typed `unknown`; each branch casts to the
 * minimal shape it needs.
 *
 * - PostgreSQL: pg_try_advisory_lock (non-blocking) → busy throws; unlock in
 *   finally. Session-level so it spans the per-file transactions migrate runs
 *   inside the lock.
 * - MySQL: GET_LOCK(name, 0) → busy throws; RELEASE_LOCK in finally.
 * - SQLite: single-writer; just run fn (an outer async transaction is unsafe
 *   with the better-sqlite3 driver, and per-statement writes already serialize).
 *
 * @module domains/schema/pipeline/locks
 * @since v0.0.3-alpha (Plan C2)
 */
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

const LOCK_NAMESPACE = "nextly:migrate";

// SHA-256(namespace) → first 8 bytes → BigInt → int64 range. Deterministic
// across processes and Nextly versions.
const hash = createHash("sha256").update(LOCK_NAMESPACE).digest();
export const POSTGRES_MIGRATE_LOCK_KEY = BigInt.asIntN(
  64,
  hash.readBigInt64BE(0)
);

const MYSQL_LOCK_NAME = "nextly:migrate";

function lockBusy(): never {
  throw new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage:
      "Another schema operation holds the migrate lock. Wait for it to finish " +
      "(a running dev server also holds it) and retry.",
  });
}

/** Normalize a driver result to a rows array (pg `{ rows }` vs array). */
function toRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) {
    return (Array.isArray(res[0]) ? res[0] : res) as Array<
      Record<string, unknown>
    >;
  }
  return ((res as { rows?: Array<Record<string, unknown>> }).rows ??
    []) as Array<Record<string, unknown>>;
}

/** Truthy for PG `true` and MySQL `1`; falsy for `false`/`0`/`null`. */
function isLocked(rows: Array<Record<string, unknown>>): boolean {
  const v = rows[0]?.locked;
  return v === true || v === 1;
}

/**
 * Acquire the migrate lock, run `fn`, release on exit (success or failure).
 */
export async function withMigrateLock<T>(
  db: unknown,
  dialect: SupportedDialect,
  fn: () => Promise<T>
): Promise<T> {
  switch (dialect) {
    case "postgresql": {
      const pg = db as { execute: (q: unknown) => Promise<unknown> };
      const acquired = toRows(
        await pg.execute(
          sql`SELECT pg_try_advisory_lock(${POSTGRES_MIGRATE_LOCK_KEY}) AS locked`
        )
      );
      if (!isLocked(acquired)) lockBusy();
      try {
        return await fn();
      } finally {
        await pg.execute(
          sql`SELECT pg_advisory_unlock(${POSTGRES_MIGRATE_LOCK_KEY})`
        );
      }
    }
    case "mysql": {
      const my = db as { execute: (q: unknown) => Promise<unknown> };
      const acquired = toRows(
        await my.execute(sql`SELECT GET_LOCK(${MYSQL_LOCK_NAME}, 0) AS locked`)
      );
      if (!isLocked(acquired)) lockBusy();
      try {
        return await fn();
      } finally {
        await my.execute(sql`SELECT RELEASE_LOCK(${MYSQL_LOCK_NAME})`);
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
