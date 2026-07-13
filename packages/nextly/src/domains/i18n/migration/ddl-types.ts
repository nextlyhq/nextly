import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { LocalizedColumnSpec } from "./types";

/**
 * Logical kind -> canonical DDL keyword, per dialect.
 *
 * We intentionally do NOT reuse `field-column-descriptor`'s `renderDialectType`: it is
 * unexported and emits introspection tokens (int4/float8/bool), not DDL keywords. This
 * mirrors `getSchemaEventsDdl`'s hand-written canonical DDL instead.
 */
export function ddlType(
  col: LocalizedColumnSpec,
  dialect: SupportedDialect
): string {
  const len = col.length ?? 255;
  switch (col.kind) {
    case "text":
      return dialect === "mysql" ? `VARCHAR(${len})` : "TEXT";
    case "longText":
      return dialect === "mysql" ? "LONGTEXT" : "TEXT";
    case "boolean":
      return dialect === "postgresql"
        ? "BOOLEAN"
        : dialect === "mysql"
          ? "TINYINT(1)"
          : "INTEGER";
    case "integer":
      return dialect === "mysql" ? "INT" : "INTEGER";
    case "double":
      return dialect === "postgresql"
        ? "DOUBLE PRECISION"
        : dialect === "mysql"
          ? "DOUBLE"
          : "REAL";
    case "timestamp":
      return dialect === "postgresql"
        ? "TIMESTAMPTZ"
        : dialect === "mysql"
          ? "DATETIME(3)"
          : "INTEGER";
    case "json":
      return dialect === "postgresql"
        ? "JSONB"
        : dialect === "mysql"
          ? "JSON"
          : "TEXT";
    case "fkSingle":
      return dialect === "mysql" ? "VARCHAR(36)" : "TEXT";
    default: {
      const _exhaustive: never = col.kind;
      throw new Error(`Unknown column kind: ${String(_exhaustive)}`);
    }
  }
}

/** Quote an identifier for the dialect (backticks on MySQL, double quotes elsewhere). */
export function q(id: string, dialect: SupportedDialect): string {
  return dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
}

/**
 * Escape a value for use inside a single-quoted SQL string literal (doubles embedded quotes).
 * Defense-in-depth (L9): the values interpolated into generated migration SQL — locale codes,
 * collection slugs, column names — are already validated upstream, but they are written to an
 * executable `.sql` file, so escaping removes any residual injection surface.
 */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Cast a column expression to text for archival, per dialect. */
export function castText(colExpr: string, dialect: SupportedDialect): string {
  return dialect === "mysql"
    ? `CAST(${colExpr} AS CHAR)`
    : `CAST(${colExpr} AS TEXT)`;
}
