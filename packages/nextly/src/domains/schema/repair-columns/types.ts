// The difference model `nextly repair-columns` reports from.
//
// Every record is ONE column of ONE table, a whole missing table included (one record per column
// its fields name), so a count of records is a count of columns and a later step that classes,
// converts or reports a column has exactly one record to attach its facts to. A column has at most
// two records: how its live column differs from its field as the database last had it applied,
// and, separately, a change to that field the configuration holds and no migration has applied.
//
// @module domains/schema/repair-columns/types

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { ColumnOverride } from "../extension/draft";
import type { ColumnOrigin } from "../services/field-column-descriptor";
import type { ConversionJudgement } from "../value-conversion/types";

import type { DifferenceToClass } from "./classify";
import type { ColumnAspects } from "./column-comparison";
import type { ColumnConversionPlan } from "./conversion/types";

/** The kinds of entity whose fields Nextly builds a table from. */
export type RepairEntityKind =
  | "collection"
  | "single"
  | "fieldGroup"
  | "userFields";

/**
 * Which builder made an entity's tables: one of the descriptor's origins, or the user-extension
 * builder that makes `user_ext`. That builder never read the descriptor and shares none of its
 * rules, so it is named here rather than among the descriptor's origins, and its columns are asked
 * of the builder itself.
 */
export type RepairColumnOrigin = ColumnOrigin | "userFields";

/**
 * A field list, whether the entity keeps its translatable fields in a `_locales` table, and which
 * builder makes its tables from it.
 *
 * The builder belongs to the definition rather than to the entity because the two sides can have
 * different owners: a Builder collection that code has adopted keeps the Builder's table until the
 * adoption's migration applies, so its applied definition is the Builder's and its configured one
 * is code-first.
 */
export interface EntityDefinition {
  fields: readonly FieldDefinition[];
  localized: boolean;
  /** Which builder makes the tables from this definition, which decides the column each field names. */
  origin: RepairColumnOrigin;
  /**
   * The app's overrides of the entity's own field columns' storage under this definition: the
   * storage those columns are judged against in place of the field's. Absent, there are none.
   */
  columnOverrides?: readonly ColumnOverride[];
  /**
   * The type the applied migration snapshot recorded for each column of the entity's table, where a
   * snapshot says what was applied. A field column it recorded with other storage than its field's
   * own, within the field's value family, was overridden when that migration was written, whatever
   * the configuration says now.
   */
  recordedTypes?: Readonly<Record<string, string>>;
}

/**
 * Where an entity's applied definition was read from.
 *
 * - `snapshot`: the newest applied migration snapshot that records entities, where it records this
 *   one, which is what the database last had applied.
 * - `registry`: the entity's registry row, read where that snapshot does not record the entity (a
 *   site with no migration files, only files written before snapshots recorded entities, or an
 *   entity the snapshot no longer records). For user fields, the stored definitions.
 *
 * Nothing else says what was applied. An entity neither records, or whose registry row still waits
 * for its migration, has no applied definition: it awaits a migration.
 */
export type AppliedDefinitionSource = "snapshot" | "registry";

/** An entity's definition as the database last had it applied, and where that was read from. */
export type AppliedDefinition = EntityDefinition & {
  source: AppliedDefinitionSource;
};

/** One entity, with its field list as last applied and as configured now. */
export interface RepairEntity {
  kind: RepairEntityKind;
  slug: string;
  /** The entity's own table; translatable fields live in `<table>_locales`. */
  table: string;
  /**
   * The definition every live column is judged against, or null where no record says what was
   * applied: the configuration alone declares the entity, or its registry row waits for a
   * migration and no applied snapshot says what it was before. Such an entity awaits a migration,
   * so a column that differs from its configured definition is reported as pending, not judged.
   */
  applied: AppliedDefinition | null;
  /**
   * The definition the next migration would apply, or null where nothing declares the entity any
   * more. Compared with `applied` to find the changes still pending a migration.
   */
  configured: EntityDefinition | null;
  /** The plugin that owns the entity, when one does. */
  plugin?: string;
}

