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
// See spec §3.4 (introspection) for where `fromType` comes from at
// runtime.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

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
  // bpchar is what PG's information_schema.columns.udt_name returns for
  // char(N) columns (blank-padded char). Without it here, a legitimate
  // char(N) -> text rename would default to drop_and_add.
  text: ["text", "varchar", "char", "bpchar", "character", "character varying"],
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
  dialect: SupportedDialect,
  /**
   * The columns the pair would move between, when the caller knows them.
   *
   * Only a CROSS-family answer depends on this, and only one such answer exists. Same-family
   * compatibility is a property of the types alone and is unaffected. Omitting this therefore never
   * widens what is accepted — it narrows it, which is the safe direction for a caller that cannot
   * say which columns it is asking about.
   */
  columns?: { from: string; to: string }
): boolean {
  const fromFamily = typeFamilyOf(fromType, dialect);
  const toFamily = typeFamilyOf(toType, dialect);
  if (fromFamily === null || toFamily === null) return false;
  if (fromFamily === toFamily) return true;
  if (!columns) return false;
  return (
    isConvertibleFamilyChange(fromFamily, toFamily) &&
    isLegacyUnderscoreRepair(columns.from, columns.to)
  );
}

/**
 * Whether a pair is the legacy column the text-to-JSON conversion exists to repair.
 *
 * 🔴 The conversion is offered for a NAMED defect, not for text-to-JSON in general. A table created
 * before the column-name fix holds `_items` where everything else addresses `items`, and for a
 * repeater or a group it holds `text` where the descriptor asks for JSON. That pair is known to
 * contain serialized JSON, because the old builder is what wrote it.
 *
 * Any other edit that happens to drop a text column and add a JSON one is not that: its text is
 * whatever a user typed. Offering the rename there defaults the operator into a conversion that
 * fails on the first row of ordinary prose — and on MySQL the rename has already auto-committed by
 * then, leaving a half-changed schema no transaction can take back.
 *
 * So the shape is the evidence. Recognising it is what separates "this column is JSON that was
 * stored as text" from "these two columns are both on this table".
 */
function isLegacyUnderscoreRepair(from: string, to: string): boolean {
  return from === `_${to}`;
}

/**
 * Whether a column can carry its contents across a change of family.
 *
 * Same-family is the ordinary case and needs no conversion. This covers the one pair that is not
 * the same family and still holds every value it had: text into JSON. A structured value stored in
 * a text column is already the JSON serialization of itself, so the database can reinterpret it in
 * place, and refusing the rename means the only recovery on offer drops the column and recreates it
 * empty.
 *
 * Deliberately one-directional. JSON back into text would also preserve the bytes, but nothing in
 * this product moves that way, and a rule that answers a question no caller asks is a rule nobody
 * maintains.
 *
 * 🔴 Offering the rename is only half of it. A rename does not convert on its own, so a caller that
 * acts on this must also change the column's type; `executePreResolutionOps` is where that pairing
 * is made.
 */
function isConvertibleFamilyChange(
  fromFamily: TypeFamily,
  toFamily: TypeFamily
): boolean {
  return fromFamily === "text" && toFamily === "json";
}
