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

import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { generateSQL } from "../../schema/pipeline/sql-templates";
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";

import { tableRenamesOf, type ManifestEntry } from "./manifest";
import { findLostIndexes, refuseLostIndexes } from "./observer";
import { PARENT_TABLE_COLUMN } from "./parent-pointers";
import type { MigrationStep } from "./runner";
import type { MigrationSession } from "./session";

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
   * Every table storing embedded field-group instances, under its current name.
   *
   * Separate from `tables` because the question is not "what exists" but "what
   * holds a parent pointer", and the answer is a property of a table's columns
   * rather than of its name: a field group whose table was named through
   * `dbName` carries no recognisable prefix, and a table orphaned by a deleted
   * registry row appears in no plan, yet a stale pointer in either is content
   * that stops resolving.
   */
  dataTables(session: MigrationSession): Promise<string[]>;
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
    // The companion travels on the entry rather than beside it, so it shares
    // this step's position. The registry derives a companion's name from its
    // owner's `table_name`, so whichever of the two renames the pointer update
    // were separated from, there would be a window where the derived name
    // addresses an object that is not there.
    return renameStep(entry, {
      position,
      applied,
      registryTable: registryNameAt(entries, position),
      identifierCase,
      observer,
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
 * Rename a table and its companion, and move every pointer at it with them.
 *
 * Two kinds of row address a field-group table by its physical name, and both
 * move here rather than in a step of their own:
 *
 * - the **registry**'s `table_name`, which is how everything finds the table;
 * - **`_parent_table`** on every embedded instance nested inside this field
 *   group, which is how a child row says which parent it hangs off.
 *
 * Separating either from the rename opens a window in which a row addresses a
 * table that is not there, and the read path turns that into empty content
 * rather than an error — so a rename that lost its pointers looks like a
 * successful migration and reads like deleted data.
 *
 * How atomic that is depends on the dialect, and the difference is not one this
 * module can paper over:
 *
 * - **Postgres and SQLite** have transactional DDL. The renames and the pointer
 *   update commit together or not at all, which is the guarantee this step is
 *   shaped around: a reader never sees a pointer addressing a table that moved.
 * - **MySQL** commits DDL implicitly. Each `RENAME TABLE` ends the transaction
 *   it is in, so the pointer update necessarily runs in a later one. There is a
 *   window in which a concurrent reader sees renamed tables and a stale pointer,
 *   and no ordering closes it — moving the pointer first only swaps which side
 *   is briefly wrong. Both intermediate states resolve to "table not found"
 *   rather than to wrong data, and the window is bounded by the run.
 *
 * So on MySQL this is sequenced with repair rather than atomic, and every half
 * is idempotent to make that repair possible: the renames check the catalog
 * first, and the pointer updates are no-ops once no row still points at the old
 * name.
 *
 * The two pointer updates sit on opposite sides of the renames on purpose. The
 * parent pointers go **first**, so that MySQL's implicit commit carries them
 * with the rename and a table that moved always has its children's pointers
 * moved too. The registry pointer stays **after**, where its own idempotence and
 * `verify`'s pointer check already cover the gap, and where it addresses the
 * registry under the name `registryNameAt` derives.
 */
function renameStep(
  entry: ManifestEntry,
  context: StepContext & { registryTable: string }
): MigrationStep {
  const { identifierCase, observer, registryTable } = context;
  // Companions carry no pointer of their own: their name is derived from the
  // owner's `table_name`, so the owner's update already moves them. The registry
  // is not addressed by any row either.
  const movesPointer = entry.kind === "table";
  // Base table first, then its companion if it has one. Both are moved by this
  // step, so both are renamed, both are verified, and both have their indexes
  // compared -- a companion whose indexes were dropped is as lost as a table's.
  const renames = tableRenamesOf(entry);
  // Captured by `run` while the sources still exist, and read by `verify`,
  // positionally against `renames`. `undefined` means that source was already
  // gone when this step ran, so there is nothing to compare against — reported
  // as not comparable rather than as nothing lost.
  let indexesBefore: (string[] | undefined)[] = [];

  return {
    id: `${entry.kind}:${entry.from}->${entry.to}`,
    async run(session) {
      // Observed BEFORE the transaction opens. The observer reads through the
      // adapter, which takes its own connection; asking it from inside the
      // transaction would wait for a second checkout and deadlock a pool sized
      // to one.
      const present = await observer.tables(session);
      const catalog = indexCatalog(present, identifierCase.tables);
      const sources = renames.map(rename =>
        resolveCatalogName(catalog, rename.from)
      );
      // Sequential rather than concurrent: the observer checks out a connection
      // per call, and a pool sized to one cannot serve two at once.
      indexesBefore = [];
      for (const source of sources) {
        indexesBefore.push(
          source === undefined ? undefined : await observer.indexNames(source)
        );
      }
      // Observed outside the transaction for the same reason the catalog is,
      // and observed fresh per step rather than once per run: earlier steps have
      // already renamed some of these tables, and the names this step must
      // address are the ones they carry now.
      const dataTables = movesPointer ? await observer.dataTables(session) : [];

      await session.inTransaction(async ctx => {
        // Issued BEFORE the renames below, so that on MySQL the implicit commit
        // a `RENAME TABLE` performs carries these updates with it: a table that
        // moved then always has the pointers at it moved too. Postgres and
        // SQLite commit the whole step atomically, where the order is immaterial.
        //
        // Every field-group data table is rewritten, not only the one being
        // renamed. A child of `comp_outer` stores its pointer in the *child's*
        // table, so the stale string lives somewhere other than the table this
        // step moves — including in tables this plan renames nothing of, and in
        // the moved table itself where a field group nests inside itself.
        //
        // Deliberately not skipped for a satisfied entry, exactly as the
        // registry update below is not: a resume reached here because something
        // did not land, and an update that is already correct costs a scan.
        if (movesPointer) {
          for (const table of dataTables) {
            await ctx.runStatement(
              sql`UPDATE ${sql.identifier(table)}
                  SET ${sql.identifier(PARENT_TABLE_COLUMN)} = ${entry.to}
                  WHERE ${sql.identifier(PARENT_TABLE_COLUMN)} = ${entry.from}`
            );
          }
        }
        // Re-runnable, and decided per table rather than per entry: on a resume
        // a rename may already have committed, and issuing it again would fail
        // on a source that is no longer there. The catalog answers that for each
        // table on its own, which is what a torn step needs — skipping the whole
        // entry because reconciliation called it satisfied would strand a
        // companion whose own rename never landed.
        for (const [index, rename] of renames.entries()) {
          if (sources[index] === undefined) continue;
          await ctx.execute(
            generateSQL(
              {
                type: "rename_table",
                fromName: rename.from,
                toName: rename.to,
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
        // Issued as a Drizzle statement, which quotes the identifier and binds
        // the values in whichever form the driver expects. The registry cannot
        // be reached through the typed query builder here: it resolves a table
        // through the schema registry, which knows tables only by the name their
        // Drizzle definition declares, and mid-run the registry is under
        // whichever name the plan has reached.
        await ctx.runStatement(
          sql`UPDATE ${sql.identifier(registryTable)}
              SET ${sql.identifier(REGISTRY_TABLE_NAME_COLUMN)} = ${entry.to}
              WHERE ${sql.identifier(REGISTRY_TABLE_NAME_COLUMN)} = ${entry.from}`
        );
      });
    },
    async verify(session) {
      const catalog = indexCatalog(
        await observer.tables(session),
        identifierCase.tables
      );

      for (const [index, rename] of renames.entries()) {
        const target = resolveCatalogName(catalog, rename.to);
        if (target === undefined) return false;
        if (resolveCatalogName(catalog, rename.from) !== undefined)
          return false;

        // Renaming a table keeps its indexes on every supported dialect, so a
        // name missing afterwards means one was dropped rather than moved.
        // Refuses rather than returning false: a lost index is not "not yet
        // done", and a retry cannot bring it back.
        const lost = findLostIndexes(
          indexesBefore[index],
          await observer.indexNames(target)
        );
        if (lost.comparable && lost.lost.length > 0) {
          throw refuseLostIndexes({ table: target, lost: lost.lost });
        }
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
