/**
 * Cross-process schema lock (spec §4.6.2). Shared by `migrate`, `upgrade`,
 * and `migrate:resolve`.
 *
 * PostgreSQL: a TTL lock ROW (`nextly_migrate_lock`) instead of a session
 * advisory lock — session advisory locks leak through transaction-mode poolers
 * (Neon/Supabase PgBouncer): the unlock can land on a different backend than the
 * one holding it, leaving a dangling lock that wedges the next run. The row lock
 * is pooler-agnostic. Acquire is an atomic upsert that succeeds only when the
 * lock is free or its TTL has expired; release deletes only our own row.
 *
 * MySQL: GET_LOCK (unchanged). SQLite: single-writer no-op (unchanged).
 *
 * @module domains/schema/pipeline/locks
 * @since v0.0.3-alpha (Plan C2; pooler-safe rewrite 2026-06)
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors";

const MYSQL_LOCK_NAME = "nextly:migrate";
const DEFAULT_TTL_SECONDS = 900;
const POLL_MS = 1000;

/** Identifies this process as a lock holder (host:pid:uuid). */
const OWNER = `${hostname()}:${process.pid}:${randomUUID()}`;

type PgLike = { execute: (q: unknown) => Promise<unknown> };

export interface MigrateLockOptions {
  /** "fail-fast" (default): busy → throw. "wait": poll until acquired or settled. */
  mode?: "fail-fast" | "wait";
  /** Lock lifetime in seconds before another process may take it over. */
  ttlSeconds?: number;
  /** wait mode: max total time to wait (ms). Default = ttlSeconds * 1000. */
  maxWaitMs?: number;
  /** wait mode: poll interval (ms). */
  pollMs?: number;
  /** wait mode: return early (without running fn) once this resolves true. */
  isSettled?: () => Promise<boolean>;
  logger?: { warn?: (m: string) => void; info?: (m: string) => void };
}

/** Idempotent DDL for the lock table (per dialect). PG only. */
export function getMigrateLockDdl(dialect: SupportedDialect): string[] {
  if (dialect === "postgresql") {
    return [
      `CREATE TABLE IF NOT EXISTS nextly_migrate_lock (
        id integer PRIMARY KEY,
        owner text NOT NULL,
        acquired_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )`,
    ];
  }
  return [];
}

/** Normalize a driver result to a rows array (pg `{ rows }` vs array). */
function toRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) {
    return (Array.isArray(res[0]) ? res[0] : res) as Array<
      Record<string, unknown>
    >;
  }
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

function lockBusy(): never {
  throw new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage:
      "Another schema operation holds the migrate lock. Wait for it to finish " +
      "(a running dev server also holds it) and retry, or run with " +
      "`--force-unlock` to clear a stale lock.",
  });
}

async function ensureLockTable(pg: PgLike): Promise<void> {
  for (const stmt of getMigrateLockDdl("postgresql")) {
    await pg.execute(sql.raw(stmt));
  }
}

/** Atomic acquire: inserts the lock, or takes over an expired one. */
async function tryAcquirePg(pg: PgLike, ttlSeconds: number): Promise<boolean> {
  const rows = toRows(
    await pg.execute(sql`
      INSERT INTO nextly_migrate_lock (id, owner, acquired_at, expires_at)
      VALUES (1, ${OWNER}, now(), now() + make_interval(secs => ${ttlSeconds}))
      ON CONFLICT (id) DO UPDATE
        SET owner = EXCLUDED.owner,
            acquired_at = EXCLUDED.acquired_at,
            expires_at = EXCLUDED.expires_at
        WHERE nextly_migrate_lock.expires_at < now()
      RETURNING id
    `)
  );
  return rows.length === 1;
}

async function releasePg(pg: PgLike): Promise<void> {
  await pg.execute(
    sql`DELETE FROM nextly_migrate_lock WHERE id = 1 AND owner = ${OWNER}`
  );
}

/** Unconditionally clear the lock (the `--force-unlock` escape hatch). PG only. */
export async function forceUnlock(
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  if (dialect !== "postgresql") return;
  const pg = db as PgLike;
  await ensureLockTable(pg);
  await pg.execute(sql`DELETE FROM nextly_migrate_lock WHERE id = 1`);
}

/**
 * Acquire the migrate lock, run `fn`, release on exit. Returns `fn`'s result, or
 * `undefined` if wait mode settled without running `fn` (another process applied
 * the migrations while we waited).
 */
export async function withMigrateLock<T>(
  db: unknown,
  dialect: SupportedDialect,
  fn: () => Promise<T>,
  opts?: MigrateLockOptions
): Promise<T | undefined> {
  switch (dialect) {
    case "postgresql": {
      const pg = db as PgLike;
      const ttl = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
      await ensureLockTable(pg);

      let acquired = await tryAcquirePg(pg, ttl);

      if (!acquired && opts?.mode === "wait") {
        const deadline = Date.now() + (opts.maxWaitMs ?? ttl * 1000);
        const pollMs = opts.pollMs ?? POLL_MS;
        while (!acquired && Date.now() < deadline) {
          if (opts.isSettled && (await opts.isSettled())) return undefined;
          await new Promise(r => setTimeout(r, pollMs));
          acquired = await tryAcquirePg(pg, ttl);
        }
        if (!acquired) {
          opts.logger?.warn?.(
            "[Nextly] migrate lock still held after waiting; proceeding without it."
          );
          return undefined;
        }
      }

      if (!acquired) lockBusy();
      try {
        return await fn();
      } finally {
        await releasePg(pg);
      }
    }
    case "mysql": {
      const my = db as PgLike;
      const acquired = toRows(
        await my.execute(sql`SELECT GET_LOCK(${MYSQL_LOCK_NAME}, 0) AS locked`)
      );
      const v = acquired[0]?.locked;
      if (!(v === 1 || v === true)) lockBusy();
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
