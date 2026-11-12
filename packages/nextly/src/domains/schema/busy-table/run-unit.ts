/**
 * A migration unit (an app file, a down section) run in tries for a busy table: each try bounded
 * as `runMigrationStatements` bounds it, watched where the database needs a watch to bound the try
 * as a whole, judged when it ends, and reported when the tries stop.
 *
 * A unit that runs in one transaction on PostgreSQL or SQLite keeps nothing of an ended try, so
 * the next try runs it from its start, while everything that ran may run again. The units whose
 * statements commit one at a time (MySQL, and a file marked to run outside a transaction) run as
 * they did, in one try with no bound of their own: what they keep across a try needs the resume
 * the next change adds.
 *
 * @module domains/schema/busy-table/run-unit
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import {
  runMigrationStatements,
  type MigrationUnit,
} from "../migrate/migration-transaction";
import {
  assertSchemaLockHeld,
  schemaLockConfirmedUntil,
} from "../pipeline/schema-lock";

import type { BusyTableBounds } from "./bounds";
import { endedWaiting } from "./ended-waiting";
import { readHolders } from "./holder";
import { firstNoRetry, targetTable } from "./judge";
import { tableBusyError, tryNotice } from "./report";
import { withBusyTableTries, type TryResult } from "./tries";
import type { HolderReport } from "./types";
import { prepareTryWatchdog } from "./watchdog";

/** What a run hands every unit it runs in tries. */
export interface BusyTableRun {
  readonly bounds: BusyTableBounds;
  /** Prints a line on standard error, so a `--json` run keeps one document on standard output. */
  readonly notify: (line: string) => void;
  /** The units this run applied before the one about to run. */
  readonly appliedBefore: () => readonly string[];
}

/** The tables of this database with a trigger a row change would fire. */
function triggerTablesQuery(dialect: SupportedDialect): SQL {
  if (dialect === "postgresql") {
    return sql`SELECT DISTINCT c.relname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`;
  }
  if (dialect === "mysql") {
    return sql`SELECT DISTINCT EVENT_OBJECT_TABLE AS name FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()`;
  }
  return sql`SELECT DISTINCT tbl_name AS name FROM sqlite_master WHERE type = 'trigger'`;
}

/** The tables with a trigger, lower-cased; read once before a unit's first try. */
async function triggerTables(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<ReadonlySet<string>> {
  const rows = await adapter.queryStatement<{ name: unknown }>(
    triggerTablesQuery(dialect)
  );
  return new Set(rows.map(row => String(row.name).toLowerCase()));
}

/** Whether a unit runs in tries: one transaction on PostgreSQL or SQLite. */
function runsInTries(unit: MigrationUnit, dialect: SupportedDialect): boolean {
  return unit.transaction && dialect !== "mysql";
}

/**
 * Runs `unit`'s statements as `runMigrationStatements` does, in tries for a busy table where the
 * unit runs in one transaction on PostgreSQL or SQLite. Throws `NEXTLY_TABLE_BUSY` once the tries
 * run out, or at once where a try ran a statement that may not run again.
 */
export async function runUnitInTries(
  adapter: DrizzleAdapter,
  statements: readonly string[],
  unit: MigrationUnit,
  after: (db: unknown, statementsExecuted: number) => Promise<void>,
  run: BusyTableRun
): Promise<number> {
  const dialect = adapter.getCapabilities().dialect;
  if (!runsInTries(unit, dialect)) {
    return runMigrationStatements(adapter, statements, unit, after);
  }
  const triggers = await triggerTables(adapter, dialect);
  const { tryMs } = run.bounds;
  return withBusyTableTries(
    {
      bounds: run.bounds,
      change: unit.source,
      appliedBefore: run.appliedBefore(),
      notify: run.notify,
      notice: tryNotice,
      assertHeld: assertSchemaLockHeld,
      stopped: tableBusyError,
      // On SQLite the holder's write lock keeps the schema lock from renewing while the tries
      // wait, so they end where the lock can still be shown held, and say why.
      ...(dialect === "sqlite"
        ? { leaseDeadline: schemaLockConfirmedUntil }
        : {}),
    },
    async (): Promise<TryResult<number>> => {
      let session: string | undefined;
      let reached = -1;
      // Made before the unit's transaction opens, so the watch's asks on another connection never
      // run inside that transaction's flow; it starts once the session is known.
      // What holds the table, read by the watch just before it ends the try, while the session
      // still waits; after the rollback it waits for nothing and the database names no holder.
      let holder: HolderReport | undefined;
      const watchdog = prepareTryWatchdog(adapter, dialect, tryMs, {
        beforeCancel: async waiting => {
          holder = await readHolders(adapter, dialect, waiting);
        },
      });
      try {
        const value = await runMigrationStatements(
          adapter,
          statements,
          unit,
          after,
          {
            tryMs,
            onSession: id => {
              session = id;
              watchdog.watch(id);
            },
            onStatement: index => {
              reached = index;
            },
          }
        );
        await watchdog.stop();
        return { kind: "done", value };
      } catch (error) {
        const { fired } = await watchdog.stop();
        if (!endedWaiting(error, dialect, fired)) throw error;
        // The transaction was rolled back: nothing of the try stayed, and the next try runs the
        // unit from its start, unless a statement that ran may not run again.
        const ran = statements.slice(0, reached + 1);
        const lasting = firstNoRetry(ran, dialect, triggers);
        const waiting = ran[ran.length - 1];
        return {
          kind: "ended",
          ended: {
            table: waiting === undefined ? null : targetTable(waiting, dialect),
            holder: holder ?? (await readHolders(adapter, dialect, session)),
          },
          lasting,
          undone: true,
          committed: [],
        };
      }
    }
  );
}
