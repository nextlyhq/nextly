/**
 * The one transaction every migration unit runs in — an app migration file,
 * a plugin module's UP, a DOWN — on one connection.
 *
 * @module domains/schema/migrate/migration-transaction
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

import {
  refusingNewDanglingReferences,
  sqliteForeignKeysOn,
  withSqliteForeignKeysOff,
  type SqliteForeignKeySession,
} from "./sqlite-foreign-keys";

/**
 * What a migration's work runs through.
 *
 * `execute` runs a statement on the transaction's own connection, and `db` is
 * the Drizzle handle bound to it, for ledger writes that must commit or roll
 * back with the statements they record.
 */
export interface MigrationTransaction {
  execute(statement: string): Promise<void>;
  db: unknown;
}

/**
 * Runs `work` in one database transaction, through the adapter's own
 * transaction API.
 *
 * The adapter reserves a single connection for it — a pooled PostgreSQL or
 * MySQL client, SQLite's one connection — and issues BEGIN, the work and
 * COMMIT or ROLLBACK on it. Sending those as separate `executeQuery` calls
 * would hand each to whichever pooled connection was free: the BEGIN on one,
 * the statements on others, so nothing was atomic and the ROLLBACK undid
 * nothing.
 *
 * On SQLite the unit runs with foreign-key enforcement OFF and is checked
 * before it commits — SQLite's documented contract for changing a table's
 * shape:
 *
 * 1. `PRAGMA foreign_keys = OFF` before BEGIN (inside a transaction the
 *    pragma is silently ignored), after reading the setting in force.
 * 2. Inside the transaction, the setting is read back; if enforcement is
 *    still on — another transaction was open on the connection, so the pragma
 *    did nothing — the unit is refused before any statement runs.
 * 3. The statements run. With enforcement off, dropping a parent table in a
 *    rebuild (`__new_x` created, rows copied, `x` dropped, `__new_x` renamed
 *    to `x`) neither cascades into its children nor fails on them.
 * 4. `PRAGMA foreign_key_check`: a row it returns is a reference the unit
 *    left dangling, and the unit is rolled back and refused.
 * 5. COMMIT, then the setting read in step 1 is restored — whether the unit
 *    committed, was refused or failed.
 *
 * PostgreSQL and MySQL enforce foreign keys as the statements run, as their
 * migrations always have.
 */
export async function executeTransaction<T>(
  adapter: DrizzleAdapter,
  work: (tx: MigrationTransaction) => Promise<T>
): Promise<T> {
  if (adapter.getCapabilities().dialect !== "sqlite") {
    return adapter.transaction(ctx =>
      work({
        execute: async statement => {
          await ctx.execute(statement);
        },
        db: ctx.drizzle(),
      })
    );
  }

  // The adapter outside the transaction for the pragma switch, which
  // SQLite ignores inside one; the transaction's own connection for the
  // reads that must see the unit's state.
  const outside: SqliteForeignKeySession = {
    read: statement => adapter.executeQuery(statement),
    run: async statement => {
      await adapter.executeQuery(statement);
    },
  };
  return withSqliteForeignKeysOff(outside, () =>
    adapter.transaction(async ctx => {
      const inside = {
        read: <R>(statement: string) =>
          ctx.queryStatement<R>(sql.raw(statement)),
      };
      if (await sqliteForeignKeysOn(inside)) {
        throw new NextlyError({
          code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
          publicMessage:
            "Foreign-key enforcement could not be switched off for this migration, because another transaction was open on the connection. Nothing was applied; re-run it once that transaction has finished.",
          logContext: { reason: "enforcement-still-on" },
        });
      }
      return refusingNewDanglingReferences(
        inside,
        () =>
          work({
            execute: async statement => {
              await ctx.execute(statement);
            },
            db: ctx.drizzle(),
          }),
        (count, pairs) =>
          `This migration would leave ${String(count)} row(s) referencing rows that do not exist (${pairs}). It was rolled back, and nothing was applied.`
      );
    })
  );
}
