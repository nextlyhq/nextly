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
import {
  parseSnapshotFile,
  SnapshotFileError,
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
}

/** Each table's columns, lower-cased, by lower-cased table name. */
type Columns = ReadonlyMap<string, ReadonlySet<string>>;

function columnsOf(snapshot: NextlySchemaSnapshot): Map<string, Set<string>> {
  return new Map(
    snapshot.tables.map(table => [
      table.name.toLowerCase(),
      new Set(table.columns.map(column => column.name.toLowerCase())),
    ])
  );
}

/**
 * What the newest of `applied` records and `live` lacks, each with the
 * applied migration that last created it: the newest one whose snapshot holds
 * it where the applied snapshot before it does not. Pure.
 */
export function missingFromDatabase(
  applied: readonly AppliedSnapshot[],
  live: Columns
): MissingFromDatabase[] {
  const newest = applied.at(-1);
  if (newest === undefined) return [];
  const createdBy = new Map<string, string>();
  let before = new Map<string, Set<string>>();
  for (const { migration, snapshot } of applied) {
    const now = columnsOf(snapshot);
    for (const [table, columns] of now) {
      const had = before.get(table);
      if (had === undefined) createdBy.set(table, migration);
      for (const column of columns) {
        if (had === undefined || !had.has(column)) {
          createdBy.set(`${table}.${column}`, migration);
        }
      }
    }
    before = now;
  }
  const missing: MissingFromDatabase[] = [];
  for (const table of newest.snapshot.tables) {
    const name = table.name.toLowerCase();
    const liveColumns = live.get(name);
    if (liveColumns === undefined) {
      missing.push({
        table: table.name,
        createdBy: createdBy.get(name) ?? newest.migration,
      });
      continue;
    }
    for (const column of table.columns) {
      const key = column.name.toLowerCase();
      if (liveColumns.has(key)) continue;
      missing.push({
        table: table.name,
        column: column.name,
        createdBy: createdBy.get(`${name}.${key}`) ?? newest.migration,
      });
    }
  }
  return missing;
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
        snapshot: file.snapshot,
      });
    } catch (error) {
      if (!(error instanceof SnapshotFileError)) throw error;
      break;
    }
  }
  return applied.reverse();
}

/** One line per missing table or column, as the refusal names them. */
export function missingLines(
  missing: readonly MissingFromDatabase[]
): string[] {
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
