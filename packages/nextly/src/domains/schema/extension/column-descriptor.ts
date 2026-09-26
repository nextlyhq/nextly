/**
 * An extension column as a {@link ColumnDescriptor}, and nothing else.
 *
 * Split out of `compile.ts` for the same reason `active-schema.ts` was split
 * out of the builder: the runtime schema generator has to render a
 * contributed column on an entity table, and `compile.ts` imports the
 * generator — so reaching for it there would close the loop. This module
 * imports only the renderer, which the generator already depends on. The
 * column's default and key live here for the same reason: both routes build
 * a Drizzle column from an extension column, and they must build the same one.
 *
 * @module domains/schema/extension/column-descriptor
 * @since 1.0.0
 */
import { sql as drizzleSql } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { currentTimestampSql } from "../../../lib/system-columns";
import type { ColumnDescriptor } from "../services/field-column-descriptor";
import { renderDialectType } from "../services/field-column-descriptor";
import {
  quoteExpressionSqlDefault,
  quoteSqlLiteral,
} from "../utils/sql-literal";

import type { ExtensionColumn } from "./types";

/** The descriptor an extension column becomes, so it renders like any other. */
export function toColumnDescriptor(
  column: ExtensionColumn,
  dialect: SupportedDialect
): ColumnDescriptor {
  return {
    name: column.name,
    dialectType: renderDialectType(column.kind, dialect, {
      ...(column.length !== undefined ? { length: column.length } : {}),
      ...(column.precision !== undefined
        ? { precision: column.precision }
        : {}),
      ...(column.scale !== undefined ? { scale: column.scale } : {}),
    }),
    nullable: column.nullable,
    kind: column.kind,
    ...(column.length !== undefined ? { length: column.length } : {}),
    ...(column.precision !== undefined ? { precision: column.precision } : {}),
    ...(column.scale !== undefined ? { scale: column.scale } : {}),
  };
}

/**
 * The DDL default for a column, or undefined.
 *
 * A token is rendered per dialect through the SAME helper the core system
 * columns use, so `created_at` on a plugin table and `created_at` on a core
 * table carry one spelling. Two spellings would read to the diff as a default
 * change on every single apply.
 */
export function defaultSql(
  column: ExtensionColumn,
  dialect: SupportedDialect
): string | undefined {
  const value = column.default;
  if (value === undefined) return undefined;
  // The tagged token, which is why it is tagged: a text column may hold the
  // literal string "now", and that must render as a quoted value.
  if (typeof value === "object") return currentTimestampSql(dialect);
  if (typeof value === "string") {
    // Through the shared quoter, never `'${value}'`. DDL is assembled as text
    // before it reaches the driver, so an apostrophe — `O'Reilly` — closed the
    // quote early and produced a migration that could not parse on any dialect.
    // The helper also doubles backslashes for MySQL, which reads one as an
    // escape introducer where the others store it verbatim; a JSON default
    // would otherwise come back with a real newline in it and stop being JSON.
    //
    // MySQL refuses a LITERAL default on a TEXT, BLOB or JSON column (error
    // 1101) and accepts only an expression default, so every such column —
    // `json`, and `longText`, which MySQL stores as TEXT — takes the hex
    // expression form. Asked of the rendered type rather than a list of
    // kinds, so a kind that starts rendering as TEXT is covered by the rule.
    const { dialectType } = toColumnDescriptor(column, dialect);
    return needsExpressionDefault(dialectType, dialect)
      ? quoteExpressionSqlDefault(value, dialect)
      : quoteSqlLiteral(value, dialect);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Whether this dialect accepts a default on a column of this type only as an
 * expression.
 *
 * MySQL's rule: TEXT, BLOB and JSON in every width (`tinytext` through
 * `longblob`). PostgreSQL and SQLite take a literal default on any type.
 */
function needsExpressionDefault(
  dialectType: string,
  dialect: SupportedDialect
): boolean {
  return (
    dialect === "mysql" &&
    /^(?:(?:tiny|medium|long)?(?:text|blob)|json)$/i.test(dialectType.trim())
  );
}

/**
 * A built column with the key and default its declaration carries.
 *
 * Both belong to the table the push creates rather than to statements added
 * after it, and nothing adds them later: left off, a fresh database had no
 * primary key on any dialect — so every foreign key pointing at the table was
 * refused for want of a unique target — and an insert omitting a defaulted
 * column failed NOT NULL. The default is the spec's own rendering, the text
 * the diff compares, so the table created here and the one the diff expects
 * are the same table.
 *
 * Shared by every builder of a Drizzle column from an extension column — an
 * extension table's own, and a column contributed to an entity table — so
 * the table drizzle-kit is handed and the spec the diff compares carry one
 * default, whichever route builds it.
 */
export function withDeclaredKeyAndDefault(
  built: unknown,
  column: ExtensionColumn,
  dialect: SupportedDialect
): unknown {
  let result = built as DrizzleColumnBuilder;
  const rendered = defaultSql(column, dialect);
  if (rendered !== undefined) {
    result = result.default(drizzleSql.raw(rendered)) as DrizzleColumnBuilder;
  }
  return column.primaryKey === true ? result.primaryKey() : result;
}

/** The two modifiers every dialect's column builder offers. */
interface DrizzleColumnBuilder {
  primaryKey(): unknown;
  default(value: unknown): unknown;
}
