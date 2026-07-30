/**
 * Turns a rename plan into the steps that apply it.
 *
 * Each step pairs the work that must not be separated. Renaming a table and
 * updating the registry row that points at it are one logical change: apart,
 * there is a window in which every row addresses a table that no longer exists,
 * and the read path turns that into empty content rather than an error.
 *
 * No SQL is written here. `generateSQL` already emits `RENAME TABLE` and
 * `RENAME COLUMN` for all three dialects and quotes identifiers, and Drizzle has
 * no query-builder surface for either.
 *
 * @module domains/field-groups/migration/steps
 */

import { NextlyError } from "../../../errors/nextly-error";
import { generateSQL } from "../../schema/pipeline/sql-templates";
import { quoteIdent } from "../../schema/pipeline/sql-templates/identifier-quoting";
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";

import { type ManifestEntry } from "./manifest";
import { findLostIndexes, refuseLostIndexes } from "./observer";
import type { MigrationStep } from "./runner";
import type { MigrationDialect, MigrationSession } from "./session";

/**
 * Positional parameter markers for a dialect.
 *
 * node-postgres binds `$1`, `$2`; mysql2 and better-sqlite3 bind `?`. The
 * transaction context hands the statement to the driver unchanged, so emitting
 * one form everywhere makes every statement with parameters fail on the other.
 */
function placeholders(dialect: MigrationDialect, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    dialect === "postgresql" ? `$${index + 1}` : "?"
  );
}

/**
 * The registry column holding a row's physical table name.
 *
 * Not in `STORAGE_FORMAT`: the collection, single and field-group registries all
 * spell it this way, so it names no field-group concept and does not move when
 * that concept is renamed.
 */
const REGISTRY_TABLE_NAME_COLUMN = "table_name";

/**
 * What a step needs to see to check its own postcondition.
 *
 * Injected rather than queried here so the steps stay decidable without a
 * database, and so catalog observation keeps one implementation instead of
 * gaining a second one inside the migration.
 */
export interface ObservedColumn {
  name: string;
  type: string;
}

export interface StorageObserver {
  /** Every table the catalog reports, in the catalog's own spelling. */
  tables(session: MigrationSession): Promise<string[]>;
  /**
   * A table's columns, or `undefined` when the catalog has no such table.
   *
   * The type travels with the name because `RenameColumnOp` carries one. No
   * dialect's rename SQL emits it today, but the operation is shared with the
   * schema pipeline, and restating the column's own type is the only honest
   * value for a rename that does not change it.
   */
  columns(
    session: MigrationSession,
    table: string
  ): Promise<ObservedColumn[] | undefined>;
  /** Every `table_name` the registry currently points at. */
  pointers(session: MigrationSession, registryTable: string): Promise<string[]>;
  /**
   * A table's index names, or `undefined` when they were not tracked.
   *
   * `undefined` is not "no indexes": a snapshot that never recorded index data
   * would otherwise report every index intact.
   */
  indexNames(table: string): Promise<string[] | undefined>;
}

/**
 * The registry's name while the step at `position` runs.
 *
 * A pointer update has to name the registry, and which name that is depends on
 * where the registry's own rename sits in *this* plan rather than on direction:
 * going up it renames last, so every pointer update precedes it; a rollback
 * reverses the order, so the registry moves first and every later update
 * addresses it under the name the rollback restored.
 *
 * Derived from the plan rather than probed for. Mid-run both names can be
 * observable on a folding server, and deciding which object is the registry from
 * the catalog would repeat a judgement reconciliation already owns.
 *
 * `position` is 1-based, matching the runner and the marker.
 */
export function registryNameAt(
  entries: readonly ManifestEntry[],
  position: number
): string {
  const index = entries.findIndex(entry => entry.kind === "registry");
  if (index === -1) {
    throw NextlyError.internal({
      logContext: { reason: "plan has no registry rename", position },
    });
  }
  const registry = entries[index];
  if (registry === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "plan has no registry rename", position },
    });
  }
  // Before its own rename the registry is still at that entry's source name;
  // after it, at the target. The registry step itself is the boundary: while it
  // runs, the name it starts under is the one to address.
  return position <= index + 1 ? registry.from : registry.to;
}

