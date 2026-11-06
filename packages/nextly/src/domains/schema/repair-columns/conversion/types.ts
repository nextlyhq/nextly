// What converting one column means on one database: the statements that change only its type and
// nullability, what they cost while they run, and what the new type cannot keep.
//
// A conversion keeps everything else the database reports for the column and its table: its
// default, comment, character set, collation, generated value and position; the table's other
// columns, rows, indexes, keys (other tables' included), checks, triggers, options and the views
// that read it. Where the new type cannot keep one of these, the difference is blocked and the plan
// says which and what the owner can change. A character set or collation the new type has no
// place for (a JSON column on PostgreSQL or MySQL) is named as not carried and does not block: no
// stored value depends on it.
//
// @module domains/schema/repair-columns/conversion/types

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnState } from "../types";

/** One column to convert, from the type and nullability it has to the ones its field expects. */
export interface ConversionRequest {
  dialect: SupportedDialect;
  /** The table and column as the database spells them. */
  table: string;
  column: string;
  from: ColumnState;
  to: ColumnState;
  /**
   * A component relation becoming the JSON list of references it keeps on its row, which reads
   * each stored shape as a list rather than casting the column (`pipeline/reference-list-conversion`).
   */
  referenceList?: boolean;
}

/**
 * Something the column or its table has that a conversion must keep. `definition` is the column's
 * own written definition, for a conversion that cannot rebuild it as written (SQLite reads it from
 * the table's stored statement, or a STRICT table refuses the new type).
 */
export type CarriedProperty =
  | "definition"
  | "default"
  | "index"
  | "key"
  | "check"
  | "trigger"
  | "view"
  /** Another column PostgreSQL computes from this one (`GENERATED ALWAYS AS`). */
  | "generated column"
  /** A row-level-security policy whose expression reads the column. */
  | "policy";

/** A property the new type cannot keep, which blocks the conversion. */
export interface CannotCarry {
  property: CarriedProperty;
  /** The index, key, check, trigger or view, or the column itself for its default. */
  name: string;
  /** Why the new type cannot keep it, in plain words. */
  reason: string;
  /** What the owner can change so that the column converts. */
  ownerCan: string;
}

/** A character set or collation the new type has no place for: named, never blocking. */
export interface NotCarried {
  property: "collation" | "characterSet";
  value: string;
}

/**
 * What the database keeps other sessions from doing while the conversion runs.
 *
 * - `reads-and-writes`: the table is closed to both until the conversion ends.
 * - `writes`: reads continue and writes wait until it ends.
 * - `brief-locks`: reads and writes continue, apart from brief exclusive locks as it starts and
 *   ends.
 */
export type BlockedWhileRunning = "reads-and-writes" | "writes" | "brief-locks";

/** How one column converts on one database, built from the live table and changing nothing. */
export interface ColumnConversionPlan {
  /**
   * The statements in order, grouped by what commits together. One group on PostgreSQL and SQLite,
   * where the whole conversion runs in one transaction; on MySQL each schema statement commits as
   * it runs, so a conversion of several steps (the list conversion's widen, rewrite and retype) is
   * one group per step.
   */
  steps: string[][];
  /** Whether the database rewrites or copies the table to run it. */
  rewritesTable: boolean;
  blocks: BlockedWhileRunning;
  /** Empty when the new type keeps everything; otherwise the conversion is blocked. */
  cannotCarry: CannotCarry[];
  notCarried: NotCarried[];
}
