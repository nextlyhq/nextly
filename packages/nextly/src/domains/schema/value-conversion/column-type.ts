// What a column type is, as far as converting the values it holds is concerned.
//
// Spellings are folded by `normalizeType`, the one rule the schema diff reads types by, so `int4`
// and `integer`, or `character varying` and `varchar`, are one type here as they are there. Sizes
// are read by `declaredSize`, from inside the type or from the size PostgreSQL reports beside it.
//
// @module domains/schema/value-conversion/column-type

import { declaredSize } from "../pipeline/diff/declared-size";
import { normalizeType } from "../pipeline/diff/normalize-type";

import type { ColumnType } from "./types";

/** The kinds of type a conversion is judged between. `other` is every type no conversion reads. */
export type TypeFamily =
  | "text"
  | "varchar"
  | "char"
  | "json"
  | "uuid"
  | "int2"
  | "int4"
  | "int8"
  | "float4"
  | "float8"
  | "numeric"
  | "other";

/** A column type's family and the size it states, where it states one. */
export interface ParsedType {
  family: TypeFamily;
  /** A varchar's length. */
  length?: number;
  /** A decimal's precision: how many significant digits it holds. */
  precision?: number;
}

/** Canonical type tokens, as `normalizeType` returns them, and the family each belongs to. */
const FAMILY_OF: Record<string, TypeFamily> = {
  text: "text",
  // MySQL's larger text types hold what `text` holds, and a conversion reads them the same way.
  tinytext: "text",
  mediumtext: "text",
  longtext: "text",
  varchar: "varchar",
  // A fixed-length string. PostgreSQL drops its padding when it is read as text, so it converts only
  // where each value is read as a relation's id.
  bpchar: "char",
  json: "json",
  jsonb: "json",
  uuid: "uuid",
  int2: "int2",
  smallint: "int2",
  int4: "int4",
  int8: "int8",
  float4: "float4",
  // MySQL spells a four-byte float `float` and an eight-byte one `double`.
  float: "float4",
  float8: "float8",
  double: "float8",
  numeric: "numeric",
};

/** The family and stated size of `column`'s type. */
export function parseColumnType(column: ColumnType): ParsedType {
  const family = FAMILY_OF[normalizeType(column.type) ?? ""] ?? "other";
  const size = declaredSize({ name: "", ...column });
  const first = size === undefined ? undefined : Number(size.split(",")[0]);
  const stated =
    first !== undefined && Number.isInteger(first) ? first : undefined;
  if (family === "varchar") return { family, length: stated };
  if (family === "numeric") return { family, precision: stated };
  return { family };
}

/** SQLite's type affinities: how a column applies its declared type to a value written to it. */
export type SqliteAffinity = "TEXT" | "NUMERIC" | "INTEGER" | "REAL" | "BLOB";

/**
 * The affinity SQLite gives a column declared `type`, by SQLite's own rules, tried in this order:
 * a name holding INT is INTEGER; CHAR, CLOB or TEXT is TEXT; BLOB, or no type, is BLOB; REAL, FLOA or
 * DOUB is REAL; anything else is NUMERIC.
 */
export function sqliteAffinity(type: string): SqliteAffinity {
  const declared = type.toUpperCase();
  if (declared.includes("INT")) return "INTEGER";
  if (/CHAR|CLOB|TEXT/.test(declared)) return "TEXT";
  if (declared.includes("BLOB") || declared.trim() === "") return "BLOB";
  if (/REAL|FLOA|DOUB/.test(declared)) return "REAL";
  return "NUMERIC";
}