/** Build the ordered steps that apply a plan. */
export function buildMigrationSteps(args: {
  entries: readonly ManifestEntry[];
  identifierCase: IdentifierCaseRules;
  observer: StorageObserver;
}): MigrationStep[] {
  const { entries, identifierCase, observer } = args;
  return entries.map((entry, index) => {
    const position = index + 1;
    // An entry reconciliation marked satisfied is already reflected in the
    // database. It keeps its position so later steps still index correctly, and
    // it verifies rather than re-running: a rename that has happened cannot be
    // issued again, and the postcondition is the thing worth confirming.
    const applied = entry.satisfied === true;
    if (entry.kind === "column") {
      return columnStep(entry, { position, applied, identifierCase, observer });
    }
    // A companion follows its owner immediately in the plan. Its rename joins
    // the owner's step rather than standing alone, because the registry derives
    // the companion's name from the owner's `table_name`: whichever of the two
    // renames the pointer update is separated from, there is a window where the
    // derived name addresses an object that does not exist. Only moving both
    // objects and the pointer together closes it.
    const next = entries[index + 1];
    const companion =
      entry.kind === "table" && next?.kind === "companion" ? next : undefined;

    return renameStep(entry, {
      position,
      applied,
      registryTable: registryNameAt(entries, position),
      identifierCase,
      observer,
      companion,
    });
  });
}

interface StepContext {
  position: number;
  applied: boolean;
  identifierCase: IdentifierCaseRules;
  observer: StorageObserver;
}

/**
 * Rename a table, and move the registry pointer with it when the table is one a
 * registry row addresses.
 *
 * Both halves are idempotent because they must survive a partial step. MySQL
 * commits DDL implicitly, so a rename can land while the pointer update fails;
 * the resume re-runs this step, finds the table already moved, and re-applies
 * the pointer. The rename tolerates that by checking the catalog first, and the
 * update is a no-op once no row still points at the old name.
 */
