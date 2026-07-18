import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
} from "../../schema/services/field-column-descriptor";

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
    case "decimal": {
      // Exact numeric so a localized decimal keeps its precision in the
      // companion table; PG/SQLite render NUMERIC, MySQL DECIMAL — matching the
      // main-table column emitted by field-column-descriptor.
      const precision = col.precision ?? DEFAULT_DECIMAL_PRECISION;
      const scale = col.scale ?? DEFAULT_DECIMAL_SCALE;
      return dialect === "mysql"
        ? `DECIMAL(${precision}, ${scale})`
        : `NUMERIC(${precision}, ${scale})`;
    }
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

/** Cast a column expression to text for archival, per dialect. */
export function castText(colExpr: string, dialect: SupportedDialect): string {
  return dialect === "mysql"
    ? `CAST(${colExpr} AS CHAR)`
    : `CAST(${colExpr} AS TEXT)`;
}
