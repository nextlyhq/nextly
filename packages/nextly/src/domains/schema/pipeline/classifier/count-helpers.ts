// Per-dialect count queries used by RealClassifier to populate
// add_not_null_with_nulls events with the NULL row count seen in the live
// DB at preview/apply time.
//
// Identifiers are guarded against quote injection via a strict regex —
// drizzle's sql.identifier could also work, but we want explicit fail-fast
// behavior on adversarial table names so that misuse is loud, not silent.
//
// Per-dialect db shapes mirror introspect-live.ts conventions:
//   - PG: db.execute() returns { rows: T[] }
//   - MySQL: db.execute() returns T[] OR [T[], fieldPackets] (defensive)
//   - SQLite: db.all() returns T[] (no execute()); take first row.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string, dialect: SupportedDialect): string {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `unsafe identifier: ${name} (only [A-Za-z_][A-Za-z0-9_]* allowed)`
    );
  }
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

interface PgMysqlExecute {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteAll {
  all(query: unknown): Array<{ count: string | number }>;
}

interface CountRow {
  count: string | number;
}

function asNumber(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  return typeof raw === "string" ? parseInt(raw, 10) : raw;
}

// Extracts a count from per-dialect db result shapes. Throws if shape is
// unrecognized so silent zero-counts can't mask broken integrations.
function extractCount(raw: unknown, dialect: SupportedDialect): number {
  if (dialect === "postgresql") {
    // pg: { rows: [{ count: "3" }] }
    const rows = (raw as { rows?: CountRow[] }).rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("PG count query returned no rows");
    }
    return asNumber(rows[0].count);
  }
  if (dialect === "mysql") {
    // mysql2 wraps in [rows, fieldPackets] tuple OR returns flat rows.
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      Array.isArray((raw as unknown[])[0])
    ) {
      const rows = (raw as [CountRow[], unknown])[0];
      if (rows.length === 0)
        throw new Error("MySQL count query returned no rows");
      return asNumber(rows[0].count);
    }
    if (Array.isArray(raw)) {
      const rows = raw as CountRow[];
      if (rows.length === 0)
        throw new Error("MySQL count query returned no rows");
      return asNumber(rows[0].count);
    }
    throw new Error("MySQL count query returned unrecognized shape");
  }
  // SQLite handled by caller before extractCount runs.
  throw new Error(`unrecognized dialect for extractCount: ${dialect}`);
}

export async function countNulls(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<number> {
  const tbl = quoteIdent(table, dialect);
  const col = quoteIdent(column, dialect);
  const query = sql.raw(
    `SELECT COUNT(*) AS count FROM ${tbl} WHERE ${col} IS NULL`
  );
  if (dialect === "sqlite") {
    const dbTyped = db as SqliteAll;
    const rows = dbTyped.all(query);
    if (rows.length === 0)
      throw new Error("SQLite count query returned no rows");
    return asNumber(rows[0].count);
  }
  const dbTyped = db as PgMysqlExecute;
  const result = await dbTyped.execute(query);
  return extractCount(result, dialect);
}

export async function countRows(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<number> {
  const tbl = quoteIdent(table, dialect);
  const query = sql.raw(`SELECT COUNT(*) AS count FROM ${tbl}`);
  if (dialect === "sqlite") {
    const dbTyped = db as SqliteAll;
    const rows = dbTyped.all(query);
    if (rows.length === 0)
      throw new Error("SQLite count query returned no rows");
    return asNumber(rows[0].count);
  }
  const dbTyped = db as PgMysqlExecute;
  const result = await dbTyped.execute(query);
  return extractCount(result, dialect);
}
