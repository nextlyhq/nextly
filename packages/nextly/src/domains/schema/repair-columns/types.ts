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
import type { ColumnOrigin } from "../services/field-column-descriptor";

import type { ColumnAspects } from "./column-comparison";

/** The kinds of entity whose fields Nextly builds a table from. */
export type RepairEntityKind =
  | "collection"
  | "single"
  | "fieldGroup"
  | "userFields";

/**
 * Which builder made an entity's tables: one of the descriptor's origins, or the user-extension
 * builder that makes `user_ext`. That builder never read the descriptor and shares none of its
 * rules, so it is named here rather than among the descriptor's origins, and its columns are
 * described by `getUserFieldColumnDescriptor`.
 */
export type RepairColumnOrigin = ColumnOrigin | "userFields";

/** A field list, and whether the entity keeps its translatable fields in a `_locales` table. */
export interface EntityDefinition {
  fields: readonly FieldDefinition[];
  localized: boolean;
}

/**
 * Where an entity's applied definition was read from.
 *
 * - `snapshot`: the newest applied migration snapshot that records entities, where it records this
 *   one, which is what the database last had applied.
 * - `registry`: the entity's registry row, read where that snapshot does not record the entity (a
 *   site with no migration files, only files written before snapshots recorded entities, or an
 *   entity the snapshot no longer records).
 * - `configuration`: neither records it, so the configuration is the only definition there is.
 */
export type AppliedDefinitionSource = "snapshot" | "registry" | "configuration";

/** One entity, with its field list as last applied and as configured now. */
export interface RepairEntity {
  kind: RepairEntityKind;
  slug: string;
  /** The entity's own table; translatable fields live in `<table>_locales`. */
  table: string;
  /** Which builder made the entity's tables, which decides the column each field names. */
  origin: RepairColumnOrigin;
  /** The definition every live column is judged against. */
  applied: EntityDefinition & { source: AppliedDefinitionSource };
  /**
   * The definition the configuration holds now, or null where it does not declare the entity.
   * Compared with `applied` to find the changes still pending a migration.
   */
  configured: EntityDefinition | null;
  /**
   * The registry row says its definition waits for a migration, and no applied snapshot says what
   * it was before. The applied definition is then unknown, so a column that differs from the row
   * is reported as pending a migration rather than judged.
   */
  awaitingMigration: boolean;
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

export type ColumnFinding =
  | NotMigratedFinding
  | DiffersFinding
  | PendingMigrationFinding;
