/**
 * What an extension column's kind becomes on each dialect.
 *
 * One implementation, because two callers ask it for different reasons and a
 * second copy would drift silently: the naming rules ask in order to refuse an
 * index the dialect cannot build, and the compiler asks in order to build the
 * column. If those two ever disagreed, a table would validate and then fail to
 * create — or worse, create with an index the diff engine keeps re-proposing.
 *
 * @module domains/schema/extension/column-sql-type
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";

import type { ExtensionColumn, ExtensionColumnKind } from "./types";

/** The width a `shortText` column takes where the dialect is bounded. */
export const SHORT_TEXT_LENGTH = 255;

/** A fixed spelling, or one computed from the column's own width. */
type DialectType =
  | string
  | ((
      column: Pick<ExtensionColumn, "length" | "precision" | "scale">
    ) => string);

const varcharOf = (column: Pick<ExtensionColumn, "length">): string =>
  `varchar(${String(column.length ?? SHORT_TEXT_LENGTH)})`;

const exactOf =
  (name: string) =>
  (column: Pick<ExtensionColumn, "precision" | "scale">): string =>
    `${name}(${String(column.precision ?? 10)},${String(column.scale ?? 0)})`;

const BOUNDED_TEXT = `varchar(${String(SHORT_TEXT_LENGTH)})`;

/**
 * The SQL type each kind takes, per dialect.
 *
 * A table rather than a switch because the mapping IS the specification: every
 * row reads as the portability rule it encodes, and the differences — MySQL
 * bounding ordinary text so it stays indexable, SQLite collapsing almost
 * everything — are visible by reading down a column instead of by tracing
 * branches.
 */
const SQL_TYPES: Record<
  ExtensionColumnKind,
  Record<SupportedDialect, DialectType>
> = {
  // MySQL bounds an ordinary text field so it stays indexable; the other two
  // index unbounded text without complaint.
  text: { postgresql: "text", mysql: BOUNDED_TEXT, sqlite: "text" },
  longText: { postgresql: "text", mysql: "text", sqlite: "text" },
  shortText: {
    postgresql: BOUNDED_TEXT,
    mysql: BOUNDED_TEXT,
    sqlite: "text",
  },
  varchar: { postgresql: varcharOf, mysql: varcharOf, sqlite: "text" },
  boolean: { postgresql: "boolean", mysql: "tinyint(1)", sqlite: "integer" },
  integer: { postgresql: "integer", mysql: "int", sqlite: "integer" },
  double: {
    postgresql: "double precision",
    mysql: "double",
    sqlite: "real",
  },
  decimal: {
    postgresql: exactOf("numeric"),
    mysql: exactOf("decimal"),
    sqlite: exactOf("numeric"),
  },
  timestamp: {
    postgresql: "timestamp",
    mysql: "timestamp",
    sqlite: "integer",
  },
  json: { postgresql: "jsonb", mysql: "json", sqlite: "text" },
};

/**
 * The SQL type a column takes on one dialect.
 *
 * Returned as the same spelling the existing index helpers match on
 * (`columnTypeIsIndexable`, `uniquenessCanBeAnIndex`), so their MySQL rules
 * about JSON and TEXT apply to extension columns exactly as they do to
 * collection columns.
 */
export function extensionColumnSqlType(
  column: Pick<ExtensionColumn, "kind" | "length" | "precision" | "scale">,
  dialect: SupportedDialect
): string {
  const entry = SQL_TYPES[column.kind][dialect];
  return typeof entry === "function" ? entry(column) : entry;
}

/**
 * How many bytes a column occupies in a MySQL index key.
 *
 * MySQL caps an InnoDB key at 3072 bytes, and it counts the DECLARED width
 * rather than the stored one — four bytes per character under utf8mb4, whatever
 * the row actually holds. A compound index over a few `varchar(255)` columns
 * therefore reaches the cap long before it looks like it should.
 *
 * Returns null for a kind that cannot be keyed at all, which is a different
 * answer from "wide": the caller refuses those with a clearer message.
 */
export function mysqlKeyBytes(
  column: Pick<ExtensionColumn, "kind" | "length">
): number | null {
  const UTF8MB4_BYTES_PER_CHAR = 4;
  switch (column.kind) {
    case "text":
      return SHORT_TEXT_LENGTH * UTF8MB4_BYTES_PER_CHAR;
    case "shortText":
      return SHORT_TEXT_LENGTH * UTF8MB4_BYTES_PER_CHAR;
    case "varchar":
      return (column.length ?? SHORT_TEXT_LENGTH) * UTF8MB4_BYTES_PER_CHAR;
    case "boolean":
      return 1;
    case "integer":
      return 4;
    case "double":
      return 8;
    case "decimal":
      return 8;
    case "timestamp":
      return 8;
    case "longText":
    case "json":
      // Neither can be keyed on MySQL without a prefix length, which the
      // neutral model has no way to express.
      return null;
  }
}

/** The InnoDB limit a compound key may not exceed. */
export const MYSQL_MAX_KEY_BYTES = 3072;
