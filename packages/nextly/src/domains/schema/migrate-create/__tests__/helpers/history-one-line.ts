/**
 * A project's migration history read as a deploy reads it, for the tests of
 * its writers: the `.sql` files in run order and the snapshot beside each.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

/** The migration files in `migrationsDir`, in run order. */
export function sqlFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();
}

/** The tables the snapshot of `file` records. */
export function snapshotTables(migrationsDir: string, file: string): string[] {
  const path = join(
    migrationsDir,
    "meta",
    file.replace(/\.sql$/, ".snapshot.json")
  );
  const snapshot = JSON.parse(readFileSync(path, "utf-8")) as {
    snapshot: { tables: { name: string }[] };
  };
  return snapshot.snapshot.tables.map(t => t.name).sort();
}

/** The tables `file` creates. */
function createdBy(migrationsDir: string, file: string): string[] {
  const sql = readFileSync(join(migrationsDir, file), "utf-8");
  return [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"]?(\w+)[`"]?/g)]
    .map(match => match[1])
    .sort();
}

/**
 * Asserts the history is one line: every file has its snapshot, each snapshot
 * holds the one before it plus the tables its own file creates that a
 * snapshot records (`recorded` picks them; all by default), each table is
 * created by exactly one file, and no other file is left in the folder.
 * Answers the recorded tables each file creates, in run order.
 */
export function historyAsOneLine(
  migrationsDir: string,
  recorded: (table: string) => boolean = () => true
): string[][] {
  let before: string[] = [];
  const created: string[][] = [];
  for (const file of sqlFiles(migrationsDir)) {
    const made = createdBy(migrationsDir, file).filter(recorded);
    const tables = snapshotTables(migrationsDir, file);
    expect(tables, file).toEqual([...new Set([...before, ...made])].sort());
    before = tables;
    created.push(made);
  }
  const all = created.flat();
  expect(new Set(all).size, "each table is created by one file").toBe(
    all.length
  );
  expect(
    readdirSync(migrationsDir).filter(f => f !== "meta" && !f.endsWith(".sql")),
    "nothing but migration files is left in the folder"
  ).toEqual([]);
  expect(
    readdirSync(join(migrationsDir, "meta")).filter(
      f => !f.endsWith(".snapshot.json")
    ),
    "nothing but snapshots is left beside them"
  ).toEqual([]);
  return created;
}
