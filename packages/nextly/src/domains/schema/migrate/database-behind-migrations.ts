/**
 * The tables and columns the applied migrations made that the database no
 * longer holds: `nextly migrate` never reports such a database as up to date.
 *
 * It compares two end states: the newest applied app snapshot (the whole
 * schema the ledger says the database is at) with the live database. A table
 * or column that snapshot records and the database lacks is named, with the
 * applied migration that last created it. A table or column a later applied
 * migration dropped is in no newest snapshot, so it is never named. What the
 * database holds beyond the snapshot, or holds with another type, is not this
 * check's: those are reported and repaired elsewhere.
 *
 * Read-only. The app's stream alone: a plugin's own migration modules carry
 * their own history, checked as they run.
 *
 * **Runtime restriction (F11):** CLI and boot only; never import from runtime
 * code.
 *
 * @module domains/schema/migrate/database-behind-migrations
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { CliError } from "../../../cli/errors";
import { databaseBehindMigrations } from "../../../cli/errors/areas/migrations";
import type { FieldGroupNaming } from "../../field-groups/services/field-group-storage-names";
import {
  parseSnapshotFile,
  snapshotFieldGroupNaming,
  SnapshotFileError,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { ledgerNameOfSnapshot, type IsAppliedFn } from "./snapshot-source";

/** A table, or one of its columns, the database lacks. */
export interface MissingFromDatabase {
  table: string;
  /** Absent where the whole table is missing. */
  column?: string;
  /** The applied migration that last created it, by base name. */
  createdBy: string;
}

/** One applied snapshot, in run order. */
export interface AppliedSnapshot {
  migration: string;
  snapshot: NextlySchemaSnapshot;
  /** The field-group names the snapshot records its point of the history on. */
  fieldGroupNaming: FieldGroupNaming;
  /**
   * The tables in `snapshot` another owner declares (a plugin's, Nextly's),
   * held for the columns the app contributed to them: never named missing
   * whole, since such a table is its owner's to report.
   */
  foreign?: ReadonlySet<string>;
}

/**
 * The part of a snapshot file the app's migrations made: its own tables whole,
 * and of each table another owner declares, which the file holds whole because
 * the app contributes to it, only the columns the app contributed. That
 * table's other columns are its owner's, whose own history may drop or rename
 * them while the app's copy stays as it was.
 */
export function appOwnedTables(
  file: Pick<SnapshotFile, "snapshot" | "contributions">
): { snapshot: NextlySchemaSnapshot; foreign: ReadonlySet<string> } {
  const contributed = file.contributions ?? {};
  const foreign = new Set(Object.keys(contributed));
  return {
    snapshot: {
      ...file.snapshot,
      tables: file.snapshot.tables.map(table => {
        if (!foreign.has(table.name)) return table;
        const own = new Set(contributed[table.name].columns);
        return {
          ...table,
          columns: table.columns.filter(column => own.has(column.name)),
        };
      }),
    },
    foreign,
  };
}

/** Each table's columns, lower-cased, by lower-cased table name. */
type Columns = ReadonlyMap<string, ReadonlySet<string>>;

/** A table's key (`posts`) or a column's (`posts.title`), lower-cased. */
const keyOf = (table: string, column?: string) =>
  column === undefined
    ? table.toLowerCase()
    : `${table.toLowerCase()}.${column.toLowerCase()}`;

/** Every table and column a snapshot records, by key. */
function elementsOf(snapshot: NextlySchemaSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const table of snapshot.tables) {
    keys.add(keyOf(table.name));
    for (const column of table.columns)
      keys.add(keyOf(table.name, column.name));
  }
  return keys;
}

/**
 * The applied migration that last created each table and column: the newest
 * whose snapshot records it where the applied snapshot before it does not.
 */
function createdByOf(applied: readonly AppliedSnapshot[]): Map<string, string> {
  const createdBy = new Map<string, string>();
  let before = new Set<string>();
  for (const { migration, snapshot } of applied) {
    const now = elementsOf(snapshot);
    for (const key of now) {
      if (!before.has(key)) createdBy.set(key, migration);
    }
    before = now;
  }
  return createdBy;
}

/**
 * What the newest of `applied` records and `live` lacks, each with the
 * applied migration that last created it. A table missing whole is named
 * once, not again for each of its columns. Pure.
 */
export function missingFromDatabase(
  applied: readonly AppliedSnapshot[],
  live: Columns
): MissingFromDatabase[] {
  const newest = applied.at(-1);
  if (newest === undefined) return [];
  const createdBy = createdByOf(applied);
  const by = (key: string) => createdBy.get(key) ?? newest.migration;
  return newest.snapshot.tables.flatMap(table => {
    const liveColumns = live.get(keyOf(table.name));
    if (liveColumns === undefined) {
      return newest.foreign?.has(table.name) === true
        ? []
        : [{ table: table.name, createdBy: by(keyOf(table.name)) }];
    }
    return table.columns
      .filter(column => !liveColumns.has(column.name.toLowerCase()))
      .map(column => ({
        table: table.name,
        column: column.name,
        createdBy: by(keyOf(table.name, column.name)),
      }));
  });
}

/**
 * The applied app snapshots in the folder, in run order, back from the newest
 * to the first that cannot be read (an older one says nothing past it). A
 * migration with no snapshot (hand-written, or a translations companion) is
 * passed over.
 */
export async function appliedSnapshotsOf(
  migrationsDir: string,
  isApplied: IsAppliedFn
): Promise<AppliedSnapshot[]> {
  const metaDir = resolve(migrationsDir, "meta");
  let names: string[];
  try {
    names = (await readdir(metaDir))
      .filter(name => name.endsWith(".snapshot.json"))
      .sort();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const applied: AppliedSnapshot[] = [];
  for (const name of names.reverse()) {
    if (!(await isApplied(ledgerNameOfSnapshot(name)))) continue;
    try {
      const file = parseSnapshotFile(
        await readFile(join(metaDir, name), "utf-8"),
        name
      );
      applied.push({
        migration: name.replace(/\.snapshot\.json$/, ""),
        fieldGroupNaming: snapshotFieldGroupNaming(file),
        ...appOwnedTables(file),
      });
    } catch (error) {
      if (!(error instanceof SnapshotFileError)) throw error;
      break;
    }
  }
  return applied.reverse();
}

/** One line per missing table or column, as the refusal names them. */
function missingLines(missing: readonly MissingFromDatabase[]): string[] {
  return missing.map(m =>
    m.column === undefined
      ? `- table ${m.table} (created by ${m.createdBy})`
      : `- column ${m.table}.${m.column} (created by ${m.createdBy})`
  );
}

/** The refusal for `missing`, or undefined where nothing is missing. */
export function databaseBehindError(
  missing: readonly MissingFromDatabase[]
): CliError | undefined {
  if (missing.length === 0) return undefined;
  return databaseBehindMigrations(missing.length, missingLines(missing));
}
