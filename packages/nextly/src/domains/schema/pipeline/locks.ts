/**
 * The schema lock, as the migration commands take it: `migrate` and the boot migrate step,
 * `migrate:down`, `migrate:baseline`, `migrate:resolve`, `upgrade`, and plugin install and
 * uninstall.
 *
 * One lock per database now covers every schema change (`./schema-lock`). This module keeps the
 * shape those commands were written against, so each states only what is particular to it: the
 * command that holds the lock, and whether it waits for a held one. It also keeps
 * `--force-unlock`, which clears the lock and both earlier locks.
 *
 * @module domains/schema/pipeline/locks
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { isMissingTable } from "../../field-groups/migration/session";

import {
  EARLIER_MIGRATE_LOCK_TABLE,
  SCHEMA_LOCK_TABLE,
  withSchemaLock,
  type SchemaLockOutcome,
} from "./schema-lock";

export {
  getEarlierMigrateLockDdl as getMigrateLockDdl,
  MYSQL_MIGRATE_LOCK_NAME,
} from "./schema-lock";

export interface MigrateLockOptions {
  /** What holds the lock, as an operator would name it. Stored with the claim. */
  command: string;
  /**
   * `wait` (the default): a held lock is waited for, about a minute, and then the run stops with a
   * message naming the holder. `fail-fast`: it stops at once.
   */
  mode?: "fail-fast" | "wait";
  /** How long `wait` waits, in milliseconds. */
  waitMs?: number;
  /** The lease, in seconds: how long the lock outlives a holder that stopped. */
  ttlSeconds?: number;
  /** wait mode: poll interval (ms). */
  pollMs?: number;
  /** wait mode: return early (without running fn) once this resolves true. */
  isSettled?: () => Promise<boolean>;
  /**
   * Release the lock when the process is interrupted. True for a command, whose interrupt ends it;
   * false for the boot migrate step, inside a server whose shutdown may let the work run on.
   */
  releaseOnInterrupt?: boolean;
  logger?: { warn?: (m: string) => void; info?: (m: string) => void };
}

/**
 * Whether the guarded body RAN, and its value if it did.
 *
 * A discriminated result rather than `T | undefined`, because `undefined` would do double duty:
 * "your function returned undefined" and "your function never ran". A held lock is not an
 * outcome — it throws `NEXTLY_MIGRATE_LOCK_BUSY` naming the holder — so `ran: false` means only
 * that a waiting run stopped because `isSettled` found the work done.
 */
export type MigrateLockOutcome<T> = SchemaLockOutcome<T>;

/** Hold the schema lock for the whole of `fn`, on behalf of a migration command. */
export async function withMigrateLock<T>(
  adapter: DrizzleAdapter,
  _dialect: SupportedDialect,
  fn: () => Promise<T>,
  opts: MigrateLockOptions
): Promise<MigrateLockOutcome<T>> {
  return withSchemaLock(
    {
      adapter,
      command: opts.command,
      whenHeld: opts.mode === "fail-fast" ? "refuse" : "wait",
      waitMs: opts.waitMs,
      pollMs: opts.pollMs,
      leaseSeconds: opts.ttlSeconds,
      isSettled: opts.isSettled,
      releaseOnInterrupt: opts.releaseOnInterrupt ?? true,
      logger: opts.logger,
    },
    () => fn()
  );
}

/** A Drizzle handle's one-statement call, per dialect: better-sqlite3 has no `execute`. */
async function runOn(
  db: unknown,
  dialect: SupportedDialect,
  statement: SQL
): Promise<void> {
  if (dialect === "sqlite") {
    await (db as { run: (q: SQL) => unknown }).run(statement);
    return;
  }
  await (db as { execute: (q: SQL) => Promise<unknown> }).execute(statement);
}

/**
 * Clear the schema lock and both earlier locks, whoever holds them (`--force-unlock`).
 *
 * For a lock an operator knows is stale and will not wait out. A holder that stopped lets its
 * claim lapse within one lease, so this is rarely needed — and it frees a LIVE holder's lock too,
 * which is why it is only ever an operator's explicit choice. MySQL's named lock has nothing to
 * clear: it goes when the connection holding it ends. A table that is not there is skipped.
 */
export async function forceUnlock(
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  const id = (name: string) => sql.identifier(name);
  const clears: SQL[] = [];
  if (dialect === "postgresql") {
    clears.push(
      sql`DELETE FROM ${id(EARLIER_MIGRATE_LOCK_TABLE)} WHERE ${id("id")} = 1`
    );
  }
  clears.push(
    sql`UPDATE ${id(SCHEMA_LOCK_TABLE)}
        SET ${id("owner")} = NULL, ${id("command")} = NULL,
            ${id("acquired_at")} = NULL, ${id("expires_at")} = NULL
        WHERE ${id("id")} = 1`,
    sql`UPDATE ${id("nextly_field_group_lock")} SET ${id("owner")} = NULL
        WHERE ${id("id")} = 1`
  );
  for (const clear of clears) {
    try {
      await runOn(db, dialect, clear);
    } catch (error) {
      if (!isMissingTable(error, dialect)) throw error;
    }
  }
}