/** Where a column is, and whose field it holds. */
export interface ColumnLocation {
  kind: RepairEntityKind;
  slug: string;
  /** The field's name as configured. */
  field: string;
  table: string;
  column: string;
  /** The column is in the entity's `_locales` translation table. */
  translation: boolean;
}

/** A column's type and nullability, as a descriptor names them or the database reports them. */
export interface ColumnState {
  type: string;
  nullable: boolean;
  /** The size the database reports beside the type (PostgreSQL), when it reports one. */
  typeModifier?: string;
}

/** A legacy column shape an earlier generator created, which no current generator does. */
export type LegacyShape =
  /** A repeater or group held as `text`, where the descriptor names JSON. */
  | "structured-as-text"
  /** A float number held as `decimal(10,2)`, where the descriptor names a double. */
  | "float-as-decimal"
  /** A MySQL column the legacy type map left as `text`, where the descriptor names a varchar. */
  | "mysql-text-fallback"
  /** A component's many-to-many held in a scalar column, where the descriptor names a JSON list. */
  | "component-list-in-scalar";

/** Why a column differs, where that is known. */
export type DifferenceCause =
  /** A generator of the current version still creates this column; the column is not legacy. */
  | { kind: "current-generator" }
  /** An earlier generator created it; `before` is the first release whose generator does not. */
  | { kind: "legacy"; shape: LegacyShape; before: string };

interface FindingBase {
  location: ColumnLocation;
  /** The plugin that owns the column's entity. Such a column is reported and never changed. */
  plugin?: string;
}

/** A table, or a column the applied definition names, that the database does not have. */
export interface NotMigratedFinding extends FindingBase {
  kind: "not-migrated";
  missing: "table" | "column";
  expected: ColumnState;
}

/** A live column whose type or nullability differs from its field's applied descriptor. */
export interface DiffersFinding extends FindingBase {
  kind: "differs";
  expected: ColumnState;
  live: ColumnState;
  aspects: ColumnAspects;
  cause: DifferenceCause | null;
  /**
   * Whether the column can convert, from the rows it holds: its class, every reason and the rows
   * that give it. Null for a column a plugin owns, which is reported and never changed.
   */
  judgement: ConversionJudgement | null;
  /**
   * How the column would convert, read from the live table: its statements, what they cost and
   * what the new type cannot keep, which makes the difference blocked. Null where the judgement is
   * null or found no conversion for the pair of types.
   */
  conversion: ColumnConversionPlan | null;
  /**
   * How many rows the conversion rewrites on this database: every row of the table where the
   * database rewrites or copies it to convert the column, none where it changes the column in
   * place. Null where there is no conversion to run.
   */
  rowsRewritten: number | null;
  /**
   * What the judgement was asked: the field, the column as the database spells it and how its rows
   * are keyed. An apply asks it again inside the change that converts the column, so a value
   * written since the report is judged too. Absent on a finding built by hand.
   */
  judged?: DifferenceToClass;
}

/**
 * A change to the field that the configuration holds and no migration has applied: the column is
 * left to that migration. `applied` is null for a field the configuration adds or where the applied
 * definition is unknown; `configured` is null for a field the configuration removes. `live` is the
 * column as it is now, or null where it does not exist.
 */
export interface PendingMigrationFinding extends FindingBase {
  kind: "pending-migration";
  applied: ColumnState | null;
  configured: ColumnState | null;
  live: ColumnState | null;
}

/**
 * A column the applied definition names on a table whose definition the database would not let
 * the run read, because another connection held the whole database (SQLite in exclusive locking
 * mode). Whether it differs could not be read, so it carries what the configuration gives: where
 * it is and the column its field expects.
 */
export interface DefinitionUnreadableFinding extends FindingBase {
  kind: "definition-unreadable";
  expected: ColumnState;
}

export type ColumnFinding =
  | NotMigratedFinding
  | DiffersFinding
  | PendingMigrationFinding
  | DefinitionUnreadableFinding;
