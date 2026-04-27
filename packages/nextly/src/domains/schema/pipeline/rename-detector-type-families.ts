// Per-dialect type-family tables for F4 RenameDetector.
//
// A "family" groups types that are interchangeable for rename purposes.
// On PG: `text`, `varchar(N)`, `char(N)` all live in the "text" family,
// so renaming `title (text) -> name (varchar(255))` defaults to 'rename'
// (not 'drop_and_add').
//
// Family lookup uses the type's leading token (everything before whitespace
// or the first '('), case-insensitive. Modifiers like NOT NULL / DEFAULT
// 'x' / REFERENCES are part of the input but not the family key.
//
// "uuid" is intentionally narrow on PG (only the native uuid type) - we
// don't want a `text -> uuid` rename to default to 'rename' because the
// byte representation differs. SQLite/MySQL "uuid" columns are conventional
// text/char(36) and naturally fall into the text family.
//
// See spec section 3.4 (introspection) for where `fromType` comes from at
// runtime.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

type TypeFamily =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "uuid"
  | "json"
  | "date_only"
  | "time_only"
  | "timestamp"
  | "binary";

const PG_FAMILIES: Record<TypeFamily, readonly string[]> = {
  text: ["text", "varchar", "char", "character", "character varying"],
  integer: [
    "smallint",
    "integer",
    "int",
    "int2",
    "int4",
    "int8",
    "bigint",
    "serial",
    "bigserial",
    "smallserial",
  ],
  decimal: [
    "decimal",
    "numeric",
    "real",
    "double precision",
    "double",
    "float",
  ],
  boolean: ["boolean", "bool"],
  uuid: ["uuid"],
  json: ["json", "jsonb"],
  date_only: ["date"],
  time_only: [
    "time",
    "timetz",
    "time with time zone",
    "time without time zone",
  ],
  timestamp: [
    "timestamp",
    "timestamptz",
    "timestamp with time zone",
    "timestamp without time zone",
  ],
  binary: ["bytea"],
};

const MYSQL_FAMILIES: Record<TypeFamily, readonly string[]> = {
  text: ["text", "varchar", "char", "tinytext", "mediumtext", "longtext"],
  integer: ["tinyint", "smallint", "mediumint", "int", "integer", "bigint"],
  decimal: ["decimal", "numeric", "float", "double", "real"],
  boolean: ["boolean", "bool"],
  uuid: [],
  json: ["json"],
  date_only: ["date"],
  time_only: ["time"],
  timestamp: ["timestamp", "datetime"],
  binary: ["binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob"],
};

const SQLITE_FAMILIES: Record<TypeFamily, readonly string[]> = {
  text: ["text", "varchar", "char", "character"],
  integer: ["integer", "int", "tinyint", "smallint", "mediumint", "bigint"],
  decimal: ["real", "double", "decimal", "numeric", "float"],
  boolean: ["boolean", "bool"],
  uuid: [],
  json: [],
  date_only: [],
  time_only: [],
  timestamp: [],
  binary: ["blob"],
};

const FAMILY_TABLES: Record<
  SupportedDialect,
  Record<TypeFamily, readonly string[]>
> = {
  postgresql: PG_FAMILIES,
  mysql: MYSQL_FAMILIES,
  sqlite: SQLITE_FAMILIES,
};

// Extract the family-token from a raw type string.
// "varchar(255) NOT NULL" -> "varchar"
// "TEXT"                  -> "text"
// "numeric(10,2)"         -> "numeric"
// Returns null for empty or whitespace-only input.
function leadingToken(rawType: string): string | null {
  const trimmed = rawType.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // Take the substring up to the first '(' or the first known modifier
  // keyword (NOT, NULL, DEFAULT, REFERENCES, PRIMARY, UNIQUE, COLLATE,
  // CHECK), whichever is earlier. Multi-word types like "double precision"
  // and "time with time zone" fall through to be matched verbatim against
  // the family table.
  const parenIdx = trimmed.indexOf("(");
  const modifierMatch = trimmed.match(
    /\s(?:not|null|default|references|primary|unique|collate|check)\b/
  );
  const modifierIdx = modifierMatch?.index ?? -1;

  let endIdx = trimmed.length;
  if (parenIdx >= 0) endIdx = Math.min(endIdx, parenIdx);
  if (modifierIdx >= 0) endIdx = Math.min(endIdx, modifierIdx);

  return trimmed.slice(0, endIdx).trim();
}

// Look up the family of a raw type string for the given dialect.
// Returns null if the type is empty, unrecognized, or the dialect has
// no entries for any family containing this type.
export function typeFamilyOf(
  rawType: string,
  dialect: SupportedDialect
): TypeFamily | null {
  const token = leadingToken(rawType);
  if (!token) return null;
  const table = FAMILY_TABLES[dialect];
  for (const family of Object.keys(table) as TypeFamily[]) {
    if (table[family].includes(token)) return family;
  }
  return null;
}

// Two types are compatible if they belong to the same family for the
// dialect. Returns false defensively for empty/unknown types - never
// silently treats an unknown type as compatible.
export function isTypesCompatible(
  fromType: string,
  toType: string,
  dialect: SupportedDialect
): boolean {
  const fromFamily = typeFamilyOf(fromType, dialect);
  const toFamily = typeFamilyOf(toType, dialect);
  if (fromFamily === null || toFamily === null) return false;
  return fromFamily === toFamily;
}
