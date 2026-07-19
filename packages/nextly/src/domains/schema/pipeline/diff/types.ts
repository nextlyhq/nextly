// Operation types - the structured representation of schema changes.
//
// Replaces the F4 PR 1 approach of parsing raw SQL strings emitted by
// drizzle-kit's pushSchema. Operations are emitted by our diff() function
// (see ./diff.ts) and consumed by:
//   - RegexRenameDetector (groups DROP+ADD pairs into rename candidates)
//   - PromptDispatcher (renders prompts for renames + destructive ops)
//   - PreResolutionExecutor (runs SQL for ops we own: rename, drop)
//   - The remaining pushSchema call for purely additive ops
//
// Why operations instead of SQL strings:
// drizzle-kit's pushSchema invokes a TTY-prompting columnsResolver when it
// sees a DROP+ADD pair on the same table. There is no public API to bypass
// this. By computing our own diff and pre-executing renames ourselves, we
// ensure pushSchema never sees a rename ambiguity, so its prompt never
// for the full Option E rationale.

// Lightweight column representation - just what we need for diff + SQL gen.
// Not a full Drizzle column descriptor; we don't track every Drizzle attribute.
export interface ColumnSpec {
  name: string;
  // Raw type token as it appears in DDL or as introspected from
  // information_schema.columns.udt_name (PG) / COLUMN_TYPE (MySQL) /
  // PRAGMA table_info.type (SQLite). Examples: "text", "varchar(255)",
  // "int4", "uuid", "timestamptz", "bpchar".
  type: string;
  nullable: boolean;
  // Raw default expression as written in DDL. Undefined when no default.
  // Examples: "'foo'::text", "now()", "0", "true", "gen_random_uuid()".
  default?: string;
}

export interface IndexSpec {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  // undefined = "no index data tracked" (pre-C1 snapshots) — the diff/drift
  // index dimension is SKIPPED for such tables. [] = tracked, none.
  indexes?: IndexSpec[];
  // `true` when this entity has content-localization enabled, so its
  // translatable columns live in the migration-owned companion `_locales` table
  // rather than here. Recorded ONLY when true — `undefined` means "not localized,
  // OR a pre-marker snapshot that never tracked this". Both read as "don't know
  // that it was localized", which is exactly the safe answer: migrate:create only
  // emits a DISABLE transition when it sees an explicit `true`, so it can never
  // false-positive on the common "add fields to a non-localized collection" case.
  //
  // This is a config-derived marker: DB-introspected snapshots cannot know it and
  // leave it undefined, so it is deliberately NOT part of the diff/drift
  // comparison — it only drives companion migration planning.
  localized?: boolean;
  // the companion's column names at the time this snapshot was written, recorded
  // alongside `localized`. This is the AUTHORITATIVE answer to "what actually lives in the
  // `_locales` table", which a later DISABLE needs in order to bring exactly those columns
  // home. Re-deriving the list from the new config instead would be wrong in both directions:
  // a field whose `localized: true` was removed in the same edit would be missed, and a
  // translatable field ADDED in the same edit would be restored from a companion that never
  // held it (emitting SQL that fails on apply). Present only when `localized` is true.
  localizedColumns?: string[];
}

// A snapshot of either the live DB state or the desired state. Only includes
// MANAGED tables (filtered by MANAGED_TABLE_PREFIXES_REGEX from F3).
export interface NextlySchemaSnapshot {
  tables: TableSpec[];
}

// =============================================================================
// Operation union
// =============================================================================

export type Operation =
  | AddTableOp
  | DropTableOp
  | RenameTableOp
  | AddColumnOp
  | DropColumnOp
  | RenameColumnOp
  | ChangeColumnTypeOp
  | ChangeColumnNullableOp
  | ChangeColumnDefaultOp
  | AddIndexOp
  | DropIndexOp;

export interface AddTableOp {
  type: "add_table";
  table: TableSpec;
}

export interface DropTableOp {
  type: "drop_table";
  tableName: string;
}

export interface RenameTableOp {
  type: "rename_table";
  fromName: string;
  toName: string;
}

export interface AddColumnOp {
  type: "add_column";
  tableName: string;
  column: ColumnSpec;
}

// drop_column carries the previous column type so the rename detector
// can read fromType without a separate lookup. Otherwise the detector
// would have to re-introspect the live DB at detection time.
export interface DropColumnOp {
  type: "drop_column";
  tableName: string;
  columnName: string;
  columnType: string;
}

export interface RenameColumnOp {
  type: "rename_column";
  tableName: string;
  fromColumn: string;
  toColumn: string;
  fromType: string;
  toType: string;
}

export interface ChangeColumnTypeOp {
  type: "change_column_type";
  tableName: string;
  columnName: string;
  fromType: string;
  toType: string;
}

export interface ChangeColumnNullableOp {
  type: "change_column_nullable";
  tableName: string;
  columnName: string;
  fromNullable: boolean;
  toNullable: boolean;
}

export interface ChangeColumnDefaultOp {
  type: "change_column_default";
  tableName: string;
  columnName: string;
  fromDefault: string | undefined;
  toDefault: string | undefined;
}

export interface AddIndexOp {
  type: "add_index";
  tableName: string;
  index: IndexSpec;
}

export interface DropIndexOp {
  type: "drop_index";
  tableName: string;
  index: IndexSpec;
}

// =============================================================================
// Operation classification helpers
// =============================================================================

// Operations we PRE-RESOLVE (run via our own SQL before calling pushSchema):
//   - rename_column / rename_table: avoid drizzle-kit's TTY prompt
//   - drop_column / drop_table: ensure F5's destructive-confirm runs first,
//     and stay symmetric with the pre-rename phase (ops we own end-to-end)
//
// Operations we let pushSchema handle (purely additive; no prompt in API):
//   - add_table, add_column
//   - change_column_type, change_column_nullable, change_column_default
export const PRE_RESOLUTION_OP_TYPES: ReadonlyArray<Operation["type"]> = [
  "rename_column",
  "rename_table",
  "drop_column",
  "drop_table",
] as const;

export function isPreResolutionOp(op: Operation): boolean {
  return (PRE_RESOLUTION_OP_TYPES as readonly string[]).includes(op.type);
}

// True when a (drop_column, add_column) pair could plausibly be a rename
// because they target the same table. The rename detector then applies
// type-family compatibility to decide the suggested resolution.
export function isPotentialRenamePair(
  drop: DropColumnOp,
  add: AddColumnOp
): boolean {
  return drop.tableName === add.tableName;
}
