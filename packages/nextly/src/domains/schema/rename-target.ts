/**
 * A column rename is checked before it runs.
 *
 * Renaming a column onto a name the table already has cannot be done without losing one of the
 * two columns, so it is refused before any statement of the change runs, naming the table and
 * both columns. Checked from the statements the change is about to run, so the check sees exactly
 * the renames that would happen, and nothing a road decides elsewhere can disagree with it.
 *
 * A rename an earlier, stopped run of the same change already made (the new column there, the old
 * one gone) is not refused: the road that plans the change leaves it out, and the check passes it.
 *
 * And a database's report that a rename's target exists is a failure, never a step an earlier run
 * already applied: `isRenameStatement` names the statements whose refusal is never passed over.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../errors/nextly-error";

import { queryLiveColumnTypes } from "./pipeline/live-column-types";

/** One column renamed in one table. */
export interface ColumnRename {
  table: string;
  from: string;
  to: string;
}

/**
 * An identifier as the generators write one: quoted with `"` (PostgreSQL, SQLite) or a backtick
 * (MySQL), a doubled quote standing for one, or bare.
 */
const IDENTIFIER = String.raw`(?:"((?:[^"]|"")+)"|\x60((?:[^\x60]|\x60\x60)+)\x60|([A-Za-z_][A-Za-z0-9_]*))`;

/** `ALTER TABLE <table> RENAME COLUMN <from> TO <to>`, the one shape every generator writes. */
const COLUMN_RENAME = new RegExp(
  String.raw`ALTER\s+TABLE\s+${IDENTIFIER}\s+RENAME\s+COLUMN\s+${IDENTIFIER}\s+TO\s+${IDENTIFIER}`,
  "gi"
);

/** The identifier one of `IDENTIFIER`'s three alternatives matched, unquoted. */
function identifierAt(match: RegExpExecArray, first: number): string {
  const quoted = match[first];
  if (quoted !== undefined) return quoted.replace(/""/g, '"');
  const backticked = match[first + 1];
  if (backticked !== undefined) return backticked.replace(/``/g, "`");
  return match[first + 2] ?? "";
}

/** Every column rename the given SQL makes, in order. */
export function columnRenamesIn(
  sql: string | readonly string[]
): ColumnRename[] {
  const text = typeof sql === "string" ? sql : sql.join(";\n");
  const renames: ColumnRename[] = [];
  for (const match of text.matchAll(COLUMN_RENAME)) {
    renames.push({
      table: identifierAt(match, 1),
      from: identifierAt(match, 4),
      to: identifierAt(match, 7),
    });
  }
  return renames;
}

/**
 * Whether a statement renames something: a column, a table, an index. A runner that passes over a
 * refusal an earlier run of the same migration explains ("already exists") must not pass over
 * this one's, since "the target already exists" is exactly a rename that could not be made.
 */
export function isRenameStatement(statement: string): boolean {
  return (
    /\bALTER\s+(?:TABLE|INDEX)\b[\s\S]*\bRENAME\b/i.test(statement) ||
    /\bRENAME\s+TABLE\b/i.test(statement)
  );
}

/**
 * The renames whose new column the table already has while the old one is still there. A rename
 * whose old column is gone is not among them: the road planning it already found it made.
 */
export function renamesOntoTakenColumns(
  renames: readonly ColumnRename[],
  liveColumns: ReadonlyMap<string, ReadonlySet<string>>
): ColumnRename[] {
  return renames.filter(rename => {
    const live = liveColumns.get(rename.table);
    return live !== undefined && live.has(rename.to) && live.has(rename.from);
  });
}

/** The refusal's message for one rename onto a taken column. */
export function renameTargetTakenMessage(rename: ColumnRename): string {
  return `Column '${rename.from}' cannot be renamed to '${rename.to}': table '${rename.table}' already has a column '${rename.to}'. Remove or rename that column first, then save again.`;
}

/**
 * Refuse, before any of them runs, the renames among `renames` whose new column the table already
 * has, reading each named table's columns as they are now. Nothing is read when there is no
 * rename.
 *
 * @throws NextlyError `VALIDATION_ERROR` with one `RENAME_TARGET_TAKEN` entry per refused rename
 */
export async function refuseRenamesOntoTakenColumns(
  adapter: DrizzleAdapter,
  renames: readonly ColumnRename[],
  logContext: Record<string, unknown>
): Promise<void> {
  if (renames.length === 0) return;
  const tables = [...new Set(renames.map(rename => rename.table))];
  const live = await queryLiveColumnTypes(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect,
    tables
  );
  const liveColumns = new Map(
    [...live].map(([table, columns]) => [table, new Set(columns.keys())])
  );
  const taken = renamesOntoTakenColumns(renames, liveColumns);
  if (taken.length === 0) return;
  throw NextlyError.validation({
    errors: taken.map(rename => ({
      path: "fields",
      code: "RENAME_TARGET_TAKEN",
      message: renameTargetTakenMessage(rename),
    })),
    logContext: {
      ...logContext,
      reason: "rename-target-taken",
      renames: taken,
    },
  });
}
