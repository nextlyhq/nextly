// The words one judgement of a column's conversion is given in.
//
// A conversion changes a column's type, its nullability or both, and the rows it holds decide
// whether that can happen without losing anything. The same judgement serves every path that
// changes a saved column: a repair of a column an older version created, the development push and
// a Schema Builder type change. So it is stated here, in terms of a column and its stored values,
// and never in terms of any one of those paths.
//
// @module domains/schema/value-conversion/types

import type { SupportedDialect } from "../services/field-column-descriptor";

/**
 * How a conversion treats the values a column holds, worst last.
 *
 * - `safe`: every stored value converts and reads back as the same value.
 * - `lossy`: some values cannot be held by the new type and would be cleared; the rest convert.
 * - `blocked`: converting would cut a value, change it into a different value or need one
 *   invented, or there is no conversion for the pair. A blocked column is never converted.
 */
export type ConversionClass = "safe" | "lossy" | "blocked";

/**
 * How the field reads its values, which decides when a value "reads back the same": a JSON value by
 * what it parses to, a number by its numeric value, anything else exactly as stored.
 */
export type CompareAs = "json" | "number" | "exact";

/** A column's type and nullability, as a descriptor names them or the database reports them. */
export interface ColumnType {
  type: string;
  nullable: boolean;
  /** The size the database reports beside the type (PostgreSQL), when it reports one. */
  typeModifier?: string;
}

/** One column conversion: from the column as it is to the column its field expects. */
export interface ColumnConversion {
  dialect: SupportedDialect;
  from: ColumnType;
  to: ColumnType;
  compareAs: CompareAs;
  /**
   * The column holds a relation's references and becomes the JSON list a relation keeps on its row.
   * Such a conversion reads each stored value as a list rather than as JSON text.
   */
  referenceList?: boolean;
  /**
   * The conversion reads each value through its text, so the new column holds each value as the
   * old one printed it. Only a conversion that casts that way may say so: it is what lets a
   * PostgreSQL real become a double with 0.1 still reading 0.1.
   */
  throughText?: boolean;
}

/**
 * The full key of one row: a row of an entity's own table by its id, a row of a translation table
 * by its parent and locale, which together are that table's primary key.
 */
export type RowKey = { id: string } | { parent: string; locale: string };

/** How SQLite stores one value, as `typeof()` reports it. */
export type SqliteStorage = "null" | "integer" | "real" | "text" | "blob";

/**
 * One stored value, read so the judgement sees exactly what the database holds.
 *
 * `text` is the value as the database renders it as text (null for a NULL), so a 64-bit integer or a
 * decimal reaches the judgement with every digit, never as a rounded JavaScript number.
 */
export interface StoredValue {
  key: RowKey;
  text: string | null;
  /** SQLite only: how the value is stored, which decides how a rebuilt column's affinity copies it. */
  storage?: SqliteStorage;
  /**
   * SQLite only, for a REAL: the stored double to 17 significant digits, which always read back as
   * the same double. `text` is SQLite's own text of it, the text a TEXT column is given, which a
   * SQLite before 3.43 rounds to 15 digits.
   */
  exactReal?: string;
  /**
   * Whether the database itself parses the value as JSON, where it offers a predicate that says so
   * (MySQL's `JSON_VALID`). Where it is present it is the answer, so the judgement and the database
   * cannot disagree about a value's JSON.
   */
  jsonValid?: boolean;
}

/** Why one value, or the whole column, keeps a conversion from being safe. */
export type ConversionReasonKind =
  /** A value that does not parse as JSON, an empty string included, would be cleared. */
  | "not-json"
  /** The new column would keep the value in a form its field cannot read, so it would be cleared. */
  | "kept-unreadable"
  /** The value is longer than the new type holds, so it would be cut. */
  | "too-long"
  /** The database would accept the value and store a different one. */
  | "stored-differently"
  /** The column is to become NOT NULL and the row holds a null, so a value would be invented. */
  | "null-under-not-null"
  /** A relation's stored value the list conversion cannot read. */
  | "unreadable-reference-list"
  /** There is no conversion for this pair of types. */
  | "no-conversion"
  /**
   * The database cannot check the rows and change the column in one transaction, and the old type
   * can hold a value it would accept and store as a different one: a value written while the
   * conversion runs could be changed with no error.
   */
  | "late-write"
  /**
   * A value that would be cleared, where the new column does not allow a null: clearing it would
   * leave a null the column refuses, so a value would have to be invented.
   */
  | "cleared-under-not-null";

/** The rows one reason applies to: the first keys, up to a bound, and how many there are. */
export interface AffectedRows {
  first: RowKey[];
  count: number;
}

/** One reason, its class, and, for a reason a row gives, the rows that give it. */
export interface ConversionReason {
  kind: ConversionReasonKind;
  class: ConversionClass;
  /** Absent for a reason the pair of types gives, whatever the rows hold. */
  rows?: AffectedRows;
}

/** A conversion's class, the worst of its reasons, and every reason with its rows. */
export interface ConversionJudgement {
  class: ConversionClass;
  reasons: ConversionReason[];
}
