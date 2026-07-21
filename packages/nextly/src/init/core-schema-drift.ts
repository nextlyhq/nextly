/**
 * Detecting a database whose core tables are behind the running code.
 *
 * Nextly's own tables are created once, on first run. Nothing updates them
 * afterwards, so a column added to a core table in a later release never
 * reaches a database that already exists. The failure is silent and arrives
 * far from its cause: queries that name the new column fail at runtime, and
 * anything that swallows its own errors — retention, the audit log — simply
 * stops working without saying so.
 *
 * Upgrades are an explicit step (`nextly migrate`), so this does not repair
 * anything. It exists so the operator learns from a startup message rather
 * than from a downstream feature quietly doing nothing.
 *
 * @module init/core-schema-drift
 */

import { createHash } from "crypto";

import type { NextlySchemaSnapshot } from "../domains/schema/pipeline/diff/types";

/** Key under which the applied core-schema fingerprint is recorded. */
export const CORE_SCHEMA_FINGERPRINT_KEY = "core_schema_fingerprint";

/** A core table that exists but is missing columns the code expects. */
export interface CoreTableDrift {
  table: string;
  missingColumns: string[];
}

/**
 * A stable fingerprint of the core schema's shape.
 *
 * Covers table and column names only. Types and defaults are deliberately
 * excluded: they do not round-trip cleanly between the desired and live sides
 * yet, so including them would make the fingerprint change for reasons that
 * are not drift and train operators to ignore the warning.
 */
export function coreSchemaFingerprint(schema: NextlySchemaSnapshot): string {
  const shape = [...schema.tables]
    .map(table => ({
      name: table.name,
      columns: [...table.columns].map(c => c.name).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `${t.name}(${t.columns.join(",")})`)
    .join(";");
  return createHash("sha256").update(shape).digest("hex").slice(0, 32);
}

/**
 * Columns the code expects that the live database does not have.
 *
 * Only additions are reported. A live table carrying columns the code no
 * longer declares is not something an upgrade needs to act on, and reporting
 * it would turn a precise message into noise.
 *
 * A table missing entirely is also skipped: that is a different failure with
 * a different remedy, and the boot path is not where it should be diagnosed.
 */
export function findCoreSchemaDrift(
  live: NextlySchemaSnapshot,
  desired: NextlySchemaSnapshot
): CoreTableDrift[] {
  const liveByTable = new Map(
    live.tables.map(t => [
      t.name.toLowerCase(),
      new Set(t.columns.map(c => c.name.toLowerCase())),
    ])
  );

  const drift: CoreTableDrift[] = [];
  for (const table of desired.tables) {
    const liveColumns = liveByTable.get(table.name.toLowerCase());
    if (!liveColumns) continue;

    const missing = table.columns
      .map(c => c.name)
      .filter(name => !liveColumns.has(name.toLowerCase()));

    if (missing.length > 0) {
      drift.push({ table: table.name, missingColumns: missing.sort() });
    }
  }

  return drift.sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * The warning shown when the database is behind the code.
 *
 * Names the columns, because "your schema is out of date" sends someone
 * hunting while "audit_log is missing metadata" points at the fix. Names the
 * command too: the whole point of an explicit upgrade step is that the
 * operator must be told what to run.
 */
export function formatCoreSchemaDriftWarning(
  drift: readonly CoreTableDrift[]
): string {
  const lines = [
    "[nextly] Your database is missing columns this version of Nextly expects.",
    "",
    ...drift.map(d => `  ${d.table}: ${d.missingColumns.join(", ")}`),
    "",
    "  Run `nextly migrate` to bring the database up to date.",
    "  Until then, features using these columns will fail or silently do nothing.",
  ];
  return lines.join("\n");
}