function renameStep(
  entry: ManifestEntry,
  context: StepContext & {
    registryTable: string;
    companion?: ManifestEntry;
  }
): MigrationStep {
  const { applied, identifierCase, observer, registryTable, companion } =
    context;
  // Companions carry no pointer of their own: their name is derived from the
  // owner's `table_name`, so the owner's update already moves them. The registry
  // is not addressed by any row either.
  const movesPointer = entry.kind === "table";
  // Captured by `run` while the source still exists, and read by `verify`.
  // `undefined` means the source was already gone when this step ran, so there
  // is nothing to compare against — reported as not comparable rather than as
  // nothing lost.
  let indexesBefore: string[] | undefined;

  return {
    id: `${entry.kind}:${entry.from}->${entry.to}`,
    async run(session) {
      // Observed BEFORE the transaction opens. The observer reads through the
      // adapter, which takes its own connection; asking it from inside the
      // transaction would wait for a second checkout and deadlock a pool sized
      // to one.
      const present = await observer.tables(session);
      const catalog = indexCatalog(present, identifierCase.tables);
      const source = resolveCatalogName(catalog, entry.from);
      // Captured while the source still exists, so `verify` can tell whether the
      // rename carried the table's indexes with it.
      indexesBefore =
        source === undefined ? undefined : await observer.indexNames(source);

      await session.inTransaction(async ctx => {
        // Re-runnable: on a resume the rename may already have committed, and
        // issuing it again would fail on a source that is no longer there. A
        // satisfied entry skips the DDL for the same reason.
        if (!applied && source !== undefined) {
          await ctx.execute(
            generateSQL(
              { type: "rename_table", fromName: entry.from, toName: entry.to },
              session.dialect
            )
          );
        }
        // Renamed before the pointer moves, so the name the registry derives
        // always addresses an object that is there. The companion's own step
        // later finds its source gone and does nothing, which is the same
        // idempotence every step already relies on.
        if (
          companion !== undefined &&
          resolveCatalogName(catalog, companion.from) !== undefined
        ) {
          await ctx.execute(
            generateSQL(
              {
                type: "rename_table",
                fromName: companion.from,
                toName: companion.to,
              },
              session.dialect
            )
          );
        }
        // Deliberately NOT skipped for a satisfied entry. MySQL commits DDL
        // implicitly, so reconciliation can mark a rename satisfied while its
        // pointer update never landed; skipping both would leave the pointer
        // stale and fail verification on every resume, forever. The update is
        // idempotent, so running it when it is already correct costs nothing.
        if (!movesPointer) return;
        // Values are bound; only the table name is interpolated, through
        // `quoteIdent`. The registry cannot be reached through Drizzle here: the
        // schema registry looks tables up exactly by the name their Drizzle
        // definition declares, so a table addressed under a migrated name is
        // unregistered as far as the ORM is concerned.
        const [toMarker, fromMarker] = placeholders(session.dialect, 2);
        const column = quoteIdent(REGISTRY_TABLE_NAME_COLUMN, session.dialect);
        await ctx.execute(
          `UPDATE ${quoteIdent(registryTable, session.dialect)} SET ${column} = ${toMarker} WHERE ${column} = ${fromMarker}`,
          [entry.to, entry.from]
        );
      });
    },
    async verify(session) {
      const catalog = indexCatalog(
        await observer.tables(session),
        identifierCase.tables
      );
      const target = resolveCatalogName(catalog, entry.to);
      if (target === undefined) return false;
      if (resolveCatalogName(catalog, entry.from) !== undefined) return false;

      // Renaming a table keeps its indexes on every supported dialect, so a name
      // missing afterwards means one was dropped rather than moved. Refuses
      // rather than returning false: a lost index is not "not yet done", and a
      // retry cannot bring it back.
      const lost = findLostIndexes(
        indexesBefore,
        await observer.indexNames(target)
      );
      if (lost.comparable && lost.lost.length > 0) {
        throw refuseLostIndexes({ table: target, lost: lost.lost });
      }

      if (!movesPointer) return true;
      // The pointer is checked as well as the rename, because a rename whose
      // pointer update did not land is exactly the state that leaves every row
      // addressing a table that is gone.
      const pointers = await observer.pointers(session, registryTable);
      if (!pointers.includes(entry.to) || pointers.includes(entry.from)) {
        return false;
      }
      return true;
    },
  };
}

/** Rename the discriminator column on one table. */
function columnStep(entry: ManifestEntry, context: StepContext): MigrationStep {
  const { applied, identifierCase, observer } = context;
  const table = entry.table;
  if (table === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "column entry names no table",
        from: entry.from,
        to: entry.to,
      },
    });
  }

  return {
    id: `column:${table}.${entry.from}->${entry.to}`,
    async run(session) {
      if (applied) return;
      // Observed BEFORE the transaction, for the same reason the table path is:
      // the observer reads through the adapter, which checks out its own
      // connection, so asking from inside would wait for a second checkout and
      // hang a pool sized to one.
      const columns = await observer.columns(session, table);
      await session.inTransaction(async ctx => {
        if (columns === undefined) {
          throw NextlyError.serviceUnavailable({
            logMessage: `field-group migration cannot rename a column on a missing table: ${table}`,
            logContext: { reason: "column step's table is absent", table },
          });
        }
        const index = indexCatalog(
          columns.map(column => column.name),
          identifierCase.columns
        );
        // Re-runnable for the same reason a table rename is.
        const current = resolveCatalogName(index, entry.from);
        if (current === undefined) return;
        const observed = columns.find(column => column.name === current);
        await ctx.execute(
          generateSQL(
            {
              type: "rename_column",
              tableName: table,
              fromColumn: entry.from,
              toColumn: entry.to,
              // A rename does not change the type, so both sides restate the
              // one the column already has.
              fromType: observed?.type ?? "",
              toType: observed?.type ?? "",
            },
            session.dialect
          )
        );
      });
    },
    async verify(session) {
      const columns = await observer.columns(session, table);
      if (columns === undefined) return false;
      const index = indexCatalog(
        columns.map(column => column.name),
        identifierCase.columns
      );
      return (
        resolveCatalogName(index, entry.to) !== undefined &&
        resolveCatalogName(index, entry.from) === undefined
      );
    },
  };
}
