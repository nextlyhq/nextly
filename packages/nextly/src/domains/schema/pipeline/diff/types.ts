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
// fires. See findings/nextly-schema-architecture/task-20-f4-drizzle-kit-prompt-issue.md
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

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
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
  | ChangeColumnDefaultOp;

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
